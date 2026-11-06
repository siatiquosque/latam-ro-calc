import { expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { METEOR_WEAK, METEOR_MONSTERS } from './__tests__/discovery-builds';

it('progressive visits late slots within a real multi-target budget, deterministically and legally', async () => {
  const ops = createOptimizationOperations(loadDatasetFromDisk(), { ...config, limits: { ...config.limits, maxSearchMs: 6 * 3_600_000 } });
  const args: any = { build: { preset: METEOR_WEAK() }, targets: METEOR_MONSTERS.map(monsterId => ({ monsterId })),
    goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: { lockedFields: ['weaponCard1'], lockedSlots: ['shield'] },
    budgetMode: 'unified', budgetAccounting: 'engine', exploration: 'progressive', procMode: 'off', instrument: true, maxSolves: 800 };
  const first: any = await ops.optimizeBuild(args);
  const again: any = await ops.optimizeBuild(args);
  expect(first.patch).toEqual(again.patch);
  expect(first.solves).toBe(again.solves);
  expect(first.solves).toBeLessThanOrEqual(800);
  expect(first.feasibility.final.violations).toEqual([]);
  const survey = first.budgetReport.slotLog.filter((row: any) => row.round === -2);
  expect(new Set(survey.map((row: any) => row.slot)).size).toBe(15);
  expect(survey.some((row: any) => row.slot.startsWith('shadow'))).toBe(true);
  const phases = first.budgetReport.phases;
  const calls = ['baseline', 'discovery', 'search', 'socket', 'levelCheck'].reduce((sum, key) => sum + phases[key].engineCalls, 0);
  expect(calls).toBe(first.solves);
}, 300_000);
