import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { evaluate } from 'src/app/build-analysis/engine/evaluate';
import { applyPatch } from 'src/app/build-analysis/engine/variants';
import { judgedMetrics } from 'src/app/build-analysis/engine/goal-spec';
import { judgeFeasibility } from 'src/app/build-analysis/engine/feasibility';
import { validateBuild } from 'src/app/build-analysis/engine/validate';
import { skillInfo } from 'src/app/build-analysis/engine/skill-info';

const root = 'docs/benchmarks/ai-guided-poc';
const read = (path: string) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));

it('conserves the actual-call ledger and marks unmeasured AI costs honestly in every arm', () => {
  const { summaries } = read('summary.json');
  expect(summaries).toHaveLength(6);
  for (const row of summaries) {
    expect(row.calls).toBeLessThanOrEqual(row.cap);
    expect(Object.values<number>(row.phases).reduce((a, b) => a + b, 0)).toBe(row.calls);
    expect(row.constraintsMet).toBe(true);
    expect(row.providerTokens).toBeNull();
    expect(row.modelCost).toBeNull();
  }
  for (const name of readdirSync(`${root}/B`)) {
    const batch = read(`B/${name}`);
    expect(batch.rows.some((row: any) => ['optimize_build', 'optimize_build-core', 'scan_slot', 'optimize_slot'].includes(row.tool))).toBe(false);
  }
});

it('reproduces the selected agent patch and link with the real engine and constraints', () => {
  const fixture = read('fixture.json'), best = read('best-build.json'), data = loadDatasetFromDisk();
  const final = applyPatch(fixture.build, best.patch);
  expect(validateBuild(final, data).errors).toEqual([]);
  const measure = (build: any) => fixture.targets.map(({ monsterId }: any) => ({ monsterId,
    hp: data.monsters[monsterId].stats.health,
    metrics: evaluate(build, undefined, data, data.monsters[monsterId], [], [...judgedMetrics(fixture.goal), 'min', 'dps']).metrics }));
  const readings = measure(final), link = measure({ share: best.share });
  expect(readings).toEqual(link);
  const report = judgeFeasibility({ dataset: data, base: fixture.build, build: final, readings,
    goal: fixture.goal, constraints: fixture.constraints });
  expect(report.status).toBe('feasible');
  expect(report.kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'guaranteed' });
  expect(readings.every((r: any) => r.metrics.hitsToKill <= 2)).toBe(true);
  // A real positive but small margin, not an invented 10% safety guarantee.
  expect(Math.min(...readings.map((r: any) => r.metrics.min * 2 / r.hp - 1))).toBeCloseTo(best.worstMargin, 5);
});

it('marks authored scaling text as unverified after a formula-version override', () => {
  const data = loadDatasetFromDisk();
  const info = skillInfo(data.classes.newInstance(4262), 'Explosion Blaster==5', 'current');
  expect(info.scaling.formula).toContain('650'); // compatibility: preserve the existing reference, label its provenance
  expect(info.scaling.formulaTextSource).toBe('authored-scaling-metadata');
  expect(info.scaling.formulaTextStatus).toBe('unverified-after-version-override');
  expect(info.scaling.note).toContain('explain_damage.stages');
});
