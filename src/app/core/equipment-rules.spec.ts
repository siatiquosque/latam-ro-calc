import { describe, expect, it } from 'vitest';
import { enchantCombinationError, refineLimitFor } from './equipment-rules';

const orb = (n: number) => ({ aegisName: `Automatic_Orb${n}`, name: `Módulo ${n}` });
describe('NPC equipment limits', () => {
  it('caps shadows at +10 while normal gear can reach +20', () => {
    expect(refineLimitFor('shadowWeapon')).toBe(10);
    expect(refineLimitFor('shadowPendant')).toBe(10);
    expect(refineLimitFor('weapon')).toBe(20);
  });
  it('rejects duplicated P-Geral, allows two B-VIT but not three', () => {
    const item = { aegisName: 'Auto_B_L' };
    expect(enchantCombinationError(item, [orb(39), orb(39)])).toContain('máximo 1');
    expect(enchantCombinationError(item, [orb(3), orb(3), orb(39)])).toBeUndefined();
    expect(enchantCombinationError(item, [orb(3), orb(3), orb(3)])).toContain('máximo 2');
  });
  it('allows two different Fantásticos, rejects three or repeats', () => {
    const item = { aegisName: 'Auto_Leg_A' };
    expect(enchantCombinationError(item, [orb(40), orb(43), orb(15)])).toBeUndefined();
    expect(enchantCombinationError(item, [orb(40), orb(41), orb(43)])).toContain('2 encantamentos');
    expect(enchantCombinationError(item, [orb(40), orb(40)])).toContain('máximo 1');
  });
  it('uses the shield-specific repeat limit for M-Rapidez', () => {
    expect(enchantCombinationError({ aegisName: 'Auto_Shield_A_LT' }, [orb(21), orb(21)])).toContain('máximo 1');
    expect(enchantCombinationError({ aegisName: 'Auto_Engine_A' }, [orb(21), orb(21)])).toBeUndefined();
  });
});
