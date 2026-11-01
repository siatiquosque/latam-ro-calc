import { describe, expect, it } from 'vitest';
import browiki from '../../../data/random-options/browiki-pools.json';
import { randomOptionCatalogFor } from './random-option-catalog';

type Rule = [string, number, number];
const combiner = (name: string) => browiki.combiners.find(c => c.name === name)!;

/** The importer is checked against pools that were written by hand from the same page. */
describe('bROWiki pools', () => {
  it('reproduces the hand-written Selo de Loki profiles, position by position', () => {
    const lokiPools = randomOptionCatalogFor(410233)!;
    for (const profile of lokiPools.profiles) {
      const imported = combiner(profile.combiner!).positions as Rule[][];
      expect(imported.length, profile.combiner).toBe(profile.positions.length);
      profile.positions.forEach((position, index) => {
        for (const rule of position) {
          const found = imported[index].find(([key]) => key === rule.key);
          expect(found, `${profile.combiner} #${index + 1} ${rule.key}`).toBeDefined();
          expect([found![1], found![2]], `${profile.combiner} ${rule.key}`).toEqual([rule.min, rule.max]);
        }
      });
    }
  });
  it('gives the Manto Branco its two positions with the ranges the page lists', () => {
    const [profile] = randomOptionCatalogFor(480812)!.profiles;
    expect(profile.combiner).toBe('Sobrecarga Temporal');
    expect(profile.positions).toHaveLength(2);
    const first = Object.fromEntries(profile.positions[0].map(rule => [rule.key, [rule.min, rule.max]]));
    expect(first['def']).toEqual([30, 100]);
    expect(first['mdef']).toEqual([3, 10]);
    expect(first['hp']).toEqual([100, 1000]);
    expect(first['vct']).toEqual([1, 5]);
    expect(first['p_race_demon']).toEqual([1, 5]);
    expect(first['subrace_demon']).toEqual([2, 7]);
    expect(profile.positions[1].some(rule => rule.key === 'aspdPercent')).toBe(true);
  });
  it('never invents a key for a line it cannot translate', () => {
    expect(Object.keys(browiki.unmapped).length).toBeGreaterThan(0);
    for (const text of Object.keys(browiki.unmapped)) expect(text).toMatch(/\[sem (chave|valor)\]$/);
  });
  it('lets a pool confirmed in game or written in code win over the wiki', () => {
    const wikiOnly = Object.keys(browiki.items).filter(id => randomOptionCatalogFor(Number(id))!.source === browiki.source);
    expect(wikiOnly.length).toBeGreaterThan(0);
    expect(randomOptionCatalogFor(410233)!.source).not.toBe(browiki.source);
  });
});
