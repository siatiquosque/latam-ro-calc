/** Transport-free build operations. Browser UI and MCP call these same implementations. */

import { z } from 'zod';
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { ExtraOptionTable } from 'src/app/constants/extra-option-table';
import { randomOptionCatalogFor, randomPoolTier } from 'src/app/core/random-option-catalog';
import { enchantPoolsFor } from 'src/app/core/equipment-slot-derivation';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { canUsedByClass, round } from 'src/app/utils';
import { canGradeItem } from 'src/app/utils/can-grade';
import { Dataset } from '../data/dataset';
import { ItemRow } from '../data/item-index';
import { SlotTag } from '../data/slot-classifier';
import { BuildInput, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, resolveBuild, ResolvedBuild } from '../engine/build-input';
import { DEFAULT_METRICS, Metric, METRICS, Metrics, objectiveFor, Profile, readMetrics } from '../engine/metrics';
import { buildShareUrl, Shortener, toPreset } from '../engine/share';
import { solveWithInput } from '../engine/solve';
import { applyPatch, BuildPatch, decodeOnce } from '../engine/variants';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { validateBuild } from '../engine/validate';
import { APP_VERSION } from 'src/app/core/app-version';
import { complementChoices, damageContext, keptSockets, REACHABLE_REFINE, relevantKeys, searchComplements, socketOptions, swapPatch, searchRefineFor } from '../engine/complements';
import { enchantCombinationError, refineLimitFor } from 'src/app/core/equipment-rules';
import { partnerIndex } from '../engine/item-partners';
import { pacing } from '../engine/pacing';
import { procData, procEstimate, procUptime, prepareProcPolicy, ProcPolicy, ProcMode } from '../engine/proc';
import { CHECK_DUMMIES, isUndefended } from '../engine/dummies';
import { AspdPotionList, AspdPotionStackable } from 'src/app/constants/aspd-potion-list';
import { targetSchema } from './calculate';
import { createBuildContext } from './context';
import { SEARCH_SLOTS } from '../engine/search-slots';
import { AnalysisRuntime } from '../runtime';
import { compact } from './compact';

type TargetArg = z.infer<typeof targetSchema>;

const metricEnum = z.enum(METRICS);

export const requireSchema = z.object({
  metric: metricEnum,
  min: z.number().optional(),
  max: z.number().optional(),
});

export function evaluate(
  base: BuildInput,
  patch: BuildPatch | undefined,
  dataset: Dataset,
  monster: any,
  effects: string[],
  wanted: readonly Metric[],
  more: { monster: any; weight: number }[] = [],
  weight = 1,
  autoProcs: ProcPolicy = false,
) {
  return evaluateResolved(resolveBuild(patch ? applyPatch(base, patch) : base, dataset), base, patch, dataset, monster, effects, wanted, more, weight, autoProcs);
}

type Evaluation = ReturnType<typeof evaluate>;

/**
 * `evaluate` for a build the caller already resolved. The search asks about the same build many times (a card tried in the
 * quick pass and again in the full one, a worn piece met again on the next round: about a quarter of all the calculations of
 * a real search were repeats), so it keeps what it measured: the metrics are a pure function of the resolved build, the
 * target and the effects. A repeat costs the key, not the ~5 ms calculation, and does not count against the budget.
 * `solved` (the live calculator) is only there on a fresh calculation: anything that reads it uses `fresh`.
 */
export function evaluationCache(limit = 4000) {
  const store = new Map<string, { metrics: Metrics; procEvaluation: Evaluation['procEvaluation'] }>();
  const cache = {
    hits: 0,
    evaluate(base: BuildInput, patch: BuildPatch | undefined, dataset: Dataset, monster: any, effects: string[], wanted: readonly Metric[], more: { monster: any; weight: number }[] = [], weight = 1, autoProcs: ProcPolicy = false): Evaluation {
      const rb = resolveBuild(patch ? applyPatch(base, patch) : base, dataset);
      const policy = typeof autoProcs === 'object' ? `${autoProcs.mode}:${autoProcs.hitsPerSecond}:${autoProcs.metadata.size}` : String(autoProcs);
      const key = [monster?.id ?? monster?.name, effects.join('|'), wanted.join(','), more.map((aim) => `${aim.monster?.id ?? aim.monster?.name}:${aim.weight}`).join(','), weight, policy, JSON.stringify(rb.model), JSON.stringify(rb.customItems ?? [])].join('§');
      const known = store.get(key);
      if (known) {
        cache.hits++;
        return { rb, solved: undefined as unknown as Evaluation['solved'], metrics: { ...known.metrics }, procEvaluation: known.procEvaluation };
      }
      const result = evaluateResolved(rb, base, patch, dataset, monster, effects, wanted, more, weight, autoProcs);
      if (store.size >= limit) store.delete(store.keys().next().value as string);
      store.set(key, { metrics: { ...result.metrics }, procEvaluation: result.procEvaluation });

      return result;
    },
  };

  return cache;
}

function evaluateResolved(
  rb: ResolvedBuild,
  base: BuildInput,
  patch: BuildPatch | undefined,
  dataset: Dataset,
  monster: any,
  effects: string[],
  wanted: readonly Metric[],
  more: { monster: any; weight: number }[],
  weight: number,
  autoProcs: ProcPolicy,
) {
  let first = solveWithInput(rb, dataset, monster, effects);
  if (autoProcs === true) {
    // Procs only exist on the calculator after a solve, and a swapped-in piece brings its own: count whatever this build offers.
    const offered = ((first.calc.chanceList ?? []) as any[]).map(chance => chance?.name).filter((name): name is string => !!name && !effects.includes(name));
    if (offered.length) { effects = [...effects, ...offered]; first = solveWithInput(rb, dataset, monster, effects); }
  }
  const solved = { ...first, rb, effects };
  const metrics = readMetrics(solved, wanted);
  const procEvaluation: { counted: string[]; uncounted: string[] } = { counted: [], uncounted: [] };
  if (autoProcs === true) procEvaluation.counted = effects.filter(effect => (first.calc.chanceList ?? []).some(chance => chance.name === effect));
  if (typeof autoProcs === 'object') {
    const offered = (first.calc.chanceList ?? []).filter(chance => chance?.name && !effects.includes(chance.name));
    const known = offered.map(chance => ({ chance, data: chance.ratePct && chance.durationSeconds ? chance : autoProcs.metadata.get(chance.itemId) }))
      .filter(entry => entry.data?.ratePct && entry.data?.durationSeconds);
    // Enumerate independent on/off states exactly for up to three known procs. Never assume an unknown proc is permanent.
    const counted = known.slice(0, 3);
    procEvaluation.counted = counted.map(entry => entry.chance.name);
    procEvaluation.uncounted = offered.map(chance => chance.name).filter(name => !procEvaluation.counted.includes(name));
    const damageMetrics = wanted.filter(metric => ['dps', 'avgHit', 'rotationDps', 'burstDps'].includes(metric));
    for (const metric of damageMetrics) metrics[metric] = 0;
    for (let mask = 0; mask < 2 ** counted.length; mask++) {
      let probability = 1;
      const active = [...effects];
      counted.forEach(({ chance, data }, index) => {
        const uptime = procUptime(data.ratePct, data.durationSeconds, autoProcs.hitsPerSecond);
        probability *= mask & 2 ** index ? uptime : 1 - uptime;
        if (mask & 2 ** index) active.push(chance.name);
      });
      const state = mask === 0 ? readMetrics(solved, damageMetrics) : readMetrics({ ...solveWithInput(rb, dataset, monster, active), rb, effects: active }, damageMetrics);
      for (const metric of damageMetrics) if (state[metric] !== undefined) metrics[metric] += probability * state[metric];
    }
  }

  // Further targets re-target the same calculator (the gear pass does not change with the monster), and
  // only the damage figures depend on it. Done last: it leaves the calculator on the final target.
  if (more.length) {
    const fields = wanted.filter(metric => ['max', 'min', 'dps', 'avgHit', 'rotationDps', 'burstDps'].includes(metric));
    const sums: Record<string, number> = Object.fromEntries(fields.map(key => [key, (metrics[key] ?? 0) * weight]));
    let total = weight;
    for (const aim of more) {
      const next = evaluate(base, patch, dataset, aim.monster, effects, wanted, [], 1, autoProcs);
      for (const key of fields) sums[key] += (next.metrics[key] ?? 0) * aim.weight;
      total += aim.weight;
    }
    for (const key of fields) if (metrics[key] !== undefined) metrics[key] = sums[key] / total;
  }

  return { rb, solved, metrics, procEvaluation };
}

function unconfirmed(rb: ResolvedBuild, changes: BuildPatch, dataset: Dataset) {
  const rolled = changes.options ?? {};
  const rows = [...ItemOptionMap].flatMap(([slot, indexes]) => {
    const id = Number((rb.model as unknown as Record<string, unknown>)[slot]);
    const options = indexes.filter(index => rolled[String(index)]).map(index => rolled[String(index)]);
    return id > 0 && options.length && randomPoolTier(id) === 'rathena' ? [{ slot, item: itemLabel(dataset, id), options }] : [];
  });
  return rows.length ? { unconfirmedRolls: { note: 'Pool do rAthena (kRO), aceito como referência do LATAM (sem confirmação regional); avise se alguma rolagem não existir no jogo.', rows } } : {};
}

export const itemLabel = (dataset: Dataset, id: number, grade?: string): string =>
  `${dataset.itemIndex.get(id)?.name ?? '?'} (${id})${grade ? ` ${grade}` : ''}`;

export const deltaPct = (value: number | undefined, base: number | undefined): number | null =>
  value === undefined || !base ? null : round(((value - base) / base) * 100, 2);

export const meets = (metrics: Metrics, rules: z.infer<typeof requireSchema>[]): boolean =>
  rules.every(({ metric, min, max }) => {
    const value = metrics[metric];

    return value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max);
  });

export const roundMetrics = (metrics: Metrics, keep: readonly Metric[]): Metrics =>
  Object.fromEntries(keep.filter((k) => metrics[k] !== undefined).map((k) => [k, round(metrics[k]!, 2)])) as Metrics;

const aegisIndexes = new WeakMap<Dataset, Map<string, number>>();

function aegisIndex(dataset: Dataset): Map<string, number> {
  let index = aegisIndexes.get(dataset);
  if (!index) {
    index = new Map();
    for (const [id, item] of Object.entries(dataset.items)) if (item?.aegisName) index.set(item.aegisName, Number(id));
    aegisIndexes.set(dataset, index);
  }

  return index;
}

const GRADES = ['', 'D', 'C', 'B', 'A'] as const;

interface Removal {
  kind: 'gear' | 'active' | 'passive' | 'buff' | 'consumable';
  name: string;
  detail?: string;
  patch: BuildPatch;
}

function removals(rb: ResolvedBuild, dataset: Dataset): Removal[] {
  const model: any = rb.model;
  const list: Removal[] = [];

  for (const key of ITEM_ID_KEYS) {
    const id = model[key];
    if (typeof id !== 'number' || id <= 0 || !rb.items[id]) continue;
    list.push({ kind: 'gear', name: rb.items[id].name ?? String(id), detail: key, patch: { gear: { [key]: null } } });
  }
  for (const [kind, map, field] of [
    ['active', model.activeSkillMap, 'active'],
    ['passive', model.passiveSkillMap, 'passive'],
    ['buff', model.skillBuffMap, 'buffs'],
  ] as const) {
    for (const [name, level] of Object.entries((map ?? {}) as Record<string, number>)) {
      if (typeof level === 'number' && level > 0) list.push({ kind, name, detail: `Nv ${level}`, patch: { skills: { [field]: { [name]: 0 } } } });
    }
  }
  for (const id of (model.consumables ?? []) as number[]) {
    list.push({ kind: 'consumable', name: dataset.itemIndex.get(id)?.name ?? String(id), patch: { consumables: (model.consumables as number[]).filter((c) => c !== id) } });
  }

  return list;
}

