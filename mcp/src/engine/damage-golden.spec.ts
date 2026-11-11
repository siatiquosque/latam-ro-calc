import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import benchBuilds from './__tests__/fixtures/bench-builds.json';
import fogueira from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { solveWithInput } from 'src/app/build-analysis/engine/solve';
import { readMetrics } from 'src/app/build-analysis/engine/metrics';

await loadRandomPools();
const dataset = loadDatasetFromDisk();
const monster = dataset.monsters[21077];
const wanted = ['dps', 'avgHit', 'max', 'min', 'critRate', 'hitChance'] as const;
const builds: Record<string, any> = { fogueira: fogueira.preset };
for (const [name, entry] of Object.entries(benchBuilds as Record<string, { preset: any }>)) builds[name] = entry.preset;
const goldenPath = fileURLToPath(new URL('./__tests__/fixtures/damage-golden.json', import.meta.url).href);

/**
 * Damage of the reference builds, pinned. A change to the calculator or the data (ours or an upstream merge) that moves any
 * of these fails here and shows which build and which figure. If the change is intended, regenerate with
 * `UPDATE_GOLDEN=1 npx vitest run mcp/src/engine/damage-golden.spec.ts` and review the diff of damage-golden.json.
 */
describe('damage of the reference builds', () => {
  it('matches the pinned values', () => {
    const actual: Record<string, Record<string, number>> = {};
    for (const [name, preset] of Object.entries(builds)) {
      const rb = resolveBuild({ preset }, dataset);
      const { calc, input } = solveWithInput(rb, dataset, monster, []);
      actual[name] = readMetrics({ calc, input, rb, effects: [] }, wanted) as any;
    }
    if (process.env['UPDATE_GOLDEN'] || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    expect(actual).toEqual(JSON.parse(readFileSync(goldenPath, 'utf8')));
  });
});
