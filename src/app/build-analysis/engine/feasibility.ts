/**
 * `FeasibilityEvaluator`: is this build a solution to the goal, under the constraints? It only reads numbers the engine already
 * produced (the caller measures each target with `readMetrics`); it changes no formula and invents no probability.
 *
 *  - `invalid`    the build is not legal (the game would refuse it) or breaks a hard constraint.
 *  - `infeasible` legal, but a target misses a goal rule.
 *  - `unknown`    legal, nothing is missed, but some number the goal needs could not be read. It never counts as met.
 *  - `feasible`   legal, within the constraints, and every target meets every rule.
 *
 * Each target is judged on its own, so a strong average cannot hide the monster that is not killed in time: the report names the
 * worst target and lists the violations per target.
 */
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { AspdPotionList, AspdPotionStackable } from 'src/app/constants/aspd-potion-list';
import { Dataset } from '../data/dataset';
import { BuildInput, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, resolveBuild, STAT_KEYS } from './build-input';
import { ConstraintSpec, GoalSpec, goalDamageRule, goalLimits, goalRequirements, Requirement } from './goal-spec';
import { Metrics } from './metrics';
import { BuildIssue, validateBuild } from './validate';

export type FeasibilityStatus = 'invalid' | 'infeasible' | 'unknown' | 'feasible';

export interface Violation {
  code: string;
  message: string;
  /** Only for goal rules: what was asked and what was read. */
  metric?: string;
  required?: { min?: number; max?: number };
  actual?: number;
}

/**
 * What a `maxHitsToKill` goal says about a kill, in three separate answers (`null` = the engine cannot tell):
 *  - `damageFeasible`: the calculated damage meets the hit goal under the declared conditions. It needs no accuracy or crit limit.
 *  - `constraintsMet`: every limit the user declared (`minCritRate`, `minAccuracy`, `require`, the hard constraints) holds.
 *  - `reliability`: whether the kill is certain. `guaranteed`: it does not depend on a crit and every hit lands. `conditional`: it does
 *    (a crit below 100%, a hit chance below 100%). `unknown`: the engine lacks a figure to decide, e.g. the non-crit damage. A limit
 *    the user met is a constraint, not evidence of certainty. Absent when `damageFeasible` is false: there is no kill to classify.
 */
export interface KillAssessment {
  damageFeasible: boolean | null;
  constraintsMet: boolean | null;
  reliability?: 'guaranteed' | 'conditional' | 'unknown';
  /** Why the reliability is not `guaranteed` (or why the damage falls short). */
  reasons: string[];
}

export interface TargetFeasibility {
  monsterId: number;
  name?: string;
  status: 'infeasible' | 'unknown' | 'feasible';
  violations: Violation[];
  unknowns: Violation[];
  /** Only with `goal.maxHitsToKill`. */
  kill?: KillAssessment;
}

export interface FeasibilityReport {
  status: FeasibilityStatus;
  /** Why the build is not legal, or breaks a hard constraint (empty unless `invalid`). */
  violations: Violation[];
  /** One entry per target, always (even when the build is invalid, so the shape does not depend on the status). */
  targets: TargetFeasibility[];
  /** The target that decides the verdict: the furthest from its rules, an unreadable one, or (all met) the one with the most hits to kill. */
  worstTarget?: { monsterId: number; name?: string; reason: string };
  /** Only with `goal.maxHitsToKill`: the worst target decides each answer (false > null > true; conditional > unknown > guaranteed). */
  kill?: Omit<KillAssessment, 'reasons'>;
  /** Errors the base build already had and the judgement let through (`tolerateInherited`). */
  inherited?: Violation[];
}

/** What the caller measured on one target. `metrics` must hold the goal's metrics (`judgedMetrics`). */
export interface TargetReading {
  monsterId: number;
  name?: string;
  /** Target HP, needed by `goal.margin` above 0. */
  hp?: number;
  metrics: Metrics;
}

