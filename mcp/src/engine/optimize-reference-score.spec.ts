import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import benchBuilds from './__tests__/fixtures/bench-builds.json';
import fogueira from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { config } from '../config';

await loadRandomPools();
const dataset = loadDatasetFromDisk();
const ops = createOptimizationOperations(dataset, { ...config, limits: { ...config.limits, maxSearchMs: 600_000, maxSolves: 100_000 } } as any);
const builds: Record<string, any> = { fogueira: fogueira.preset };
for (const [name, entry] of Object.entries(benchBuilds as Record<string, { preset: any }>)) builds[name] = entry.preset;
const goldenPath = fileURLToPath(new URL('./__tests__/fixtures/optimize-reference-score.json', import.meta.url).href);

/**
 * What `optimize_build` ends with on the reference builds at a fixed solve budget. The search is deterministic, so a speed-up
 * must leave these untouched; a change in the search itself moves them on purpose. Regenerate with
 * `UPDATE_GOLDEN=1 npx vitest run mcp/src/engine/optimize-reference-score.spec.ts` and review the diff of optimize-reference-score.json.
 */
describe('optimize_build on the reference builds', () => {
  it('ends on the pinned score and solve count', async () => {
    const actual: Record<string, { solves: number; final: number }> = {};
    for (const [name, preset] of Object.entries(builds)) {
      const r: any = await ops.optimizeBuild({ build: { preset }, target: { monsterId: 21077 }, objective: 'dps', maxSolves: 600, procMode: 'average', instrument: true } as any);
      actual[name] = { solves: r.solves, final: Math.round(r.budgetReport?.bestScoreByPhase?.final ?? 0) };
    }
    if (process.env['UPDATE_GOLDEN'] || !existsSync(goldenPath)) { writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n'); return; }
    expect(actual).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  }, 300_000);
});
