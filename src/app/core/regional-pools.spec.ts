import { describe, expect, it } from 'vitest';
import { loadRandomPools, cataloguedRandomItemIds, randomOptionCatalogFor } from './random-option-catalog';
import { ExtraOptionMap } from '../utils/create-extra-option-list';

await loadRandomPools();

/** Every pool anyone adds to regional-pools.json has to be one the picker and the engine can use. */
describe('catalogued random-option pools', () => {
  const keys = new Set([...ExtraOptionMap.keys()].map(value => value.split(':')[0]));

  it.each(cataloguedRandomItemIds())('item %i has well-formed profiles', (id) => {
    const pool = randomOptionCatalogFor(id)!;
    expect(pool.source).toBeTruthy();
    expect(pool.profiles.length).toBeGreaterThan(0);
    for (const profile of pool.profiles) {
      expect(profile.positions.length).toBeGreaterThan(0);
      for (const position of profile.positions) for (const rule of position) {
        expect(keys.has(rule.key), `${id}: "${rule.key}" is not a bonus the calculator knows`).toBe(true);
        expect(rule.min).toBeLessThanOrEqual(rule.max);
      }
    }
  });
});