function contributions(
  base: BuildInput,
  rb: ResolvedBuild,
  baseValue: number | undefined,
  metric: Metric,
  monster: any,
  effects: string[],
  dataset: Dataset,
  max: number,
  config: AnalysisRuntime,
) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };

  const all = removals(rb, dataset);
  const limit = Math.min(max, config.limits.maxContributions);
  const rows = all.slice(0, config.limits.maxContributions).map((removal) => {
    const { metrics } = evaluate(base, removal.patch, dataset, monster, effects, [metric]);

    return compact({
      kind: removal.kind,
      name: removal.name,
      detail: removal.detail,
      // Negative: the build loses this much without it. Positive: it is hurting the number.
      withoutPct: deltaPct(metrics[metric] ?? 0, baseValue),
    });
  });
  rows.sort((a, b) => Math.abs((b.withoutPct as number) ?? 0) - Math.abs((a.withoutPct as number) ?? 0));

  return {
    note: 'Retirar uma peça também desfaz os conjuntos e combos dela; o valor é o efeito da peça inteira.',
    rows: rows.slice(0, limit),
    ...(all.length > rows.length ? { truncated: `${all.length - rows.length} itens ficaram de fora do limite de ${config.limits.maxContributions}` } : {}),
  };
}

function emptySocketsOf(dataset: Dataset, before: ResolvedBuild, after: ResolvedBuild): string[] | undefined {
  const model = after.model as Record<string, any>;
  const rows = MAIN_ITEM_SLOTS.flatMap((slot) => {
    const id = model[slot];
    if (typeof id !== 'number' || id <= 0 || id === (before.model as Record<string, any>)[slot]) return [];
    const item = dataset.items[id];
    const keys = relatedItemKeys(slot);
    const cardsFree = Math.max(0, (item?.slots ?? 0) - keys.filter((key) => /Card\d?$/.test(key) && model[key] > 0).length);
    const pools = (enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined) ?? [];
    const enchantsFree = Math.max(0, pools.filter((pool) => pool?.length).length - keys.filter((key) => /Enchant\d$/.test(key) && model[key] > 0).length);

    return cardsFree || enchantsFree ? [`${slot} (${dataset.itemIndex.get(id)?.name}): ${cardsFree} slot(s) de carta e ${enchantsFree} encantamento(s) vazios`] : [];
  });

  return rows.length ? rows : undefined;
}

const enchantFamilies = new WeakMap<Dataset, Map<string, { id: number; level: number }[]>>();

function enchantLevels(dataset: Dataset, id: number): { id: number; level: number }[] {
  let families = enchantFamilies.get(dataset);
  const stemOf = (name: string): { stem: string; level: number } | undefined => {
    const match = /^(.*\D)\s*(?:Lv\.?\s*)?(\d+)\)?$/.exec(name.trim());
    return match ? { stem: match[1].replace(/\s*Lv\.?$/i, '').trim(), level: Number(match[2]) } : undefined;
  };
  if (!families) {
    families = new Map();
    for (const [key, item] of Object.entries(dataset.items)) {
      if (!dataset.itemIndex.get(Number(key))?.slotTags?.includes('enchant' as SlotTag)) continue;
      const parsed = stemOf(String(item?.name ?? ''));
      if (parsed) families.set(parsed.stem, [...(families.get(parsed.stem) ?? []), { id: Number(key), level: parsed.level }]);
    }
    enchantFamilies.set(dataset, families);
  }
  const own = stemOf(String(dataset.items[id]?.name ?? ''));
  return own ? (families.get(own.stem) ?? []).filter((entry) => entry.id !== id).sort((a, b) => a.level - b.level) : [];
}

function upgradeGains(base: BuildInput, rb: ResolvedBuild, baseValue: number | undefined, metric: Metric, monster: any, effects: string[], dataset: Dataset, keys: string[]) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };
  const model: any = rb.model;
  const gain = (patch: BuildPatch) => {
    try { return deltaPct(evaluate(base, patch, dataset, monster, effects, [metric]).metrics[metric], baseValue); } catch { return null; }
  };
  const rows: { slot: string; name?: string; action: string; gainPct: number }[] = [];
  const add = (slot: string, action: string, patch: BuildPatch) => {
    const value = gain(patch);
    if (value !== null) rows.push({ slot, name: dataset.itemIndex.get(model[slot])?.name, action, gainPct: value });
  };
  for (const slot of MAIN_ITEM_SLOTS) {
    const id = model[slot];
    if (typeof id !== 'number' || id <= 0) continue;
    const refine: number = model[`${slot}Refine`] ?? 0;
    const refineCap = refineLimitFor(slot, dataset.items[id]);
    if (`${slot}Refine` in model && refine < refineCap) {
      add(slot, `refino +${refine + 1}${refine >= REACHABLE_REFINE ? ' (endgame alto)' : ''}`, { gear: { [`${slot}Refine`]: refine + 1 } });
      if (refine < Math.min(REACHABLE_REFINE, refineCap) - 1) add(slot, `refino +${Math.min(REACHABLE_REFINE, refineCap)}`, { gear: { [`${slot}Refine`]: Math.min(REACHABLE_REFINE, refineCap) } });
    }
    if (canGradeItem(dataset.items[id])) {
      const at = GRADES.indexOf(model[`${slot}Grade`] ?? '');
      if (at < GRADES.length - 1) add(slot, `grau ${GRADES[at + 1]}`, { gear: { [`${slot}Grade`]: GRADES[at + 1] } });
      if (at < GRADES.length - 2) add(slot, 'grau A', { gear: { [`${slot}Grade`]: 'A' } });
    }
    for (const key of relatedItemKeys(slot).filter((field) => /Enchant\d$/.test(field))) {
      const carried = model[key];
      if (typeof carried !== 'number' || carried <= 0) continue;
      const own = enchantLevels(dataset, carried);
      const current = Number(/(\d+)\)?$/.exec(String(dataset.items[carried]?.name ?? ''))?.[1] ?? 0);
      const higher = own.filter((entry) => entry.level > current);
      if (higher[0]) add(slot, `encantamento ${dataset.items[carried]?.name} → nível ${higher[0].level}`, { gear: { [key]: higher[0].id } });
      const top = higher[higher.length - 1];
      if (top && top !== higher[0]) add(slot, `encantamento ${dataset.items[carried]?.name} → nível máximo ${top.level}`, { gear: { [key]: top.id } });
    }
    // An empty enchant socket: the best of the few legal enchants the piece accepts, scored by the build's own formula.
    for (const choices of complementChoices(dataset, slot, id, keys, new Set())) {
      const key = Object.keys(choices[0]?.gear ?? {})[0] ?? '';
      if (!/Enchant\d$/.test(key) || model[key] > 0) continue;
      const best = choices.flatMap((choice) => {
        const id = (choice.gear as Record<string, unknown> | undefined)?.[key];
        const value = typeof id === 'number' ? gain(choice) : null;
        return typeof id === 'number' && value !== null ? [{ id, value }] : [];
      }).sort((a, b) => b.value - a.value)[0];
      if (best && best.value > 0) rows.push({ slot, name: dataset.itemIndex.get(id)?.name, action: `encantar (${key}): ${dataset.items[best.id]?.name}`, gainPct: best.value });
    }
  }
  rows.sort((a, b) => b.gainPct - a.gainPct);
  return { note: 'Cada linha é uma mudança isolada sobre a build atual, na métrica pedida; não conta custo, chance de falha nem materiais. Combinações podem render mais (teste em `evaluate_variants`).', ranked: rows.slice(0, 25) };
}

function refineGains(base: BuildInput, rb: ResolvedBuild, baseValue: number | undefined, metric: Metric, monster: any, effects: string[], dataset: Dataset) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };
  const model: any = rb.model;
  const rows = MAIN_ITEM_SLOTS.filter((slot) => model[slot] > 0 && `${slot}Refine` in model && (model[`${slot}Refine`] ?? 0) < refineLimitFor(slot, dataset.items[model[slot]])).flatMap((slot) => {
    const refine: number = model[`${slot}Refine`] ?? 0;
    const gain = (levels: number) => deltaPct(evaluate(base, { gear: { [`${slot}Refine`]: Math.min(refineLimitFor(slot, dataset.items[model[slot]]), refine + levels) } }, dataset, monster, effects, [metric]).metrics[metric], baseValue);
    try {
      return [{ slot, name: dataset.itemIndex.get(model[slot])?.name, refine, plus1Pct: gain(1), ...(refine < 19 ? { plus2Pct: gain(2) } : {}) }];
    } catch { return []; }
  }).sort((a, b) => (b.plus1Pct ?? 0) - (a.plus1Pct ?? 0));

  return { note: 'Ganho de cada peça sozinha, sobre a build atual; não considera chance de falha nem custo.', rows };
}

async function notModelled(
  rb: ResolvedBuild,
  calc: any,
  baseMax: number | undefined,
  base: BuildInput,
  dataset: Dataset,
  monster: any,
  effects: string[],
  ) {
  const model: any = rb.model;
  const warnings: Record<string, unknown>[] = [];

  for (const key of ITEM_ID_KEYS) {
    const id = model[key];
    const item = typeof id === 'number' ? rb.items[id] : undefined;
    // Costume pieces are visual: an empty script there is the norm, not a gap.
    if (!item || /^costume(Upper|Middle|Lower|Garment)$/.test(key) || key === 'pet' || key === 'ammo') continue;
    if ((!item.script || Object.keys(item.script).length === 0) && !randomOptionCatalogFor(id)) {
      warnings.push({ type: 'emptyScript', slot: key, id, name: item.name, note: 'Sem bônus no calculador: se a peça tem efeito no jogo, ele não entra no número.' });
    }
  }

  const available = ((calc.chanceList ?? []) as any[]).filter((chance) => !effects.includes(chance?.name)).slice(0, 10);
  for (const chance of available) {
    const { metrics } = evaluate(base, undefined, dataset, monster, [...effects, chance.name], ['max']);
    warnings.push(compact({
      type: 'proc',
      name: chance.name,
      label: chance.label,
      gainMaxPct: deltaPct(metrics['max'], baseMax),
      note: 'Efeito de proc fora da conta. Passe o nome em `effects` para contá-lo.',
      average: procEstimate(await procData(dataset, chance), deltaPct(metrics['max'], baseMax)),
    }));
  }

  return warnings;
}

export type EvaluateVariantsArgs = {
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    variants: { label: string; patch: BuildPatch }[];
    /** A variant that adds a card dropped by an MVP is `invalid` (MVP_CARD_EXCLUDED), not measured. */
    excludeMvpCards?: boolean;
    metrics?: Metric[];
    require?: z.infer<typeof requireSchema>[];
    sortBy?: Metric;
    limit?: number;
  };

export type ScanSlotArgs = {
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    includePatches?: boolean;
    excludeMvpCards?: boolean;
    build: BuildInput;
    slot: string;
    target?: TargetArg;
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    base?: 'current' | 'tuned';
    query?: string;
    limit?: number;
    topSockets?: number;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    maxSolves?: number;
  };