export interface FeasibilityInput {
  dataset: Dataset;
  /** The build the search started from: constraints such as locked slots and stat resets compare against it. */
  base: BuildInput;
  /** The build to judge. */
  build: BuildInput;
  readings: TargetReading[];
  goal?: GoalSpec;
  constraints?: ConstraintSpec;
  /** Older `require` rules, judged like the goal's. */
  require?: Requirement[];
  /** Validation errors the caller already has for `build` (skips a second `validateBuild`). */
  issues?: BuildIssue[];
  /** Errors the base build has too are reported under `inherited` instead of making the build invalid (a search cannot repair them). */
  tolerateInherited?: boolean;
}

const GRADE_ORDER = ['', 'D', 'C', 'B', 'A'];
const issueKey = (issue: { code: string; path: string; itemId?: number }) => `${issue.code}|${issue.path}|${issue.itemId ?? ''}`;
const blank = (value: unknown) => (value === null || value === undefined || value === 0 || value === '' ? null : value);

interface Model {
  [key: string]: any;
  rawOptionTxts?: (string | null | undefined)[];
  skillBuffMap?: Record<string, number>;
  activeSkillMap?: Record<string, number>;
  aspdPotion?: number;
  consumables?: number[];
}

/** Properties of the build that a hard constraint forbids. */
export function constraintViolations(constraints: ConstraintSpec, dataset: Dataset, base: Model, build: Model): Violation[] {
  const out: Violation[] = [];
  const name = (id: number) => dataset.itemIndex.get(id)?.name ?? String(id);
  const worn = (key: string) => (typeof build[key] === 'number' && build[key] > 0 ? (build[key] as number) : undefined);

  const policy = constraints.mvpPolicy ?? 'allow';
  const unavailable = new Set(constraints.unavailableIds ?? []);
  for (const key of ITEM_ID_KEYS) {
    const id = worn(key);
    if (id === undefined) continue;
    if (MVP_CARD_IDS.has(id) && (policy === 'none' || (policy === 'exclude-new' && base[key] !== id))) {
      out.push({ code: 'MVP_CARD_EXCLUDED', message: `${name(id)} é carta de MVP (${key}).` });
    }
    if (unavailable.has(id)) out.push({ code: 'ITEM_UNAVAILABLE', message: `${name(id)} está na lista de itens indisponíveis (${key}).` });
  }

  const gradeLimit = constraints.maxGrade === undefined ? undefined : constraints.maxGrade === 'none' ? 0 : GRADE_ORDER.indexOf(constraints.maxGrade);
  for (const slot of MAIN_ITEM_SLOTS) {
    if (gradeLimit !== undefined && GRADE_ORDER.indexOf(build[`${slot}Grade`] ?? '') > gradeLimit) {
      out.push({ code: 'GRADE_ABOVE_MAX', message: `${slot} tem grau ${build[`${slot}Grade`]}, acima do teto ${constraints.maxGrade}.` });
    }
    if (constraints.maxRefine !== undefined && (build[`${slot}Refine`] ?? 0) > constraints.maxRefine) {
      out.push({ code: 'REFINE_ABOVE_MAX', message: `${slot} está em +${build[`${slot}Refine`]}, acima do teto +${constraints.maxRefine}.` });
    }
  }

  for (const slot of constraints.lockedSlots ?? []) {
    const rolls = (ItemOptionMap.get(slot as ItemTypeEnum) ?? []).map((index) => [`rawOptionTxts.${index}`, base.rawOptionTxts?.[index], build.rawOptionTxts?.[index]] as const);
    const fields = [slot, `${slot}Refine`, `${slot}Grade`, ...relatedItemKeys(slot)].map((key) => [key, base[key], build[key]] as const);
    const moved = [...fields, ...rolls].filter(([, before, after]) => blank(before) !== blank(after)).map(([key]) => key);
    if (moved.length) out.push({ code: 'LOCKED_SLOT_CHANGED', message: `${slot} está travado e mudou (${moved.join(', ')}).` });
  }

  // The effect, not the skill: the toggles and active selectors are inspected, the learned (passive) level never is.
  for (const effect of constraints.forbiddenEffects ?? []) {
    const level = Math.max(build.skillBuffMap?.[effect] ?? 0, build.activeSkillMap?.[effect] ?? 0);
    if (level > 0) out.push({ code: 'FORBIDDEN_EFFECT_ACTIVE', message: `O efeito de ${effect} está ativo (nível ${level}) e é proibido.` });
  }

  if (constraints.allowExternalBuffs === false) {
    for (const [effect, level] of Object.entries<number>(build.skillBuffMap ?? {})) {
      if (level > 0 && !(base.skillBuffMap?.[effect] > 0)) out.push({ code: 'EXTERNAL_BUFF_ADDED', message: `Buff novo ativo: ${effect}.` });
    }
  }

  if (constraints.allowStatReset === false) {
    const changed = STAT_KEYS.filter((stat) => (base[stat] ?? 0) !== (build[stat] ?? 0));
    if (changed.length) out.push({ code: 'STAT_RESET_NOT_ALLOWED', message: `Atributos mudaram: ${changed.join(', ')}.` });
  }

  if (constraints.consumables) {
    const { allowed, forbidden = [], max } = constraints.consumables;
    const potion = typeof build.aspdPotion === 'number' && build.aspdPotion > 0 && [...AspdPotionList, ...AspdPotionStackable].some((entry) => entry.value === build.aspdPotion) ? [build.aspdPotion as number] : [];
    const used = [...((build.consumables ?? []) as number[]).filter((id) => id > 0), ...potion];
    for (const id of used) {
      if (forbidden.includes(id)) out.push({ code: 'CONSUMABLE_FORBIDDEN', message: `${name(id)} é um consumível proibido.` });
      else if (allowed && !allowed.includes(id)) out.push({ code: 'CONSUMABLE_NOT_ALLOWED', message: `${name(id)} não está entre os consumíveis permitidos.` });
    }
    if (max !== undefined && used.length > max) out.push({ code: 'CONSUMABLE_LIMIT', message: `${used.length} consumíveis, o limite é ${max}.` });
  }

  return out;
}

