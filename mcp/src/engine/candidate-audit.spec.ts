/**
 * The candidate audit (`instrument: true` → `candidateAudit`): the stations add up, nothing is counted twice, a constraint shows as an exclusion
 * and not as a failure of discovery, and a candidate the caller names gets a fate. Fixture: Jor_ab02 gear-only start, scenario rules, 300.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { GOAL, gearOnlyStart, MONSTERS, preset, SCENARIO_RULES } from './__tests__/jor-ab02-support';

vi.setConfig({ testTimeout: 300_000 });
const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const targets = MONSTERS.map((monsterId) => ({ monsterId }));
const goal = { ...GOAL, margin: 0.1 };
const run = (extra: Record<string, unknown> = {}) =>
  ops.optimizeBuild({ build: { preset: gearOnlyStart() }, objective: 'dps', procMode: 'off', budgetMode: 'unified', targets, goal, instrument: true, maxSolves: 300, ...extra, constraints: { ...SCENARIO_RULES, ...(extra['constraints'] as object) } } as never) as Promise<any>;

let maxSearchMs: number;
beforeEach(() => { maxSearchMs = config.limits.maxSearchMs; config.limits.maxSearchMs = 6 * 3_600_000; });
afterEach(() => { config.limits.maxSearchMs = maxSearchMs; });

describe('candidate audit', () => {
  it('the stations add up for every searched slot, and are monotone', async () => {
    const { candidateAudit } = await run();
    const slots = Object.entries(candidateAudit.pieces) as [string, any][];
    expect(slots.length).toBeGreaterThan(3);
    for (const [slot, row] of slots) {
      expect(row.catalog, slot).toBe(row.excluded.unavailable + row.excluded.mvp + row.notRelevant + row.eligible);
      expect(row.eligible, slot).toBe(row.truncated.byShare + row.truncated.byBareScore + row.pooled);
      expect(row.screened, slot).toBe(row.truncated.byBareScore + row.pooled);
      expect(row.pooled, slot).toBe(row.pooledNotEvaluated + row.evaluated);
      expect(row.evaluated, slot).toBe(row.evaluatedRejected + row.accepted);
      expect(row.evaluated, slot).toBeLessThanOrEqual(row.pooled);
    }
  });

  it('is deterministic and does not count a repeated evaluation twice (cache hits are not candidates)', async () => {
    const first = (await run()).candidateAudit;
    const second = (await run()).candidateAudit;
    expect(second.pieces).toEqual(first.pieces);
    const evaluated = Object.values(first.pieces).reduce((sum: number, row: any) => sum + row.evaluated, 0);
    const found = await run();
    expect(evaluated).toBeLessThanOrEqual(found.solves);
  });

  it('a constraint appears as an exclusion, a lock as a slot that was not searched, never as a failure of discovery', async () => {
    const { candidateAudit } = await run({ constraints: { lockedSlots: ['headUpper'], lockedFields: ['accRightEnchant1'] } });
    expect(candidateAudit.notSearched).toMatchObject({ headUpper: 'locked', accRight: 'pinned' });
    expect(candidateAudit.pieces['garment'].excluded.unavailable).toBeGreaterThanOrEqual(1); // Casaco Pirata (480174), unavailable in the study
    expect(candidateAudit.pieces['headUpper']).toBeUndefined();
    expect(candidateAudit.fields.find((field: any) => field.field === 'accRightEnchant1')).toMatchObject({ locked: true });
  });

  it('names what became of the candidates the caller knows', async () => {
    const reference = preset('invernal') as Record<string, number>;
    const start = gearOnlyStart() as Record<string, number>;
    const keys = ['boot', 'headLower', 'accLeftCard', 'accRightCard', 'bootEnchant2', 'bootEnchant3'].filter((key) => reference[key] && reference[key] !== start[key]);
    const known = keys.map((key) => ({ key, id: reference[key] }));
    const { candidateAudit } = await run({ knownCandidates: known });
    expect(candidateAudit.known.map((entry: any) => entry.key)).toEqual(keys);
    for (const entry of candidateAudit.known) expect(typeof entry.fate, entry.key).toBe('string');
    console.info('KNOWN', JSON.stringify(candidateAudit.known));
  });
});
