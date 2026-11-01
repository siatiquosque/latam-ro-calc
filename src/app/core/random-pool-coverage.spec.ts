import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExtraOptionTable } from '../constants/extra-option-table';
import { loadRandomPools, randomPoolTier } from './random-option-catalog';

await loadRandomPools();

/**
 * Every LATAM item that rolls random bonuses (the ones in ExtraOptionTable) has to be covered by some pool source, or be
 * listed here on purpose. A new item with option slots and no pool fails this test instead of staying silently open.
 *
 * KNOWN_GAPS is the honest list of what no source covers: empty today. Geffen, Cota Dracônica and the Arena Noturna
 * items come from the bROWiki pages of their instances (tools/import-browiki-instances.py); the fans and the Crimson
 * Booster share the pool of their normal versions (SAME_POOL in tools/build-rathena-pools.py). Add an id here only on
 * purpose, with the reason, and remove it as soon as a source covers it; the second test fails if you forget.
 */
const KNOWN_GAPS: Record<number, string> = {};

const items: Record<string, { aegisName: string }> = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const latam: Record<string, unknown> = JSON.parse(readFileSync('src/assets/demo/data/latam-items.json', 'utf8'));
const rolling = Object.entries(items)
  .filter(([id, item]) => ExtraOptionTable[item.aegisName] && latam[id])
  .map(([id]) => Number(id));

describe('random-bonus pool coverage', () => {
  it('has a pool, or a documented gap, for every LATAM item that rolls bonuses', () => {
    const uncovered = rolling.filter(id => !randomPoolTier(id) && !(id in KNOWN_GAPS));
    expect(uncovered, `itens com bônus aleatório e sem pool: ${uncovered.join(', ')}`).toEqual([]);
  });
  it('keeps the gap list honest: no listed item is covered or has stopped rolling', () => {
    const stale = Object.keys(KNOWN_GAPS).map(Number).filter(id => randomPoolTier(id) || !rolling.includes(id));
    expect(stale, `tire da lista: ${stale.join(', ')}`).toEqual([]);
  });
  it('covers most items with a regional source, not only the rAthena fallback', () => {
    const tiers = rolling.map(id => randomPoolTier(id));
    expect(tiers.filter(t => t && t !== 'rathena').length).toBeGreaterThanOrEqual(55);
  });
});
