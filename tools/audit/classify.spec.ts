import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { classify, classifyKey } from './classify.mjs';

const pts = (rows: [number, number][]) => rows.map(([a, d], i) => [`${i}|-`, a, d]);

describe('item audit classification', () => {
  it('has no class without a pt-BR text', () => {
    expect(classifyKey(pts([[10, 0]]), undefined)).toBe('C');
  });

  it('calls a bonus the text does not mention and the DB lacks D0', () => {
    expect(classifyKey(pts([[10, 0]]), { mentioned: false })).toBe('D0');
    expect(classifyKey(pts([[10, 4]]), { mentioned: false })).toBe('E');
  });

  it('calls text = DB != script D1, and script = text != DB A', () => {
    expect(classifyKey(pts([[10, 5]]), { mentioned: true })).toBe('D1');
    expect(classifyKey(pts([[10, 5]]), { mentioned: true, series: pts([[10, 5]]) })).toBe('A');
    expect(classifyKey(pts([[10, 5]]), { mentioned: true, series: pts([[7, 5]]) })).toBe('E');
  });

  it('depends on which sources the item has', () => {
    const script = { 1: { name: 'a', status: 'DIFF', diffs: [{ key: 'atk', sample: [], series: pts([[10, 0]]) }] }, 2: { name: 'b', status: 'MATCH' } };
    const text = { 2: { name: 'b', status: 'DIFF', diffs: [{ key: 'hp', sample: [] }] }, 3: { name: 'c', status: 'MATCH', diffs: [] } };
    const out = classify(script, text);
    expect(out[1]).toMatchObject({ confidence: 'script', keys: [{ key: 'atk', class: 'C' }] });
    expect(out[2]).toMatchObject({ confidence: 'full', status: 'MATCH' });
    expect(out[3]).toMatchObject({ confidence: 'text', status: 'T-OK' });
    expect(classify({}, {})).toEqual({});
  });
});
