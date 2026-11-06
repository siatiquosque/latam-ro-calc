/**
 * Jor_ab02 fixture: the four snapshots resolve, they kill what the study says they kill, and the gear-only starting state differs from the
 * original only where it should. Small budgets only; the benchmark is `goal-feasible.bench.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createCalculationOperations } from '../../../src/app/build-analysis/operations/calculate';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { MVP_CARD_IDS } from '../../../src/app/constants/mvp-cards';
import { audit, changedKeys, GEAR_KEY, GOAL, gearOnlyStart, JOR, MONSTERS, preset, SCENARIO } from './__tests__/jor-ab02-support';

const dataset = loadDatasetFromDisk();
const calc = createCalculationOperations(dataset, config);
const ops = createOptimizationOperations(dataset, config);
const kills = async (build: Record<string, any>) => Promise.all(MONSTERS.map(async (monsterId) => ((await calc.calculate({ build: { preset: build }, target: { monsterId } } as never)) as any).damage.skill.hitsToKill));

let maxSearchMs: number;
beforeEach(() => { maxSearchMs = config.limits.maxSearchMs; config.limits.maxSearchMs = 6 * 3_600_000; });
afterEach(() => { config.limits.maxSearchMs = maxSearchMs; });

describe('Jor_ab02 snapshots', () => {
  it('holds the four links as local presets', () => {
    expect(Object.values(JOR.builds).map((build) => build.link)).toEqual(['5hTy6pd', 'L7P7qcS', 'GIPObNf', '0TdaENM']);
    expect(MONSTERS).toEqual([21544, 21545, 21542, 21601, 21539]);
  });

  it('kills as the shared links do (original: 3, 4, 3, 3, 3 hits; every solution: 2 on all five)', async () => {
    expect(await kills(preset('original'))).toEqual([3, 4, 3, 3, 3]);
    for (const name of ['grauC', 'invernal', 'semGrau'] as const) expect(await kills(preset(name)), name).toEqual([2, 2, 2, 2, 2]);
  }, 120_000);

  it('the gear-only start changes only what is not equipment, and the reference gear stays reachable by gear moves', () => {
    const start = gearOnlyStart();
    const original = preset('original');
    // Against the original: attributes, a skill level, consumables. No equipment key.
    expect(changedKeys(start, original)).toEqual(['activeSkillMap', 'activeSkills', 'consumables', 'luk', 'vit']);
    expect(changedKeys(start, original).some((key) => GEAR_KEY.test(key))).toBe(false);
    // Against the "grau C" solution: only equipment.
    const gear = changedKeys(start, preset('grauC'));
    expect(gear.length).toBeGreaterThan(0);
    expect(gear.every((key) => GEAR_KEY.test(key))).toBe(true);
    expect(gear).toEqual(['accLeftCard', 'accRightCard', 'boot', 'bootEnchant2', 'bootEnchant3', 'bootRefine', 'headLower', 'weaponGrade']);
  });

  it('judges the starting states against the goal on every monster, with a small budget', async () => {
    const judge = async (build: Record<string, any>) => ((await ops.optimizeBuild({ build: { preset: build }, objective: 'dps', procMode: 'off', targets: MONSTERS.map((monsterId) => ({ monsterId })), goal: GOAL, maxSolves: 1, complements: false } as never)) as any).feasibility.baseline;
    expect((await judge(preset('original'))).targets.map((target: any) => target.status)).toEqual(Array(5).fill('infeasible'));
    for (const name of ['grauC', 'invernal'] as const) expect((await judge(preset(name))).status, name).toBe('feasible');
    expect((await judge(gearOnlyStart())).status).toBe('infeasible');
    // The worst monster is the one that needs the most hits: 21545 takes 4 from the original.
    expect((await judge(preset('original'))).worstTarget.monsterId).toBe(21545);
  }, 120_000);
});

describe('Jor_ab02 limits of the study', () => {
  const patch = (gear: Record<string, unknown>) => ({ gear } as never);

  it('the shared builds and the gear-only start respect the study (no MVP card, grade C, Abrasivo/Casaco Pirata, Oleum off, Insígnia and Cordão kept)', () => {
    for (const name of Object.keys(JOR.builds) as (keyof typeof JOR.builds)[]) expect(audit(dataset, preset(name)), name).toEqual([]);
    expect(audit(dataset, gearOnlyStart())).toEqual([]);
  });

  it('the audit does flag a break of each kind (it is not vacuous)', () => {
    const original = preset('original');
    const [mvpCard] = [...MVP_CARD_IDS];
    expect(audit(dataset, original, patch({ weaponGrade: 'B' }))).toEqual([expect.stringContaining('GRADE_ABOVE_MAX')]);
    expect(audit(dataset, original, patch({ weaponCard1: mvpCard }))).toEqual([expect.stringContaining('MVP_CARD_EXCLUDED')]);
    // 4865: Fatal 3, the enchant a search without the lock put on the Cordão do Inquisidor.
    expect(audit(dataset, original, patch({ accRightEnchant2: 4865 }))).toEqual([expect.stringContaining('FIELD_LOCK: accRightEnchant2')]);
    expect(audit(dataset, original, patch({ headUpperEnchant1: null }))).toEqual([expect.stringContaining('FIELD_LOCK: headUpperEnchant1')]);
    expect(audit(dataset, { ...original, activeSkillMap: { ...original['activeSkillMap'], 'Oleum Sanctum': 1 } })).toEqual([expect.stringContaining('FORBIDDEN_EFFECT_ACTIVE')]);
  });

  it('a search under the study\'s limits keeps them, and the damage verdict is not the reliability of the kill', async () => {
    const goal = { ...GOAL, margin: 0.1 };
    const targets = MONSTERS.map((monsterId) => ({ monsterId }));
    const start = gearOnlyStart();
    const found: any = await ops.optimizeBuild({ build: { preset: start }, objective: 'dps', procMode: 'off', budgetMode: 'unified', targets, goal, constraints: SCENARIO, maxSolves: 300 } as never);
    expect(found.feasibility.search.feasible).toBe(true);
    expect(found.feasibility.final.status).toBe('feasible');
    expect(audit(dataset, start, found.patch)).toEqual([]);
    // 2 hits at the minimum damage, but no crit or accuracy floor was asked: the kill is feasible in damage and still conditional.
    expect(found.feasibility.final.kill.damageFeasible).toBe(true);
    expect(found.feasibility.final.kill.reliability).toBe('conditional');
    const reference: any = await ops.optimizeBuild({ build: { preset: preset('invernal') }, objective: 'dps', procMode: 'off', targets, goal, constraints: SCENARIO, maxSolves: 1, complements: false } as never);
    expect(reference.feasibility.baseline.kill).toMatchObject({ damageFeasible: true, reliability: 'guaranteed' });
  }, 300_000);
});
