import { expect, it, vi } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { solve } from 'src/app/build-analysis/engine/solve';
import { complementChoices, relevantKeys, searchComplements, socketOptions, swapPatch } from 'src/app/build-analysis/engine/complements';
import { evaluate } from 'src/app/build-analysis/engine/evaluate';
import { GOAL, gearOnlyStart, MONSTERS, preset, SCENARIO_EXACT } from './__tests__/jor-ab02-support';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { config } from '../config';
import * as complements from 'src/app/build-analysis/engine/complements';

it('checks the reference armor enchant after the parent swap', () => {
  const dataset = loadDatasetFromDisk();
  const start = gearOnlyStart(), reference = preset('invernal');
  const base = { preset: start } as any;
  const rb = resolveBuild(base, dataset);
  const monster = dataset.monsters[21544];
  const keys = relevantKeys(solve(rb, dataset, monster), [monster]);
  const field = 'armorEnchant1', id = reference[field];
  const currentLegal = socketOptions(dataset, 'armor', start['armor']).some(x => x.field === field && x.ids.includes(id));
  const replacementLegal = socketOptions(dataset, 'armor', reference['armor']).some(x => x.field === field && x.ids.includes(id));
  const choices = complementChoices(dataset, 'armor', reference['armor'], keys, new Set());
  const offered = choices.some(group => group.some(p => p.gear?.[field] === id));
  expect(currentLegal).toBe(false);
  expect(replacementLegal).toBe(true);
  expect(offered).toBe(true);
  const patch = swapPatch(dataset, rb, 'armor', reference['armor'], { maxGrade: 'C' });
  const initial = evaluate(base, patch, dataset, monster, [], ['dps']);
  const attempted: any[] = [];
  searchComplements({ patch, result: initial }, choices, 'dps', candidate => {
    if (candidate.gear?.[field] === id) attempted.push(candidate);
    try { return evaluate(base, candidate, dataset, monster, [], ['dps']); } catch { return null; }
  }, 2000);
  expect(attempted.length).toBeGreaterThan(0);
  expect(attempted.every(p => p.gear.armor === reference['armor'])).toBe(true);
}, 300_000);

it('distinguishes a compound move actually evaluated from a piece merely considered', async () => {
  const start = gearOnlyStart(), reference = preset('invernal');
  const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 6 * 3_600_000 } };
  const original = complements.searchComplements;
  let evaluated = 0;
  const spy = vi.spyOn(complements, 'searchComplements').mockImplementation(((initial: any, fields: any, objective: any, solve: any, budget: any) =>
    original(initial, fields, objective, (patch: any) => {
      const result = solve(patch);
      const gear = result?.rb.model;
      if (gear?.armor === reference['armor'] && gear.armorEnchant1 === reference['armorEnchant1'] && gear.armorEnchant2 === reference['armorEnchant2']) evaluated++;
      return result;
    }, budget)) as any);
  try {
    const observations: unknown[] = [];
    const ops = createOptimizationOperations(loadDatasetFromDisk(), runtime);
    for (const maxSolves of [230, 730, 1930]) {
      evaluated = 0;
      const found: any = await ops.optimizeBuild({
        build: { preset: start }, targets: MONSTERS.map(monsterId => ({ monsterId })), goal: { ...GOAL, margin: 0.1 },
        constraints: SCENARIO_EXACT, slots: ['armor'], candidates: { armor: [start['armor'], reference['armor']] },
        budgetMode: 'unified', budgetAccounting: 'engine', procMode: 'off', objective: 'dps', maxSolves,
      } as any);
      expect(found.feasibility.final.violations).toEqual([]);
      observations.push({ maxSolves, evaluated: evaluated > 0, accepted: found.patch.gear?.armor === reference['armor'] && found.patch.gear?.armorEnchant1 === reference['armorEnchant1'] && found.patch.gear?.armorEnchant2 === reference['armorEnchant2'] });
    }
    expect(observations).toEqual([
      { maxSolves: 230, evaluated: false, accepted: false },
      { maxSolves: 730, evaluated: true, accepted: false },
      { maxSolves: 1930, evaluated: true, accepted: true },
    ]);
  } finally { spy.mockRestore(); }
}, 300_000);
