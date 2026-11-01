import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { CardPosition } from 'src/app/constants/card-position.enum';
import { enchantPoolsFor } from 'src/app/core/equipment-slot-derivation';
import { randomOptionCatalogFor } from 'src/app/core/random-option-catalog';
import { Dataset } from '../data/dataset';
import { BuildPatch, applyPatch } from './variants';
import { partnerIndex } from './item-partners';

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

/** Legal socket choices only. Unknown regional random pools never become free-form stats. */
export function complementChoices(dataset: Dataset, slot: string, itemId: number, keys: string[], excluded: Set<number>) {
  const descriptor = EQUIPMENT_SLOTS.find(d => d.key === slot);
  const item = dataset.items[itemId];
  if (!descriptor || !item) return [];
  const score = (id: number) => Object.entries(dataset.items[id]?.script ?? {}).reduce((sum, [key, value]) =>
    sum + (keys.includes(key) ? 10 + (Array.isArray(value) ? value : [value]).reduce((n: number, v: unknown) => n + (typeof v === 'number' ? Math.abs(v) : 0), 0) : 0), 0);
  const rank = (ids: number[]) => [...new Set(ids)].filter(id => !excluded.has(id) && dataset.items[id])
    .sort((a, b) => score(b) - score(a) || a - b).slice(0, 8);
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
    const profiles: BuildPatch[][] = [];
    for (const profile of catalog.profiles) {
      const choices = profile.positions.map(pool => pool.filter(rule => keys.includes(rule.key))
        .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key)));
      const count = Math.max(...choices.map(pool => pool.length));
      const rolls: BuildPatch[] = [];
      for (let offset = 0; offset < count; offset++) for (const bound of ['max', 'min'] as const) {
        const options = Object.fromEntries(choices.flatMap((pool, position) => {
          const rule = pool[offset % pool.length];
          const index = descriptor.optionIndexes[position];
          return rule && index !== undefined ? [[index, `${rule.key}:${rule[bound]}`]] : [];
        }));
        if (Object.keys(options).length) rolls.push({ options });
      }
      profiles.push(rolls);
    }
    // Round-robin combiners, so a limited search never spends its entire budget on the first coin.
    fields.push(Array.from({ length: Math.max(...profiles.map(p => p.length)) }, (_, i) => profiles.flatMap(p => p[i] ? [p[i]] : [])).flat());
  }
  return fields;
}

/** Bounded beam, scored by the real solver. The base survives every stage. */
export function searchComplements<T extends { metrics: Record<string, number | undefined> }>(
  initial: { patch: BuildPatch; result: T }, fields: BuildPatch[][], objective: string,
  solve: (patch: BuildPatch) => T | null,
  budget = 48,
) {
  let beam = [initial];
  const perStage = Math.floor(budget / Math.max(1, fields.length));
  for (const choices of fields) {
    const next = [...beam];
    let spent = 0;
    stage:
    for (const choice of choices) for (const entry of beam) {
      if (spent++ >= perStage) break stage;
      const patch = applyPatch(entry.patch, choice);
      const result = solve(patch);
      if (result) next.push({ patch, result });
    }
    const unique = new Map(next.map(entry => [JSON.stringify(entry.patch), entry]));
    beam = [...unique.values()].sort((a, b) => (b.result.metrics[objective] ?? -Infinity) - (a.result.metrics[objective] ?? -Infinity)).slice(0, 3);
  }
  return beam[0];
}
