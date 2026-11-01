/**
 * The timing and damage a rotation step contributes, from one solved summary.
 *
 * Framework-free and engine-side so the rotation panel (`layout/…/rotation-view.ts`) and the
 * MCP read the same numbers: neither may re-derive them. The panel adds everything about how
 * a row *looks*; this file owns only what is arithmetic.
 */
import { calcDmgDpsDetailed } from '../utils/calc-dmg-dps';
import { BASIC_ATTACK_VALUE, isBasicAttack } from './rotation';
import { RotationCycle, RotationScheduleStep, simulateRotation } from './rotation-schedule';

/** `"Name==Level"` split at the level; a value with no level keeps the whole string as its name. */
export const splitRotationValue = (value: string): { name: string; level: string } => {
  const at = value.indexOf('==');

  return at < 0 ? { name: value, level: '' } : { name: value.slice(0, at), level: value.slice(at + 2) };
};

/**
 * The effected pass's DPS inputs when Efeitos are ticked, the base ones otherwise — gated on
 * the same flag the hero figure uses, because unticking the last Efeito can leave `effected*`
 * stale.
 */
export function effectedDpsInputs(dmg: any, hasSelectedChances: boolean): any {
  if (!dmg) return dmg;
  const hasEffected = hasSelectedChances && (dmg.effectedSkillDpsInputMin ?? 0) > 0;
  if (!hasEffected) return dmg;

  return {
    ...dmg,
    skillDpsInputMin: dmg.effectedSkillDpsInputMin,
    skillDpsInputMax: dmg.effectedSkillDpsInputMax,
    skillDpsInputCriDmg: dmg.effectedSkillDpsInputCriDmg,
    skillDpsInputHitsPerSec: dmg.effectedSkillDpsInputHitsPerSec,
    skillCriRateToMonster: dmg.effectedSkillCriRateToMonster,
    skillAccuracy: dmg.effectedSkillAccuracy,
    skillTotalHit: dmg.effectedSkillTotalHit,
  };
}

/**
 * Per-use damage of one skill: the engine's accuracy- and crit-weighted damage summed over
 * every hit, with no rate applied (the same arithmetic as `buildDpsSteps().damagePerUse`;
 * a spec in the battle-hud folder pins the two together).
 */
export function skillUseDamage(dmg: any): number {
  if (!dmg) return 0;
  const detailed = calcDmgDpsDetailed({
    min: dmg.skillDpsInputMin || 0,
    max: dmg.skillDpsInputMax || 0,
    cri: dmg.skillCriRateToMonster || 0,
    criDmg: dmg.skillDpsInputCriDmg || 0,
    hitsPerSec: dmg.skillDpsInputHitsPerSec || 0,
    accRate: dmg.skillAccuracy || 0,
  });

  return (dmg.skillTotalHit || 0) * detailed.totalDamage;
}

/** Per-use damage of ataque básico: `basicDps` is already damage x rate, so dividing recovers it. */
export function basicUseDamage(summary: any, hasSelectedChances: boolean): number {
  const dmg = summary?.dmg;
  const rate = summary?.calc?.hitPerSecs || 0;
  if (!dmg || rate <= 0) return 0;

  return ((hasSelectedChances ? dmg.effectedBasicDps : 0) || dmg.basicDps || 0) / rate;
}

/**
 * Map one solved summary onto the scheduler's per-step timing.
 *
 * `castPeriod` is used rather than `reducedFct + reducedVct` so that `hitEveryNSec` skills
 * come through the way calc-skill-aspd already treats them: the channel time is the cast and
 * the block period is zero. `blockPeriod === 0` is exactly that signal.
 */
export function toScheduleStep(input: { value: string; summary: any; damage: number }): RotationScheduleStep {
  const { value, summary, damage } = input;
  if (isBasicAttack(value)) {
    return { key: BASIC_ATTACK_VALUE, cast: 0, acd: 0, cd: 0, damage };
  }

  const calcSkill = summary?.calcSkill ?? {};
  const cast = calcSkill.castPeriod || 0;
  const blockPeriod = Math.max(0, (calcSkill.hitPeriod || 0) - cast);
  const channelled = blockPeriod <= 0 && (calcSkill.reducedAcd > 0 || calcSkill.reducedCd > 0);

  return {
    // Recarga is per skill, shared across its levels, so the name is the identity.
    key: splitRotationValue(value).name,
    timingUnknown: calcSkill.timingUnknown,
    cast,
    acd: channelled ? 0 : calcSkill.reducedAcd || 0,
    cd: channelled ? 0 : calcSkill.reducedCd || 0,
    damage,
    ignoreAspdFloor: calcSkill.ignoreAspdFloor,
  };
}

/**
 * The steady cycle of a rotation, from the solved summary of each distinct step.
 *
 * `summaryByValue` holds one summary per skill value (ataque básico needs none: it reads
 * `baseSummary`). A skill that carries a requirement it does not meet, or is a utility, reads
 * zero from the chain already, so it costs time without adding damage — as in the panel.
 * Per-index stack choices are the panel's concern and are not read here.
 */
export function simulateRotationOf(input: {
  rotation: string[];
  summaryByValue: Map<string, any>;
  baseSummary: any;
  hasSelectedChances: boolean;
}): RotationCycle {
  const { rotation, summaryByValue, baseSummary, hasSelectedChances } = input;
  const aspdPeriod = baseSummary?.calc?.hitPerSecs > 0 ? 1 / baseSummary.calc.hitPerSecs : 0;

  const steps = rotation.map((value) => {
    if (isBasicAttack(value)) return toScheduleStep({ value, summary: baseSummary, damage: basicUseDamage(baseSummary, hasSelectedChances) });
    const summary = summaryByValue.get(value) ?? baseSummary;
    const damage = summary?.dmg?.requireTxt ? 0 : skillUseDamage(effectedDpsInputs(summary?.dmg, hasSelectedChances));

    return toScheduleStep({ value, summary, damage });
  });

  return simulateRotation({ steps, aspdPeriod });
}
