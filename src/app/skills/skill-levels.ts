import clientDelays from '../../assets/demo/data/skill-delay.json';
import type { AtkSkillModel } from '../jobs/_character-base.abstract';
import { SKILL_ID_BY_NAME } from './index';

const fields = ['fct', 'vct', 'acd', 'cd'] as const;
type TimingField = typeof fields[number];
// Build level-dependent callbacks once, so repeated catalog reads retain stable
// function identities, just like the original class definitions.
const timings = new Map(Object.entries(clientDelays).map(([id, row]) => [Number(id),
  Object.fromEntries(fields.map(field => {
    const value: number | number[] = row[field];
    return [field, Array.isArray(value) ? (level: number) => value[level - 1] / 1000 : value / 1000];
  })) as Record<TimingField, number | ((level: number) => number)>,
]));

/** Supply missing level choices from the definition's declared maximum.
 * Explicit lists (including empty ones and special variants) remain authoritative.
 */
export function withSelectableSkillLevels(skill: AtkSkillModel): AtkSkillModel {
  if (skill.levelList !== undefined) return skill;
  const match = skill.value.match(/^(.*)==([1-9]\d*)$/);
  if (!match || Number(match[2]) <= 1) return skill;
  const maxLevel = Number(match[2]);
  const suffix = skill.labelSuffix ? `(${skill.labelSuffix})` : skill.label.startsWith(skill.name)
    ? skill.label.slice(skill.name.length).replace(/^\s*(?:Lv|Nv)\s*\d+\s*/i, '').trim() : '';
  const result: AtkSkillModel = {
    ...skill,
    levelList: Array.from({ length: maxLevel }, (_, index) => ({
      label: `${skill.name} Nv${index + 1}${suffix ? ` ${suffix}` : ''}`, value: `${match[1]}==${index + 1}`,
    })),
  };
  const client = timings.get(SKILL_ID_BY_NAME[skill.name]);
  for (const field of fields) {
    const timing = client?.[field];
    // A fixed maximum-level timing can now vary with the selected level.
    // Preserve custom callbacks and explicit timing overrides.
    if (typeof timing === 'function' && typeof skill[field] === 'number' &&
        Math.abs(skill[field] - timing(maxLevel)) < 1e-9) result[field] = timing;
  }
  return result;
}
