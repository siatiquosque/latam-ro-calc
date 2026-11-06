import { expect, it } from 'vitest';
import { JobBudget, JobBudgetExceeded, JobInterrupted } from 'src/app/build-analysis/engine/job-budget';
import { evaluationCache } from 'src/app/build-analysis/engine/evaluate';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { gearOnlyStart, MONSTERS } from './__tests__/jor-ab02-support';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { config } from '../config';

it('reserves verification calls and never overspends, including interleaved users of one budget', () => {
  const budget = new JobBudget(4, 2);
  const worker = () => budget.charge();
  worker(); worker();
  expect(worker).toThrow(JobBudgetExceeded);
  expect(budget.calls).toBe(2);
  budget.verifying = true;
  worker(); worker();
  expect(worker).toThrow(JobBudgetExceeded);
  expect(budget.calls).toBe(4);
});

it('shares a single ceiling across concurrent tasks', async () => {
  const budget = new JobBudget(10, 2);
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, async () => {
    await Promise.resolve();
    budget.charge();
  }));
  expect(attempts.filter(entry => entry.status === 'fulfilled')).toHaveLength(8);
  expect(budget.calls).toBe(8);
  budget.verifying = true;
  budget.charge(); budget.charge();
  expect(budget.calls).toBe(10);
});

it('limits all five targets including final verification and returns a verified build', async () => {
  const found: any = await createOptimizationOperations(loadDatasetFromDisk(), config).optimizeBuild({
    build: { preset: gearOnlyStart() }, targets: MONSTERS.map(monsterId => ({ monsterId })),
    goal: { maxHitsToKill: 2 }, objective: 'dps', procMode: 'off', maxEngineCalls: 80, maxSolves: 300,
  } as any);
  expect(found.budgetUsage.engineCalls).toBeLessThanOrEqual(80);
  expect(found.budgetUsage.hardTotalLimit).toBe(true);
  expect(found.budgetUsage.feasibilityVerificationCalls).toBe(10);
  expect(Object.values(found.budgetUsage.phases).reduce((sum: number, row: any) => sum + row.engineCalls, 0)).toBe(found.budgetUsage.engineCalls);
  expect(found.feasibility.final.violations).toEqual([]);
  expect(found.feasibility.final.targets).toHaveLength(5);
}, 300_000);

it('refuses a hard limit that cannot cover baseline and verification', async () => {
  const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
  await expect(ops.optimizeBuild({ build: { preset: gearOnlyStart() }, targets: MONSTERS.map(monsterId => ({ monsterId })),
    procMode: 'off', maxEngineCalls: 5 } as any)).rejects.toThrow(/insuficiente/);
}, 300_000);

it('charges every target and no extra call for a cache hit', () => {
  const data = loadDatasetFromDisk(), cache = evaluationCache(), budget = new JobBudget(5, 0);
  const aims = MONSTERS.map(id => ({ monster: data.monsters[id], weight: 1 }));
  const run = () => cache.evaluate({ preset: gearOnlyStart() } as any, undefined, data, aims[0].monster, [], ['dps'], aims.slice(1), 1, false, budget);
  run();
  expect(budget.calls).toBe(5);
  run();
  expect(budget.calls).toBe(5);
  expect(cache.hits).toBe(1);
});

it('leaves legacy requests unchanged when the total cap is absent', async () => {
  const start = gearOnlyStart(), ops = createOptimizationOperations(loadDatasetFromDisk(), config);
  const args: any = { build: { preset: start }, target: { monsterId: MONSTERS[0] }, objective: 'dps', procMode: 'off',
    slots: ['weapon'], candidates: { weapon: [start['weapon']] }, refine: 12, maxGrade: 'C', complements: false, maxSolves: 100 };
  const implicit: any = await ops.optimizeBuild(args);
  const explicit: any = await ops.optimizeBuild({ ...args, maxEngineCalls: undefined });
  expect(explicit.patch).toEqual(implicit.patch);
  expect(explicit.final).toEqual(implicit.final);
  expect(implicit.budgetUsage.hardTotalLimit).toBe(false);
});

it('counts proc states as actual engine calls inside the same hard cap', async () => {
  const before = (await import('src/app/build-analysis/engine/evaluate')).engineCallCount();
  const found: any = await createOptimizationOperations(loadDatasetFromDisk(), config).optimizeBuild({
    build: { preset: gearOnlyStart() }, targets: MONSTERS.slice(0, 2).map(monsterId => ({ monsterId })),
    goal: { maxHitsToKill: 2 }, objective: 'dps', procMode: 'average', procHitsPerSecond: 3, maxEngineCalls: 300, maxSolves: 300,
  } as any);
  const after = (await import('src/app/build-analysis/engine/evaluate')).engineCallCount();
  expect(found.budgetUsage.engineCalls).toBe(after - before);
  expect(found.budgetUsage.engineCalls).toBeLessThanOrEqual(300);
  expect(found.budgetUsage.reservedVerificationCalls).toBe(32);
}, 300_000);

it('discards a multi-target evaluation interrupted between targets', () => {
  const data = loadDatasetFromDisk(), cache = evaluationCache(), budget = new JobBudget(20, 4);
  const aims = MONSTERS.map(id => ({ monster: data.monsters[id], weight: 1 }));
  budget.shouldStop = () => budget.calls >= 2 ? 'time' : undefined;
  const run = () => cache.evaluate({ preset: gearOnlyStart() } as any, undefined, data, aims[0].monster, [], ['dps'], aims.slice(1), 1, false, budget);
  expect(run).toThrow(JobInterrupted);
  expect(budget.calls).toBe(2);
  expect(cache.completed).toBe(0);
  budget.shouldStop = undefined;
  run();
  expect(budget.calls).toBe(7);
  expect(cache.hits).toBe(0);
});

it.each([false, true])('returns the last verified checkpoint when cancelled after improvement=%s', async afterImprovement => {
  const start = gearOnlyStart(), controller = new AbortController(), snapshots: any[] = [];
  const found: any = await createOptimizationOperations(loadDatasetFromDisk(), config).optimizeBuild({
    build: { preset: start }, target: { monsterId: MONSTERS[0] }, objective: 'dps', procMode: 'off',
    slots: ['weapon'], candidates: { weapon: [start['weapon']] }, refine: 12, maxGrade: 'C',
    complements: false, maxSolves: 300, maxEngineCalls: 300,
    execution: { signal: controller.signal, onCheckpoint: (checkpoint: any) => {
      snapshots.push(checkpoint);
      if (!afterImprovement || snapshots.length > 1) controller.abort();
    } },
  } as any);
  expect(snapshots.length).toBe(afterImprovement ? 2 : 1);
  expect(found.budgetUsage.stoppedBy).toBe('cancelled');
  expect(found.patch).toEqual(snapshots.at(-1).patch);
  expect(found.final.dps).toBe(snapshots.at(-1).final.dps);
  expect(found.feasibility.final.status).not.toBe('invalid');
  expect(found.budgetUsage.engineCalls).toBeLessThanOrEqual(300);
  if (afterImprovement) expect(found.final.dps).toBeGreaterThan(found.baseline.dps);
}, 300_000);
