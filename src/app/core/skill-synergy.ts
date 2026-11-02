import { AtkSkillModel } from '../jobs/_character-base.abstract';

/** Effects worth investigating, not a claim that they all increase damage in every build. */
export function skillSynergyKeys(skill: AtkSkillModel): string[] {
  const keys = new Set(skill.scaling?.bonusKeys ?? []);
  for (const resource of skill.scaling?.resources ?? []) {
    for (const key of resource === 'hp' ? ['hp', 'hpPercent', 'vit', 'allStatus'] : ['sp', 'spPercent', 'int', 'allStatus']) keys.add(key);
  }
  return [...keys];
}
