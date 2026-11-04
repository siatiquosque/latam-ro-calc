/**
 * The contract that says what a search is for (`GoalSpec`) and what it may not do (`ConstraintSpec`). Both the calculator UI and the
 * MCP tools take these shapes; `feasibility.ts` judges a build against them and the operations adapt the older flags (`require`,
 * `lock`, `exclude`, `mvpPolicy`, `maxGrade`, `refine`) onto them, so a search without a spec behaves as before.
 *
 * The goal is a set of per-target metric rules. A hard constraint is a property of the build itself, never traded against the goal.
 * Prices, liquidity and zeny cost are not part of the contract, and neither is a kill probability: `maxHitsToKill` reads the
 * deterministic `hitsToKill` metric and says nothing about the chance that any two hits kill.
 */
import { z } from 'zod';
import { MAIN_ITEM_SLOTS } from './build-input';
import { Metric, METRICS } from './metrics';

const metricEnum = z.enum(METRICS);

/** A floor and/or ceiling a metric must respect (also the shape of the older `require`). */
export const requireSchema = z.object({
  metric: metricEnum,
  min: z.number().optional(),
  max: z.number().optional(),
});
export type Requirement = z.infer<typeof requireSchema>;

export const goalSpecSchema = z.object({
  kind: z.enum(['dps', 'burst', 'farm']).optional().describe('dps: sustentado (padrão). burst: abertura da rotação. farm: abater cada alvo em poucos golpes (use maxHitsToKill).'),
  skill: z.string().optional().describe('Habilidade ofensiva "Nome==Nível"; substitui o `atkSkill` da build.'),
  targets: z.array(z.object({ monsterId: z.number().int().positive(), weight: z.number().positive().optional() })).min(1).max(5).optional()
    .describe('Alvos julgados um a um. Ausente: usa `target`/`targets` da chamada.'),
  maxHitsToKill: z.number().int().min(1).optional().describe('Golpes no máximo para abater CADA alvo, pelo `hitsToKill` determinístico (não é probabilidade).'),
  minCritRate: z.number().min(0).max(100).optional().describe('Chance de crítico efetivo mínima (%) contra cada alvo.'),
  minAccuracy: z.number().min(0).optional().describe('Precisão (HIT) mínima.'),
  margin: z.number().min(0).max(10).optional().describe('Com maxHitsToKill: minDano × maxHitsToKill ≥ HP × (1 + margin). Padrão 0 (equivale ao hitsToKill).'),
}).superRefine((goal, ctx) => {
  if (goal.margin !== undefined && goal.maxHitsToKill === undefined) ctx.addIssue({ code: 'custom', path: ['margin'], message: '`margin` exige `maxHitsToKill`.' });
  const ids = (goal.targets ?? []).map((target) => target.monsterId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Alvos repetidos.' });
});
export type GoalSpec = z.infer<typeof goalSpecSchema>;

/** What tool lists advertise: the full schemas would add ~7 KB to every client's tool list. Input is still validated against the full one. */
export const compactGoalSchema = z.looseObject({}).pipe(goalSpecSchema);

const slotEnum = z.string().refine((slot) => MAIN_ITEM_SLOTS.includes(slot), { message: 'Não é um slot de equipamento.' });

export const constraintSpecSchema = z.object({
  mvpPolicy: z.enum(['allow', 'exclude-new', 'none']).optional().describe('allow (padrão); exclude-new não aceita carta de MVP além das já usadas; none não aceita nenhuma.'),
  maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Teto de grau de qualquer peça.'),
  maxRefine: z.number().int().min(0).max(20).optional().describe('Teto de refino de qualquer peça.'),
  lockedSlots: z.array(slotEnum).optional().describe('Slots que ficam exatamente como na build base: peça, refino, grau, cartas, encantamentos e rolagens.'),
  unavailableIds: z.array(z.number().int().positive()).optional().describe('Itens que o jogador não tem ou não quer: proibidos em qualquer lugar da build.'),
  forbiddenEffects: z.array(z.string().min(1)).optional()
    .describe('Habilidades cujo EFEITO ATIVO é proibido (ex.: "Oleum Sanctum"). Não toca o nível aprendido, que continua valendo como pré-requisito.'),
  consumables: z.object({
    allowed: z.array(z.number().int()).optional().describe('Se informado, só estes consumíveis.'),
    forbidden: z.array(z.number().int()).optional(),
    max: z.number().int().min(0).optional().describe('Quantidade máxima de consumíveis (poção de ASPD incluída).'),
  }).optional(),
  allowExternalBuffs: z.boolean().optional().describe('false: nenhum buff ativo novo além dos da build base. Padrão true.'),
  allowStatReset: z.boolean().optional().describe('false: atributos idênticos aos da build base. Padrão true.'),
}).superRefine((spec, ctx) => {
  const { allowed = [], forbidden = [] } = spec.consumables ?? {};
  if (allowed.some((id) => forbidden.includes(id))) ctx.addIssue({ code: 'custom', path: ['consumables'], message: 'Um consumível não pode ser permitido e proibido.' });
});
export type ConstraintSpec = z.infer<typeof constraintSpecSchema>;
export const compactConstraintSchema = z.looseObject({}).pipe(constraintSpecSchema);

export type MvpPolicy = NonNullable<ConstraintSpec['mvpPolicy']>;

/** The damage goal: the most hits a kill may take. Whether the damage suffices is judged apart from the user's other limits. */
export function goalDamageRule(goal?: GoalSpec): Requirement | undefined {
  return goal?.maxHitsToKill !== undefined ? { metric: 'hitsToKill', max: goal.maxHitsToKill } : undefined;
}

/** The limits the user set explicitly (optional). They are constraints to meet, never evidence that a kill is certain. */
export function goalLimits(goal?: GoalSpec): Requirement[] {
  return [
    ...(goal?.minCritRate !== undefined ? [{ metric: 'critRate' as const, min: goal.minCritRate }] : []),
    ...(goal?.minAccuracy !== undefined ? [{ metric: 'hit' as const, min: goal.minAccuracy }] : []),
  ];
}

/** All the metric rules a goal states (the search filters on them). Each holds on every target, and an unreadable metric never satisfies one. */
export function goalRequirements(goal?: GoalSpec): Requirement[] {
  const damage = goalDamageRule(goal);

  return [...(damage ? [damage] : []), ...goalLimits(goal)];
}

/** Everything the judgement reads off a target: the rules' metrics, plus what a kill needs to be classified (minimum hit, crit, hit chance). */
export function judgedMetrics(goal: GoalSpec | undefined, require: Requirement[] = []): Metric[] {
  const kill: Metric[] = goal?.maxHitsToKill === undefined ? [] : ['critRate', 'canCri', 'minNoCri', 'hitChance', ...((goal.margin ?? 0) > 0 ? ['min' as const] : [])];

  return [...new Set<Metric>([...require.map((rule) => rule.metric), ...goalRequirements(goal).map((rule) => rule.metric), ...kill])];
}

/** The fields of an operation that the spec overlaps. */
export interface SpecFields {
  build?: { atkSkill?: string };
  target?: { monsterId?: number };
  targets?: { monsterId: number; weight?: number }[];
  profile?: 'sustained' | 'burst';
  lock?: string[];
  exclude?: number[];
  mvpPolicy?: MvpPolicy;
  excludeMvpCards?: boolean;
  strictMvp?: boolean;
  maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
  refine?: number;
  require?: Requirement[];
  goal?: GoalSpec;
  constraints?: ConstraintSpec;
}

/**
 * Lay a goal and constraints over an operation's older fields. A field the caller set explicitly wins; the spec only fills what was left
 * out (lists are joined), so a call with no spec returns the same fields it was given.
 */
export function adaptSpecs<T extends SpecFields>(args: T): T {
  const { goal, constraints } = args;
  if (!goal && !constraints) return args;
  const out: T = { ...args };

  if (goal) {
    if (goal.skill && out.build) out.build = { ...out.build, atkSkill: goal.skill };
    if (goal.targets && !out.target && !out.targets) out.targets = goal.targets;
    if (goal.kind === 'burst' && out.profile === undefined) out.profile = 'burst';
    out.require = [...(args.require ?? []), ...goalRequirements(goal)];
  }
  if (constraints) {
    // The explicit legacy flags keep their own meaning; the spec's policy applies when they are absent.
    if (out.mvpPolicy === undefined && !args.excludeMvpCards && !args.strictMvp) out.mvpPolicy = constraints.mvpPolicy;
    if (out.maxGrade === undefined) out.maxGrade = constraints.maxGrade;
    if (out.refine === undefined) out.refine = constraints.maxRefine;
    if (constraints.lockedSlots?.length) out.lock = [...new Set([...(args.lock ?? []), ...constraints.lockedSlots])];
    if (constraints.unavailableIds?.length) out.exclude = [...new Set([...(args.exclude ?? []), ...constraints.unavailableIds])];
  }

  return out;
}
