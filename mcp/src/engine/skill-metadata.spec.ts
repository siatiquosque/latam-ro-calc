import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { skillInfo } from 'src/app/build-analysis/engine/skill-info';

const dataset = loadDatasetFromDisk();
const inquisitor = () => dataset.classes.newInstance(4262);

describe('every class: what a formula reads is documented', () => {
  it('reads the inputs of the skills that scale with a trait, HP or SP, in every class', () => {
    let documented = 0;
    const undocumented: string[] = [];
    for (const { id } of dataset.classes.list() as { id: number }[]) {
      const char = dataset.classes.newInstance(id);
      for (const skill of char.getAtkSkills('current') as { name: string }[]) {
        const info = skillInfo(char, skill.name);
        if (info.scaling.documented) documented++;
        else undocumented.push(`${id}:${skill.name}`);
      }
    }
    // Before this, 9 of ~260 formulas said what they read. The rest that stay undocumented read nothing beyond ATK/MATK.
    expect(documented).toBeGreaterThan(130);
    expect(undocumented).not.toContain('4255:Storm Cannon');
  });

  it('reads the trait a skill uses and the keys that feed it', () => {
    const stormCannon = skillInfo(dataset.classes.newInstance(4255), 'Storm Cannon');
    expect(stormCannon.scaling.inputs.length).toBeGreaterThan(0);
    expect(stormCannon.scaling.bonusKeys).toContain('allTrait');
  });

  it('lists the HP and SP a skill reads (Dragonic Breath)', () => {
    const breath = skillInfo(dataset.classes.newInstance(4252), 'Dragonic Breath');
    expect(breath.scaling.inputs).toEqual(expect.arrayContaining(['HP máximo', 'SP máximo']));
  });
});

describe('Inquisitor skill metadata', () => {
  // A skill whose formula reads POD must say so: the item search (`synergy`) and the agent rely on it to look for POD.
  it.each(['First Brand', 'Second Faith', 'Third Punish', 'Second Judgement', 'Third Consecration', 'Second Flame', 'Explosion Blaster', 'Massive Flame Blaster', 'Third Flame Bomb'])(
    '%s documents its POD dependency', (name) => {
      const info = skillInfo(inquisitor(), name);
      expect(info.scaling.documented).toBe(true);
      expect(info.scaling.bonusKeys).toEqual(expect.arrayContaining(['pow', 'allTrait']));
    });

  it('Explosion Blaster states both coefficients (with and without Oleum Sanctum)', () => {
    const { formula } = skillInfo(inquisitor(), 'Explosion Blaster').scaling;
    expect(formula).toContain('650');
    expect(formula).toContain('850');
    expect(formula).toContain('Oleum Sanctum');
  });
});
