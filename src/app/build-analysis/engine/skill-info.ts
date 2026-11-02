import { CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { resolveSkillMeta, SKILL_ID_BY_NAME } from 'src/app/skills';
import { SkillFormulaVersion } from 'src/app/skills/skill-formula-version';
import { skillSynergyKeys } from 'src/app/core/skill-synergy';

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function findSkill(char: CharacterBase, query: string, version: SkillFormulaVersion = 'current') {
  const name = fold(query.trim().split('==')[0]);
  const skill = char.getAtkSkills(version).find(entry => [entry.name, entry.value, resolveSkillMeta(entry.name)?.label, String(SKILL_ID_BY_NAME[entry.name])]
    .some(value => value && fold(value) === name));
  if (!skill) throw new Error(`Habilidade "${query}" não encontrada nesta classe. Use list_skills.`);
  return skill;
}
export function skillInfo(char: CharacterBase, query: string, version: SkillFormulaVersion = 'current', level?: number) {
  const skill = findSkill(char, query, version);
  const meta = resolveSkillMeta(skill.name);
  const levels = skill.levelList?.map(entry => Number(String(entry.value).split('==').at(-1))) ?? [Number(skill.value.split('==')[1]) || 1];
  const selected = level ?? (query.includes('==') ? Number(query.split('==')[1]) : Math.max(...levels));
  if (!levels.includes(selected)) throw new Error(`Nível inválido. Use: ${levels.join(', ')}.`);
  const timing = (value: number | ((level: number) => number)) => typeof value === 'function' ? value(selected) : value;
  return {
    name: skill.name, label: meta?.label ?? skill.label, id: meta?.id, value: `${skill.name}==${selected}`, levels, formulaVersion: version,
    description: meta?.description, damageType: skill.isMatk ? 'magical' : 'physical', melee: !!skill.isMelee,
    canCrit: typeof skill.canCri === 'function' ? 'conditional' : !!skill.canCri,
    timing: { fixedCast: timing(skill.fct), variableCast: timing(skill.vct), afterCastDelay: timing(skill.acd), cooldown: timing(skill.cd) },
    scaling: { documented: !!skill.scaling, resources: skill.scaling?.resources ?? [], bonusKeys: skillSynergyKeys(skill), formula: skill.scaling?.formulaText,
      note: skill.scaling ? 'Dependências documentadas no motor; valide combinações com calculate/evaluate_variants.' : 'Dependências ainda não documentadas: ausência de um bônus nesta ficha não prova que ele não afeta o dano.' },
  };
}
