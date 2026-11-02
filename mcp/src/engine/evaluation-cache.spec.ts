import { describe, expect, it } from 'vitest';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { evaluate, evaluationCache } from 'src/app/build-analysis/engine/evaluate';
import { AverageProcPolicy } from 'src/app/build-analysis/engine/proc';

await loadRandomPools();
const dataset = loadDatasetFromDisk();
const build = { preset: fixture.preset };
const monster = dataset.monsters[21077];
const other = dataset.monsters[20994];

describe('evaluation cache of the search', () => {
  it('separates changed target records and datasets even when IDs and release versions are the same', () => {
    const memo = evaluationCache();
    const changedTarget = { ...monster, stats: { ...monster.stats, defense: 900 } };
    memo.evaluate(build, undefined, dataset, monster, [], ['dps']);
    const changed = memo.evaluate(build, undefined, dataset, changedTarget, [], ['dps']);
    const isolated = memo.evaluate(build, undefined, { ...dataset }, changedTarget, [], ['dps']);
    expect(memo.hits).toBe(0);
    expect(memo.misses).toBe(3);
    expect(changed.metrics).toEqual(evaluate(build, undefined, dataset, changedTarget, [], ['dps']).metrics);
    expect(isolated.metrics).toEqual(changed.metrics);
  });

  it('does not confuse proc metadata with the same entry count or effect names containing separators', () => {
    const memo = evaluationCache();
    const policy = (ratePct: number): AverageProcPolicy => ({ mode: 'average', hitsPerSecond: 3, metadata: new Map([[470073, { ratePct, durationSeconds: 10 }]]) });
    memo.evaluate(build, undefined, dataset, monster, [], ['dps'], [], 1, policy(1));
    memo.evaluate(build, undefined, dataset, monster, [], ['dps'], [], 1, policy(99));
    memo.evaluate(build, undefined, dataset, monster, ['a|b'], ['dps']);
    memo.evaluate(build, undefined, dataset, monster, ['a', 'b'], ['dps']);
    expect(memo.misses).toBe(4);
    expect(memo.hits).toBe(0);
  });

  it('does not let callers mutate cached metrics or proc diagnostics', () => {
    const memo = evaluationCache();
    const first = memo.evaluate(build, undefined, dataset, monster, [], ['dps']);
    const expected = first.metrics.dps;
    first.metrics.dps = -1;
    first.procEvaluation.counted.push('caller mutation');
    const cached = memo.evaluate(build, undefined, dataset, monster, [], ['dps']);
    expect(cached.metrics.dps).toBe(expected);
    expect(cached.procEvaluation.counted).not.toContain('caller mutation');
    cached.procEvaluation.counted.push('another mutation');
    expect(memo.evaluate(build, undefined, dataset, monster, [], ['dps']).procEvaluation.counted).not.toContain('another mutation');
  });

  it('answers a repeated build from memory, with the same numbers as a fresh calculation', () => {
    const memo = evaluationCache();
    const patch = { gear: { headUpperCard: 300174 } };
    const first = memo.evaluate(build, patch, dataset, monster, [], ['dps', 'max']);
    const again = memo.evaluate(build, patch, dataset, monster, [], ['dps', 'max']);
    const fresh = evaluate(build, patch, dataset, monster, [], ['dps', 'max']);

    expect(memo.hits).toBe(1);
    expect(first.solved).toBeTruthy();
    expect(again.solved).toBeUndefined();
    expect(again.metrics).toEqual(first.metrics);
    expect(again.metrics).toEqual(fresh.metrics);
    expect(again.rb.model.headUpperCard).toBe(300174);
  });

  it('does not mix builds, targets, effects or metrics', () => {
    const memo = evaluationCache();
    const a = memo.evaluate(build, { gear: { headUpperCard: 300174 } }, dataset, monster, [], ['dps']);
    const differentCard = memo.evaluate(build, { gear: { headUpperCard: 4582 } }, dataset, monster, [], ['dps']);
    const differentTarget = memo.evaluate(build, { gear: { headUpperCard: 300174 } }, dataset, other, [], ['dps']);
    const differentMetrics = memo.evaluate(build, { gear: { headUpperCard: 300174 } }, dataset, monster, [], ['dps', 'max']);

    expect(memo.hits).toBe(0);
    expect(differentCard.metrics['dps']).not.toBe(a.metrics['dps']);
    expect(differentTarget.metrics['dps']).not.toBe(a.metrics['dps']);
    expect(differentMetrics.metrics['max']).toBeGreaterThan(0);
  });

  it('forgets the oldest entry past its limit instead of growing without bound', () => {
    const memo = evaluationCache(2);
    for (const card of [300174, 4582, 4302]) memo.evaluate(build, { gear: { headUpperCard: card } }, dataset, monster, [], ['dps']);
    memo.evaluate(build, { gear: { headUpperCard: 300174 } }, dataset, monster, [], ['dps']);
    expect(memo.hits).toBe(0);
    memo.evaluate(build, { gear: { headUpperCard: 4302 } }, dataset, monster, [], ['dps']);
    expect(memo.hits).toBe(1);
  });
});
