import { expect, it } from 'vitest';
import { engineCallCount } from 'src/app/build-analysis/engine/evaluate';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { gearOnlyStart, MONSTERS } from './__tests__/jor-ab02-support';

it.each([false, true])('reports all engine calls and mandatory checks with goal=%s', async goalOn => {
  const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
  const before = engineCallCount();
  const found: any = await ops.optimizeBuild({ build: { preset: gearOnlyStart() }, targets: MONSTERS.slice(0, 2).map(monsterId => ({ monsterId })),
    objective: 'dps', procMode: 'off', maxSolves: 100, complements: false, levelChecks: false,
    ...(goalOn ? { goal: { maxHitsToKill: 2 } } : {}) } as any);
  expect(found.budgetUsage.engineCalls).toBe(engineCallCount() - before);
  expect(found.budgetUsage.hardTotalLimit).toBe(false);
  expect(found.budgetUsage.counted).toBe(found.solves);
  expect(found.budgetUsage.feasibilityVerificationCalls).toBe(goalOn ? 4 : 0);
  expect(found.budgetUsage.engineCalls).toBeGreaterThan(found.budgetUsage.counted);
}, 300_000);

it('does not start a new socket pass after the search deadline', async () => {
  const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 1 } };
  const ops = createOptimizationOperations(loadDatasetFromDisk(), runtime);
  const found: any = await ops.optimizeBuild({ build: { preset: gearOnlyStart() }, target: { monsterId: MONSTERS[0] },
    objective: 'dps', procMode: 'off', maxSolves: 10000, instrument: true } as any);
  expect(found.budgetReport.phases.socket.engineCalls).toBe(0);
  expect(found.budgetUsage.stoppedBy).toMatch(/^time/);
}, 300_000);

it('reports both budget and time when both stopped the stages', async () => {
  const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 1 } };
  const found: any = await createOptimizationOperations(loadDatasetFromDisk(), runtime).optimizeBuild({
    build: { preset: gearOnlyStart() }, target: { monsterId: MONSTERS[0] }, objective: 'dps', procMode: 'off', maxSolves: 1,
  } as any);
  expect(found.budgetUsage.stoppedReasons).toContain('search-budget');
  expect(found.budgetUsage.stoppedReasons.some((reason: string) => reason.startsWith('time'))).toBe(true);
}, 300_000);
