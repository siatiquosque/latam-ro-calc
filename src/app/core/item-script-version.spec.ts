import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMainModel } from '../utils';
import { ELMO, ITEM_DB } from './__tests__/worn-bonus';
import { equipStatusOf, makeCalculator } from './__tests__/make-calculator';
import { applyItemScriptOverlay, normalizeItemScriptVersion } from './item-script-version';
import { normalizeSavedModel } from './saved-model';

const KRO = JSON.parse(readFileSync('src/assets/demo/data/item-script-kro.json', 'utf8'));
/** Infinite Vagabond Wolf Card: LATAM prints ATK +10 with +5 / +10 tiers at refine 7 / 9; the client script has the flat +10. */
const CARD = 4643;

function atkWith(version: 'latam' | 'kro', refine: number, overlay = KRO): number {
  const items = { [ELMO]: { ...ITEM_DB[ELMO], itemTypeId: 2, itemSubTypeId: 512 }, [CARD]: { ...ITEM_DB[CARD], itemTypeId: 6, itemSubTypeId: 0 } };
  const calc = makeCalculator(items).setScriptOverlay(overlay);
  const model: any = { ...createMainModel(), level: 200, headUpper: ELMO, headUpperRefine: refine, headUpperCard: CARD, itemScriptVersion: version };

  return equipStatusOf(calc, model).atk ?? 0;
}

describe('item script version', () => {
  it('replaces a key, drops one the overlay empties, and leaves the item alone without an overlay', () => {
    const item = { script: { atk: ['1'], int: ['2'], str: ['3'] } };
    expect(applyItemScriptOverlay(item, { atk: ['5'], int: [] }).script).toEqual({ atk: ['5'], str: ['3'] });
    expect(item.script).toEqual({ atk: ['1'], int: ['2'], str: ['3'] });
    expect(applyItemScriptOverlay(item, undefined)).toBe(item);
  });

  it('defaults to LATAM for anything but kro, including saved models without the field', () => {
    expect(normalizeItemScriptVersion(undefined)).toBe('latam');
    expect(normalizeItemScriptVersion('x')).toBe('latam');
    expect(normalizeItemScriptVersion('kro')).toBe('kro');
    expect(normalizeSavedModel({ ...createMainModel(), itemScriptVersion: undefined } as any).itemScriptVersion).toBe('latam');
    expect(normalizeSavedModel({ ...createMainModel(), itemScriptVersion: 'kro' } as any).itemScriptVersion).toBe('kro');
  });

  it('reads item.json under LATAM and the overlay under kRO', () => {
    expect(KRO[CARD].atk).toEqual(['10']);
    const latam = atkWith('latam', 9);
    expect(atkWith('latam', 0)).toBe(atkWith('latam', 0, {}));
    expect(atkWith('kro', 9)).toBeLessThan(latam);
    expect(atkWith('kro', 9)).toBe(atkWith('latam', 0));
  });
});
