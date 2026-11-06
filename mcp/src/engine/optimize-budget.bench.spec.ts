/**
 * Budget benchmark of the equipment search (docs/optimize-budget-benchmark.md). It answers where the evaluations go and what the
 * final socket pass, the reserve for it, a restart and a wider search are worth at the SAME total evaluation budget. It measures;
 * it changes nothing. It takes minutes to hours, so it only runs on request, one build per process (they can run in parallel):
 *
 *   PowerShell:  $env:BUDGET_BENCH=1; $env:BUDGET_BENCH_BUILD='b1'; npx vitest run mcp/src/engine/optimize-budget.bench.spec.ts
 *   BUDGET_BENCH_RUNS=id1,id2   run only those run ids (default: all of the build, in order)
 *   BUDGET_BENCH_OUT=dir        artifact directory (default docs/benchmarks/optimize-budget)
 *
 * Every run writes `runs/<build>/<runId>.json`; `tools/optimize-budget-report.mjs` turns the artifacts into the report tables.
 * The search is deterministic (no random source) provided no wall-clock limit cuts it, so the time limits are lifted here and a
 * run that was stopped by time says so in `stoppedReason`. Repeating a run therefore proves determinism, not robustness.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import inquisitor from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { APP_VERSION } from '../../../src/app/core/app-version';
import { createOptimizationOperations, OptimizeBuildArgs } from '../../../src/app/build-analysis/operations/optimize';

const BOSS = 20994;
const OUT = process.env['BUDGET_BENCH_OUT'] ?? 'docs/benchmarks/optimize-budget';
const FIXTURES: Record<string, { preset: unknown; customItems?: unknown[] }> = {
  b1: builds.b1, b2: builds.b2, weak: builds.weak,
  // "inq": the Inquisitor of the budget spec (inquisitor-fogueira-optimization.json), the fixture of the earlier A/B.
  inq: inquisitor,
};
const RESERVES = [0.1, 0.15, 0.2, 0.3, 0.4];
const pct = (reserve: number) => Math.round(reserve * 100);

interface RunSpec { id: string; group: string; note?: string; args: Partial<OptimizeBuildArgs>; /** Restart: a second search starts from the first one's build. */ restart?: Partial<OptimizeBuildArgs>; }
/** Same conditions for every run: engine, catalog, target, objective, refine, grade, procs, constraints. Only the lines below vary. */
const unified = (maxSolves: number, extra: Partial<OptimizeBuildArgs> = {}): Partial<OptimizeBuildArgs> => ({ budgetMode: 'unified', maxSolves, ...extra });