export type ExplainDamageArgs = {
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    parts?: ('stages' | 'contributions' | 'warnings' | 'refine' | 'upgrades')[];
    metric?: 'dps' | 'max' | 'rotationDps';
    maxContributions?: number;
  };

export type OptimizeBuildArgs = {
    equipmentMode?: 'current' | 'replace';
    procMode?: ProcMode;
    build: BuildInput;
    target?: TargetArg;
    targets?: { monsterId: number; weight?: number }[];
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    slots?: string[];
    lock?: string[];
    exclude?: number[];
    /** No card dropped by an MVP is recommended (same as listing them in `exclude`, and a worn one is reported). */
    excludeMvpCards?: boolean;
    candidates?: Record<string, number[]>;
    combos?: boolean;
    pairs?: string[][];
    countProcs?: boolean;
    procHitsPerSecond?: number;
    levelChecks?: boolean;
    detail?: boolean;
    complements?: boolean;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    candidatesPerSlot?: number;
    rounds?: number;
    maxSolves?: number;
    require?: z.infer<typeof requireSchema>[];
  };

export type SlotOptionsArgs = { itemId: number; query?: string; limit?: number; detail?: boolean };

export function createOptimizationOperations(dataset: Dataset, config: AnalysisRuntime, shortener?: Shortener) {

  const { normalizeShare, resolveTarget } = createBuildContext(config, shortener);

const shareOf = (rb: ResolvedBuild): string => buildShareUrl(toPreset(rb.model, rb.char), config.appOrigin, null, rb.customItems);

async function evaluateVariants({ build, target, effects = [], variants, excludeMvpCards = false, metrics, procMode = 'off', procHitsPerSecond, require: rules = [], sortBy = 'dps', limit = 10 }: EvaluateVariantsArgs) {
    const policy = await prepareProcPolicy(dataset, procMode, procHitsPerSecond);
    const measure = (...args: Parameters<typeof evaluate>) => { args[8] = policy; return evaluate(...args); };
    if (variants.length > config.limits.maxVariants) {
      throw new Error(`No máximo ${config.limits.maxVariants} variantes por chamada (recebi ${variants.length}). Divida em lotes.`);
    }
    const shown: Metric[] = [...new Set<Metric>([...(metrics ?? DEFAULT_METRICS), sortBy])];
    const wanted: Metric[] = [...new Set<Metric>([...shown, ...rules.map((r) => r.metric)])];

    const base = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const baseline = measure(base, undefined, dataset, monster, effects, wanted);

    const scored: { label: string; rb: ResolvedBuild; metrics: Metrics; notes: string[] }[] = [];
    const errors: { label: string; status: 'invalid' | 'failed'; code: string; error: string }[] = [];
    let belowRequire = 0;
    // What the base already breaks does not count against a variant; only what the variant adds does.
    const issueKey = (issue: { code: string; path: string; itemId?: number }) => `${issue.code}|${issue.path}|${issue.itemId ?? ''}`;
    const baseIssues = validateBuild(base, dataset, { excludeMvpCards });
    const known = new Set(baseIssues.errors.map(issueKey));
    for (const variant of variants) {
      try {
        // A variant that breaks a rule the base respected (a card left in a piece without sockets, a piece the class cannot wear,
        // an MVP card when asked) is refused before it is measured: the answer must not carry a number for it.
        const added = validateBuild(applyPatch(base, variant.patch), dataset, { excludeMvpCards }).errors.filter((issue) => !known.has(issueKey(issue)));
        // Points beyond the level's budget are a hypothesis worth measuring ("what if more POD"), so it is reported, not refused.
        const broken = added.filter((issue) => issue.code !== 'INSUFFICIENT_STAT_POINTS');
        const notes = added.filter((issue) => issue.code === 'INSUFFICIENT_STAT_POINTS').map((issue) => issue.message);
        if (broken.length) {
          errors.push({ label: variant.label, status: 'invalid', code: broken[0].code, error: broken.slice(0, 3).map((issue) => issue.message).join(' ') });
          continue;
        }
        const { rb, metrics: values } = measure(base, variant.patch, dataset, monster, effects, wanted);
        if (meets(values, rules)) scored.push({ label: variant.label, rb, metrics: values, notes });
        else belowRequire++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ label: variant.label, status: 'failed', code: /refino máximo/.test(message) ? 'INVALID_REFINE' : /não é permitido na posição|ncantament/.test(message) ? 'INVALID_ENCHANT' : 'INVALID_BUILD', error: message });
      }
    }

    scored.sort((a, b) => (b.metrics[sortBy] ?? -Infinity) - (a.metrics[sortBy] ?? -Infinity));

    return {
      sortedBy: sortBy,
      engineVersion: APP_VERSION,
      baseline: roundMetrics(baseline.metrics, shown),
      ...(baseIssues.errors.length ? { baselineIssues: baseIssues.errors.slice(0, 5).map((issue) => `${issue.code} ${issue.path}: ${issue.message}`) } : {}),
      tested: variants.length,
      results: scored.slice(0, limit).map((entry, rank) =>
        compact({
          label: entry.label,
          status: 'ok',
          metrics: roundMetrics(entry.metrics, shown),
          deltaPct: Object.fromEntries(shown.map((k) => [k, deltaPct(entry.metrics[k], baseline.metrics[k])])),
          warnings: entry.rb.warnings.length || entry.notes.length ? [...entry.rb.warnings, ...entry.notes] : undefined,
          emptySockets: emptySocketsOf(dataset, baseline.rb, entry.rb),
          // A link costs a compression pass, so only the front of the ranking gets one.
          share: rank < 3 ? shareOf(entry.rb) : undefined,
        }),
      ),
      discarded: { belowRequire, invalid: errors.length },
      ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
      ...(baseline.rb.warnings.length ? { warnings: baseline.rb.warnings } : {}),
    };
  }

async function scanSlot({ build, slot, target, effects = [], objective: objectiveArg, profile = 'sustained', base: baseMode = 'tuned', query, limit = 15, topSockets = 12, refine, maxGrade, maxSolves, includePatches = false, excludeMvpCards = false, procMode = 'off', procHitsPerSecond }: ScanSlotArgs) {
    const noCards = excludeMvpCards ? new Set(MVP_CARD_IDS) : new Set<number>();
    const policy = await prepareProcPolicy(dataset, procMode, procHitsPerSecond);
    const measure = (...args: Parameters<typeof evaluate>) => { args[8] = policy; return evaluate(...args); };
    if (!MAIN_ITEM_SLOTS.includes(slot)) throw new Error(`"${slot}" não é um slot de equipamento. Use um destes: ${MAIN_ITEM_SLOTS.join(', ')}.`);
    const budget = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const input = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const hasRotation = (((resolveBuild(input, dataset).model as { rotation?: string[] }).rotation) ?? []).length > 0;
    const objective: Metric = objectiveArg ?? objectiveFor(profile, hasRotation);
    const wanted: Metric[] = [objective, 'dps', 'max'];
    const baseline = measure(input, undefined, dataset, monster, effects, wanted);
    const baseValue = baseline.metrics[objective];
    if (!baseValue) throw new Error(`A build não produz ${objective} para varrer.`);

    const rb = baseline.rb;
    const worn = (rb.model as Record<string, any>)[slot] as number;
    const canWear = canUsedByClass(rb.char);
    const found = dataset.itemIndex.search({ slot: slot as SlotTag, maxLevel: rb.model.level, inCalcDb: true, limit: 4000, query }, rb.char).rows
      .map((row) => row.id)
      .filter((id) => dataset.items[id] && canWear(dataset.items[id]) && (dataset.items[id].requiredLevel ?? 0) <= rb.model.level);

    const keys = relevantKeys(baseline.solved.calc);
    const skillId = SKILL_ID_BY_NAME[String(rb.model.selectedAtkSkill ?? '').split('==')[0] as keyof typeof SKILL_ID_BY_NAME];
    if (skillId) keys.push(String(skillId), `cd__${skillId}`, `chance__${skillId}`);

    let solves = 1;
    let stopped = false;
    const run = (patch: BuildPatch) => {
      if (solves >= budget || pace.timeUp()) { stopped = true; return null; }
      solves++;
      try { return measure(input, patch, dataset, monster, effects, wanted); } catch { return null; }
    };

    // 1) Every candidate, bare (the ideal refine and grade, no sockets).
    const bare: { id: number; patch: BuildPatch; value: number }[] = [];
    for (const id of found) {
      await pace.breathe();
      const patch = swapPatch(dataset, rb, slot, id, { refine, maxGrade });
      const result = run(patch);
      const value = result?.metrics[objective];
      if (result && value !== undefined) bare.push({ id, patch, value });
      if (stopped) break;
    }
    bare.sort((a, b) => b.value - a.value);

    // 2) Sockets. Ranking the bare pieces cannot see a piece whose value is in its cards and enchants (a Soqueira Vil Invernal is
    //    "equal" to the Invernal until it is enchanted), so it is done in two stages: a quick pass over every piece that has
    //    sockets or enchants and is not hopeless bare, then the full search on the best of those.
    const tune = (id: number, patch: BuildPatch, value: number, effort: number) => {
      const first = run(patch);
      if (!first) return { patch, value, result: undefined };
      const tuned = searchComplements({ patch, result: first }, complementChoices(dataset, slot, id, keys, noCards), objective, (candidate) => run(candidate), effort);

      return { patch: tuned.patch, value: tuned.result.metrics[objective] ?? value, result: tuned.result };
    };
    const hasSockets = (id: number) => {
      const item = dataset.items[id];
      const pools = enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined;

      return (item?.slots ?? 0) > 0 || !!pools?.some((pool) => pool?.length);
    };
    const bestBare = bare[0]?.value ?? 0;
    const QUICK_LIMIT = 60;
    const quickPool = [...new Map([
      ...bare.slice(0, topSockets),
      ...bare.filter((entry) => hasSockets(entry.id) && entry.value >= 0.4 * bestBare).slice(0, QUICK_LIMIT),
    ].map((entry) => [entry.id, entry])).values()];
    // With socket search disabled, the bare ranking is already the final ranking.
    let finalists = bare.slice(0, topSockets > 0 ? topSockets : limit);
    if (topSockets > 0) {
      const quick: { id: number; patch: BuildPatch; value: number }[] = [];
      for (const entry of quickPool) {
        await pace.breathe();
        const out = tune(entry.id, entry.patch, entry.value, 8);
        quick.push({ id: entry.id, patch: entry.patch, value: out.value });
      }
      quick.sort((a, b) => b.value - a.value);
      finalists = quick.slice(0, topSockets);
    }
    if (worn > 0 && !finalists.some((entry) => entry.id === worn)) {
      const wornPatch = swapPatch(dataset, rb, slot, worn, { refine, maxGrade });
      const first = run(wornPatch);
      if (first && first.metrics[objective] !== undefined) finalists.push({ id: worn, patch: wornPatch, value: first.metrics[objective]! });
    }
    const bareOf = new Map(bare.map((entry) => [entry.id, entry.value]));
    const tunedRows: { id: number; patch: BuildPatch; value: number; bare: number }[] = [];
    for (const entry of finalists) {
      await pace.breathe();
      const fields = complementChoices(dataset, slot, entry.id, keys, noCards);
      const out = topSockets > 0 ? tune(entry.id, bare.find((candidate) => candidate.id === entry.id)?.patch ?? entry.patch, entry.value,
        Math.max(48, fields.reduce((sum, field) => sum + field.length, 0) * 2)) : { patch: entry.patch, value: entry.value };
      tunedRows.push({ id: entry.id, patch: out.patch, value: out.value, bare: bareOf.get(entry.id) ?? entry.value });
    }
    const wornRow = tunedRows.find((row) => row.id === worn);
    const reference = baseMode === 'tuned' && wornRow ? wornRow.value : baseValue;
    tunedRows.sort((a, b) => b.value - a.value);
    const partners = partnerIndex(dataset);

    const top = tunedRows.slice(0, limit).map((row) => {
      const gear = (row.patch.gear ?? {}) as Record<string, unknown>;
      const sockets = relatedItemKeys(slot).flatMap((key) => typeof gear[key] === 'number' ? [`${key}: ${dataset.itemIndex.get(gear[key] as number)?.name ?? gear[key]}`] : []);
      const setPartners = partners.of(row.id).flatMap((partner) => {
        const partnerSlot = partners.slotOf(partner);
        return partnerSlot && partnerSlot !== slot ? [{ id: partner, name: dataset.itemIndex.get(partner)?.name, slot: partnerSlot }] : [];
      }).slice(0, 3);

      return compact({
        id: row.id,
        name: dataset.itemIndex.get(row.id)?.name,
        value: round(row.value, 2),
        deltaPct: deltaPct(row.value, reference),
        bare: topSockets > 0 ? round(row.bare, 2) : undefined,
        worn: row.id === worn ? true : undefined,
        ...(includePatches ? { patch: row.patch } : {}),
        sockets: sockets.length ? sockets : undefined,
        partners: setPartners.length ? setPartners : undefined,
      });
    });

    return {
      slot,
      objective,
      reference: { item: worn ? itemLabel(dataset, worn) : null, value: round(reference, 2), basis: baseMode === 'tuned' && wornRow ? 'peça atual com os melhores soquetes' : 'build como veio no link' },
      scanned: bare.length,
      eligible: found.length,
      ranking: top,
      share: shareOf(rb),
      context: damageContext(baseline.solved.calc),
      solves,
      ...(stopped ? { stopped: `orçamento de cálculos ou de tempo esgotado (${solves} de ${budget}): ${found.length - bare.length} itens não foram medidos. Use \`query\` para restringir ou aumente \`maxSolves\`.` } : {}),
      note: 'Cada item entra no resto da build como ela está; conjuntos que dependem de outro slot aparecem em `partners` e só valem testados juntos (`evaluate_variants` ou `optimize_build` com `pairs`).',
    };
  }

