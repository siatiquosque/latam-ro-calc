/**
 * Last check before `socketRecheck: 'near'` becomes the default (docs/optimize/optimize-targeted-greedy.md, section 9). `all` and `near` run
 * the same search; they are identical until the second socket pass starts (the report records the value and the unique evaluations at
 * that moment, and the test asserts both are equal), so what differs afterwards is the effect of `socketRecheck` alone.
 *
 *   magic   a magic build (Magus, Crimson Rock), searched from bare equipment
 *   weapon  b1: a weapon with two card slots and three enchant slots, full search
 *   adv:*   adversarial starts: every card field random, equipment kept, three effort levels (different states after tuning); looks for a
 *           second-pass winner that the first pass ranked sixth or worse
 *
 *   PowerShell:  $env:NEAR_VALIDATION=1; $env:NEAR_JOBS='magic,weapon,adv:b1'; npx vitest run mcp/src/engine/optimize-near-validation.bench.spec.ts
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
import { createBuildContext } from '../../../src/app/build-analysis/operations/context';
import { evaluate } from '../../../src/app/build-analysis/engine/evaluate';
import { resolveTarget } from '../tools/calculate';
import { readFileSync } from 'node:fs';

const OUT = process.env['NEAR_OUT'] ?? 'docs/benchmarks/optimize-budget/recheck';
const BOSS = 20994;
const WINDHAWK = { class: 4257, level: 250, jobLevel: 50, stats: { agi: 100, dex: 130, pow: 60, con: 40 }, atkSkill: 'Crescive Bolt==5', gear: { weapon: 700016, weaponRefine: 11 } };
const MAGUS = { class: 4255, level: 250, jobLevel: 50, stats: { int: 130, dex: 130, spl: 60, wis: 40 }, atkSkill: 'Crimson Rock==5', gear: {} };
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const JOBS = ['magic', 'weapon', 'adv:b1', 'adv:b2', 'adv:wh', 'adv:magus', 'construct'];

describe.skipIf(!process.env['NEAR_VALIDATION'])('near validation', () => {
  const jobs = (process.env['NEAR_JOBS'] ?? JOBS.join(',')).split(',');
  it.each(jobs)('%s', async (job) => {
    config.limits.maxSearchMs = 6 * 3_600_000;
    config.limits.maxSolves = 100_000;
    const dataset = loadDatasetFromDisk();
    const ops = createOptimizationOperations(dataset, config);
    const common = { target: { monsterId: BOSS }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', budgetMode: 'unified', maxSolves: 40000, instrument: true };
    const optimize = (build: unknown, extra: Record<string, unknown>): Promise<any> => ops.optimizeBuild({ ...common, build, ...extra } as never) as Promise<any>;
    const dress = async (bare: unknown) => ({ share: (await optimize(bare, { maxSolves: 4000, budgetMode: 'legacy' })).share });

    const measure = async (build: unknown, extra: Record<string, unknown>, socketRecheck: 'all' | 'near') => {
      const began = Date.now();
      const found = await optimize(build, { ...extra, socketRecheck });
      const report = found.budgetReport;
      const seen = new Set<string>();
      let pass = 1;
      const second: { field: string; gainPct: number | null; firstPassRank: number | null; candidates: number; slotTouchedByFirstPass?: boolean }[] = [];
      const touchedFirst = new Set<string>();
      for (const field of report.socketLog as any[]) {
        const key = `${field.slot}.${field.field}`;
        if (seen.has(key) && pass === 1) pass = 2;
        seen.add(key);
        if (pass === 1 && field.gainPct) touchedFirst.add(field.slot);
        if (pass === 2 && field.gainPct) second.push({ field: key, gainPct: field.gainPct, firstPassRank: field.firstPassRank, candidates: field.candidates, slotTouchedByFirstPass: touchedFirst.has(field.slot) });
      }
      return { finalDps: found.final.dps as number, unique: report.budgeted.effective as number, wallMs: Date.now() - began, secondPass: report.secondPass as { startedWith: number; uniqueBefore: number; evaluations: number; ms: number } | null, secondPassChanges: second };
    };
    const compare = async (label: string, build: unknown, extra: Record<string, unknown>) => {
      const all = await measure(build, extra, 'all');
      const near = await measure(build, extra, 'near');
      // The state just before the second pass is the same in both runs: the comparison below isolates the re-check.
      // No second pass in either run means the first pass changed nothing: the runs are the same search, end to end.
      const sameState = (!all.secondPass && !near.secondPass && all.finalDps === near.finalDps && all.unique === near.unique) || (!!all.secondPass && !!near.secondPass && all.secondPass.startedWith === near.secondPass.startedWith && all.secondPass.uniqueBefore === near.secondPass.uniqueBefore);
      return { label, sameState, all, near, dpsDiffPct: (near.finalDps / all.finalDps - 1) * 100 };
    };

    const rows: Record<string, unknown>[] = [];
    if (job === 'magic') rows.push(await compare('magus, busca completa (esforço 12000)', await dress(MAGUS), { effortBudget: 12000 }));
    if (job === 'weapon') rows.push(await compare('b1, arma com 2 cartas e 3 encantamentos, busca completa (esforço 20000)', { preset: builds.b1.preset }, { effortBudget: 20000 }));
    if (job.startsWith('adv:')) {
      const name = job.slice(4);
      const input: unknown = name === 'wh' ? await dress(WINDHAWK) : name === 'magus' ? await dress(MAGUS) : { preset: (builds as any)[name].preset };
      const rb = resolveBuild(input as never, dataset);
      const next = random(1);
      const gear: Record<string, number> = {};
      for (const slot of SEARCH_SLOTS) {
        const itemId = (rb.model as any)[slot] as number;
        if (itemId > 0) for (const option of socketOptions(dataset, slot, itemId)) if (option.kind === 'card' && option.ids.length) gear[option.field] = option.ids[Math.floor(next() * option.ids.length)];
      }
      const start = applyPatch(input as never, { gear } as never);
      for (const plan of [300, 1500, 4000]) rows.push(await compare(`${name}, cartas sorteadas, equipamento mantido, esforço ${plan}`, start, { effortBudget: plan, equipmentMode: 'current' }));
    }
    if (job === 'construct') {
      // Looks for the case the first pass cannot see coming: a field F (earlier in the walk) whose best card, in the final build, ranked
      // seventh or worse while a later field G held another card x, so that the first pass settled F under x. When G then moves to its
      // best card, the second pass finds F's best card, which near no longer offers. The search is by direct evaluation, not by the optimizer.
      const { normalizeShare } = createBuildContext(config);
      const final = JSON.parse(readFileSync('docs/benchmarks/optimize-budget/runs/b1/plan-e20000.json', 'utf8')).result.share;
      const base = (await import('../../../src/app/build-analysis/engine/variants')).decodeOnce(await normalizeShare({ share: final } as never));
      const rb = resolveBuild(base, dataset);
      const monster = resolveTarget(dataset, BOSS).monster;
      const dpsWith = (gear: Record<string, number>) => { try { return evaluate(base, { gear } as never, dataset, monster, [], ['dps']).metrics['dps'] ?? 0; } catch { return -Infinity; } };
      const fields: { slot: string; field: string; ids: number[] }[] = [];
      for (const slot of SEARCH_SLOTS) { const itemId = (rb.model as any)[slot] as number; if (itemId > 0) for (const option of socketOptions(dataset, slot, itemId)) if (option.ids.length) fields.push({ slot, field: option.field, ids: option.ids }); }
      const pick = random(7);
      const found: { f: string; g: string; x: number; fStar: number; fFirst: number; rank: number }[] = [];
      for (const [i, f] of fields.entries()) {
        const star = (rb.model as any)[f.field] as number;
        if (!(star > 0)) continue;
        for (const g of fields.slice(i + 1)) {
          const gStar = (rb.model as any)[g.field] as number;
          const xs = [...g.ids].filter((id) => id !== gStar).sort(() => pick() - 0.5).slice(0, 8);
          for (const x of xs) {
            const scored = f.ids.map((id) => ({ id, dps: dpsWith({ [g.field]: x, [f.field]: id }) })).sort((a, b) => b.dps - a.dps);
            const rank = scored.findIndex((entry) => entry.id === star) + 1;
            if (scored[0].id !== star) found.push({ f: f.field, g: g.field, x, fStar: star, fFirst: scored[0].id, rank });
          }
        }
      }
      found.sort((a, b) => b.rank - a.rank);
      const worst = found[0];
      const row: Record<string, unknown> = { label: 'construção dirigida (b1)', candidatesChecked: found.length, ranksFound: found.slice(0, 12).map((entry) => `${entry.f}/${entry.g}: #${entry.rank}`), worst };
      if (worst && worst.rank >= 7) {
        // The start: the final build with G on x and F on the card that is best under x; the optimizer must walk back to the final build.
        const start = applyPatch(base, { gear: { [worst.g]: worst.x, [worst.f]: worst.fFirst } } as never);
        Object.assign(row, await compare(`construção dirigida (b1): ${worst.f} #${worst.rank} sob ${worst.g}`, start, { effortBudget: 300, equipmentMode: 'current' }));
      }
      rows.push(row);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `validation-${job.replace(':', '-')}.json`), JSON.stringify({ job, target: BOSS, rows }, null, 1));
    for (const row of rows) console.info(`${job} ${row['label']}: same state ${row['sameState']}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) if ('sameState' in row) expect(row['sameState'], String(row['label'])).toBe(true);
  }, 6 * 3_600_000);
});
