import { describe, expect, it } from 'vitest';
import { MAX_EXTRA_TARGETS, critRateOf, readExtraTargets, sanitizeExtraTargets, worstTarget } from './extra-targets';

describe('extra targets', () => {
  it('drops repeats, the main target and anything that is not a positive id', () => {
    expect(sanitizeExtraTargets([5, 5, 7, 0, -1, 1.5, 'x', 9], 7)).toEqual([5, 9]);
  });

  it('caps the list', () => {
    const ids = Array.from({ length: MAX_EXTRA_TARGETS + 10 }, (_, index) => index + 100);
    expect(sanitizeExtraTargets(ids, 1)).toHaveLength(MAX_EXTRA_TARGETS);
  });

  it('keeps only ids the data knows when asked to', () => {
    expect(sanitizeExtraTargets([1, 2, 3], 9, id => id !== 2)).toEqual([1, 3]);
  });

  it('reads storage defensively', () => {
    expect(readExtraTargets(null, 1)).toEqual([]);
    expect(readExtraTargets('not json', 1)).toEqual([]);
    expect(readExtraTargets('{"a":1}', 1)).toEqual([]);
    expect(readExtraTargets('[2,3]', 1)).toEqual([2, 3]);
  });

  it('finds the lowest-DPS target', () => {
    expect(worstTarget([])).toBeNull();
    expect(worstTarget([{ dps: 5 }, { dps: 2 }, { dps: 9 }])).toEqual({ dps: 2 });
  });

  it('reads the crit chance of the first step the way the card does', () => {
    const entry = (isBasic: boolean, dmg: object) => ({ entries: [{ isBasic, summary: { dmg } }] });
    expect(critRateOf(entry(true, { criRateToMonster: 12.5 }))).toBe(12.5);
    expect(critRateOf(entry(false, { skillCanCri: true, skillCriRateToMonster: 40 }))).toBe(40);
    expect(critRateOf(entry(false, { skillCanCri: false, skillCriRateToMonster: 40 }))).toBeNull();
    expect(critRateOf(null)).toBeNull();
    expect(critRateOf({ entries: [] })).toBeNull();
  });
});
