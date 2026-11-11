/** A/B: PROGRESSIVE_BENCH=1; PROGRESSIVE_CASES and PROGRESSIVE_BUDGETS narrow the run. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { GOAL, gearOnlyStart, MONSTERS, preset, SCENARIO_EXACT, SCENARIO_RULES } from './__tests__/jor-ab02-support';
import { magusGeared, METEOR_MONSTERS, METEOR_REFERENCE, METEOR_WEAK } from './__tests__/discovery-builds';

const OUT = 'docs/benchmarks/optimize-progressive';
const budgets = (process.env['PROGRESSIVE_BUDGETS'] ?? '300,800,2000').split(',').map(Number);
const only = process.env['PROGRESSIVE_CASES']?.split(',');
const dataset = loadDatasetFromDisk();
const ops = createOptimizationOperations(dataset, config);
const blank = (value: unknown) => (value === null || value === undefined || value === 0 || value === '' ? null : value);

/** The gear keys where the reference differs from the start: the candidates the search is expected to be able to find. */
function knownFrom(start: Record<string, any>, reference: Record<string, any>, skip: RegExp) {
  return Object.keys(reference)
    .filter((key) => /^(head|armor|garment|boot|acc|weapon|shield)/.test(key) && !/(Refine|Grade)$/.test(key) && !skip.test(key))
    .filter((key) => blank(reference[key]) !== blank(start[key]) && typeof reference[key] === 'number' && reference[key] > 0)
    .map((key) => ({ key, id: reference[key] as number }));
}

interface Case { name: string; start: Record<string, any>; targets: number[]; goal: object; constraints: object; reference?: Record<string, any>; skip?: RegExp; note: string }
const cases: Case[] = [
  { name: 'jor-original', start: gearOnlyStart(), targets: MONSTERS, goal: { ...GOAL, margin: 0.1 }, constraints: SCENARIO_RULES, reference: preset('invernal'), note: 'the study rules, nothing locked beyond them' },
  { name: 'jor-restricted', start: gearOnlyStart(), targets: MONSTERS, goal: { ...GOAL, margin: 0.1 }, constraints: SCENARIO_EXACT, reference: preset('invernal'), note: 'exact field locks: Insígnia and Cordão enchants kept' },
  { name: 'meister', start: METEOR_WEAK(), targets: METEOR_MONSTERS, goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: {}, reference: METEOR_REFERENCE(), skip: /^(costume|shadow)/, note: 'physical, another class; reference = the full gear of the same character' },
  { name: 'magus', start: magusGeared(), targets: [20530, 20256, 20779], goal: { maxHitsToKill: 20, margin: 0.1 }, constraints: {}, note: 'magic; no reference solution' },
  { name: 'jor-composite', start: gearOnlyStart(), targets: MONSTERS, goal: { ...GOAL, margin: 0.1 }, constraints: SCENARIO_EXACT, reference: preset('invernal'), note: 'real reference requiring the Invernal armor and its enchants; restricted to armor to exercise the composite move' },
  { name: 'meister-sets', start: METEOR_WEAK(), targets: METEOR_MONSTERS, goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: { lockedSlots: ['weapon', 'shield'] }, reference: METEOR_REFERENCE(), skip: /^(costume|shadow|weapon)/, note: 'weapon and shield locked: the gain must come from armor, garment, boot, headgear and accessory combinations' },
];

describe.skipIf(!process.env['PROGRESSIVE_BENCH'])('progressive A/B on the same initial states', () => {
  it('records both schedules using the same real engine-call budget', async () => {
    const saved = config.limits.maxSearchMs;
    config.limits.maxSearchMs = 6 * 3_600_000;
    const rows: Record<string, any>[] = [];
    mkdirSync(OUT, { recursive: true });
    const file = `${OUT}/${process.env['PROGRESSIVE_FILE'] ?? 'ab.json'}`;
    try {
      for (const item of cases.filter(entry => !only || only.includes(entry.name))) {
        const known = item.reference ? knownFrom(item.start, item.reference, item.skip ?? /$^/) : [];
        for (const maxSolves of budgets) for (const exploration of ['greedy', 'progressive'] as const) {
          const started = Date.now();
          // Equal total cap, including reporting and the mandatory base/final target checks.
          // The fixed reserve is conservative and identical for both arms of each fixture.
          const searchCap = maxSolves - (10 * item.targets.length + 20);
          const scope = item.name === 'jor-composite' ? { slots: ['armor'], candidates: { armor: [item.start['armor'], item.reference!['armor']] } } : {};
          const result: any = await ops.optimizeBuild({ build: { preset: item.start }, objective: 'dps', procMode: 'off', budgetMode: 'unified', budgetAccounting: 'engine', exploration,
            targets: item.targets.map(monsterId => ({ monsterId })), goal: item.goal, constraints: item.constraints, instrument: true, maxSolves: searchCap, knownCandidates: known, ...scope } as never);
          const search = result.feasibility.search;
          const changed = Object.entries(result.patch?.gear ?? {}).filter(([key, value]) => blank(value) !== blank(item.start[key])).map(([key]) => key);
          const slots = result.budgetReport.slotLog.filter((row: any) => row.discovered > 0);
          const pieceAudit = Object.values(result.candidateAudit.pieces) as any[];
          const row = { case: item.name, exploration, maxSolves, searchCap, feasible: search.feasible, startedFeasible: search.startedFeasible,
            firstFeasible: search.firstFeasible ?? null, bestGap: search.bestGap ?? null, stoppedBy: search.stoppedBy,
            statuses: result.feasibility.final.targets.map((target: any) => `${target.monsterId}:${target.status}`),
            violations: result.feasibility.final.violations, countedEngineCalls: result.solves, actualEngineCalls: Object.entries(result.budgetReport.phases).filter(([name]) => name !== 'report').reduce((n: number, [, phase]: [string, any]) => n + phase.engineCalls, 0),
            evaluations: search.evaluations, reportEngineCalls: result.budgetReport.phases.report.engineCalls, finalChecks: search.evaluations.finalChecks, dps: result.final.dps, wallMs: Date.now() - started, changed,
            slotsReached: [...new Set(slots.map((row: any) => row.slot))], slotLog: result.budgetReport.slotLog,
            candidates: { screened: pieceAudit.reduce((n, p) => n + p.screened, 0), pooled: pieceAudit.reduce((n, p) => n + p.pooled, 0), evaluated: pieceAudit.reduce((n, p) => n + p.evaluated, 0), accepted: pieceAudit.reduce((n, p) => n + p.accepted, 0) },
            known: result.candidateAudit.known, fields: result.candidateAudit.fields, patch: result.patch };
          rows.push(row);
          writeFileSync(file, JSON.stringify({ accounting: 'total engine calls including aggregate targets, reports, and mandatory final checks; proc off', budgets, rows }, null, 2));
          console.info(`AB ${item.name} ${exploration} @${maxSolves} feasible=${row.feasible} gap=${row.bestGap?.worst ?? 0} dps=${row.dps} calls=${row.countedEngineCalls}/${row.actualEngineCalls} slots=${row.slotsReached.length} ${row.wallMs}ms`);
          expect(row.countedEngineCalls).toBe(row.actualEngineCalls);
          expect(row.countedEngineCalls + row.reportEngineCalls + row.finalChecks).toBeLessThanOrEqual(maxSolves);
          expect(row.violations).toEqual([]);
          expect(row.feasible).toBe(row.statuses.every((status: string) => status.endsWith(':feasible')));
        }
      }
    } finally { config.limits.maxSearchMs = saved; }
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