function plan(effective?: number): RunSpec[] {
  const specs: RunSpec[] = [
    { id: 'legacy-20000', group: 'legacy', note: 'nominal 20000; the socket pass has its own allowance', args: { budgetMode: 'legacy', maxSolves: 20000 } },
    ...[400, 1000, 2000, 4000].map((n): RunSpec => ({ id: `unified-${n}-r15`, group: 'curve', args: unified(n) })),
    { id: 'unified-2000-r15-repeat', group: 'determinism', args: unified(2000) },
  ];
  for (const budget of [8000, 20000]) for (const reserve of RESERVES) specs.push({ id: `unified-${budget}-r${pct(reserve)}`, group: 'reserve', args: unified(budget, { socketReserve: reserve }) });
  // Control: the same ceiling for the walk as the legacy run (20000), the reserve on top of it. The walk's effort per slot is a function
  // of its budget, so this separates "the cap" from "the reserve" and shows how sensitive the path is to the walk budget.
  for (const walk of [16000, 18000, 20000, 22000]) specs.push({ id: `unified-walk${walk}-r15`, group: 'walk-control', note: `search ceiling ${walk}, total ${Math.ceil(walk / 0.85)}`, args: unified(Math.ceil(walk / 0.85)) });
  specs.push({ id: 'restart-2x10000-r15', group: 'restart', note: 'second search starts from the first one\'s build; best of the two', args: unified(10000), restart: unified(10000) });
  specs.push({ id: 'wide-20000-r15', group: 'wide', note: 'candidatesPerSlot 40, rounds 4', args: unified(20000, { candidatesPerSlot: 40, rounds: 4 }) });
  // Decoupling: the effort per slot is planned from a fixed 20000 whatever the cap, which then only stops the walk (docs/optimize-budget-efficiency.md).
  for (const total of [2000, 4000, 8000, 12000, 16000, 23530]) specs.push({ id: `decoupled-${total}-e20000`, group: 'decoupled', note: `effort planned from 20000, total cap ${total}`, args: unified(total, { effortBudget: 20000 }) });
  // Separating the two roles of the cap: the same walk ceiling with the effort planned from another budget, and the other way round.
  specs.push({ id: 'decoupled-20000-e20000', group: 'decoupled', note: 'search ceiling 17000, effort planned from 20000', args: unified(20000, { effortBudget: 20000 }) });
  specs.push({ id: 'decoupled-23530-e17000', group: 'decoupled', note: 'search ceiling 20000, effort planned from 17000', args: unified(23530, { effortBudget: 17000 }) });
  specs.push({ id: 'trail-unified-20000-r15', group: 'decoupled', note: 'the coupled run again, with its trail', args: unified(20000) });
  // Quality against the effort plan alone: the cap is out of the way (the walk ends by itself), so the cost is what the plan needs.
  for (const plan of [6000, 10000, 14000, 17000, 20000, 24000]) specs.push({ id: `plan-e${plan}`, group: 'plan', note: `effort planned from ${plan}, cap 40000`, args: unified(40000, { effortBudget: plan }) });
  // Second socket pass limited to the pieces the first pass touched, against the full re-check (same effort plan).
  for (const plan of [10000, 14000, 20000]) specs.push({ id: `touched-e${plan}`, group: 'recheck', note: `plan-e${plan} with socketRecheck touched`, args: unified(40000, { effortBudget: plan, socketRecheck: 'touched' }) });
  // Which of the three efforts moves the path: the same walk, with a decision log, planned from 17000 and 20000; then 17000 with one effort planned from 20000.
  for (const plan of [17000, 20000]) specs.push({ id: `slots-e${plan}`, group: 'divergence', note: `effort planned from ${plan}, per-slot log`, args: unified(40000, { effortBudget: plan }) });
  for (const part of ['quick', 'full', 'discoveryCap'] as const) specs.push({ id: `mix-e17000-${part}20000`, group: 'divergence', note: `effort planned from 17000 except ${part}, planned from 20000`, args: unified(40000, { effortBudget: 17000, effortParts: { [part]: 20000 } }) });
  for (const plan of [10000, 14000, 17000, 20000, 24000]) specs.push({ id: `near-e${plan}`, group: 'recheck', note: `plan-e${plan} with socketRecheck near`, args: unified(40000, { effortBudget: plan, socketRecheck: 'near' }) });
  // The finalists' socket search at a fixed depth, whatever the budget (everything else planned from 20000).
  for (const fixed of [100, 150, 200, 300, 500]) specs.push({ id: `fixed-full${fixed}`, group: 'divergence', note: `fullEffort fixed at ${fixed}`, args: unified(40000, { effortBudget: 20000, effortParts: { fullFixed: fixed } }) });
  // A fixed finalist depth with a smaller plan for everything else (screening, tuning): same quality for fewer evaluations?
  for (const [fixed, plan] of [[300, 10000], [300, 14000], [250, 20000]]) specs.push({ id: `fixed-full${fixed}-e${plan}`, group: 'divergence', note: `fullEffort fixed at ${fixed}, rest planned from ${plan}`, args: unified(40000, { effortBudget: plan, effortParts: { fullFixed: fixed } }) });
  if (effective) specs.push({ id: `unified-effective-${effective}-r15`, group: 'equal-effective', note: `same total as the real cost of legacy-20000 (${effective})`, args: unified(effective) });
  return specs;
}

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const git = (command: string) => { try { return execSync(command, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

describe.skipIf(!process.env['BUDGET_BENCH'])('optimize budget benchmark', () => {
  const names = (process.env['BUDGET_BENCH_BUILD'] ?? Object.keys(FIXTURES).join(',')).split(',');
  it.each(names)('%s', async (name) => {
    const fixture = FIXTURES[name];
    expect(fixture, `unknown build ${name}`).toBeTruthy();
    // No wall-clock cut: the evaluation cap is the only limit, so the runs are deterministic and comparable.
    config.limits.maxSearchMs = 6 * 3_600_000;
    config.limits.maxSolves = 100_000;
    const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
    const dir = join(OUT, 'runs', name);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(OUT, 'inputs'), { recursive: true });
    const input = { preset: fixture.preset, customItems: fixture.customItems ?? [] };
    const versions = {
      app: APP_VERSION, gitHead: git('git rev-parse --short HEAD'), gitDirty: git('git status --porcelain').split('\n').filter(Boolean).length > 0,
      dataManifestSha: sha('src/assets/data-manifest.json'), node: process.version,
    };
    writeFileSync(join(OUT, 'inputs', `${name}.json`), JSON.stringify({ name, versions, target: BOSS, input }, null, 1));

    const common: Partial<OptimizeBuildArgs> = { target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', instrument: true };
    const only = process.env['BUDGET_BENCH_RUNS']?.split(',');
    const legacyFile = join(dir, 'legacy-20000.json');
    const optimize = (build: unknown, args: Partial<OptimizeBuildArgs>) => ops.optimizeBuild({ ...common, ...args, build } as OptimizeBuildArgs) as Promise<any>;
    const summarize = (found: any) => ({
      baselineDps: found.baseline.dps, finalDps: found.final.dps, deltaPct: found.deltaPct.dps, solves: found.solves, reused: found.reused ?? 0,
      stopped: found.stopped ?? null, coverage: found.coverage, screening: found.screening, steps: found.steps.length, trail: found.steps.map((step: any) => ({ slot: step.slot ?? 'combo', to: step.to ?? step.combo?.map((swap: any) => swap.to), kind: step.kind, gainPct: step.gainPct, polish: step.polish })), share: found.share, budgetReport: found.budgetReport,
    });

    const run = async (spec: RunSpec) => {
      const started = Date.now();
      const first = await optimize(input, spec.args);
      let result: any = summarize(first);
      if (spec.restart) {
        const second = await optimize({ share: first.share }, spec.restart);
        const best = second.final.dps >= first.final.dps ? second : first;
        result = { ...summarize(best), restart: { first: summarize(first), second: summarize(second), totalSolves: first.solves + second.solves, bestOf: best === second ? 'second' : 'first' } };
      }
      const wallMs = Date.now() - started;
      writeFileSync(join(dir, `${spec.id}.json`), JSON.stringify({ name, runId: spec.id, group: spec.group, note: spec.note, versions, target: BOSS, args: { ...common, ...spec.args, restart: spec.restart }, wallMs, result }, null, 1));
      console.info(`${name} ${spec.id}: dps ${result.finalDps} (baseline ${result.baselineDps}) solves ${result.solves} ${result.budgetReport.stoppedReason} ${wallMs} ms`);
      return result;
    };

    // The legacy run goes first: its real cost sets the total of the equal-effective-budget run.
    const wanted = (id: string) => !only || only.includes(id);
    const [legacy, ...rest] = plan();
    if (wanted(legacy.id)) await run(legacy);
    const effective: number | undefined = existsSync(legacyFile) ? JSON.parse(readFileSync(legacyFile, 'utf8')).result.budgetReport.budgeted.effective : undefined;
    for (const spec of plan(effective).slice(1)) if (wanted(spec.id)) await run(spec);
    expect(rest.length).toBeGreaterThan(0);
  }, 6 * 3_600_000);
});
