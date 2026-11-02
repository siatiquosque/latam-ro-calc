import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { CardPosition } from 'src/app/constants/card-position.enum';
import { enchantPoolsFor } from 'src/app/core/equipment-slot-derivation';
import { randomOptionCatalogFor } from 'src/app/core/random-option-catalog';
import { Dataset } from '../data/dataset';
import { BuildPatch, applyPatch } from './variants';
import { partnerIndex } from './item-partners';
import { relatedItemKeys, ResolvedBuild } from './build-input';
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';
import { canGradeItem } from 'src/app/utils/can-grade';
import { isUndefended } from './dummies';
import { refineLimitFor } from 'src/app/core/equipment-rules';
import { skillSynergyKeys } from 'src/app/core/skill-synergy';

const indexes = new WeakMap<Dataset, { byAegis: Map<string, number>; cards: Map<string, number[]> }>();
function indexFor(dataset: Dataset) {
  let index = indexes.get(dataset);
  if (!index) {
    index = { byAegis: new Map(), cards: new Map() };
    for (const row of Object.values(dataset.items)) {
      index.byAegis.set(row.aegisName, row.id);
      for (const tag of dataset.itemIndex.get(row.id)?.slotTags ?? []) {
        if (tag.endsWith('Card')) index.cards.set(tag, [...(index.cards.get(tag) ?? []), row.id]);
      }
    }
    indexes.set(dataset, index);
  }
  return index;
}

/**
 * Every legal choice for each socket of a piece, unranked: all the cards its card slots accept and all the enchants its
 * positions offer. `complementChoices` ranks and cuts (a search needs to), and a ranking by script keys can miss the one
 * that wins for a reason it does not model (a card that scales with HP); the last pass of the optimizer walks this list.
 */
export function socketOptions(dataset: Dataset, slot: string, itemId: number): { field: string; kind: 'card' | 'enchant'; position: number; ids: number[] }[] {
  const descriptor = EQUIPMENT_SLOTS.find((entry) => entry.key === slot);
  const item = dataset.items[itemId];
  if (!descriptor || !item) return [];
  const index = indexFor(dataset);
  const cardTag = descriptor.cardListKey?.replace(/List$/, '');
  const cards = (index.cards.get(cardTag) ?? []).filter((id) => {
    const card = dataset.items[id];
    return dataset.itemIndex.get(id)?.latam === true && !!card
      && !(slot === 'accLeft' && card.compositionPos === CardPosition.AccR)
      && !(slot === 'accRight' && card.compositionPos === CardPosition.AccL);
  });
  const result: { field: string; kind: 'card' | 'enchant'; position: number; ids: number[] }[] = descriptor.cardFields
    .slice(0, item.slots || 0).map((field, position) => ({ field, kind: 'card' as const, position, ids: cards }));
  const pools = (enchantPoolsFor(item) ?? []) as (string[] | null | undefined)[];
  descriptor.enchantFields.forEach((field, position) => {
    if (!field) return;
    const ids = (pools[position] ?? []).map((name) => index.byAegis.get(name)).filter((id): id is number => !!id && !!dataset.items[id]);
    if (ids.length) result.push({ field, kind: 'enchant', position, ids });
  });

  return result;
}

