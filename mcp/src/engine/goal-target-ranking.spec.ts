import { expect, it } from 'vitest';
import { config } from '../config';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { evaluate } from 'src/app/build-analysis/engine/evaluate';
import { goalStanding } from 'src/app/build-analysis/engine/feasibility';
import { judgedMetrics } from 'src/app/build-analysis/engine/goal-spec';
import { gearOnlyStart } from './__tests__/jor-ab02-support';

it('judges the first target with its own metrics, not the weighted average', async () => {
  const dataset = loadDatasetFromDisk();
  const start = gearOnlyStart();
  const goal = { maxHitsToKill: 1, margin: 0.1 };
  const targetIds = [21545, 21544];
  const wanted: any = [...new Set([...judgedMetrics(goal), 'min'])];
  const readings = targetIds.map(monsterId => {
    const monster = dataset.monsters[monsterId];
    const result = evaluate({ preset: start } as any, undefined, dataset, monster, [], wanted);
    return { monsterId, hp: monster.stats?.health, metrics: result.metrics };
  });
  const expected = goalStanding(readings, goal);
  const found: any = await createOptimizationOperations(dataset, config).optimizeBuild({ build: { preset: start }, targets: targetIds.map(monsterId => ({ monsterId })), goal, procMode: 'off', budgetMode: 'unified', slots: [], complements: false, maxSolves: 300 } as any);
  expect(found.feasibility.search.bestGap.worst).toBeCloseTo(expected.worst, 4);
}, 300_000);
