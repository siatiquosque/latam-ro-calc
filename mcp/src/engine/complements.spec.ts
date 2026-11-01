import { expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools, randomOptionCatalogFor } from 'src/app/core/random-option-catalog';
import { complementChoices, searchComplements } from './complements';
import { validateCataloguedRolls } from 'src/app/core/random-option-catalog';

await loadRandomPools();

const dataset = loadDatasetFromDisk();

it('offers only valid coin profiles and never assigns random options to an item with no pool', () => {
  const fields = complementChoices(dataset, 'headMiddle', 410233, ['atk', 'melee', 'range', 'sMatk'], new Set());
  const rolls = fields.flat().filter(patch => patch.options);
  expect(rolls.length).toBeGreaterThan(0);
  for (const patch of rolls) expect(validateCataloguedRolls(410233, [patch.options['10'], patch.options['11']])).toBeNull();
  const bare = Object.values(dataset.items).find(item => item.itemTypeId === 1 && !randomOptionCatalogFor(item.id))!;
  expect(complementChoices(dataset, 'weapon', bare.id, ['atk'], new Set()).flat().every(p => !p.options)).toBe(true);
});

it('searches each field and keeps gains evaluated before its per-stage budget runs out', () => {
  const initial = { patch: { gear: {} }, result: { metrics: { max: 0 } } };
  const fields = Array.from({ length: 4 }, (_, i) => Array.from({ length: 10 }, (_, j) => ({ gear: { [`field${i}`]: j + 1 } })));
  let calls = 0;
  const result = searchComplements(initial, fields, 'max', patch => {
    calls++;
    return { metrics: { max: Object.values(patch.gear).reduce<number>((sum, value) => sum + Number(value), 0) } };
  });
  expect(calls).toBeLessThanOrEqual(48);
  expect(Object.keys(result.patch.gear)).toHaveLength(4);
  expect(result.result.metrics.max).toBeGreaterThan(4);
});

it('honors exclusions when generating card and enchantment choices', () => {
  const fields = complementChoices(dataset, 'boot', 470094, ['atk', 'criDmg', 'melee'], new Set());
  const ids = fields.flat().flatMap(p => Object.values(p.gear ?? {})).filter((id): id is number => typeof id === 'number');
  expect(ids.length).toBeGreaterThan(0);
  const banned = new Set(ids);
  const filtered = complementChoices(dataset, 'boot', 470094, ['atk', 'criDmg', 'melee'], banned);
  expect(filtered.flat().flatMap(p => Object.values(p.gear ?? {})).every(id => !banned.has(Number(id)))).toBe(true);
});

it('does not propose cards absent from the current LATAM client', () => {
  const fields = complementChoices(dataset, 'weapon', 560026, ['atk', 'criDmg', 'melee'], new Set());
  for (const patch of fields.flat()) for (const [field, id] of Object.entries(patch.gear ?? {})) {
    if (field.includes('Card') && id) expect(dataset.itemIndex.get(Number(id))?.latam).toBe(true);
  }
});

it('counts penetration of the target race and class, and the size penalty, among the keys that make an item worth testing', async () => {
  const { resolveBuild } = await import('./build-input');
  const { solve } = await import('./solve');
  const { resolveTarget } = await import('../tools/calculate');
  const { relevantKeys } = await import('./complements');
  const rb = resolveBuild({ class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560037 } } as any, dataset);
  const keys = relevantKeys(solve(rb, dataset, resolveTarget(dataset, undefined).monster));
  expect(keys).toEqual(expect.arrayContaining(['ignore_size_penalty', 'p_pene_class_boss', 'p_pene_race_all', 'pene_res', 'p_class_boss']));
});