/** How far a rule is from being met, as a fraction of what it asks (0 when met). Used only to pick the worst target. */
const shortfall = (value: number, { min, max }: { min?: number; max?: number }): number => {
  if (min !== undefined && value < min) return (min - value) / Math.max(Math.abs(min), 1);
  if (max !== undefined && value > max) return (value - max) / Math.max(Math.abs(max), 1);

  return 0;
};

interface RuleCheck { violations: Violation[]; unknowns: Violation[]; gap: number }

function checkRules(reading: TargetReading, rules: Requirement[]): RuleCheck {
  const out: RuleCheck = { violations: [], unknowns: [], gap: 0 };

  for (const rule of rules) {
    const actual = reading.metrics[rule.metric];
    if (actual === undefined) {
      out.unknowns.push({ code: 'METRIC_UNKNOWN', metric: rule.metric, required: { min: rule.min, max: rule.max }, message: `${rule.metric} não pôde ser medido neste alvo.` });
      continue;
    }
    const missed = shortfall(actual, rule);
    if (missed > 0) {
      out.gap = Math.max(out.gap, missed);
      out.violations.push({ code: 'GOAL_NOT_MET', metric: rule.metric, required: { min: rule.min, max: rule.max }, actual, message: `${rule.metric} ${actual} fora do pedido (${[rule.min !== undefined ? `mín ${rule.min}` : '', rule.max !== undefined ? `máx ${rule.max}` : ''].filter(Boolean).join(', ')}).` });
    }
  }

  return out;
}

/** A margin above 0 asks the engine's minimum hit, times the hits allowed, to cover the HP with room. At 0 the `hitsToKill` rule says the same. */
function checkMargin(reading: TargetReading, goal: GoalSpec): RuleCheck {
  const out: RuleCheck = { violations: [], unknowns: [], gap: 0 };
  const margin = goal.margin ?? 0;
  if (goal.maxHitsToKill === undefined || margin <= 0) return out;

  const min = reading.metrics.min;
  if (min === undefined || reading.hp === undefined) {
    out.unknowns.push({ code: 'METRIC_UNKNOWN', metric: 'margin', message: 'Margem não pôde ser avaliada: falta o dano mínimo ou o HP do alvo.' });

    return out;
  }
  const needed = reading.hp * (1 + margin);
  const dealt = min * goal.maxHitsToKill;
  if (dealt < needed) {
    out.gap = (needed - dealt) / needed;
    out.violations.push({ code: 'GOAL_NOT_MET', metric: 'margin', actual: dealt, required: { min: needed }, message: `${goal.maxHitsToKill} golpe(s) de dano mínimo somam ${Math.round(dealt)}; o HP com margem de ${Math.round(margin * 100)}% é ${Math.round(needed)}.` });
  }

  return out;
}

