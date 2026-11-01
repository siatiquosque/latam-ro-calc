import { describe, expect, it } from 'vitest';
import { AdditionalBonusInput } from '../models/info-for-class.model';
import { createRawTotalBonus } from '../utils/create-raw-total-bonus';
import { Inquisitor } from './Inquisitor';

const MANTRAS = ['Sincere Faith', 'Firm Faith', 'Powerful Faith'] as const;

function bonusOf(name: string, level: number) {
  const cls = new Inquisitor();
  cls.setLearnSkills({
    activeSkillIds: cls.activeSkills.map(s => s.name === name ? level : 0),
    passiveSkillIds: [],
  }).getSkillBonusAndName();
  const totalBonus = createRawTotalBonus();
  cls.setAdditionalBonus({ totalBonus, weapon: { isType: () => false } } as unknown as AdditionalBonusInput);
  return totalBonus;
}

describe('Inquisitor Mantras — selectable levels and LATAM client bonus tables', () => {
  it.each(MANTRAS)('%s exposes off and levels 1–5 in the same exclusive group', name => {
    const skill = new Inquisitor().activeSkills.find(s => s.name === name)!;
    expect(skill.inputType).toBe('dropdown');
    expect(skill.exclusiveGroup).toBe('faith');
    expect(skill.dropdown.map(o => o.value)).toEqual([0, 5, 4, 3, 2, 1]);
  });

  it.each([1, 2, 3, 4, 5])('applies the actual level %i instead of the former fixed level 5', level => {
    const energy = bonusOf('Sincere Faith', level);
    expect(energy.aspd).toBe(level);
    expect(energy.perfectHit).toBe(level * 4);
    const health = bonusOf('Firm Faith', level);
    expect(health.hpPercent).toBe(level * 2);
    expect(health.res).toBe(level * 8);
    const strength = bonusOf('Powerful Faith', level);
    expect(strength.atk).toBe(5 + level * 5);
    expect(strength.pAtk).toBe(5 + level * 2);
  });

  it.each(MANTRAS)('%s grants no bonus at level 0', name => {
    const bonus = bonusOf(name, 0);
    for (const key of ['aspd', 'perfectHit', 'hpPercent', 'res', 'atk', 'pAtk'] as const) {
      expect(bonus[key]).toBe(0);
    }
  });
});
