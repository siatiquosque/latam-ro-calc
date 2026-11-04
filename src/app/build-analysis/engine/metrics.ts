/**
 * What an agent can rank builds on. One place decides how each number is read off a solved
 * calculator, so `evaluate_variants`, `explain_damage` and any later tool agree on it.
 */
import { CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { Calculator } from 'src/app/core/calculator';
import { CalcChainInput } from 'src/app/core/calculator-controller';
import { isBasicAttack } from 'src/app/core/rotation';
import { simulateRotationOf } from 'src/app/core/rotation-dps';
import { ResolvedBuild } from './build-input';
import { solveController } from './solve';

export const METRICS = [
  'max', 'min', 'dps', 'avgHit', 'rotationDps', 'burstDps', 'hitsToKill', 'critRate',
  'hp', 'sp', 'atk', 'def', 'softDef', 'mdef', 'flee', 'hit', 'aspd', 'crit',
] as const;

/**
 * Facts the feasibility judgement reads that are not figures to rank on, so they stay out of the public `METRICS` enum (and out of
 * every tool schema). `minNoCri`: the lowest damage of a hit that does not crit, only when the engine computes it comparably.
 * `canCri`: 1 if the chosen skill can crit. `hitChance`: the engine's chance (%) that the skill hits the target.
 */
export const INTERNAL_METRICS = ['minNoCri', 'canCri', 'hitChance'] as const;

export type Metric = (typeof METRICS)[number] | (typeof INTERNAL_METRICS)[number];
export type Metrics = Partial<Record<Metric, number>>;

export const DEFAULT_METRICS: readonly Metric[] = ['max', 'min', 'dps', 'hitsToKill'];

export interface Solved {
  calc: Calculator;
  input: CalcChainInput;
  rb: ResolvedBuild;
  /** Proc effects the solve was asked to trigger. */
  effects: string[];
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Steady-state DPS of the build's rotation, or undefined when it has none, or when a step's
 * timing is not known (the rotation panel refuses to print a figure there too).
 *
 * Reads the steady cycle the app's rotation panel draws (the shared `simulateRotationOf`),
 * from one solve per distinct step, so the number is the one the player would read there. The calculator is put back on the
 * selected skill afterwards: the caller reads the other metrics off the same instance.
 */
function rotationCycle({ calc, input, rb, effects }: Solved): { cycle: ReturnType<typeof simulateRotationOf>; unknownTiming: boolean } | undefined {
  const rotation: string[] = (rb.model as any).rotation ?? [];
  if (!rotation.length) return undefined;

  const summaryByValue = new Map<string, any>();
  for (const value of rotation) {
    if (isBasicAttack(value) || summaryByValue.has(value)) continue;
    summaryByValue.set(value, solveController.solveSkill(calc, input, value).getTotalSummary());
  }
  solveController.solveSkill(calc, input, input.selectedAtkSkill);

  const cycle = simulateRotationOf({ rotation, summaryByValue, baseSummary: calc.getTotalSummary(), hasSelectedChances: effects.length > 0 });
  const unknownTiming = rotation.some((value) => !isBasicAttack(value) && (summaryByValue.get(value) as any)?.calcSkill?.timingUnknown);

  return { cycle, unknownTiming };
}

/** Sustained: the steady cycle, with every recarga paid. */
const rotationDps = (solved: Solved): number | undefined => {
  const result = rotationCycle(solved);

  return result && !result.unknownTiming ? num(result.cycle.sustainedDps) : undefined;
};

/** Burst: the first pass of the rotation, with every recarga clear (the opening, before the cooldowns bite). */
const burstDps = (solved: Solved): number | undefined => {
  const result = rotationCycle(solved);

  return result && !result.unknownTiming ? num(result.cycle.firstCycleDps) : undefined;
};

export type Profile = 'sustained' | 'burst';

/**
 * The metric a build is judged on for a profile. Sustained is what the rotation settles into (or the chosen skill's DPS
 * with no rotation); burst is the opening pass of the rotation (or the average hit of the chosen skill with none).
 */
export const objectiveFor = (profile: Profile, hasRotation: boolean): Metric =>
  profile === 'burst' ? (hasRotation ? 'burstDps' : 'avgHit') : (hasRotation ? 'rotationDps' : 'dps');

/**
 * The lowest damage of a hit that does not crit. For a skill that cannot crit that is `skillMinDamage`. For one that can, `skillMinDamage`
 * is the crit path (max ATK plus the crit bonus), so the figure comes from `skillMinDamageNoCri`, which the engine computes without the
 * per-hit rounding (`calcSkillDmgByTotalHit`) and without the multi-hit aura rounding. It is returned only where those steps change
 * nothing (a single-hit skill on a class that does not override the rounding); otherwise the engine has no comparable figure: undefined.
 */
function noCritMinimum(solved: Solved, dmg: Record<string, unknown>, effected: boolean): number | undefined {
  if (effected) return undefined; // with procs on, the engine only reports the effected crit-path minimum
  if (dmg['skillCanCri'] === false) return num(dmg['skillMinDamage']);
  if (dmg['skillCanCri'] !== true || (num(dmg['skillHit']) ?? 1) > 1) return undefined;
  if (solved.rb.char.calcSkillDmgByTotalHit !== CharacterBase.prototype.calcSkillDmgByTotalHit) return undefined;
  const raw = num(dmg['skillMinDamageNoCri']);

  return raw && raw > 0 ? raw : undefined;
}

/** Read the requested numbers off a solved build. Only the rotation costs extra solves. */
export function readMetrics(solved: Solved, wanted: readonly Metric[]): Metrics {
  const summary = solved.calc.getTotalSummary() as any;
  const dmg = summary.dmg ?? {};
  const c = summary.calc ?? {};
  const effected = solved.effects.length > 0 && num(dmg.effectedSkillDamageMin) !== undefined;

  const min = effected ? dmg.effectedSkillDamageMin : dmg.skillMinDamage;
  const hp = num(summary.monster?.hp);

  const out: Metrics = {};
  for (const metric of new Set(wanted)) {
    let value: number | undefined;
    switch (metric) {
      case 'max': value = num(effected ? dmg.effectedSkillDamageMax : dmg.skillMaxDamage); break;
      case 'min': value = num(min); break;
      case 'dps': value = num(effected ? dmg.effectedSkillDps : dmg.skillDps); break;
      // Damage per hit averaged over the chance to hit and to crit: `dps` divided by the hits per second it was made with.
      case 'avgHit': { const perSecond = num(effected ? dmg.effectedSkillHitsPerSec : dmg.skillDpsInputHitsPerSec); const dps = num(effected ? dmg.effectedSkillDps : dmg.skillDps); value = perSecond && dps !== undefined ? dps / perSecond : undefined; break; }
      case 'rotationDps': value = rotationDps(solved); break;
      case 'burstDps': value = burstDps(solved); break;
      case 'hitsToKill': value = effected ? (hp && num(min) ? Math.ceil(hp / min) : undefined) : num(dmg.skillHitKill); break;
      case 'critRate': value = num(effected ? dmg.effectedSkillCriRateToMonster : dmg.skillCriRateToMonster); break;
      case 'hp': value = num(c.maxHp); break;
      case 'sp': value = num(c.maxSp); break;
      case 'atk': value = num(c.totalStatusAtk); break;
      case 'def': value = num(c.def); break;
      case 'softDef': value = num(c.softDef); break;
      case 'mdef': value = num(c.mdef); break;
      case 'flee': value = num(c.totalFlee); break;
      case 'hit': value = num(c.totalHit); break;
      case 'aspd': value = num(c.totalAspd); break;
      case 'crit': value = num(c.totalCri); break;
      case 'minNoCri': value = noCritMinimum(solved, dmg, effected); break;
      case 'canCri': value = typeof dmg.skillCanCri === 'boolean' ? Number(dmg.skillCanCri) : undefined; break;
      case 'hitChance': value = num(dmg.skillAccuracy); break;
    }
    if (value !== undefined) out[metric] = value;
  }

  return out;
}
