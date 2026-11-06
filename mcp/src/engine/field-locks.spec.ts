/**
 * Field locks (`constraints.lockedFields`): a model key stays exactly as the base build has it, while the rest of its slot stays open.
 * A locked card, enchant, refine or grade pins the worn piece (they only make sense on it); `lockedSlots` still freezes a whole slot.
 * Every search path is covered: the walk, the sockets of the walk, the last pass over the sockets, and the judgement of the answer.
 * Fixture: Jor_ab02 (Inquisidor), the study's rules without its slot locks, small budgets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { constraintViolations } from '../../../src/app/build-analysis/engine/feasibility';
import { constraintSpecSchema } from '../../../src/app/build-analysis/engine/goal-spec';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { GOAL, gearOnlyStart, MONSTERS, SCENARIO_RULES } from './__tests__/jor-ab02-support';

vi.setConfig({ testTimeout: 300_000 });
const dataset = loadDatasetFromDisk();
const ops = createOptimizationOperations(dataset, config);
const start = gearOnlyStart();
const targets = MONSTERS.map((monsterId) => ({ monsterId }));
const goal = { ...GOAL, margin: 0.1 };
/** 800 evaluations is where the unlocked search starts reaching the Cordão's enchants (it does not at 300). */
const run = (constraints: Record<string, unknown>, maxSolves = 800, withGoal = true) =>
  ops.optimizeBuild({ build: { preset: start }, objective: 'dps', procMode: 'off', budgetMode: 'unified', targets, ...(withGoal ? { goal } : {}), constraints, maxSolves } as never) as Promise<any>;
const blank = (value: unknown) => (value === null || value === undefined || value === 0 || value === '' ? null : value);
/** The fields whose value the answer changed (the patch repeats the anchor piece with its own value). */
const touched = (found: any) => Object.entries(found.patch?.gear ?? {}).filter(([key, value]) => blank(value) !== blank((start as any)[key])).map(([key]) => key);
const ENCHANTS = ['accRightEnchant1', 'accRightEnchant2', 'accRightEnchant3', 'headUpperEnchant1'];

let maxSearchMs: number;
beforeEach(() => { maxSearchMs = config.limits.maxSearchMs; config.limits.maxSearchMs = 6 * 3_600_000; });
afterEach(() => { config.limits.maxSearchMs = maxSearchMs; });

describe('the contract', () => {
  it('accepts the model keys of a piece and refuses anything else', () => {
    expect(constraintSpecSchema.safeParse({ lockedFields: ['weapon', 'weaponCard1', 'accRightEnchant2', 'weaponRefine', 'weaponGrade'] }).success).toBe(true);
    expect(constraintSpecSchema.safeParse({ lockedFields: ['str'] }).success).toBe(false);
    expect(constraintSpecSchema.safeParse({ lockedFields: ['weaponCard9'] }).success).toBe(false);
  });

  it('the judgement names a locked field that moved, and nothing else in the slot', () => {
    const base: any = { ...start, accRightEnchant2: 4800, accRightCard: 4001 };
    const lock = { lockedFields: ['accRightEnchant2'] };
    expect(constraintViolations(lock, dataset, base, { ...base, accRightCard: 4002 })).toEqual([]);
    expect(constraintViolations(lock, dataset, base, { ...base, accRightEnchant2: 4865 }).map((v) => v.code)).toEqual(['LOCKED_FIELD_CHANGED']);
    expect(constraintViolations(lock, dataset, base, { ...base, accRightEnchant2: null }).map((v) => v.code)).toEqual(['LOCKED_FIELD_CHANGED']);
  });
});

describe('what a search does with a field lock', () => {
  it('control: without field locks the rules of the study still let the search touch the Cordão enchants and a card', async () => {
    const found = await run({ ...SCENARIO_RULES });
    expect(found.feasibility.final.status).toBe('feasible');
    expect(touched(found)).toEqual(expect.arrayContaining(['accRightEnchant2', 'accRightEnchant3']));
    expect(touched(await run({ ...SCENARIO_RULES }, 300, false))).toContain('weaponCard1');
  });

  it('keeps the locked enchants and lets the rest of the slot move', async () => {
    const found = await run({ ...SCENARIO_RULES, lockedFields: ENCHANTS });
    expect(found.feasibility.final.violations).toEqual([]);
    expect(touched(found).filter((key) => ENCHANTS.includes(key))).toEqual([]);
    expect(found.feasibility.final.status).toBe('feasible');
    expect(touched(found).length).toBeGreaterThan(0);
  });

  it('a locked card is kept through the walk, its sockets and the last pass over them, and the other cards of the piece stay open', async () => {
    const found = await run({ ...SCENARIO_RULES, lockedFields: ['weaponCard1'] }, 300, false);
    expect(found.feasibility.final.violations).toEqual([]);
    expect(touched(found)).not.toContain('weaponCard1');
    expect(touched(found)).not.toContain('weapon');
  });

  it('a locked item keeps the piece; its refine, grade and sockets stay open', async () => {
    const found = await run({ ...SCENARIO_RULES, lockedFields: ['weapon'] }, 300);
    expect(found.feasibility.final.violations).toEqual([]);
    expect(touched(found)).not.toContain('weapon');
    // The Garra Primordial-LT goes from +11 without grade to +12 grade C in every answer of the study.
    expect(touched(found).some((key) => key === 'weaponRefine' || key === 'weaponGrade')).toBe(true);
  });

  it('a locked refine or grade is kept and pins the piece; the other pieces are free', async () => {
    const found = await run({ ...SCENARIO_RULES, lockedFields: ['weaponRefine', 'weaponGrade'] }, 300);
    expect(found.feasibility.final.violations).toEqual([]);
    expect(touched(found).filter((key) => ['weapon', 'weaponRefine', 'weaponGrade'].includes(key))).toEqual([]);
    expect(touched(found).length).toBeGreaterThan(0);
  });

  it('slot locks still freeze the whole slot, and combine with field locks', async () => {
    const found = await run({ ...SCENARIO_RULES, lockedSlots: ['headUpper'], lockedFields: ['accRightEnchant2', 'accRightEnchant3'] });
    expect(found.feasibility.final.violations).toEqual([]);
    expect(touched(found).filter((key) => key.startsWith('headUpper') || /^accRightEnchant[23]$/.test(key))).toEqual([]);
  });
});
