import { describe, expect, it } from 'vitest';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { evaluate, evaluationCache } from 'src/app/build-analysis/operations/optimize';

await loadRandomPools();
const dataset = loadDatasetFromDisk();
const build = { preset: fixture.preset };
const monster = dataset.monsters[21077];
const other = dataset.monsters[20994];

describe('evaluation cache of the search', () => {
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