/** Legal socket choices only. Unknown regional random pools never become free-form stats. */
export function complementChoices(dataset: Dataset, slot: string, itemId: number, keys: string[], excluded: Set<number>) {
  const descriptor = EQUIPMENT_SLOTS.find(d => d.key === slot);
  const item = dataset.items[itemId];
  if (!descriptor || !item) return [];
  const score = (id: number) => Object.entries(dataset.items[id]?.script ?? {}).reduce((sum, [key, value]) =>
    sum + (keys.includes(key) ? 10 + (Array.isArray(value) ? value : [value]).reduce((n: number, v: unknown) => n + (typeof v === 'number' ? Math.abs(v) : 0), 0) : 0), 0);
  const rank = (ids: number[]) => [...new Set(ids)].filter(id => !excluded.has(id) && dataset.items[id])
    .filter(id => Object.keys(dataset.items[id]?.script ?? {}).some(key => keys.includes(key) || key.startsWith('chance__')))
    .sort((a, b) => score(b) - score(a) || a - b);
  const cardTag = descriptor.cardListKey?.replace(/List$/, '');
  const index = indexFor(dataset);
  const legalCards = (index.cards.get(cardTag) ?? []).filter(id => {
    const card = dataset.items[id];
    return dataset.itemIndex.get(id)?.latam === true
      && !(slot === 'accLeft' && card.compositionPos === CardPosition.AccR)
      && !(slot === 'accRight' && card.compositionPos === CardPosition.AccL);
  });
  const rankedCards = rank(legalCards);
  const legal = new Set(legalCards);
  const partners = partnerIndex(dataset);
  const cards = [...new Set(rankedCards.flatMap(id => [id, ...partners.of(id)
    .filter(partner => legal.has(partner) && !excluded.has(partner))]))];
  const fields: BuildPatch[][] = descriptor.cardFields.slice(0, item.slots || 0)
    .map(field => [...cards.map(id => ({ gear: { [field]: id } })), { gear: { [field]: null } }]);
  const byAegis = index.byAegis;
  const enchants = enchantPoolsFor(item) ?? [];
  descriptor.enchantFields.forEach((field, position) => {
    if (!field) return;
    const ids = rank((enchants[position] ?? []).map(name => byAegis.get(name)).filter((id): id is number => !!id));
    if (ids.length) fields.push([...ids.map(id => ({ gear: { [field]: id } })), { gear: { [field]: null } }]);
  });
  const catalog = randomOptionCatalogFor(itemId);
  if (catalog && descriptor.optionIndexes.length) {
    // Keep each combiner atomic: never combine the best roll of unrelated coins.
    const seeds: BuildPatch[] = [];
    const positions = new Map<number, BuildPatch[]>();
    for (const profile of catalog.profiles) {
      const choices = profile.positions.map(pool => pool.filter(rule => keys.includes(rule.key))
        .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key)));
      // A profile is one legal coin. Vary positions independently while keeping its other positions valid.
      const defaults = Object.fromEntries(choices.flatMap((pool, position) => pool[0] && descriptor.optionIndexes[position] !== undefined
        ? [[descriptor.optionIndexes[position], `${pool[0].key}:${pool[0].max}`]] : []));
      if (Object.keys(defaults).length) seeds.push({ options: { ...Object.fromEntries(descriptor.optionIndexes.map(index => [index, null])), ...defaults } });
      choices.forEach((pool, position) => {
        const index = descriptor.optionIndexes[position];
        if (index === undefined) return;
        const rolls = positions.get(index) ?? [];
        for (const rule of pool) for (const bound of ['max', 'min'] as const) {
          rolls.push({ options: { [index]: `${rule.key}:${rule[bound]}` } });
        }
        positions.set(index, rolls);
      });
    }
    // Change coin atomically, then improve each position. resolveBuild validates the combined profile.
    if (seeds.length) fields.push(seeds);
    for (const rolls of positions.values()) fields.push([...new Map(rolls.map(patch => [JSON.stringify(patch), patch])).values()]);
  }
  return fields;
}

