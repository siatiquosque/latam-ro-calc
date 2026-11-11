import { describe, expect, it } from 'vitest';
import { CLASS_CTOR_BY_ID } from '../jobs/_class-list';
import { Inquisitor } from '../jobs/Inquisitor';
import { Mage } from '../jobs/Mage';
import { Oboro } from '../jobs/Oboro';
import { withSelectableSkillLevels } from './skill-levels';

describe('Shared offensive skill levels', () => {
  it('offers every declared level without changing formulas, defaults or explicit variants', () => {
    let checked = 0;
    for (const Ctor of Object.values(CLASS_CTOR_BY_ID)) {
      const character = new Ctor();
      for (const original of (character as any)._atkSkillList) {
        const skill = withSelectableSkillLevels(original);
        expect(skill.value).toBe(original.value);
        expect(skill.formula).toBe(original.formula);
        if (original.levelList !== undefined) {
          expect(skill).toBe(original);
          continue;
        }
        const match = original.value.match(/^(.*)==([1-9]\d*)$/);
        if (!match || +match[2] <= 1) continue;
        const max = +match[2];
        expect(skill.levelList?.map(option => option.value))
          .toEqual(Array.from({ length: max }, (_, i) => `${match[1]}==${i + 1}`));
        for (const field of ['fct', 'vct', 'acd', 'cd'] as const) {
          const at = (value: any) => typeof value === 'function' ? value(max) : value;
          expect(at(skill[field])).toBeCloseTo(at(original[field]) ?? 0, 9);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('preserves the Tiger Cannon combo prefix at lower levels', () => {
    const skill = new Inquisitor().getAtkSkills().find(s => s.value === 'Tiger Cannon Combo==10')!;
    expect(skill.levelList?.find(s => s.value === 'Tiger Cannon Combo==3')?.label).toContain('Combo');
    expect(skill.levelList?.some(s => s.value === 'Tiger Cannon==3')).toBe(false);
  });

  it('scales bolt hit counts and client cast times at lower levels', () => {
    const skill = new Mage().atkSkills.find(s => s.name === 'Fire Bolt')!;
    expect((skill.totalHit as Function)({ skillLevel: 3 })).toBe(3);
    expect((skill.fct as Function)(3)).toBe(0.5);
    expect((skill.vct as Function)(3)).toBe(1.1);
    expect((skill.totalHit as Function)({ skillLevel: 10 })).toBe(10);
  });

  it('uses the client hit tables for ninja magic rather than maximum-level hit counts', () => {
    const skills = new Oboro().atkSkills;
    const hits = (name: string, level: number) =>
      (skills.find(s => s.name === name)!.totalHit as Function)({ skillLevel: level });
    expect(hits('Flaming Petals', 3)).toBe(3);
    expect(hits('Freezing Spear', 3)).toBe(5);
    expect([1, 2, 3, 4, 9, 10].map(level => hits('Wind Blade', level))).toEqual([1, 2, 2, 3, 5, 6]);
  });
});
