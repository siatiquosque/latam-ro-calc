/**
 * feasible@budget on the Jor_ab02 study (docs/optimize/optimize-goal-search.md). The goal is 2 hits to kill on each of the five monsters. Two starts:
 *   gear-only  the original gear with the attributes, skill level and consumables of the "grau C" solution (a start the Greedy can finish from);
 *   original   the original as shared (the solutions also change attributes and consumables, which the Greedy does not touch: reported, not demanded).
 * For every run: found a feasible build?, where first (counted evaluations, real unique evaluations, phase), the best distance, why it stopped,
 * and what the other targets' reads cost outside the budget. Nothing here proves a goal impossible.
 *
 *   PowerShell:  $env:GOAL_BENCH=1; npx vitest run mcp/src/engine/goal-feasible.bench.spec.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { GOAL, gearOnlyStart, MONSTERS, preset } from './__tests__/jor-ab02-support';

const OUT = 'docs/benchmarks/optimize-goal';
const budgets = (process.env['GOAL_BENCH_BUDGETS'] ?? '300,800,2000').split(',').map(Number);
const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const constraints = { maxGrade: 'C', maxRefine: 12 } as const;
// `hits2` is met by the original after a few moves (it does not tell searches apart). `hits2-margin10` asks 10% of room on each kill: the original,
// the "grau C" solution and the "sem grau" solution do not meet it on every monster, the "Armadura Invernal" one does, so a feasible build exists in the gear-only space.
const goals = { hits2: { goal: GOAL, budgets: [300] }, 'hits2-margin10': { goal: { ...GOAL, margin: 0.1 }, budgets } } as const;
const common = { objective: 'dps', procMode: 'off', budgetMode: 'unified', constraints, instrument: true } as const;

const row = (result: any) => ({
  feasible: result.feasibility.search.feasible,
  startedFeasible: result.feasibility.search.startedFeasible,
  firstFeasible: result.feasibility.search.firstFeasible ?? null,
  bestGap: result.feasibility.search.bestGap ?? null,
  stoppedBy: result.feasibility.search.stoppedBy,
  evaluations: result.feasibility.search.evaluations,
  socketFieldsRefusedByGoal: result.feasibility.search.socketFieldsRefusedByGoal,
  statuses: result.feasibility.final.targets.map((target: any) => `${target.monsterId}:${target.status}`),
  steps: result.steps.length,
  dps: [result.baseline.dps, result.final.dps],
  wallMs: result.budgetReport.wallClockMs,
});

describe.skipIf(!process.env['GOAL_BENCH'])('feasible@budget', () => {
  it('measures the goal search on the Jor_ab02 monsters', async () => {
    const saved = config.limits.maxSearchMs;
    config.limits.maxSearchMs = 6 * 3_600_000;
    const starts = { 'gear-only': gearOnlyStart(), original: preset('original') };
    const rows: Record<string, unknown>[] = [];
    try {
      // Reference: the shared solutions, judged under the same constraints and goal (is a feasible build inside this space?).
      const references: Record<string, unknown> = {};
      for (const name of ['grauC', 'invernal', 'semGrau'] as const) {
        const result: any = await ops.optimizeBuild({ build: { preset: preset(name) }, ...common, goal: goals['hits2-margin10'].goal, targets: MONSTERS.map((monsterId) => ({ monsterId })), maxSolves: 1, complements: false } as never);
        references[name] = { status: result.feasibility.baseline.status, violations: result.feasibility.baseline.violations.map((violation: any) => violation.code) };
      }
      for (const [goalName, { goal, budgets: planned }] of Object.entries(goals)) for (const [start, build] of Object.entries(starts)) {
        const scopes: [string, { monsterId: number }[]][] = [['all', MONSTERS.map((monsterId) => ({ monsterId }))], ...MONSTERS.map((id) => [String(id), [{ monsterId: id }]] as [string, { monsterId: number }[]])];
        for (const [scope, targets] of scopes) for (const budget of planned) {
          if (scope !== 'all' && budget > 800) continue;
          const result = await ops.optimizeBuild({ build: { preset: build }, ...common, goal, targets, maxSolves: budget } as never);
          const entry = { goal: goalName, start, scope, budget, ...row(result) };
          rows.push(entry);
          console.info(`${goalName} ${start} ${scope} @${budget}: feasible=${entry.feasible} first=${JSON.stringify(entry.firstFeasible)} gap=${JSON.stringify(entry.bestGap)} eval=${JSON.stringify(entry.evaluations)} refused=${entry.socketFieldsRefusedByGoal} ${entry.statuses.map((s: string) => s.slice(-1)).join('')}`);
        }
      }
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/feasible-at-budget.json`, JSON.stringify({ goals: Object.fromEntries(Object.entries(goals).map(([name, entry]) => [name, entry.goal])), constraints, references, rows }, null, 1));
    } finally { config.limits.maxSearchMs = saved; }
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