/** Bounded beam, scored by the real solver. The base survives every stage. */
export function searchComplements<T extends { metrics: Record<string, number | undefined> }>(
  initial: { patch: BuildPatch; result: T }, fields: BuildPatch[][], objective: string,
  solve: (patch: BuildPatch) => T | null,
  budget = Math.max(48, fields.reduce((sum, field) => sum + field.length, 0) * 2),
) {
  let beam = [initial];
  const cache = new Map<string, T | null>();
  const canonical = (patch: BuildPatch) => JSON.stringify(patch, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  let remaining = budget;
  for (const [index, choices] of fields.entries()) {
    const next = [...beam];
    const pendingChoices = fields.slice(index).reduce((sum, field) => sum + field.length, 0);
    const perStage = Math.max(1, Math.floor(remaining * choices.length / Math.max(1, pendingChoices)));
    let spent = 0;
    stage: for (const entry of beam) for (const choice of choices) {
      if (spent >= perStage || remaining <= 0) break stage;
      const patch = applyPatch(entry.patch, choice);
      const key = canonical(patch);
      let result = cache.get(key);
      if (!cache.has(key)) { result = solve(patch); cache.set(key, result); spent++; remaining--; }
      if (result) next.push({ patch, result });
    }
    const unique = new Map(next.map(entry => [JSON.stringify(entry.patch), entry]));
    beam = [...unique.values()].sort((a, b) => (b.result.metrics[objective] ?? -Infinity) - (a.result.metrics[objective] ?? -Infinity)).slice(0, 3);
  }
  return beam[0];
}

/** Bonus keys every damage build cares about, whatever the skill. */
const COMMON_DAMAGE_KEYS = ['atk', 'atkPercent', 'pAtk', 'pow', 'str', 'dex', 'luk', 'cri', 'criDmg', 'cRate', 'range', 'melee', 'allStatus', 'p_race_all', 'p_size_all', 'p_element_all', 'p_class_all', 'ignore_size_penalty', 'ignorePhysicalDef', 'p_pene_race_all'];

const SIZE_INITIAL: Record<string, string> = { SMALL: 's', MEDIUM: 'm', LARGE: 'l' };

/**
 * Which bonus keys can move this build's damage against this target: the formula's own stage keys,
 * plus the race, size and element keys of the monster. An item whose script has none of them cannot
 * matter, so it is never solved.
 */
/** The refine a build can realistically reach; above it is high endgame, so it is only tested when asked for. */
export const REACHABLE_REFINE = 12;

export function relevantKeys(calc: any, targets: any[] = []): string[] {
  const summary = calc.getTotalSummary() as any;
  const keys = new Set<string>(COMMON_DAMAGE_KEYS);
  const selected = String(calc.model?.selectedAtkSkill ?? '').split('==')[0];
  const skill = calc.atkSkills?.find((entry: { name: string }) => entry.name === selected);
  if (skill) for (const key of skillSynergyKeys(skill)) keys.add(key);
  if (summary.dmg?.dmgType === 'Magical') {
    for (const key of ['matk', 'matkPercent', 'sMatk', 'spl', 'int', 'm_race_all', 'm_size_all', 'm_element_all', 'm_class_all', 'm_my_element_all', 'ignoreMagicDef', 'm_pene_race_all']) keys.add(key);
  }
  for (const key of ['aspd', 'aspdPercent', 'agi', 'vct', 'acd']) keys.add(key);
  for (const step of summary.dmg?.skillFormulaTrace?.max ?? []) for (const key of step.keys ?? []) keys.add(String(key));

  for (const monster of [summary.monster ?? {}, ...targets]) {
    const race = String(monster.raceUpper ?? monster.stats?.raceName ?? '').toLowerCase();
    const size = SIZE_INITIAL[String(monster.sizeFullUpper ?? monster.stats?.scaleName ?? '').toUpperCase()];
    const element = String(monster.elementName ?? monster.stats?.elementName ?? '').split(' ')[0].toLowerCase();
    if (race) keys.add(`p_race_${race}`);
    if (size) keys.add(`p_size_${size}`);
    if (size) keys.add(`sizePenalty_${size}`);
    if (element) keys.add(`p_element_${element}`);

    // Penetration and size penalty decide a physical build against a given target: an item that ignores the DEF of this
    // race or class, cuts TEN, or lifts the weapon's penalty against this size is worth testing even if its own script
    // says nothing about damage. Class is the monster's own (normal or boss); unknown means both.
    const kind = String(monster.type ?? monster.stats?.type ?? '').toLowerCase();
    const classes = kind === 'boss' || kind === 'normal' ? [kind] : ['normal', 'boss'];
    const prefixes = summary.dmg?.dmgType === 'Magical' ? ['m_pene', 'pene_mres'] : ['p_pene', 'pene_res'];
    for (const prefix of prefixes) {
      keys.add(prefix);
      keys.add(`${prefix}_race_all`);
      keys.add(`${prefix}_class_all`);
      if (race) keys.add(`${prefix}_race_${race}`);
      for (const name of classes) keys.add(`${prefix}_class_${name}`);
    }
    for (const name of classes) keys.add(`${summary.dmg?.dmgType === 'Magical' ? 'm' : 'p'}_class_${name}`);
  }

  return [...keys];
}

const ASPD_CAP = 193;

/** Limits the build can sit short of, read off the same solve: ASPD against its cap and HIT against what the target needs for 100%. */
function breakpointsOf(summary: any, monster: any) {
  const calc = summary.calc ?? {};
  const aspd = calc.totalAspd;
  const hit = calc.totalHit;
  const required = monster.hitRequireFor100;
  const notes: string[] = [];
  if (typeof aspd === 'number' && aspd >= ASPD_CAP) notes.push(`ASPD no teto (${ASPD_CAP}): mais velocidade de ataque não rende.`);
  if (typeof hit === 'number' && typeof required === 'number' && hit < required) notes.push(`Faltam ${required - hit} de ACERTO para acertar 100% neste alvo.`);

  return {
    aspd, aspdCap: ASPD_CAP, hit, hitRequiredFor100: required, hitRatePct: calc.hitRate, hitsPerSecond: calc.hitPerSecs,
    ...(notes.length ? { notes } : {}),
  };
}

/**
 * What the target does to this build, for the answer: the penalty its weapon takes against the target's size and how
 * much DEF the build ignores. They are inputs to every number the search ranks, so the caller should see them.
 */
export function damageContext(calc: any) {
  const summary = calc.getTotalSummary() as any;
  const monster = summary.monster ?? {};
  const sizePenalty = summary.dmg?.sizePenalty;
  const penetration = summary.dmg?.totalPene;
  return {
    target: { name: monster.name, race: monster.raceUpper ?? monster.race, size: monster.sizeFullUpper ?? monster.size, class: monster.type, element: monster.elementName, def: monster.def, res: monster.res, mdef: monster.mdef, mres: monster.mres },
    ...(typeof sizePenalty === 'number' ? { sizePenaltyPct: sizePenalty } : {}),
    ...(typeof penetration === 'number' ? { penetrationPct: penetration } : {}),
    // A build's bonuses against normal monsters and against bosses differ (p_class_*, penetration by class): one target is one answer.
    classNote: monster.type === 'boss' || monster.type === 'normal'
      ? `O alvo é ${monster.type === 'boss' ? 'chefe' : 'monstro normal'}: a build pode render diferente contra ${monster.type === 'boss' ? 'normais' : 'chefes'} (bônus e penetração por classe). Passe \`targets\` com um de cada para ver os dois.` : undefined,
    // A target without defenses hides penetration, TEN reduction and size penalty, and makes every hit look bigger than it is.
    ...(isUndefended({ def: monster.def, mdef: monster.mdef, res: monster.res, mres: monster.mres })
      ? { undefendedNote: 'O alvo não tem DEF, DEFM, TEN nem TENM: penetração e redução de TEN não aparecem e o dano parece maior do que é. Use um chefe real ou os dummies com defesa (ids 9000001 a 9000004).' } : {}),
    breakpoints: breakpointsOf(summary, monster),
    ...(typeof sizePenalty === 'number' && sizePenalty < 100
      ? { hint: `A arma causa só ${sizePenalty}% contra o tamanho do alvo: itens que ignoram a penalidade de tamanho (ignore_size_penalty) ou fixam sizePenalty valem mais aqui.` } : {}),
  };
}


/**
 * What the new piece can keep of what the old one carried. A card or enchant left in a socket the
 * new piece does not have would still be counted by the engine, and the "better" build would be one
 * no player can wear. Cards keep their order up to the piece's slot count; an enchant stays only if
 * the new piece's pool at that position offers it.
 */
export function keptSockets(dataset: Dataset, rb: ResolvedBuild, slot: string, itemId: number): { clear: string[]; dropped: string[] } {
  const item = dataset.items[itemId];
  const pools = enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined;
  const clear: string[] = [];
  const dropped: string[] = [];
  let cards = 0;

  for (const key of relatedItemKeys(slot)) {
    const carried = (rb.model as any)[key];
    if (typeof carried !== 'number' || carried <= 0) continue;

    const isEnchant = /Enchant(\d)$/.exec(key);
    const fits = isEnchant
      ? !!pools?.[Number(isEnchant[1])]?.includes(dataset.items[carried]?.aegisName)
      : ++cards <= (item?.slots ?? 0);
    if (!fits) {
      clear.push(key);
      dropped.push(dataset.itemIndex.get(carried)?.name ?? String(carried));
    }
  }

  return { clear, dropped };
}



/**
 * The patch that puts `itemId` in `slot` for a comparison: the new piece at the ideal refine and grade (or the caller's cap),
 * the old piece's cards and enchants it cannot hold taken out, its random rolls cleared. For the piece already worn only the
 * refine and grade move. Shared by `optimize_slot` and `scan_slot`, so both rank on the same footing.
 */
export function swapPatch(dataset: Dataset, rb: ResolvedBuild, slot: string, itemId: number, caps: { refine?: number; maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A' } = {}): BuildPatch {
  const model = rb.model as Record<string, any>;
  const worn = model[slot] === itemId;
  const grade = canGradeItem(dataset.items[itemId]) ? (caps.maxGrade === undefined ? 'A' : caps.maxGrade === 'none' ? '' : caps.maxGrade) : worn ? undefined : '';
  const refineTo = searchRefineFor(rb, slot, itemId, caps.refine);

  return {
    gear: Object.fromEntries([
      ...(worn ? [] : [[slot, itemId], ...keptSockets(dataset, rb, slot, itemId).clear.map((key) => [key, null])]),
      ...(refineTo !== undefined ? [[`${slot}Refine`, refineTo]] : []),
      ...(grade !== undefined && (`${slot}Grade` in model || canGradeItem(dataset.items[itemId])) ? [[`${slot}Grade`, grade]] : []),
    ]),
    ...(worn ? {} : { options: Object.fromEntries((ItemOptionMap.get(slot as ItemTypeEnum) ?? []).map((index) => [String(index), null])) }),
  };
}

export function searchRefineFor(rb: ResolvedBuild, slot: string, itemId: number, requested?: number): number | undefined {
  if (!(`${slot}Refine` in rb.model)) return undefined;
  const cap = refineLimitFor(slot, rb.items[itemId]);
  return Math.min(cap, requested ?? (rb.model[slot] === itemId ? Math.max(REACHABLE_REFINE, rb.model[`${slot}Refine`] ?? 0) : REACHABLE_REFINE));
}
