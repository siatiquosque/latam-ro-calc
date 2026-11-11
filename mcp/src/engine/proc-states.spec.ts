import { describe, expect, it } from 'vitest';
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
const builds = [fogueira.preset, ...Object.values(benchBuilds as Record<string, { preset: any }>).map(entry => entry.preset)];
const wanted = ['dps', 'avgHit', 'max', 'min', 'critRate', 'hitChance'] as const;

/**
 * The search averages proc states by switching chances on the already solved calculator (evaluate.ts `withChances`)
 * instead of solving the whole build once per state. That holds only while the chances are read by the extra-bonus
 * pass alone: if a change makes another step depend on them, this comparison with a fresh solve fails.
 */
describe('proc states on a solved calculator', () => {
  it('match a fresh solve with the same chances, and switching back restores the solved build', () => {
    let compared = 0;
    for (const preset of builds) {
      const rb = resolveBuild({ preset }, dataset);
      const { calc, input } = solveWithInput(rb, dataset, monster, []);
      const chances = [...new Set(((calc.chanceList ?? []) as any[]).map(chance => chance?.name).filter(Boolean))].slice(0, 3) as string[];
      const solved = readMetrics({ calc, input, rb, effects: [] }, wanted);
      for (let mask = 1; mask < 2 ** chances.length; mask++) {
        const active = chances.filter((_, index) => mask & 2 ** index);
        calc.setSelectedChances(active).recalcExtraBonus(input.selectedAtkSkill);
        const state = readMetrics({ calc, input: { ...input, selectedChances: active }, rb, effects: active }, wanted);
        const fresh = solveWithInput(resolveBuild({ preset }, dataset), dataset, monster, active);
        expect(state).toEqual(readMetrics({ ...fresh, rb, effects: active }, wanted));
        compared++;
      }
      calc.setSelectedChances([]).recalcExtraBonus(input.selectedAtkSkill);
      expect(readMetrics({ calc, input, rb, effects: [] }, wanted)).toEqual(solved);
    }
    expect(compared).toBeGreaterThan(0);
  });
});
