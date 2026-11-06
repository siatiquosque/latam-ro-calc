import { expect, it } from 'vitest';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { applyPatch } from 'src/app/build-analysis/engine/variants';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { gearOnlyStart, SCENARIO_EXACT } from './__tests__/jor-ab02-support';

it('reports the unmet goal after a completely closed equipment space', async () => {
  const build: any = { preset: gearOnlyStart() };
  const dataset = loadDatasetFromDisk();
  const found: any = await createOptimizationOperations(dataset, config).optimizeBuild({
    build, target: { monsterId: 21545 }, objective: 'dps', procMode: 'off',
    goal: { maxHitsToKill: 1, margin: 0.1 }, slots: [], pairs: [], complements: false, levelChecks: false, maxSolves: 300,
  } as any);
  expect(found.feasibility.baseline.status).toBe('infeasible');
  expect(found.feasibility.final.status).toBe('infeasible');
  expect(found.feasibility.search.stoppedBy).toBe('completed');
  expect(found.feasibility.search.bestGap.worst).toBeGreaterThan(0);
  expect(resolveBuild(applyPatch(build, found.patch), dataset).model).toEqual(resolveBuild(build, dataset).model);
}, 300_000);

it('applies grade, refine, MVP, consumable and field constraints together', async () => {
  const dataset = loadDatasetFromDisk(), build: any = { preset: gearOnlyStart() };
  const constraints = { ...SCENARIO_EXACT, maxRefine: 12, consumables: { forbidden: [14536] } };
  const found: any = await createOptimizationOperations(dataset, config).optimizeBuild({
    build, targets: [{ monsterId: 21545 }, { monsterId: 21544 }], objective: 'dps', procMode: 'off',
    goal: { maxHitsToKill: 2 }, constraints, slots: ['weapon'], complements: false, maxSolves: 100,
  } as any);
  expect(found.feasibility.final.violations).toEqual([]);
  const after: any = resolveBuild(applyPatch(build, found.patch), dataset).model;
  const before: any = resolveBuild(build, dataset).model;
  for (const field of SCENARIO_EXACT.lockedFields) expect(after[field] ?? null).toBe(before[field] ?? null);
  expect(after.consumables ?? []).not.toContain(14536);
}, 300_000);
