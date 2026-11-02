import { describe, expect, it } from 'vitest';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';

const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const run = (budgetMode: 'legacy' | 'unified', maxSolves: number) =>
  ops.optimizeBuild({ build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves, procMode: 'off', budgetMode }) as Promise<any>;

describe('budget of the equipment search', () => {
  it('unified mode pays the final socket pass from the same calculation budget', async () => {
    const maxSolves = 800;
    const unified = await run('unified', maxSolves);
    expect(unified.solves).toBeLessThanOrEqual(maxSolves + 5);
    expect(unified.final.dps).toBeGreaterThanOrEqual(unified.baseline.dps);
  }, 300_000);

  it('legacy mode (the preserved baseline) is the default and keeps its own allowance for the pass', async () => {
    const legacy = await run('legacy', 800);
    const implicit = await ops.optimizeBuild({ build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 800, procMode: 'off' }) as any;
    expect(implicit.share).toBe(legacy.share);
  }, 300_000);
});
