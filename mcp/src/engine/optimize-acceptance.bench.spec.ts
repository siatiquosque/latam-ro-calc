/**
 * Final quality benchmark for the Optimize V1 acceptance (docs/optimize/optimize-v1-acceptance.md). For each build it runs the search the way the
 * MCP and the UI run it and compares quality at the SAME total cost: the engine-call count (`engineCallCount`, every call to the damage
 * calculator, final socket pass included) and the same wall-clock deadline.
 *
 *   A  shipped default (`budgetMode` legacy, 20000 searches)           -> its total engine calls define the cost of the comparison
 *   B  `unified` with the cap set to A's total engine calls            -> same total cost, the reserve for the final pass inside the cap
 *   C  the UI defaults (10000 searches, procs on average)              -> what a player gets without touching the form
 *
 * It measures and changes nothing. It takes minutes, so it only runs on request, one build per process:
 *   PowerShell:  $env:ACCEPT_BENCH=1; $env:ACCEPT_BUILD='inq'; npx vitest run mcp/src/engine/optimize-acceptance.bench.spec.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import inquisitor from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { APP_VERSION } from '../../../src/app/core/app-version';
import { engineCallCount } from '../../../src/app/build-analysis/engine/evaluate';
import { createOptimizationOperations, OptimizeBuildArgs } from '../../../src/app/build-analysis/operations/optimize';

const BOSS = 20994;
const OUT = process.env['ACCEPT_OUT'] ?? 'docs/benchmarks/optimize-acceptance';
const DEADLINE_MS = 600_000;
// Bare classes are dressed first by a short search, so every build starts from real equipment.
const MAGUS = { class: 4255, level: 250, jobLevel: 50, stats: { int: 130, dex: 130, spl: 60, wis: 40 }, atkSkill: 'Crimson Rock==5', gear: {} };
const MEISTER = { class: 4253, level: 250, jobLevel: 50, stats: { str: 130, dex: 130, pow: 60, sta: 40 }, atkSkill: 'Axe Stomp==5', gear: {} };
const FIXTURES: Record<string, { bare?: unknown; preset?: unknown; customItems?: unknown[] }> = {
  inq: inquisitor, b1: builds.b1, weak: builds.weak,
  meister: { bare: MEISTER },
  magus: { bare: MAGUS },
};

describe.skipIf(!process.env['ACCEPT_BENCH'])('optimize V1 acceptance benchmark', () => {
  const names = (process.env['ACCEPT_BUILD'] ?? Object.keys(FIXTURES).join(',')).split(',');
  it.each(names)('%s', async (name) => {
    config.limits.maxSearchMs = DEADLINE_MS;
    config.limits.maxSolves = 100_000;
    const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
    const fixture = FIXTURES[name];
    const common = { target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', } as const;
    const run = async (build: unknown, extra: Partial<OptimizeBuildArgs>) => {
      const calls = engineCallCount(), began = Date.now();
      const found = await ops.optimizeBuild({ ...common, build, ...extra } as never) as any;
      return {
        found, engineCalls: engineCallCount() - calls, seconds: Math.round((Date.now() - began) / 100) / 10,
        row: { baselineDps: found.baseline?.dps, finalDps: found.final?.dps, deltaPct: found.deltaPct?.dps, counted: found.solves, stopped: found.stopped ?? null, changes: found.changes?.length ?? null, share: found.share },
      };
    };

    let start: unknown;
    if (fixture.bare) start = { share: (await run(fixture.bare, { maxSolves: 4000, budgetMode: 'legacy' })).found.share };
    else start = { preset: fixture.preset, ...(fixture.customItems ? { customItems: fixture.customItems } : {}) };

    const uiOnly = process.env['ACCEPT_ONLY'] === 'ui';
    const a = uiOnly ? undefined : await run(start, { maxSolves: 20000 });
    const b = a && await run(start, { budgetMode: 'unified', maxSolves: a.engineCalls });
    // The UI hands its form values to the worker as the runtime limits (60 s and 10000 by default), not as call arguments.
    config.limits.maxSearchMs = 60_000;
    const ui = await run(start, { maxSolves: 10000, procMode: 'average' });
    config.limits.maxSearchMs = DEADLINE_MS;
    const result = {
      build: name, engine: APP_VERSION, target: BOSS, deadlineMs: DEADLINE_MS,
      ...(a && b ? { shipped: { engineCalls: a.engineCalls, seconds: a.seconds, ...a.row }, equalCostUnified: { cap: a.engineCalls, engineCalls: b.engineCalls, seconds: b.seconds, ...b.row } } : {}),
      uiDefaults: { deadlineMs: 60_000, engineCalls: ui.engineCalls, seconds: ui.seconds, ...ui.row },
    };
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, `${name}.json`);
    const saved = uiOnly ? { ...JSON.parse(readFileSync(file, 'utf8')), uiDefaults: result.uiDefaults } : result;
    writeFileSync(file, JSON.stringify(saved, null, 2));
    console.info(JSON.stringify(result));
  }, 3_600_000);
});
