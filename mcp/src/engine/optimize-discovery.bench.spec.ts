/**
 * Automatic discovery of the Optimize V1 on equipped builds (docs/optimize-discovery.md). For every case and budget it measures what the search found
 * and what the candidate generator did on the way (`candidateAudit`): feasibility per target, feasible@budget, best distance, DPS, real unique evaluations,
 * time, pieces changed, and the fate of every KNOWN reference candidate (was it in the permitted universe? reached? evaluated? accepted?).
 *
 * Cases (all equipped, none bare):
 *   jor-original    Jor_ab02 gear-only start, the study's rules (no field locks)         reference: "Armadura Invernal" gear
 *   jor-restricted  the same with the exact field locks (Insígnia and Cordão enchants)    reference: "Armadura Invernal" gear
 *   meister         `weak` Meister (physical, another class), 3 hits on four monsters     reference: `b1`, the same character with the full gear
 *   magus           a Magus with the real gear of `b1`, 20 hits on three monsters         no reference solution (coverage and feasibility only)
 *   meister-sets    `weak` Meister with the weapon, its cards and the shadow gear locked out: the rest must be found through armor/accessory/costume moves
 *                   (cards, enchants and set partners): a configuration where the gain depends on the combination of pieces
 * What is NOT a failure of discovery: a reference that needs attributes, consumables or skills the search does not move (Jor_ab02 original keeps them from "grau C").
 *
 *   PowerShell:  $env:DISCOVERY_BENCH=1; npx vitest run mcp/src/engine/optimize-discovery.bench.spec.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { audit, GOAL, gearOnlyStart, MONSTERS, preset, SCENARIO_EXACT, SCENARIO_RULES } from './__tests__/jor-ab02-support';
import { magusGeared, METEOR_MONSTERS, METEOR_REFERENCE, METEOR_WEAK } from './__tests__/discovery-builds';

const OUT = 'docs/benchmarks/optimize-discovery';
const budgets = (process.env['DISCOVERY_BENCH_BUDGETS'] ?? '300,800').split(',').map(Number);
const only = process.env['DISCOVERY_BENCH_CASES']?.split(',');
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
  { name: 'meister-sets', start: METEOR_WEAK(), targets: METEOR_MONSTERS, goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: { lockedSlots: ['weapon', 'shield'] }, reference: METEOR_REFERENCE(), skip: /^(costume|shadow|weapon)/, note: 'weapon and shield locked: the gain must come from armor, garment, boot, headgear and accessory combinations' },
];

const slim = (candidateAudit: any) => ({
  notSearched: candidateAudit.notSearched,
  pieces: Object.fromEntries(Object.entries(candidateAudit.pieces).map(([slot, row]: [string, any]) => [slot, { catalog: row.catalog, excluded: row.excluded, relevant: row.eligible + 0, notRelevant: row.notRelevant, screened: row.screened, truncated: row.truncated, pooled: row.pooled, evaluated: row.evaluated, accepted: row.accepted, pooledNotEvaluated: row.pooledNotEvaluated }])),
  fields: candidateAudit.fields,
  known: candidateAudit.known,
});

describe.skipIf(!process.env['DISCOVERY_BENCH'])('discovery', () => {
  it('measures the candidate coverage and the discovery on equipped builds', async () => {
    const saved = config.limits.maxSearchMs;
    config.limits.maxSearchMs = 6 * 3_600_000;
    const rows: Record<string, unknown>[] = [];
    try {
      for (const item of cases.filter((entry) => !only || only.includes(entry.name))) {
        const known = item.reference ? knownFrom(item.start, item.reference, item.skip ?? /$^/) : [];
        for (const maxSolves of budgets) {
          const started = Date.now();
          const result: any = await ops.optimizeBuild({ build: { preset: item.start }, objective: 'dps', procMode: 'off', budgetMode: 'unified', targets: item.targets.map((monsterId) => ({ monsterId })), goal: item.goal, constraints: item.constraints, instrument: true, maxSolves, ...(known.length ? { knownCandidates: known } : {}) } as never);
          const search = result.feasibility.search;
          const changed = Object.entries(result.patch?.gear ?? {}).filter(([key, value]) => blank(value) !== blank(item.start[key])).map(([key]) => key);
          const row = {
            case: item.name, note: item.note, maxSolves,
            feasible: search.feasible, startedFeasible: search.startedFeasible, firstFeasible: search.firstFeasible ?? null, bestGap: search.bestGap ?? null, stoppedBy: search.stoppedBy,
            statuses: result.feasibility.final.targets.map((target: any) => `${target.monsterId}:${target.status}`),
            evaluations: search.evaluations, dps: [result.baseline.dps, result.final.dps], wallMs: Date.now() - started, piecesChanged: changed.length, changed,
            ...(item.name.startsWith('jor') ? { studyRules: audit(dataset, item.start, result.patch) } : {}),
            candidateAudit: slim(result.candidateAudit),
          };
          rows.push(row);
          console.info(`DISCOVERY ${item.name} @${maxSolves}: feasible=${search.feasible} gap=${search.bestGap?.worst?.toFixed(3) ?? '-'} counted=${search.evaluations.counted} unique=${search.evaluations.unique} changed=${changed.length} dps=${Math.round(result.baseline.dps)}→${Math.round(result.final.dps)} ${row.wallMs}ms stop=${search.stoppedBy}`);
          console.info(`  KNOWN ${JSON.stringify((row.candidateAudit.known ?? []).map((entry: any) => `${entry.key}:${entry.fate}`))}`);
        }
      }
    } finally {
      config.limits.maxSearchMs = saved;
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/discovery.json`, JSON.stringify({ budgets, rows }, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
