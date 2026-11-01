import { describe, expect, it } from 'vitest';
import { HpSpCalculator } from './hp-sp-calculator';

function simulate(equipmentBonus: Record<string, any>) {
  return new HpSpCalculator()
    .setHpSpTable([{ jobs: { Inquisitor: true }, baseHp: { 236: 31325.6 }, baseSp: { 236: 1000 } }])
    .setClass({ className: 'Inquisitor', isExpandedClass: false } as any)
    .setAllInfo({ model: { level: 236 }, status: { totalVit: 137, totalInt: 96 },
      totalBonus: { hp: 3450, hpPercent: 112, sp: 0, spPercent: 0 }, equipmentBonus } as any)
    .calculate().getTotalSummary();
}

describe('Flat HP/SP from equipment VIT/INT', () => {
  it('counts the piece itself, including all attributes, separately from cards and enchants', () => {
    // Shared build wwGlfR: VIT 137, flat HP 3450, HP +112%; the only
    // intrinsic equipment VIT is the headgear's allStatus +1.
    expect(simulate({ headUpper: { allStatus: 1 }, bootCard: { vit: 1 },
      accRightCard: { vit: 3 }, accLeftEnchant2: { vit: 3 }, accLeftEnchant3: { vit: 3 } }).maxHp)
      .toBe(204056);
  });

  it('does not add card/enchant stats a second time as flat HP/SP', () => {
    const base = simulate({});
    expect(simulate({ armorCard: { vit: 10, int: 10, allStatus: 5 },
      weaponEnchant1: { vit: 20, int: 20 } })).toEqual(base);
    // Total VIT/INT are deliberately fixed: this isolates the extra flat pool.
    expect(simulate({ armor: { vit: 2, int: 3, allStatus: 1 } }).maxSp).toBe(base.maxSp + 4);
  });
});