const mergeChecks = (a: RuleCheck, b: RuleCheck): RuleCheck => ({ violations: [...a.violations, ...b.violations], unknowns: [...a.unknowns, ...b.unknowns], gap: Math.max(a.gap, b.gap) });

const verdict = (check: RuleCheck): boolean | null => (check.violations.length ? false : check.unknowns.length ? null : true);

/**
 * Whether the kill is certain, given that the damage suffices. `skillMinDamage` is the crit path (max ATK plus the crit bonus), so on a
 * skill that can crit the engine's `hitsToKill` may rest on crits alone: it is judged again with the non-crit minimum (`minNoCri`).
 * Only figures the engine produced are used; no chance of killing is computed.
 */
function reliabilityOf(reading: TargetReading, goal: GoalSpec): { reliability: NonNullable<KillAssessment['reliability']>; reasons: string[] } {
  const { canCri, minNoCri, critRate, hitChance } = reading.metrics;
  const conditional: string[] = [];
  const unknown: string[] = [];

  if (hitChance === undefined) unknown.push('A chance de acerto da habilidade no alvo não pôde ser medida.');
  else if (hitChance < 100) conditional.push(`A habilidade acerta o alvo com chance de ${hitChance}% (menos de 100%): um golpe pode errar.`);

  if (canCri === undefined) unknown.push('Não se sabe se a habilidade pode causar crítico.');
  else if (canCri > 0) {
    const needed = reading.hp === undefined ? undefined : reading.hp * (1 + (goal.margin ?? 0));
    if (minNoCri === undefined) unknown.push('O motor não tem um dano mínimo sem crítico comparável para esta habilidade; não dá para saber se o abate depende de críticos.');
    else if (needed === undefined) unknown.push('Falta o HP do alvo para comparar o dano sem crítico.');
    else if (minNoCri * (goal.maxHitsToKill ?? 0) < needed) {
      if (critRate === undefined) unknown.push('Sem crítico o dano não cobre o HP e a chance de crítico efetivo não pôde ser medida.');
      else if (critRate < 100) conditional.push(`Sem crítico o dano mínimo (${Math.round(minNoCri)} × ${goal.maxHitsToKill}) não cobre o HP (${Math.round(needed)}): o abate depende de críticos, com chance efetiva de ${critRate}%.`);
    }
  }

  return conditional.length ? { reliability: 'conditional', reasons: [...conditional, ...unknown] }
    : unknown.length ? { reliability: 'unknown', reasons: unknown }
    : { reliability: 'guaranteed', reasons: [] };
}

function judgeTarget(reading: TargetReading, rules: Requirement[], goal?: GoalSpec): TargetFeasibility & { gap: number } {
  const damageRule = goalDamageRule(goal);
  const damage = damageRule && goal ? mergeChecks(checkRules(reading, [damageRule]), checkMargin(reading, goal)) : undefined;
  const limits = checkRules(reading, rules);
  const violations = [...(damage?.violations ?? []), ...limits.violations];
  const unknowns = [...(damage?.unknowns ?? []), ...limits.unknowns];

  let kill: KillAssessment | undefined;
  if (damage && goal) {
    const damageFeasible = verdict(damage);
    const extra = damageFeasible === false ? { reasons: damage.violations.map((entry) => entry.message) }
      : damageFeasible === null ? { reliability: 'unknown' as const, reasons: damage.unknowns.map((entry) => entry.message) }
      : reliabilityOf(reading, goal);
    kill = { damageFeasible, constraintsMet: verdict(limits), ...extra };
  }

  return { monsterId: reading.monsterId, name: reading.name, status: violations.length ? 'infeasible' : unknowns.length ? 'unknown' : 'feasible', violations, unknowns, ...(kill ? { kill } : {}), gap: Math.max(damage?.gap ?? 0, limits.gap) };
}

