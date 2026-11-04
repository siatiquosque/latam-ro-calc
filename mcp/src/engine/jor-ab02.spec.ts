/**
 * Jor_ab02 fixture: the four snapshots resolve, they kill what the study says they kill, and the gear-only starting state differs from the
 * original only where it should. Small budgets only; the benchmark is `goal-feasible.bench.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createCalculationOperations } from '../../../src/app/build-analysis/operations/calculate';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { changedKeys, GEAR_KEY, GOAL, gearOnlyStart, JOR, MONSTERS, preset } from './__tests__/jor-ab02-support';

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
  }, 120_000);
});