async function explainDamage({ build, target, effects = [], parts, metric = 'dps', maxContributions = 25 }: ExplainDamageArgs) {
    const want = new Set(parts ?? ['stages', 'contributions', 'warnings']);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);

    const baseline = evaluate(base, undefined, dataset, monster, effects, [metric, 'max']);
    const out: Record<string, unknown> = { metric, value: round(baseline.metrics[metric] ?? 0, 2) };

    if (want.has('stages')) {
      const trace = (baseline.solved.calc.getTotalSummary() as any).dmg?.skillFormulaTrace;
      out['stages'] = (trace?.max ?? []).map((step: any) => compact({ label: step.label, value: step.value, keys: step.keys }));
    }

    if (want.has('contributions')) out['contributions'] = contributions(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset, maxContributions, config);

    if (want.has('refine')) out['refine'] = refineGains(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset);

    if (want.has('upgrades')) out['upgrades'] = upgradeGains(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset, relevantKeys(baseline.solved.calc));

    if (want.has('warnings')) out['warnings'] = await notModelled(baseline.rb, baseline.solved.calc, baseline.metrics['max'], base, dataset, monster, effects);

    return out;
  }

async function optimizeBuild({ build, target, targets, effects = [], objective: objectiveArg, profile = 'sustained', slots, lock = [], exclude = [], excludeMvpCards = false, candidates, combos = true, pairs = [], countProcs, procMode, procHitsPerSecond, equipmentMode = 'replace', levelChecks = true, detail = false, complements = true, refine, maxGrade, candidatesPerSlot = 12, rounds = 2, maxSolves, require: rules = [] }: OptimizeBuildArgs) {
    const resolvedProcMode = procMode ?? (countProcs === undefined ? 'average' : countProcs ? 'active' : 'off');
    const procPolicy = await prepareProcPolicy(dataset, resolvedProcMode, procHitsPerSecond);
    const memo = evaluationCache();
    const evalBuild = (...args: Parameters<typeof evaluate>) => { args[8] = procPolicy; return memo.evaluate(...args); };
    const evalFresh = (...args: Parameters<typeof evaluate>) => { args[8] = procPolicy; return evaluate(...args); };
    const requestedBudget = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const hasRotation = (((resolveBuild(base, dataset).model as { rotation?: string[] }).rotation) ?? []).length > 0;
    const objective: Metric = objectiveArg ?? objectiveFor(profile, hasRotation);
    // A rotation costs a calculation per step: search on the chosen skill's DPS and measure only the finalists on the real objective.
    const proxy: Metric | undefined = objective === 'rotationDps' || objective === 'burstDps' ? 'dps' : undefined;
    const rankMetric: Metric = proxy ?? objective;
    const profileObjectives = { sustained: objectiveFor('sustained', hasRotation), burst: objectiveFor('burst', hasRotation) };
    const shown: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp'])];
    const wanted: Metric[] = [...new Set<Metric>([...shown, ...rules.map((r) => r.metric)])];
    const searchWanted: Metric[] = proxy ? [...new Set<Metric>([...wanted.filter((metric) => metric !== objective), proxy])] : wanted;

    const aims = (targets ?? [{ monsterId: target?.monsterId ?? config.defaultTargetId }]).map((aim) => ({
      monster: resolveTarget(dataset, aim.monsterId).monster,
      weight: (aim as { weight?: number }).weight ?? 1,
    }));
    const monster = aims[0].monster;
    const more = aims.slice(1);
    const baseline = evalFresh(base, undefined, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
    // Both limits apply; a wall-clock stop returns the best measured build so far.
    const budget = requestedBudget;
    const gradeLimit = maxGrade === 'none' ? 0 : GRADES.indexOf(maxGrade as typeof GRADES[number]);
    if (maxGrade !== undefined) {
      const above = MAIN_ITEM_SLOTS.filter(slot => GRADES.indexOf(baseline.rb.model[`${slot}Grade`] ?? '') > gradeLimit);
      if (above.length) throw new Error(`A build base excede o grau máximo ${maxGrade}: ${above.join(', ')}. Ajuste os graus da base antes da busca; slots travados também devem respeitar o teto.`);
    }
    const baseValue = baseline.metrics[objective];
    if (!baseValue) throw new Error(`A build não produz ${objective} para otimizar.`);

    const locked = new Set(lock);
    if (equipmentMode === 'current') { combos = false; if (pairs.length) throw new Error('equipmentMode current mantém as peças; não aceita pairs.'); }
    const walk = (slots ?? SEARCH_SLOTS).filter((slot) => !locked.has(slot));
    const badPair = pairs.find(([a, b]) => a === b || ![a, b].every(slot => walk.includes(slot)));
    if (badPair) throw new Error(`Par ${badPair.join('+')} inválido: dois slots diferentes, ambos entre os percorridos e não travados.`);
    const unknown = [...walk, ...Object.keys(candidates ?? {})].filter((slot) => !MAIN_ITEM_SLOTS.includes(slot));
    if (unknown.length) throw new Error(`Não são slots de equipamento: ${unknown.join(', ')}. Use: ${MAIN_ITEM_SLOTS.join(', ')}.`);

    // Candidates are fixed once, from the baseline's own formula: which items could matter, best-matching first.
    const keys = relevantKeys(baseline.solved.calc, aims.map(aim => aim.monster));
    const skillId = SKILL_ID_BY_NAME[String(baseline.rb.model.selectedAtkSkill ?? '').split('==')[0] as keyof typeof SKILL_ID_BY_NAME];
    if (skillId) keys.push(String(skillId), `cd__${skillId}`, `chance__${skillId}`);
    const banned = new Set([...exclude, ...(excludeMvpCards ? MVP_CARD_IDS : [])]);
    const partners = partnerIndex(dataset);
    const skippedNotInLatam: number[] = [];
    const complementPools = new Map<string, BuildPatch[][]>();
    const complementsFor = (slot: string, id: number) => {
      const key = `${slot}:${id}`;
      if (!complementPools.has(key)) complementPools.set(key, complementChoices(dataset, slot, id, keys, banned));
      return complementPools.get(key)!;
    };
    const canWear = canUsedByClass(baseline.rb.char);
    const eligible = (id: number, slot: string) => {
      const item = dataset.items[id];
      return !!item && canWear(item) && (item.requiredLevel ?? 0) <= baseline.rb.model.level
        && !!dataset.itemIndex.get(id)?.latam
        && !!dataset.itemIndex.get(id)?.slotTags.includes(slot as SlotTag);
    };
    let solves = 1;
    /** Calculations spent finding out what each candidate is worth (discovery) against refining the ones that matter (evaluation). */
    let discovery = 0;
    const screening: Record<string, { eligible: number; tested: number }> = {};
    const pools = new Map<string, number[]>();
    // Screening (every eligible item measured bare) is the discovery phase and has its own budget: 35% of the calculations, shared
    // out slot by slot with what an earlier slot did not use passed on. Without it the first slots (the weapon has hundreds of
    // candidates) took the whole of a short budget and the later slots, and the search itself, never started.
    const discoveryBudget = Math.floor(budget * 0.35);
    for (const [slotPosition, slot] of walk.entries()) {
      const worn = baseline.rb.model[slot];
      if (equipmentMode === 'current') { pools.set(slot, worn ? [worn] : []); continue; }
      if (candidates?.[slot]) {
        skippedNotInLatam.push(...candidates[slot].filter((id) => !dataset.itemIndex.get(id)?.latam));
        pools.set(slot, candidates[slot].filter((id) => (id !== worn || maxGrade === undefined || canGradeItem(dataset.items[id])) && !banned.has(id) && eligible(id, slot)));
        continue;
      }
      const common = { slot: slot as SlotTag, maxLevel: baseline.rb.model.level, inCalcDb: true, limit: 4000 };
      const found = new Map<number, ItemRow>();
      const searches = [dataset.itemIndex.search({ ...common, bonus: keys, bonusMode: 'any' }, baseline.rb.char)];
      if (skillId) searches.push(dataset.itemIndex.search({ ...common, skill: String(skillId) }, baseline.rb.char));
      for (const { rows } of searches) for (const row of rows) found.set(row.id, row);
      // A plain parent can derive its value entirely from enchants (Wolf/Nebula/Varmundt among others).
      for (const row of dataset.itemIndex.search(common, baseline.rb.char).rows) {
        if (enchantPoolsFor(dataset.items[row.id])?.some(pool => pool?.length)) found.set(row.id, row);
      }

      const matches = (id: number): number => Object.keys(dataset.items[id]?.script ?? {}).filter((key) => keys.includes(key)).length;
      const ordered = [...found.values()]
        .filter((row) => row.id !== worn && !banned.has(row.id))
        .sort((a, b) => matches(b.id) - matches(a.id) || (b.reqLv ?? 0) - (a.reqLv ?? 0));
      const scored: { id: number; value: number }[] = [];
      const slotShare = Math.max(6, Math.floor((discoveryBudget - discovery) / (walk.length - slotPosition)));
      for (const row of ordered.slice(0, slotShare)) {
        if (solves >= budget || pace.timeUp()) break;
        await pace.breathe();
        solves++;
        discovery++;
        try {
          const trial = evalBuild(base, swapPatch(dataset, baseline.rb, slot, row.id, { refine, maxGrade }), dataset, monster, effects, searchWanted, more, aims[0].weight, countProcs);
          scored.push({ id: row.id, value: trial.metrics[rankMetric] ?? -Infinity });
        } catch { /* an incompatible candidate is not a recommendation */ }
      }
      screening[slot] = { eligible: ordered.length, tested: scored.length };
      scored.sort((a, b) => b.value - a.value);
      const ranked = scored.slice(0, candidatesPerSlot).map(row => row.id);
      // Preserve a representative of every enchant family, so bare damage cannot eliminate its potential.
      const families = new Set<string>();
      for (const row of scored) {
        const pools = enchantPoolsFor(dataset.items[row.id]);
        if (!pools?.some(pool => pool?.length)) continue;
        const family = JSON.stringify(pools);
        if (!families.has(family)) { families.add(family); if (!ranked.includes(row.id)) ranked.push(row.id); }
      }
      // Upgrades of the worn piece: the same script at a higher level (Soqueira Invernal → Vil Invernal) differs only in sockets and
      // enchants, which no script key shows, so the keyword search never offers it.
      const wornScript = worn > 0 ? JSON.stringify(dataset.items[worn]?.script ?? {}) : '';
      if (wornScript && wornScript !== '{}') {
        const wornLevel = dataset.items[worn]?.requiredLevel ?? 0;
        const siblings = dataset.itemIndex.search({ ...common, limit: 4000 }, baseline.rb.char).rows
          .filter((row) => row.id !== worn && !ranked.includes(row.id) && !banned.has(row.id) && (row.reqLv ?? 0) >= wornLevel
            && JSON.stringify(dataset.items[row.id]?.script ?? {}) === wornScript && dataset.items[row.id]?.attack === dataset.items[worn]?.attack)
          .sort((a, b) => (b.reqLv ?? 0) - (a.reqLv ?? 0)).slice(0, 3).map((row) => row.id);
        ranked.push(...siblings);
      }
      pools.set(slot, ranked);
      if ((maxGrade === undefined || canGradeItem(dataset.items[worn])) && worn > 0 && !banned.has(worn)) ranked.unshift(worn);
    }

    // A piece the build already wears can name a partner that completes a set (the Garra Primordial-LT
    // names the Bota Primordial-LT): that partner is a candidate for its own slot, whatever its own script says.
    if (combos && !candidates) {
      for (const key of ITEM_ID_KEYS) {
        const id = baseline.rb.model[key];
        if (typeof id !== 'number' || id <= 0) continue;
        for (const partner of partners.of(id)) {
          const slot = partners.slotOf(partner);
          if (slot && walk.includes(slot) && eligible(partner, slot) && baseline.rb.model[slot] !== partner && !banned.has(partner) && !pools.get(slot)?.includes(partner)) pools.get(slot)!.push(partner);
        }
      }
    }

    interface Move { anchor: string; changes: [string, number][]; grades: Record<string, string> }
    /** One move per grade combination the cap allows; a new item never inherits the old item's grade. */
    const expandMove = (anchor: string, changes: [string, number][]): Move[] => {
      let variants: Record<string, string>[] = [{}];
      for (const [slot, item] of changes) {
        // Higher grades only add bonuses: measure the highest grade the caller allows.
        const grades = equipmentMode === 'current' ? [baseline.rb.model[`${slot}Grade`] ?? ''] : canGradeItem(dataset.items[item]) ? [maxGrade === 'none' ? '' : maxGrade ?? 'A']
          : [rb.model[slot] === item ? rb.model[`${slot}Grade`] ?? '' : ''];
        variants = variants.flatMap(v => grades.map(grade => ({ ...v, [slot]: grade })));
      }
      return variants.map(grades => ({ anchor, changes, grades }));
    };
    const movesFor = (anchor: string): Move[] => {
      const moves: Move[] = [];
      const seen = new Set<string>();
      const add = (changes: [string, number][]) => {
        for (const move of expandMove(anchor, changes)) {
          // The worn piece at its own refine and grade is the baseline: only worth a calculation when its sockets are searched.
          if (!complements && move.changes.every(([slot, item]) => rb.model[slot] === item && (refineFor(slot, item) === undefined || rb.model[`${slot}Refine`] === refineFor(slot, item))
            && move.grades[slot] === (rb.model[`${slot}Grade`] ?? ''))) continue;
          const id = move.changes.map(([slot, item]) => `${slot}:${item}:${move.grades[slot]}`).sort().join('|');
          if (!seen.has(id)) { seen.add(id); moves.push(move); }
        }
      };
      for (const item of [...new Set([...(complements && baseline.rb.model[anchor] ? [baseline.rb.model[anchor]] : []), ...(pools.get(anchor) ?? [])])]) {
        add([[anchor, item]]);
        if (!combos) continue;
        for (const partner of partners.of(item)) {
          const slot = partners.slotOf(partner);
          if (slot && slot !== anchor && walk.includes(slot) && eligible(partner, slot) && !banned.has(partner)) add([[anchor, item], [slot, partner]]);
        }
      }

      return moves;
    };

    /** The ideal refine unless the caller capped it; pieces with no refine field are left alone. */
    const refineFor = (target: string, item: number): number | undefined => equipmentMode === 'current' ? baseline.rb.model[`${target}Refine`] : searchRefineFor(rb, target, item, refine);
    const patchFor = (move: Move): BuildPatch => ({
      gear: Object.fromEntries(move.changes.flatMap(([target, id]) => [
        [target, id],
        ...(refineFor(target, id) !== undefined ? [[`${target}Refine`, refineFor(target, id)]] : []),
        // A new item is not automatically the old item's grade.
        ...(`${target}Grade` in rb.model || canGradeItem(dataset.items[id]) ? [[`${target}Grade`, move.grades[target]]] : []),
        ...keptSockets(dataset, rb, target, id).clear.map((key) => [key, null]),
      ])),
      options: Object.fromEntries(move.changes.flatMap(([target, id]) => rb.model[target] === id ? []
        : (ItemOptionMap.get(target as ItemTypeEnum) ?? []).map(index => [String(index), null]))),
    });

    const outOfBudget = () => solves - memo.hits >= budget || pace.timeUp();
    let current = base;
    let value = baseValue;
    let metrics = baseline.metrics;
    let rb = baseline.rb;
    let changes: BuildPatch = { gear: {} };
    const steps: Record<string, unknown>[] = [];
    /** For each slot, how its alternatives scored the last time the slot was evaluated: what lost, and by how much. */
    const considered = new Map<string, { to: [string, number][]; grades: Record<string, string>; value: number; against: number }[]>();
    let exhausted = false;
    let tunedSlots = 0;
    const slotCoverage = new Map<string, { available: number; measured: number }>();

    type Chosen = { move: Move; patch: BuildPatch; value: number; metrics: Metrics; rb: ResolvedBuild };
    const accept = (best: Chosen) => {
      const swaps = best.move.changes.map(([target, id]) => {
        const from = rb.model[target];
        const { dropped } = keptSockets(dataset, rb, target, id);

        return {
          slot: target,
          from: from ? itemLabel(dataset, from, rb.model[`${target}Grade`]) : null,
          to: itemLabel(dataset, id, best.move.grades[target]),
          ...(dropped.length ? { dropped } : {}),
        };
      });
      steps.push({
        ...(swaps.length > 1 ? { combo: swaps } : swaps[0]),
        kind: best.move.changes.every(([target, id]) => rb.model[target] === id)
          ? best.move.changes.some(([target]) => best.patch.gear?.[`${target}Refine`] !== undefined && best.patch.gear[`${target}Refine`] !== rb.model[`${target}Refine`]
            || best.patch.gear?.[`${target}Grade`] !== undefined && best.patch.gear[`${target}Grade`] !== rb.model[`${target}Grade`]) ? 'refinoGrau' : 'ajuste' : 'troca',
        gainPct: deltaPct(best.value, value),
        totalPct: deltaPct(best.value, baseValue),
      });
      current = applyPatch(current, best.patch);
      changes = applyPatch(changes, best.patch);
      value = best.value;
      metrics = best.metrics;
      rb = best.rb;
    };

    // The build only changes when a move is accepted. A slot already searched against the current build, and a combined
    // move already solved against it from another slot, would give the same numbers again: skip them (exact, not a cut).
    let version = 0;
    const searchedAt = new Map<string, number>();
    const solvedMoves = new Set<string>();
    const moveKey = (move: Move) => move.changes.map(([slot, item]) => `${slot}:${item}:${move.grades[slot]}`).sort().join('|');

    // Round -1 tunes what the build already wears (best cards, enchants and catalogued rolls) before anything is compared with it:
    // otherwise a worn piece the link left bare loses to a replacement that the walk happened to reach first.
    for (let round = complements ? -1 : 0; round < rounds && !exhausted; round++) {
      const tuning = round < 0;
      let improved = false;
      for (const [slotIndex, slot] of walk.entries()) {
        if (searchedAt.get(slot) === version) continue;
        // Discovery (35%) and tuning what is worn (40% more) leave a quarter of the calculations for the walk: a short budget spent
        // on the sockets of the current pieces never looks at a replacement. What was not reached is reported in `coverage`.
        if (tuning && solves - memo.hits >= Math.floor(budget * 0.75)) break;
        let best: Chosen | null = null;
        const seen: { to: [string, number][]; grades: Record<string, string>; value: number; against: number }[] = [];
        if (!tuning) considered.set(slot, seen);
        const moves = tuning ? movesFor(slot).filter((move) => move.changes.length === 1 && move.changes[0][1] === rb.model[slot]) : movesFor(slot);
        if (!moves.length) continue;
        if (tuning) tunedSlots++;
        const remainingSlots = walk.length - slotIndex + (rounds - round - 1) * walk.length;
        const share = Math.max(0, Math.floor((budget - (solves - memo.hits)) / Math.max(1, remainingSlots)));
        // Three stages, so every candidate is judged with the same care as the piece it competes with: all of them bare, a quick
        // search of sockets and rolls for the best dozen, the full search for the best few. A small even share for each candidate
        // (what this used to give) cannot find the right enchant among eight, and the worn piece, which had the full search, won.
        const quickEffort = tuning ? 0 : Math.max(4, Math.min(8, Math.floor(share / (2 * Math.max(1, Math.min(12, moves.length))))));
        const fullEffort = Math.max(0, tuning ? share - 1 : Math.floor(share / 3));
        const solveFor = (candidatePatch: BuildPatch) => {
          if (outOfBudget()) { exhausted = true; return null; }
          solves++;
          try { return evalBuild(current, candidatePatch, dataset, monster, effects, searchWanted, more, aims[0].weight, countProcs); } catch { return null; }
        };
        type Tried = ReturnType<typeof evalBuild>;
        const entries: { move: Move; patch: BuildPatch; tried: Tried; fields: BuildPatch[][] }[] = [];
        // Discovery (measuring every candidate bare) may take at most half of the slot's share, so a long list of candidates cannot
        // leave nothing for the sockets of the ones that matter. What the cap leaves unmeasured is reported in `coverage`.
        const discoveryCap = tuning ? Infinity : Math.max(12, Math.floor(share / 2));
        let discovered = 0;
        for (const move of moves) {
          await pace.breathe();
          const key = moveKey(move);
          if (solvedMoves.has(key)) continue;
          if (outOfBudget()) { exhausted = true; break; }
          if (discovered >= discoveryCap) break;
          discovered++;
          discovery++;
          solves++;
          solvedMoves.add(key);
          try {
            const patch = patchFor(move);
            const tried = evalBuild(current, patch, dataset, monster, effects, searchWanted, more, aims[0].weight, countProcs);
            entries.push({ move, patch, tried, fields: complements ? move.changes.flatMap(([target, id]) => complementsFor(target, id)) : [] });
          } catch {
            /* a candidate that does not resolve is simply not a candidate */
          }
        }
        if (!tuning) slotCoverage.set(slot, { available: moves.length, measured: Math.max(slotCoverage.get(slot)?.measured ?? 0, entries.length) });
        const valueOf = (entry: { tried: Tried }) => entry.tried.metrics[rankMetric] ?? -Infinity;
        const refineEntry = (entry: (typeof entries)[number], effort: number) => {
          if (effort <= 0 || !entry.fields.length) return;
          const coverage = Math.max(48, entry.fields.reduce((sum, field) => sum + field.length, 0) * 2);
          const refined = searchComplements({ patch: entry.patch, result: entry.tried }, entry.fields, rankMetric, solveFor, Math.min(effort, coverage));
          entry.patch = refined.patch;
          entry.tried = refined.result;
        };
        if (complements && !exhausted) {
          entries.sort((x, y) => valueOf(y) - valueOf(x));
          // A bare score cannot compare different enchant families. Give the best representative
          // of each family a socket search before allowing damage ranking to prune it.
          const withFamilies = (ranked: typeof entries, limit: number) => {
            const selected = ranked.slice(0, limit);
            const families = new Set<string>();
            for (const entry of ranked) {
              const family = JSON.stringify(entry.move.changes.map(([, id]) => enchantPoolsFor(dataset.items[id]) ?? []));
              if (families.has(family)) continue;
              families.add(family);
              if (!selected.includes(entry)) selected.push(entry);
            }
            return selected;
          };
          if (!tuning) {
            // Pieces with sockets first: a bare tie says nothing about them.
            const withSockets = entries.filter((entry) => entry.fields.length);
            for (const entry of withFamilies(withSockets, 12)) { await pace.breathe(); refineEntry(entry, quickEffort); }
            entries.sort((x, y) => valueOf(y) - valueOf(x));
          }
          const finalists = entries.filter((candidate) => candidate.fields.length);
          const selected = tuning ? finalists.slice(0, 1) : withFamilies(finalists, 3);
          const effort = tuning ? fullEffort : Math.floor(fullEffort * 3 / Math.max(1, selected.length));
          for (const entry of selected) { await pace.breathe(); refineEntry(entry, effort); }
        }
        // With a rotation the ranking above used the chosen skill's DPS (a third of the cost); only the best few are measured on
        // the real objective, and only those can be accepted.
        let contenders = entries;
        if (proxy) {
          entries.sort((x, y) => valueOf(y) - valueOf(x));
          contenders = [];
          for (const [rank, entry] of entries.slice(0, tuning ? 1 : 3).entries()) {
            // The leader of the proxy ranking is measured on the real objective even when the budget is spent (one calculation): stopping
            // here would throw away the best candidate found so far.
            if (outOfBudget()) { exhausted = true; if (rank > 0) break; }
            solves++;
            try { entry.tried = evalBuild(current, entry.patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs); contenders.push(entry); } catch { /* not a candidate */ }
          }
        }
        for (const entry of contenders) {
          const candidate = entry.tried.metrics[objective];
          if (candidate === undefined || !meets(entry.tried.metrics, rules)) continue;
          seen.push({ to: entry.move.changes, grades: entry.move.grades, value: candidate, against: value });
          if (!best || candidate > best.value) best = { move: entry.move, patch: entry.patch, value: candidate, metrics: entry.tried.metrics, rb: entry.tried.rb };
        }
        // 0,1% is the floor: below it the "gain" is rounding in the engine, and the walk would chase noise.
        if (!exhausted && !tuning) searchedAt.set(slot, version);
        if (best && best.value > value * 1.001) {
          accept(best); improved = true; version++; solvedMoves.clear();
          if (tuning) { steps[steps.length - 1]['atual'] = true; steps[steps.length - 1]['kind'] = 'ajuste'; }
        }
        if (exhausted) break;
      }
      if (!improved && !tuning) break;
    }

    // Pairs the user names: the best few candidates of each slot, every combination, applied only if both together beat the build.
    const PAIR_TOP = 4;
    for (const [first, second] of pairs) {
      if (exhausted) break;
      const top = (slot: string) => (pools.get(slot) ?? []).filter(id => id !== rb.model[slot]).slice(0, PAIR_TOP);
      let best: Chosen | null = null;
      search: for (const a of top(first)) for (const b of top(second)) for (const move of expandMove(first, [[first, a], [second, b]])) {
        await pace.breathe();
        if (outOfBudget()) { exhausted = true; break search; }
        solves++;
        try {
          const patch = patchFor(move);
          const tried = evalBuild(current, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
          const candidate = tried.metrics[objective];
          if (candidate !== undefined && meets(tried.metrics, rules) && (!best || candidate > best.value)) best = { move, patch, value: candidate, metrics: tried.metrics, rb: tried.rb };
        } catch { /* not a candidate */ }
      }
      if (best && best.value > value * 1.001) accept(best);
    }

    // Last pass over the sockets. The search ranks cards and enchants by the script keys it expects to matter and tries the best
    // few; a card that wins for a reason the ranking does not see (Carta Derreting scales with HP) is never tried, and the answer
    // keeps a worse one. So the build it ends with is checked field by field against every legal card and enchant, in the time
    // the search left, with its own allowance so a long walk cannot starve it.
    const polish = { fields: 0, total: 0, tried: 0, improved: 0 };
    if (complements) {
      const allowanceMs = Math.max(25_000, Math.round(config.limits.maxSearchMs * 0.5));
      const polishPace = pacing(allowanceMs);
      const polishEnd = Date.now() + allowanceMs;
      const relevant = new Set(relevantKeys(baseline.solved.calc, aims.map((aim) => aim.monster)));
      const score = (id: number) => Object.keys(dataset.items[id]?.script ?? {}).filter((key) => relevant.has(key) || key.startsWith('chance__')).length;
      for (let pass = 0; pass < 2; pass++) {
        let changed = false;
        // Every socket gets an equal share of what is left, so the first slots cannot spend the allowance (a weapon has hundreds of
        // legal cards) and leave the garment and the boots unchecked.
        const fields = walk.flatMap((slot) => (rb.model[slot] > 0 ? socketOptions(dataset, slot, rb.model[slot]).map((option) => ({ slot, option })) : []));
        if (pass === 0) polish.total = fields.length;
        for (const [position, { slot, option }] of fields.entries()) {
          if (polishPace.timeUp()) break;
          const itemId = rb.model[slot];
          if (!(itemId > 0) || !socketOptions(dataset, slot, itemId).some((entry) => entry.field === option.field)) continue;
          const fieldEnd = Date.now() + Math.max(250, (polishEnd - Date.now()) / (fields.length - position));
          polish.fields++;
          const current_ = (rb.model as unknown as Record<string, number | undefined>)[option.field];
          let best: { id: number; ranked: number } | undefined;
          const candidates = option.ids.filter((id) => id !== current_ && !banned.has(id)).sort((a, b) => score(b) - score(a) || a - b);
          for (const id of candidates) {
            if (polishPace.timeUp() || Date.now() > fieldEnd) break;
            await polishPace.breathe();
            const patch: BuildPatch = { gear: { [option.field]: id } };
            if (option.kind === 'enchant') {
              const item = dataset.items[itemId];
              const enchants = (EQUIPMENT_SLOTS.find((entry) => entry.key === slot)?.enchantFields ?? []).map((field) => (field === option.field ? id : (rb.model as unknown as Record<string, number | undefined>)[field ?? ''])).filter((enchantId): enchantId is number => !!enchantId && enchantId > 0).map((enchantId) => dataset.items[enchantId]);
              if (enchantCombinationError(item, enchants)) continue;
            }
            polish.tried++;
            try {
              // Scanned without the proc average (it doubles the cost of a build with a proc); the winner is measured in full below.
              const tried = memo.evaluate(current, patch, dataset, monster, effects, searchWanted, more, aims[0].weight, false);
              const ranked = tried.metrics[rankMetric];
              if (ranked !== undefined && (!best || ranked > best.ranked)) best = { id, ranked };
            } catch { /* not a candidate */ }
          }
          if (!best) continue;
          const patch: BuildPatch = { gear: { [option.field]: best.id } };
          const full = evalBuild(current, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
          const candidate = full.metrics[objective];
          if (candidate === undefined || !meets(full.metrics, rules) || candidate <= value * 1.001) continue;
          accept({ move: { anchor: slot, changes: [[slot, itemId]], grades: { [slot]: (rb.model as unknown as Record<string, string>)[`${slot}Grade`] ?? '' } }, patch, value: candidate, metrics: full.metrics, rb: full.rb });
          steps[steps.length - 1]['kind'] = 'ajuste';
          steps[steps.length - 1]['polish'] = `${option.field}: ${dataset.items[best.id]?.name}`;
          polish.improved++;
          changed = true;
        }
        if (!changed) break;
      }
    }

    // The walk compares everything at the ideal refine and grade. A piece can lose to the worn one at the level the player has
    // today and win once both are raised (a better enchant, a bonus that unlocks at a grade), or the other way round: for the
    // slots that changed, and the best runner-up, measure both levels against the worn piece, each tuned the same way.
    const levelCheck: Record<string, unknown>[] = [];
    if (levelChecks && complements) {
      const original = baseline.rb.model as Record<string, any>;
      const levelBudget = 12;
      const gradeIdeal = (id: number) => (canGradeItem(dataset.items[id]) ? (maxGrade === undefined ? 'A' : maxGrade === 'none' ? '' : maxGrade) : undefined);
      /** `base` with `id` in `slot` at the player's current refine and grade ('now') or at the ideal ones, sockets and rolls tuned. */
      const valueAt = (slot: string, id: number, level: 'now' | 'ideal'): number | undefined => {
        if (outOfBudget()) { exhausted = true; return undefined; }
        const worn = original[slot] === id;
        const refineTo = level === 'now' ? original[`${slot}Refine`] : refineFor(slot, id);
        const gradeTo = level === 'now' ? (canGradeItem(dataset.items[id]) ? original[`${slot}Grade`] ?? '' : undefined) : gradeIdeal(id);
        const patch: BuildPatch = {
          gear: Object.fromEntries([
            ...(worn ? [] : [[slot, id], ...keptSockets(dataset, baseline.rb, slot, id).clear.map((key) => [key, null])]),
            ...(refineTo !== undefined && `${slot}Refine` in original ? [[`${slot}Refine`, refineTo]] : []),
            ...(gradeTo !== undefined && (`${slot}Grade` in original || canGradeItem(dataset.items[id])) ? [[`${slot}Grade`, gradeTo]] : worn ? [] : [[`${slot}Grade`, '']]),
          ]),
          ...(worn ? {} : { options: Object.fromEntries((ItemOptionMap.get(slot as ItemTypeEnum) ?? []).map((index) => [String(index), null])) }),
        };
        try {
          solves++;
          const first = evalBuild(base, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
          const tuned = searchComplements({ patch, result: first }, complementsFor(slot, id), objective, (candidatePatch) => {
            if (outOfBudget()) { exhausted = true; return null; }
            solves++;
            try { return evalBuild(base, candidatePatch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs); } catch { return null; }
          }, levelBudget);
          return tuned.result.metrics[objective];
        } catch { return undefined; }
      };
      const changedSlots = walk.filter((slot) => rb.model[slot] !== original[slot]);
      for (const slot of changedSlots) {
        await pace.breathe();
        const worn = original[slot] as number;
        const rivals = [rb.model[slot] as number, ...[...(considered.get(slot) ?? [])]
          .filter((row) => row.to.length === 1 && row.to[0][1] !== worn && row.to[0][1] !== rb.model[slot])
          .sort((a, b) => b.value - a.value).map((row) => row.to[0][1])].filter((id, index, all) => id > 0 && all.indexOf(id) === index).slice(0, 3);
        const wornNow = worn > 0 ? valueAt(slot, worn, 'now') : baseline.metrics[objective];
        const wornIdeal = worn > 0 ? valueAt(slot, worn, 'ideal') : baseline.metrics[objective];
        if (wornNow === undefined || wornIdeal === undefined) continue;
        const rows = rivals.flatMap((id) => {
          const now = valueAt(slot, id, 'now');
          const ideal = valueAt(slot, id, 'ideal');
          if (now === undefined || ideal === undefined) return [];
          const nowPct = deltaPct(now, wornNow);
          const idealPct = deltaPct(ideal, wornIdeal);
          const better = (pct: number | null) => (pct ?? 0) > 0.1;
          return [{ item: itemLabel(dataset, id), now: nowPct, evolved: idealPct,
            verdict: better(nowPct) && better(idealPct) ? 'melhor nos dois níveis' : !better(nowPct) && better(idealPct) ? 'só vence evoluída' : better(nowPct) ? 'vence agora, perde evoluída' : 'não vence' }];
        });
        if (rows.length) levelCheck.push({ slot, worn: worn > 0 ? itemLabel(dataset, worn) : null, rows });
      }
    }


    // Both kinds of build side by side: a piece can win the opening and lose the long fight.
    const profiles = Object.fromEntries((['sustained', 'burst'] as const).map((name) => {
      const metric = profileObjectives[name];
      try {
        const before = evalBuild(base, undefined, dataset, monster, effects, [metric]).metrics[metric];
        const after = evalBuild(current, undefined, dataset, monster, effects, [metric]).metrics[metric];
        return [name, compact({ metric, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) })];
      } catch { return [name, { metric }]; }
    }));

    // What the ranking cannot see on its own: a target without defenses, an objective that ignores crits, an ASPD potion left out.
    const context = damageContext(baseline.solved.calc);
    const defendedCheck = isUndefended(context.target) ? CHECK_DUMMIES.flatMap((id) => {
      try {
        const dummy = resolveTarget(dataset, id).monster;
        const before = evalBuild(base, undefined, dataset, dummy, effects, [objective]).metrics[objective];
        const after = evalBuild(current, undefined, dataset, dummy, effects, [objective]).metrics[objective];
        return [compact({ target: dummy.name, id, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) })];
      } catch { return []; }
    }) : undefined;
    const objectiveNote = objective === 'max'
      ? '`max` é o golpe máximo, sem média de crítico nem de acerto: builds que dependem de crítico aparecem erradas. Prefira `dps`, `avgHit` (dano médio por golpe) ou `rotationDps`.'
      : objective === 'dps' && ((rb.model as { rotation?: string[] }).rotation?.length ?? 0) > 1
        ? 'A build tem uma rotação: `rotationDps` mede o ciclo inteiro (buffs, recargas); `dps` mede só a habilidade escolhida.' : undefined;
    let aspdPotionCheck: Record<string, unknown> | undefined;
    if (!['max', 'min', 'hitsToKill'].includes(objective)) {
      try {
        const now = evalBuild(current, undefined, dataset, monster, effects, [objective, 'aspd']);
        if ((now.metrics.aspd ?? 0) < 193 && now.metrics[objective]) {
          const options = [...AspdPotionList, ...AspdPotionStackable].flatMap((potion) => {
            if (potion.value === (current as { aspdPotion?: number }).aspdPotion) return [];
            const gain = deltaPct(evalBuild(current, { aspdPotion: potion.value }, dataset, monster, effects, [objective]).metrics[objective], now.metrics[objective]);
            return gain !== null && gain > 0.5 ? [{ potion: potion.label, id: potion.value, gainPct: gain }] : [];
          }).sort((a, b) => b.gainPct - a.gainPct).slice(0, 3);
          if (options.length) aspdPotionCheck = { aspd: now.metrics.aspd, note: 'Ganho de trocar a poção de velocidade de ataque da build final (a busca de peças não a escolhe).', options };
        }
      } catch { /* optional report */ }
    }

    // Procs the search did not count, measured on the build it ended with: a piece may be worth more when its proc is on.
    const procs: { effect: string; label?: string; gainPct: number | null; average?: ReturnType<typeof procEstimate> }[] = [];
    let countedProcs: string[] | undefined;
    const lostProcs: string[] = [];
    try {
      const last = evaluate(current, undefined, dataset, monster, effects, [objective], more, aims[0].weight, false);
      const firstOff = evaluate(base, undefined, dataset, monster, effects, [objective], more, aims[0].weight, false);
      const keptProcs = new Set(((last.solved.calc.chanceList ?? []) as { name?: string }[]).map((chance) => chance?.name));
      for (const chance of ((baseline.solved.calc.chanceList ?? []) as any[]).filter((entry) => entry?.name && !keptProcs.has(entry.name) && !effects.includes(entry.name)).slice(0, 5)) {
        const withProc = evaluate(base, undefined, dataset, monster, [...effects, chance.name], [objective], more, aims[0].weight, false).metrics[objective];
        const gain = deltaPct(withProc, firstOff.metrics[objective]);
        const average = procEstimate(await procData(dataset, chance), gain, procHitsPerSecond ?? 3);
        const expected = average?.expectedGainPct ? Object.values(average.expectedGainPct)[0] : undefined;
        lostProcs.push(`Você deixa de usar o proc de ${chance.name}: +${gain}% com ele ligado${expected !== undefined ? `, em média +${expected}% a ${procHitsPerSecond ?? 3} ataques/s (${average?.chancePct}% por ataque, ${average?.durationSeconds}s)` : ''}. Política da busca: ${resolvedProcMode}; confira as premissas em procContext.`);
      }
      if (resolvedProcMode === 'active') countedProcs = evalFresh(current, undefined, dataset, monster, effects, [objective]).solved.effects;
      else for (const chance of ((last.solved.calc.chanceList ?? []) as any[]).filter(chance => chance?.name && !effects.includes(chance.name)).slice(0, 10)) {
        if (outOfBudget()) break;
        solves++;
        const withProc = evaluate(current, undefined, dataset, monster, [...effects, chance.name], [objective], more, aims[0].weight, false).metrics[objective];
        const gainPct = deltaPct(withProc, last.metrics[objective]);
        const average = procEstimate(await procData(dataset, chance), gainPct, procHitsPerSecond);
        procs.push({ effect: chance.name, label: chance.label, gainPct, ...(average ? { average } : {}) });
      }
    } catch { /* the report is optional */ }

    const uncatalogued = (() => {
      const ids = [...new Set([...pools.values()].flat().concat(walk.map(slot => rb.model[slot])))].filter(id => id && !randomOptionCatalogFor(id)
        && (ExtraOptionTable[dataset.items[id]?.aegisName] || dataset.items[id]?.itemTypeId === 1 || dataset.items[id]?.itemTypeId === 10));
      return { count: ids.length, ...(ids.length ? { sample: ids.slice(0, 8), see: 'uncatalogued_pools' } : {}) };
    })();


    // How much of the gain is swapping pieces and how much is raising refine and grade of what is already worn: the default tests
    // everything at +12 and grade A, so without this split a +116% reads like a shopping list.
    const gainByKind: Record<string, number> = {};
    for (const step of steps) {
      const kind = String(step['kind'] ?? 'troca');
      gainByKind[kind] = round(((1 + (gainByKind[kind] ?? 0) / 100) * (1 + (Number(step['gainPct']) || 0) / 100) - 1) * 100, 2);
    }
    const model = (side: ResolvedBuild) => side.model as unknown as Record<string, any>;
    const nameOf = (id: unknown) => (typeof id === 'number' && id > 0 ? (dataset.itemIndex.get(id)?.name ?? String(id)) : null);
    /** The final build against the original, in words: what to put where, at which refine and grade, with which sockets and rolls. */
    const changeList = MAIN_ITEM_SLOTS.flatMap((slot) => {
      const before = model(baseline.rb);
      const after = model(rb);
      const sockets = relatedItemKeys(slot).filter((key) => before[key] !== after[key]);
      const indexes = ItemOptionMap.get(slot as ItemTypeEnum) ?? [];
      const rolls = indexes.map((index) => (changes.options ?? {})[String(index)]).filter((roll): roll is string => !!roll);
      const rolled = rolls.length > 0 && JSON.stringify(rolls) !== JSON.stringify(indexes.map((index) => before['rawOptionTxts']?.[index]).filter(Boolean));
      const moved = before[slot] !== after[slot] || before[`${slot}Refine`] !== after[`${slot}Refine`] || (before[`${slot}Grade`] ?? '') !== (after[`${slot}Grade`] ?? '') || sockets.length > 0;
      if (!moved && !rolled) return [];

      return [compact({
        slot,
        from: nameOf(before[slot]),
        to: nameOf(after[slot]),
        refine: before[`${slot}Refine`] !== after[`${slot}Refine`] ? `${before[`${slot}Refine`] ?? 0} → ${after[`${slot}Refine`] ?? 0}` : undefined,
        grade: (before[`${slot}Grade`] ?? '') !== (after[`${slot}Grade`] ?? '') ? `${before[`${slot}Grade`] || '-'} → ${after[`${slot}Grade`] || '-'}` : undefined,
        sockets: sockets.length ? sockets.map((key) => `${key.replace(slot, '')}: ${nameOf(after[key]) ?? 'vazio'}`) : undefined,
        rolls: rolls.length ? rolls : undefined,
      })];
    });
    const hpBefore = baseline.metrics.hp;
    const hpAfter = metrics.hp;

    // The answer is short by default: the numbers, the path, and the few things that change how to read them (`alerts`). The
    // explanations and the target block come with `detail` (and are in the `guide` tool).
    const alerts = [
      context.undefendedNote,
      context.classNote,
      context.hint,
      ...(context.breakpoints?.notes ?? []),
      objectiveNote,
      ...(complements && !skillId ? ['Sem habilidade ofensiva escolhida (`atkSkill`): encantamentos e cartas de habilidade não são ranqueados.'] : []),
      ...(uncatalogued.count ? [`${uncatalogued.count} item(ns) sem pool de rolagens confirmado ficam fora da busca de rolagens (\`uncatalogued_pools\`).`] : []),
      ...(hpBefore && hpAfter && hpAfter < hpBefore * 0.95 ? [`O HP cai ${round((1 - hpAfter / hpBefore) * 100, 1)}% (${Math.round(hpBefore)} → ${Math.round(hpAfter)}): se a build precisa aguentar, repita com \`require: [{ metric: "hp", min: ${Math.round(hpBefore)} }]\`.`] : []),
      ...((gainByKind['refinoGrau'] ?? 0) > 10 ? [`${gainByKind['refinoGrau']}% do ganho é subir refino e grau das peças que você já usa (para +${REACHABLE_REFINE}/A); só trocar peças rende ${gainByKind['troca'] ?? 0}% (\`gainByKind\`).`] : []),
      ...lostProcs,
      ...(excludeMvpCards && ITEM_ID_KEYS.some((key) => MVP_CARD_IDS.has(rb.model[key]))
        ? [`A build final ainda usa carta de MVP que você já tinha: ${ITEM_ID_KEYS.filter((key) => MVP_CARD_IDS.has(rb.model[key])).map((key) => `${dataset.items[rb.model[key]]?.name} (${key})`).join(', ')}. A busca não recomenda carta de MVP nova, mas mantém a sua; para tirá-la, teste a troca em \`evaluate_variants\`.`] : []),
      ...(profile === 'burst' && !hasRotation ? ['Sem rotação no link: burst e sustentado medem quase o mesmo. Passe `rotation` para separá-los.'] : []),
    ].filter((entry): entry is string => !!entry);

    const tuned = steps.filter((step) => step['kind'] === 'ajuste');
    const pathSteps = tuned.length > 1
      ? [{ kind: 'ajuste', slots: [...new Set(tuned.map((step) => step['slot']))], ...(tuned.some((step) => step['polish']) ? { polish: tuned.map((step) => step['polish']).filter(Boolean) } : {}), gainPct: round((tuned.reduce((product, step) => product * (1 + (Number(step['gainPct']) || 0) / 100), 1) - 1) * 100, 2), atual: true }, ...steps.filter((step) => step['kind'] !== 'ajuste')]
      : steps;

    // What the search looked at and what it did not: a result is "the best found among these", and this says how many these were.
    const searchable = walk.filter((slot) => (pools.get(slot)?.length ?? 0) > 0);
    const unreached = searchable.filter((slot) => !slotCoverage.has(slot));
    const partial = [...slotCoverage].filter(([, entry]) => entry.measured < entry.available).map(([slot, entry]) => [slot, entry.available - entry.measured] as const);
    const total = solves - memo.hits;
    const coverage = {
      slots: { searched: searchable.length - unreached.length, total: searchable.length, ...(unreached.length ? { notReached: unreached } : {}) },
      candidates: { measured: [...slotCoverage.values()].reduce((sum, entry) => sum + entry.measured, 0), available: [...slotCoverage.values()].reduce((sum, entry) => sum + entry.available, 0), ...(partial.length ? { notMeasured: Object.fromEntries(partial) } : {}) },
      ...(complements ? { worn: { tuned: tunedSlots, total: walk.filter((slot) => rb.model[slot] > 0).length }, sockets: { checked: Math.min(polish.fields, polish.total), total: polish.total } } : {}),
      calculations: { discovery, evaluation: Math.max(0, total - discovery), ...(memo.hits ? { reused: memo.hits } : {}) },
      complete: !exhausted && !unreached.length && !partial.length && (!complements || polish.fields >= polish.total),
    };

    const finalProcEvaluation = evalBuild(current, undefined, dataset, monster, effects, [objective]).procEvaluation;
    return {
      objective,
      baseline: roundMetrics(baseline.metrics, shown),
      final: roundMetrics(metrics, shown),
      deltaPct: Object.fromEntries(shown.map((k) => [k, deltaPct(metrics[k], baseline.metrics[k])])),
      steps: pathSteps,
      gainByKind,
      changes: changeList,
      patch: changes,
      share: shareOf(rb),
      profiles,
      // The weighted figure hides that a build can be strong on one kind of target and weak on another: show each.
      perTarget: aims.length > 1 ? aims.map((aim, i) => {
        const before = evalBuild(base, undefined, dataset, aim.monster, effects, [objective]).metrics[objective];
        const after = evalBuild(current, undefined, dataset, aim.monster, effects, [objective]).metrics[objective];
        return compact({ monsterId: (targets ?? [])[i]?.monsterId, name: aim.monster.name, class: aim.monster.type, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) });
      }) : undefined,
      ...(defendedCheck?.length ? { defendedCheck: detail ? { note: 'O alvo não tem defesas; o resultado em dummies com defesa de chefe mostra o que a penetração e a TEN valem de verdade.', rows: defendedCheck } : defendedCheck } : {}),
      ...(levelCheck.length ? { levelCheck: detail ? { note: '`now`: ganho da peça sobre a atual, ambas no refino e grau que você tem hoje; `evolved`: o mesmo com as duas no refino e grau ideais. Cada lado com os melhores cartas, encantamentos e rolagens.', slots: levelCheck } : levelCheck } : {}),
      ...(aspdPotionCheck ? { aspdPotionCheck } : {}),
      ...unconfirmed(rb, changes, dataset),
      ...(procs.length ? { procs: detail ? { note: 'Ganho individual contra a mesma build sem o proc (`gainPct`: sempre ativo; `average`: estimativa por frequência de ataques). A política usada para ordenar a busca aparece em procContext.', options: procs } : procs } : {}),
      ...(countedProcs?.length ? { countedProcs } : {}),
      ...(skippedNotInLatam.length ? { skippedNotInLatam } : {}),
      ...(alerts.length ? { alerts } : {}),
      solves: solves - memo.hits,
      ...(memo.hits ? { reused: memo.hits } : {}),
      screening,
      procContext: { mode: resolvedProcMode, hitsPerSecond: procHitsPerSecond ?? 3,
        counted: finalProcEvaluation.counted,
        uncounted: finalProcEvaluation.uncounted,
        baselineOff: evaluate(base, undefined, dataset, monster, effects, [objective], more, aims[0].weight).metrics[objective],
        finalOff: evaluate(current, undefined, dataset, monster, effects, [objective], more, aims[0].weight).metrics[objective],
        note: 'Média estimada por estados ativo/inativo de até 3 procs com chance e duração conhecidas, independentes e ataques regulares. HP mínimo é verificado sem os procs adicionais. A comparação visual usa os efeitos explicitamente selecionados.' },
      limits: { refine: refine ?? REACHABLE_REFINE, maxGrade: maxGrade ?? 'A' },
      coverage,
      ...(exhausted ? { stopped: `orçamento de cálculos ou de tempo esgotado (${solves - memo.hits} de ${budget}): pode haver trocas melhores que a busca não alcançou. Restrinja \`slots\`, fixe \`candidates\`, use \`complements: false\` ou aumente \`maxSolves\` para a busca caber.` } : {}),
      ...(baseline.rb.warnings.length ? { warnings: baseline.rb.warnings } : {}),
      ...(detail ? {
        context,
        targets: aims.length > 1 ? aims.map((aim, i) => ({ monsterId: (targets ?? [])[i]?.monsterId, name: aim.monster.name, weight: aim.weight })) : undefined,
        candidates: Object.fromEntries([...pools].map(([slot, ids]) => [slot, ids.length])),
        candidateIds: Object.fromEntries(pools),
        alternatives: Object.fromEntries([...considered].flatMap(([slot, rows]) => {
          const top = rows
            .filter((row) => row.to.some(([target, id]) => rb.model[target] !== id))
            .sort((a, b) => b.value - a.value).slice(0, 3)
            .map((row) => ({ to: row.to.map(([target, id]) => itemLabel(dataset, id, row.grades[target])), vsBuildThenPct: deltaPct(row.value, row.against) }));
          return top.length ? [[slot, top]] : [];
        })),
        complementSearch: { enabled: complements, uncataloguedRandomItems: uncatalogued, note: 'Itens sem pool confirmado ficam fora da busca de rolagens. Orçamento: até 48 cálculos de complementos por movimento.' },
        note: 'Heurística (peças, conjuntos, graus e complementos); patch/link incluem cartas, encantamentos e rolagens. Antes de comparar, a peça que a build já usa é ajustada com os melhores cartas, encantamentos e rolagens catalogadas (passos com `atual`), mesmo que o link não os traga. Não prova ótimo global.',
      } : {}),
    };
  }

async function slotOptions({ itemId, query, limit = 40, detail = false }: SlotOptionsArgs) {
    const { compactCatalog, compactUpstream, randomOptionReferencesFor } = await import('../data/random-options');
    const item = dataset.items[itemId];
    if (!item) throw new Error(`Item ${itemId} não está no banco do calculador.`);

    const needle = (query ?? '').trim().toLowerCase();
    const aegis = aegisIndex(dataset);

    const pools = enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined;
    const randomCapacity = item.itemTypeId === 1 ? 3 : item.itemTypeId === 10 ? 2 : ExtraOptionTable[item.aegisName] ?? 0;
    const randomCatalog = randomOptionCatalogFor(itemId);
    const randomReferences = randomOptionReferencesFor(itemId);
    const randomPositions = (dataset.itemIndex.get(itemId)?.slotTags ?? [])
      .filter(slot => MAIN_ITEM_SLOTS.includes(slot))
      .map(slot => ({ slot, positions: (ItemOptionMap.get(slot as ItemTypeEnum) ?? []).slice(0, randomCapacity) }));
    const enchants = (pools ?? []).flatMap((pool, index) => {
      if (!pool?.length) return [];
      const options = [...new Set(pool)]
        .map((aegisName) => ({ id: aegis.get(aegisName), name: aegisName }))
        .filter((o): o is { id: number; name: string } => o.id !== undefined)
        .map((o) => ({ id: o.id, name: dataset.itemIndex.get(o.id)?.name ?? o.name }))
        .filter((o) => !needle || o.name.toLowerCase().includes(needle));

      return [{ position: index, total: options.length, options: options.slice(0, limit), ...(options.length > limit ? { truncated: true } : {}) }];
    }).reduce<{ position: number; positions?: number[]; total: number; options: { id: number; name: string }[]; truncated?: boolean }[]>((groups, entry) => {
      // Sockets that offer the same list (Automatron's three) are said once, not three times.
      const same = groups.find(group => group.options.length === entry.options.length && group.options.every((o, i) => o.id === entry.options[i].id));
      if (same) same.positions = [...(same.positions ?? [same.position]), entry.position];
      else groups.push(entry);
      return groups;
    }, []);

    return compact({
      id: itemId,
      name: dataset.itemIndex.get(itemId)?.name ?? item.name,
      cardSlots: item.slots || 0,
      cardSearch: 'search_items com `slot` = weaponCard, headCard, shieldCard, armorCard, garmentCard, bootCard ou accCard.',
      enchants,
      ...(randomCapacity || randomReferences?.references.length ? { randomOptions: {
        capacity: randomCapacity, slots: randomPositions,
        validation: randomCatalog ? 'reference-ranges' : 'capacity-only', poolSource: randomPoolTier(itemId), automaticRollSearch: !!randomCatalog,
        ...(randomCatalog ? { catalog: detail ? randomCatalog : compactCatalog(randomCatalog) } : {}),
        ...(randomReferences ? { upstream: detail ? randomReferences : compactUpstream(randomReferences) } : {}),
        input: 'Passe options com o número da posição e o bônus rolado (ex.: "melee:5"). optimize_build busca rolagens só com catalog. `detail: true` devolve os pools brutos.',
      } } : {}),
      ...(pools ? {} : { note: randomCapacity
        ? 'Esta peça usa bônus aleatórios, não itens de encantamento. Declare as rolagens em options ao comparar configurações.'
        : 'Esta peça não tem soquetes de encantamento no calculador.' }),
    });
  }

return { evaluateVariants, scanSlot, explainDamage, optimizeBuild, slotOptions, shareOf };
}