export function judgeFeasibility({ dataset, base, build, readings, goal, constraints, require = [], issues, tolerateInherited = false }: FeasibilityInput): FeasibilityReport {
  const limitRules = [...require, ...goalLimits(goal)];
  const damageRule = goalDamageRule(goal);
  const violations: Violation[] = [];

  const errors = issues ?? validateBuild(build, dataset).errors;
  const known = tolerateInherited ? new Set(validateBuild(base, dataset).errors.map(issueKey)) : new Set<string>();
  const asViolation = (issue: BuildIssue): Violation => ({ code: issue.code, message: issue.message });
  const inherited = errors.filter((issue) => known.has(issueKey(issue))).map(asViolation);
  violations.push(...errors.filter((issue) => !known.has(issueKey(issue))).map(asViolation));

  // Constraints compare resolved models; a build that does not resolve is already reported as a validation error above.
  if (constraints && !violations.length) {
    try {
      violations.push(...constraintViolations(constraints, dataset, resolveBuild(base, dataset).model, resolveBuild(build, dataset).model));
    } catch (error) {
      violations.push({ code: 'INVALID_BUILD', message: (error as Error).message });
    }
  }

  const judged = readings.map((reading) => judgeTarget(reading, limitRules, goal));
  const targets: TargetFeasibility[] = judged.map(({ gap: _gap, ...target }) => target);
  // A goal with rules but nothing measured has no evidence to stand on.
  const unmeasured = (limitRules.length > 0 || !!damageRule) && readings.length === 0;

  const status: FeasibilityStatus = violations.length ? 'invalid'
    : judged.some((target) => target.status === 'infeasible') ? 'infeasible'
    : unmeasured || judged.some((target) => target.status === 'unknown') ? 'unknown'
    : 'feasible';

  let worstTarget: FeasibilityReport['worstTarget'];
  if (judged.length) {
    const bad = judged.filter((target) => target.status === 'infeasible').sort((a, b) => b.gap - a.gap)[0];
    const unreadable = judged.find((target) => target.status === 'unknown');
    // All met: the slowest kill, which is the one with the least room.
    const slowest = [...judged].sort((a, b) => (readings.find((r) => r.monsterId === b.monsterId)?.metrics.hitsToKill ?? 0) - (readings.find((r) => r.monsterId === a.monsterId)?.metrics.hitsToKill ?? 0))[0];
    const pick = bad ?? unreadable ?? slowest;
    worstTarget = { monsterId: pick.monsterId, name: pick.name, reason: pick === bad ? pick.violations[0].message : pick === unreadable ? pick.unknowns[0].message : 'Cumpre todas as regras; é o alvo com mais golpes para abater.' };
  }

  const kills = judged.flatMap((target) => (target.kill ? [target.kill] : []));
  const all = (values: (boolean | null)[]): boolean | null => (values.includes(false) ? false : values.includes(null) ? null : true);
  const damageFeasible = all(kills.map((entry) => entry.damageFeasible));
  const reliabilities = kills.flatMap((entry) => (entry.reliability ? [entry.reliability] : []));
  const kill: FeasibilityReport['kill'] = kills.length ? {
    damageFeasible,
    // The hard constraints are explicit user limits too.
    constraintsMet: violations.length ? false : all(kills.map((entry) => entry.constraintsMet)),
    ...(damageFeasible === false ? {} : { reliability: reliabilities.includes('conditional') ? 'conditional' as const : reliabilities.includes('unknown') ? 'unknown' as const : 'guaranteed' as const }),
  } : undefined;

  return { status, violations, targets, ...(kill ? { kill } : {}), ...(worstTarget ? { worstTarget } : {}), ...(inherited.length ? { inherited } : {}) };
}

