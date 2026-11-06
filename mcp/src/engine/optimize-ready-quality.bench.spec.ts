/** Opt-in equal REAL engine-call ceiling. READY_BENCH=1; READY_FIXTURES=b1; READY_RUNS=legacy-8000,... */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import inq from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations, OptimizeBuildArgs } from 'src/app/build-analysis/operations/optimize';
import { evaluate, engineCallCount } from 'src/app/build-analysis/engine/evaluate';
import { applyPatch } from 'src/app/build-analysis/engine/variants';
import { APP_VERSION } from 'src/app/core/app-version';
import { gearOnlyStart, MONSTERS, SCENARIO_EXACT } from './__tests__/jor-ab02-support';

const out = 'docs/benchmarks/optimize-ready-audit';
const fixtures: Record<string, any> = { ...builds, inq, jor: { preset: gearOnlyStart() } };
const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 3_600_000, maxSolves: 100_000 } };
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const versions = { app: APP_VERSION, node: process.version, dataManifest: hash('src/assets/data-manifest.json'),
  optimize: hash('src/app/build-analysis/operations/optimize.ts'), evaluator: hash('src/app/build-analysis/engine/evaluate.ts'),
  constraints: hash('src/app/build-analysis/engine/feasibility.ts') };
type Spec = { id: string; cap: number; mode: 'legacy' | 'unified'; reserve?: number; restart?: boolean; wide?: boolean; args?: Partial<OptimizeBuildArgs> };
function specs(name: string): Spec[] {
  if (name === 'jor') return [
    { id: 'five-goal-locks-8000', cap: 8000, mode: 'legacy', args: { targets: MONSTERS.map(monsterId => ({ monsterId })), goal: { maxHitsToKill: 2, margin: 0.1 }, constraints: structuredClone(SCENARIO_EXACT) as any } },
    { id: 'closed-infeasible-8000', cap: 8000, mode: 'legacy', args: { targets: MONSTERS.map(monsterId => ({ monsterId })), goal: { maxHitsToKill: 1, margin: 1 }, slots: [], complements: false } },
    { id: 'mvp-none-8000', cap: 8000, mode: 'legacy', args: { mvpPolicy: 'none', constraints: { mvpPolicy: 'none' } } },
  ];
  const rows: Spec[] = [8000, 20000].flatMap(cap => ([{ id: `legacy-${cap}`, cap, mode: 'legacy' }, { id: `unified-${cap}-r15`, cap, mode: 'unified', reserve: 0.15 }] as Spec[]));
  if (name === 'inq') for (const cap of [8000, 20000]) {
    for (const reserve of [0.1, 0.2, 0.3, 0.4]) rows.push({ id: `unified-${cap}-r${reserve * 100}`, cap, mode: 'unified', reserve });
    rows.push({ id: `restart-${cap}`, cap, mode: 'unified', reserve: 0.15, restart: true });
    rows.push({ id: `wide-${cap}`, cap, mode: 'unified', reserve: 0.15, wide: true });
  }
  return rows;
}

describe.skipIf(!process.env['READY_BENCH'])('READY equal total-call quality', () => {
  it.each((process.env['READY_FIXTURES'] ?? 'b1,b2,weak,inq,jor').split(','))('%s', async name => {
    const dataset = loadDatasetFromDisk(), ops = createOptimizationOperations(dataset, runtime);
    const input = structuredClone(fixtures[name]);
    expect(input).toBeTruthy();
    const dir = join(out, name); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'input.json'), JSON.stringify({ versions, build: input }, null, 2));
    const only = process.env['READY_RUNS']?.split(',');
    for (const spec of specs(name).filter(spec => !only || only.includes(spec.id))) {
      const checkpoints: any[] = [];
      const cap = spec.restart ? spec.cap / 2 : spec.cap;
      const args: OptimizeBuildArgs = { build: input, target: { monsterId: 20994 }, objective: 'dps', procMode: 'off',
        refine: 12, maxGrade: 'A', levelChecks: false, instrument: true, maxSolves: cap, maxEngineCalls: cap,
        budgetMode: spec.mode, ...(spec.mode === 'unified' ? { budgetAccounting: 'engine', socketReserve: spec.reserve } : {}),
        ...(spec.wide ? { candidatesPerSlot: 40, rounds: 4 } : {}), ...spec.args,
        execution: { onCheckpoint: (checkpoint: any) => checkpoints.push({ calls: checkpoint.budgetUsage.engineCalls, dps: checkpoint.final.dps }) } };
      if (args.targets) delete args.target;
      const started = performance.now(), before = engineCallCount();
      let found: any, error: string | undefined, second: any;
      try {
        found = await ops.optimizeBuild(args);
        if (spec.restart) second = await ops.optimizeBuild({ ...args, build: applyPatch(input, found.patch) });
      } catch (cause) { error = String(cause); }
      const wallMs = performance.now() - started, calls = engineCallCount() - before;
      const selected = second && second.final.dps > found.final.dps ? second : found;
      const finalBuild = second === selected ? applyPatch(applyPatch(input, found.patch), second.patch) : found ? applyPatch(input, found.patch) : undefined;
      const verificationStart = engineCallCount();
      const perTarget = finalBuild ? (args.targets ?? [{ monsterId: args.target!.monsterId! }]).map(aim => {
        const monster = dataset.monsters[aim.monsterId];
        const metrics = evaluate(finalBuild, undefined, dataset, monster, [], ['dps', 'min', 'hitsToKill', 'critRate', 'canCri', 'minNoCri', 'hitChance', 'conditionalEffects']).metrics;
        return { monsterId: aim.monsterId, metrics, margin: args.goal?.maxHitsToKill ? (metrics.min ?? 0) * args.goal.maxHitsToKill / monster.stats.health - 1 : undefined };
      }) : [];
      const serialize = (row: any) => row ? { baseline: row.baseline, final: row.final, deltaPct: row.deltaPct, patch: row.patch,
        share: row.share, feasibility: row.feasibility, budgetUsage: row.budgetUsage, coverage: row.coverage, budgetReport: row.budgetReport, steps: row.steps } : undefined;
      const artifact = { versions, fixture: name, spec, args: { ...args, execution: undefined }, wallMs, calls, checkpoints,
        result: serialize(found), second: serialize(second), selected: second === selected ? 'second' : 'first', perTarget,
        externalReplayCalls: engineCallCount() - verificationStart, error };
      writeFileSync(join(dir, `${spec.id}.json`), JSON.stringify(artifact, null, 2));
      expect(calls, `${name}/${spec.id} exceeded hard total ceiling`).toBeLessThanOrEqual(spec.cap);
      expect(error, `${name}/${spec.id}`).toBeUndefined();
      expect(calls).toBe((found?.budgetUsage.engineCalls ?? 0) + (second?.budgetUsage.engineCalls ?? 0));
    }
  }, 3_600_000);
});
