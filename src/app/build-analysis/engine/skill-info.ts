import { DEFAULT_CATALOG } from 'src/app/i18n';
import { CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { resolveSkillMeta, SKILL_ID_BY_NAME } from 'src/app/skills';
import { SkillFormulaVersion } from 'src/app/skills/skill-formula-version';
import { formulaInputs, skillSynergyKeys } from 'src/app/core/skill-synergy';
import { skillDependencies } from './skill-dependencies';

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function findSkill(char: CharacterBase, query: string, version: SkillFormulaVersion = 'current') {
  const name = fold(query.trim().split('==')[0]);
  const skill = char.getAtkSkills(version).find(entry => [entry.name, entry.value, resolveSkillMeta(entry.name)?.label, String(SKILL_ID_BY_NAME[entry.name])]
    .some(value => value && fold(value) === name));
  if (!skill) throw new Error(`Habilidade "${query}" não encontrada nesta classe. Use list_skills.`);
  return skill;
}
/** What the model says about the shape of a skill's damage, structured, so an agent does not have to infer it from the description. */
function structureOf(skill: ReturnType<typeof findSkill>, level: number) {
  const hits = typeof skill.hitByLevel === 'function' ? skill.hitByLevel(level) : skill.hit;
  return Object.fromEntries(Object.entries({
    hits,
    totalHit: typeof skill.totalHit === 'number' ? skill.totalHit : undefined,
    hitEveryNSec: skill.hitEveryNSec,
    element: skill.element,
    ignoresAspdFloor: skill.ignoreAspdFloor || undefined,
    timingUnknown: skill.timingUnknown || undefined,
    stacks: skill.maxStack !== undefined ? { min: skill.minStack ?? 0, max: skill.maxStack, default: skill.defaultStack } : undefined,
    secondPacket: skill.part2 ? { label: skill.part2.labelKey ? DEFAULT_CATALOG[skill.part2.labelKey] : undefined, hits: skill.part2.hit, damageType: skill.part2.isMatk ? 'magical' : 'physical', includesMain: skill.part2.isIncludeMain } : undefined,
    addsFlatDamage: skill.flatDamage ? true : undefined,
    adjustsFinalDamage: skill.finalDmgFormula ? true : undefined,
    adjustsAccuracy: skill.accuracy ? true : undefined,
    alwaysCrits: skill.forceCri || undefined,
  }).filter(([, value]) => value !== undefined));
}

export function skillInfo(char: CharacterBase, query: string, version: SkillFormulaVersion = 'current', level?: number) {
  const skill = findSkill(char, query, version);
  const meta = resolveSkillMeta(skill.name);
  const levels = skill.levelList?.map(entry => Number(String(entry.value).split('==').at(-1))) ?? [Number(skill.value.split('==')[1]) || 1];
  const selected = level ?? (query.includes('==') ? Number(query.split('==')[1]) : Math.max(...levels));
  if (!levels.includes(selected)) throw new Error(`Nível inválido. Use: ${levels.join(', ')}.`);
  const inputs = formulaInputs(skill);
  const timing = (value: number | ((level: number) => number)) => typeof value === 'function' ? value(selected) : value;
  return {
    name: skill.name, label: meta?.label ?? skill.label, id: meta?.id, value: `${skill.name}==${selected}`, levels, formulaVersion: version,
    description: meta?.description, damageType: skill.isMatk ? 'magical' : 'physical', melee: !!skill.isMelee,
    canCrit: typeof skill.canCri === 'function' ? 'conditional' : !!skill.canCri,
    // How the skill uses the crit: the share of the character's crit it applies, its own flat crit and the multiplier of its crit damage.
    // The chance it really rolls against a target depends on the build and the target: `explain_damage` (part `crit`).
    crit: { canCrit: typeof skill.canCri === 'function' ? 'conditional' : !!skill.canCri, shareOfCharacterCrit: skill.baseCriPercentage ?? 1, flatCrit: skill.baseCri ?? 0, shareOfCritDamage: skill.criDmgPercentage ?? 1 },
    // The skill's shape, from the model: how many hits, which element, what else shapes the damage. Absent keys mean "not special".
    structure: structureOf(skill, selected),
    dependencies: skillDependencies(char, skill),
    timing: { fixedCast: timing(skill.fct), variableCast: timing(skill.vct), afterCastDelay: timing(skill.acd), cooldown: timing(skill.cd) },
    scaling: { documented: !!skill.scaling || inputs.length > 0, inputs: inputs.map((input) => input.label), resources: skill.scaling?.resources ?? [], bonusKeys: skillSynergyKeys(skill), formula: skill.scaling?.formulaText,
      note: skill.scaling ? 'Dependências documentadas no motor; valide combinações com calculate/evaluate_variants.'
        : inputs.length ? `Entradas lidas da fórmula do motor (${inputs.map((input) => input.label).join(', ')}); efeitos de estados e buffs não estão aqui. Valide combinações com calculate/evaluate_variants.`
        : 'Dependências ainda não documentadas: ausência de um bônus nesta ficha não prova que ele não afeta o dano.' },
  };
}
