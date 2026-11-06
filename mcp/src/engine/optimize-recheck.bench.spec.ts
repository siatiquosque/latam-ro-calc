/**
 * Safety of `socketRecheck: 'touched'` (docs/optimize-targeted-greedy.md, task 1). The question is whether re-checking only the pieces
 * the first socket pass changed can miss what the full second pass finds, because changing a socket of one piece moves the best choice
 * for a socket of another (a cap, a breakpoint, a condition). Real builds rarely start in a state where that happens, so the build
 * is perturbed: every card field gets a seeded random legal card, the equipment stays (`equipmentMode: current`) and both modes
 * start from the same state. It measures; it changes nothing.
 *
 *   PowerShell:  $env:RECHECK_BENCH=1; $env:RECHECK_BUILD='b1'; $env:RECHECK_SEEDS=8; npx vitest run mcp/src/engine/optimize-recheck.bench.spec.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { resolveBuild } from '../../../src/app/build-analysis/engine/build-input';
import { socketOptions } from '../../../src/app/build-analysis/engine/complements';
import { SEARCH_SLOTS } from '../../../src/app/build-analysis/engine/search-slots';
import { applyPatch } from '../../../src/app/build-analysis/engine/variants';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';

const OUT = process.env['RECHECK_OUT'] ?? 'docs/benchmarks/optimize-budget/recheck';
const BOSS = 20994;
/** A second class: a physical bow build (Windhawk), the only fixture here that is not the Inquisitor of the budget benchmark. It starts bare and a first, small search dresses it (deterministic), so every seed perturbs the same equipment. */
const WINDHAWK = { class: 4257, level: 250, jobLevel: 50, stats: { agi: 100, dex: 130, pow: 60, con: 40 }, atkSkill: 'Crescive Bolt==5', gear: { weapon: 700016, weaponRefine: 11 } };
const FIXTURES: Record<string, unknown> = { b1: { preset: builds.b1.preset }, b2: { preset: builds.b2.preset }, wh: undefined };
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe.skipIf(!process.env['RECHECK_BENCH'])('socketRecheck safety', () => {
  const names = (process.env['RECHECK_BUILD'] ?? Object.keys(FIXTURES).join(',')).split(',');
  it.each(names)('%s', async (name) => {
    config.limits.maxSearchMs = 6 * 3_600_000;
    config.limits.maxSolves = 100_000;
    const dataset = loadDatasetFromDisk();
    const ops = createOptimizationOperations(dataset, config);
    let input = FIXTURES[name] as never;
    if (name === 'wh') {
      const dressed: any = await ops.optimizeBuild({ build: WINDHAWK, target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', maxSolves: 4000 } as never);
      input = { share: dressed.share } as never;
    }
    const seeds = Number(process.env['RECHECK_SEEDS'] ?? 6);
    
    const rb = resolveBuild(input, dataset);
    const rows: Record<string, unknown>[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const next = random(seed);
      const gear: Record<string, number> = {};
      for (const slot of SEARCH_SLOTS) {
        const itemId = (rb.model as any)[slot] as number;
        if (!(itemId > 0)) continue;
        for (const option of socketOptions(dataset, slot, itemId)) if (option.kind === 'card' && option.ids.length) gear[option.field] = option.ids[Math.floor(next() * option.ids.length)];
      }
      const start = applyPatch(input, { gear } as never);
      const run = async (socketRecheck: 'all' | 'touched' | 'near') => {
        const began = Date.now();
        const found: any = await ops.optimizeBuild({ build: start, target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', budgetMode: 'unified', maxSolves: 40000, effortBudget: 300, equipmentMode: 'current', socketRecheck, instrument: true } as never);
        const log: any[] = found.budgetReport.socketLog;
        const seen = new Set<string>();
        let pass = 1, second = 0, secondGain = 0;
        const first: string[] = [], later: string[] = [];
        for (const field of log) { const key = `${field.slot}.${field.field}`; if (seen.has(key) && pass === 1) pass = 2; seen.add(key); if (pass === 2) { second += field.tried; if (field.gainPct) { secondGain++; later.push(`${key} +${field.gainPct}% (rank ${field.winnerRank + 1}/${field.candidates})`); } } else if (field.gainPct) first.push(key); }
        return { finalDps: found.final.dps, baselineDps: found.baseline.dps, unique: found.budgetReport.budgeted.effective, socket: found.budgetReport.socket.used, secondPassEvaluations: second, secondPassGains: secondGain, firstPassChanged: first, secondPassChanged: later, wallMs: Date.now() - began, stopped: found.budgetReport.stoppedReason };
      };
      const all = await run('all');
      const touched = await run('touched');
      const near = await run('near');
      rows.push({ seed, fields: Object.keys(gear).length, all, touched, near, nearDiffPct: (near.finalDps / all.finalDps - 1) * 100, nearSaved: all.unique - near.unique, nearSavedMs: all.wallMs - near.wallMs, dpsDiffPct: (touched.finalDps / all.finalDps - 1) * 100, savedEvaluations: all.unique - touched.unique, savedMs: all.wallMs - touched.wallMs });
      console.info(`${name} seed ${seed}: all ${all.finalDps} touched ${touched.finalDps} (${rows.at(-1)!['dpsDiffPct']}%) saved ${all.unique - touched.unique}`);
    }
    // A complete search (equipment replaced, nothing perturbed) of the same build, all against near: the physical-class check of a real run.
    const real: Record<string, unknown> = {};
    if (name === 'wh') for (const socketRecheck of ['all', 'near'] as const) {
      const began = Date.now();
      const found: any = await ops.optimizeBuild({ build: input, target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', budgetMode: 'unified', maxSolves: 40000, effortBudget: 12000, socketRecheck, instrument: true } as never);
      real[socketRecheck] = { finalDps: found.final.dps, unique: found.budgetReport.budgeted.effective, socket: found.budgetReport.socket.used, wallMs: Date.now() - began };
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ name, target: BOSS, rows, real }, null, 1));
    expect(rows.length).toBe(seeds);
  }, 6 * 3_600_000);
});