/**
 * Where a build stands against the goal, for ranking candidates during a search (not for the verdict: that is `judgeFeasibility`).
 *
 * `feasible`: every target meets every goal rule as the engine reads it (an unreadable number never counts as met).
 * `worst` and `total`: how far the build is from the goal, `0` when it is met. Each unmet rule contributes a shortfall relative to what
 * the rule asks (`(min - value) / min` or `(value - max) / max`), so neither HP nor the scale of the damage enters it, then squashed with
 * `s / (1 + s)` into [0, 1) so that a rule that is far off (40 hits where 2 are asked) cannot drown the others. An unreadable number
 * counts as 1. `worst` is the largest contribution of any rule on any target (the monster that is furthest away decides, never an
 * average); `total` is the sum over every unmet rule of every target, so progress on a target that is not the worst still shows.
 * `hitsToKill` is an integer (`ceil(HP / min)`), so a move that adds damage but does not cross a whole hit would change nothing:
 * when the engine's minimum hit and the HP are known, the shortfall of that rule uses `HP / min` instead.
 */
export interface GoalStanding {
  feasible: boolean;
  worst: number;
  total: number;
}

const squash = (shortfall: number): number => shortfall / (1 + shortfall);

export function goalStanding(readings: TargetReading[], goal: GoalSpec | undefined): GoalStanding {
  const rules = goalRequirements(goal);
  if (!rules.length) return { feasible: true, worst: 0, total: 0 };

  let feasible = readings.length > 0;
  let worst = 0;
  let total = 0;
  for (const reading of readings) {
    if (judgeTarget(reading, goalLimits(goal), goal).status !== 'feasible') feasible = false;
    const { min } = reading.metrics;
    for (const rule of rules) {
      const engine = reading.metrics[rule.metric];
      const continuous = rule.metric === 'hitsToKill' && reading.hp !== undefined && min !== undefined && min > 0 ? reading.hp / min : engine;
      const missed = engine === undefined ? 1 : shortfall(engine, rule) === 0 ? 0 : squash(shortfall(continuous ?? engine, rule) || shortfall(engine, rule));
      worst = Math.max(worst, missed);
      total += missed;
    }
    const margin = goal?.margin ?? 0;
    if (goal?.maxHitsToKill !== undefined && margin > 0) {
      const gap = min === undefined || reading.hp === undefined ? 1 : squash(Math.max(0, (reading.hp * (1 + margin) - min * goal.maxHitsToKill) / (reading.hp * (1 + margin))));
      worst = Math.max(worst, gap);
      total += gap;
    }
  }

  return { feasible, worst, total };
}

/** A candidate as the search ranks it: how it stands against the goal, then its objective (DPS). */
export interface RankedStanding extends GoalStanding {
  value: number;
}

const GAP_EPSILON = 1e-6;

/**
 * Lexicographic order of two candidates (positive: `a` is better). Legality is settled before this (an illegal candidate never gets
 * here). Then: one that meets every goal beats one that does not; while neither does, the one closer to the goal (`worst`, then `total`)
 * wins; the objective only decides between candidates that are equal in the above. So a big DPS gain never buys a missed goal.
 */
export function compareStanding(a: RankedStanding, b: RankedStanding): number {
  if (a.feasible !== b.feasible) return a.feasible ? 1 : -1;
  if (!a.feasible) {
    if (Math.abs(a.worst - b.worst) > GAP_EPSILON) return b.worst - a.worst;
    if (Math.abs(a.total - b.total) > GAP_EPSILON) return b.total - a.total;
  }

  return a.value - b.value;
}

/**
 * Whether the search takes `candidate` over the build it holds. Reaching the goal is always taken, and a build that meets the goal is
 * never given up for one that does not. Between builds that are alike in the goal (both feasible, or no closer to it) the objective must
 * improve by more than `margin` (0.1%: below that the gain is rounding in the engine).
 */
export function improvesStanding(candidate: RankedStanding, incumbent: RankedStanding, margin = 1.001): boolean {
  if (incumbent.feasible && !candidate.feasible) return false;
  if (candidate.feasible && !incumbent.feasible) return true;
  if (!candidate.feasible) {
    if (candidate.worst < incumbent.worst - GAP_EPSILON) return true;
    if (candidate.worst > incumbent.worst + GAP_EPSILON) return false;
    if (candidate.total < incumbent.total - GAP_EPSILON) return true;
    if (candidate.total > incumbent.total + GAP_EPSILON) return false;
  }

  return candidate.value > incumbent.value * margin;
}
