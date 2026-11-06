/**
 * The goal search is not an Inquisitor trick. The same contract on a magic class (Magus, Crimson Rock) and on a second physical class (Windhawk,
 * Crescive Bolt) with a farm goal, a goal that explicit constraints make unreachable, and several monsters where the worst one decides.
 * Builds: the bare ones of the near-validation benchmark (class, stats, skill, a weapon). Monsters (dataset): Mantis Caótico 20530, Ursinho Amarelo
 * 20256 and Mímico do Vazio 20779 (the strongest, 102 hits for the bare Magus, 26 for the bare Windhawk). Small budgets, nothing above 600.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { MAIN_ITEM_SLOTS } from '../../../src/app/build-analysis/engine/build-input';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';

const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const WINDHAWK = { class: 4257, level: 250, jobLevel: 50, stats: { agi: 100, dex: 130, pow: 60, con: 40 }, atkSkill: 'Crescive Bolt==5', gear: { weapon: 700016, weaponRefine: 11 } };
const MAGUS = { class: 4255, level: 250, jobLevel: 50, stats: { int: 130, dex: 130, spl: 60, wis: 40 }, atkSkill: 'Crimson Rock==5', gear: {} };
const MIMIC = 20779;
const MANTIS = 20530;
const BEAR = 20256;
const search = (build: unknown, extra: Record<string, unknown>) =>
  ops.optimizeBuild({ build, objective: 'dps', procMode: 'off', budgetMode: 'unified', refine: 12, maxGrade: 'A', ...extra } as never) as Promise<any>;
const one = (id: number) => [{ monsterId: id }];

let maxSearchMs: number;
beforeEach(() => { maxSearchMs = config.limits.maxSearchMs; config.limits.maxSearchMs = 6 * 3_600_000; });
afterEach(() => { config.limits.maxSearchMs = maxSearchMs; });

describe.each([['magic class (Magus)', MAGUS], ['second physical class (Windhawk)', WINDHAWK]] as const)('farm goal, %s', (_name, build) => {
  it('closes a 5-hit farm goal on the strongest monster, from a build that needs dozens', async () => {
    const found = await search(build, { targets: one(MIMIC), goal: { maxHitsToKill: 5 }, maxSolves: 300 });
    expect(found.feasibility.baseline.status).toBe('infeasible');
    expect(found.feasibility.final.status).toBe('feasible');
    expect(found.feasibility.search).toMatchObject({ feasible: true, startedFeasible: false });
    expect(found.feasibility.search.firstFeasible.evaluations).toBeLessThanOrEqual(found.solves);
    // The damage verdict and the reliability of the kill are separate answers.
    expect(found.feasibility.final.kill.damageFeasible).toBe(true);
    expect(found.feasibility.final.kill.reliability).toBeDefined();
  }, 300_000);

  it('is unreachable when explicit constraints leave nothing to move, and the report says the search ended rather than ran out', async () => {
    const goal = { maxHitsToKill: 5 };
    const open = await search(build, { targets: one(MIMIC), goal, maxSolves: 300 });
    expect(open.feasibility.final.status).toBe('feasible');

    const shut = await search(build, { targets: one(MIMIC), goal, constraints: { lockedSlots: [...MAIN_ITEM_SLOTS] }, maxSolves: 300 });
    expect(shut.steps).toHaveLength(0);
    expect(shut.feasibility.final.status).toBe('infeasible');
    expect(shut.feasibility.search).toMatchObject({ feasible: false, stoppedBy: 'completed' });
    expect(shut.feasibility.search.bestGap.worst).toBeGreaterThan(0);
    // The constraints are met (nothing moved): it is the goal that is out of reach under them, not an illegal build.
    expect(shut.feasibility.final.violations).toEqual([]);
  }, 300_000);
});

describe('the worst monster decides', () => {
  const targets = [BEAR, MANTIS, MIMIC].map((monsterId) => ({ monsterId }));
  const goal = { maxHitsToKill: 8 };

  it('with too little budget only the hardest monster is left, it is reported as the worst, and the search says it ran out', async () => {
    const found = await search(MAGUS, { targets, goal, maxSolves: 300 });
    const final = found.feasibility.final;
    expect(final.targets.map((target: any) => `${target.monsterId}:${target.status}`)).toEqual([`${BEAR}:feasible`, `${MANTIS}:feasible`, `${MIMIC}:infeasible`]);
    expect(final.worstTarget.monsterId).toBe(MIMIC);
    expect(found.feasibility.search).toMatchObject({ feasible: false, stoppedBy: 'search-budget' });
    // Only one target is unmet, so the worst distance and the total are the same number: nothing was averaged with the two that are met.
    const gap = found.feasibility.search.bestGap;
    expect(gap.worst).toBeGreaterThan(0);
    expect(gap.total).toBeCloseTo(gap.worst, 4);
    expect(found.feasibility.search.evaluations.counted).toBeLessThanOrEqual(300);
  }, 300_000);

  it('with the budget it needs, all three are met: the hardest one set the price', async () => {
    const found = await search(MAGUS, { targets, goal, maxSolves: 600 });
    expect(found.feasibility.final.status).toBe('feasible');
    expect(found.feasibility.search.feasible).toBe(true);
    // The hardest monster alone is closed with half the budget: the other two are what make the three-target search cost more.
    const alone = await search(MAGUS, { targets: one(MIMIC), goal, maxSolves: 300 });
    expect(alone.feasibility.search.feasible).toBe(true);
    expect(found.feasibility.search.firstFeasible.evaluations).toBeGreaterThan(alone.feasibility.search.firstFeasible.evaluations);
  }, 300_000);
});
