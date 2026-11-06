/**
 * The Greedy search with a goal: hard constraints stay a filter, the goal is a lexicographic ranking (feasible first, then the
 * distance to the goal, then DPS). Fixture: `b1` against the Jor_ab02 monsters of the dataset (Dolocaris de Um Olho 21544 dies in 2 hits
 * from the start, Dolocaris de Dois Olhos 21545 in 3), small budgets, nothing beyond 800 evaluations.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { compareStanding, goalStanding, improvesStanding, TargetReading } from '../../../src/app/build-analysis/engine/feasibility';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';

const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const b1 = { preset: (builds as Record<string, any>)['b1'].preset };
const ONE = 21544;
const TWO = 21545;
const THIRD = 21601;
const common = { objective: 'dps', procMode: 'off', budgetMode: 'unified', refine: 12, maxGrade: 'A' } as const;
const search = (extra: Record<string, unknown>) => ops.optimizeBuild({ build: b1, ...common, ...extra } as never) as Promise<any>;
const statuses = (report: any) => report.targets.map((target: any) => `${target.monsterId}:${target.status}`);

// The per-field time slices of the socket pass make the counts depend on the clock under load: lift the limit, as the other budget tests do.
let maxSearchMs: number;
beforeEach(() => { maxSearchMs = config.limits.maxSearchMs; config.limits.maxSearchMs = 6 * 3_600_000; });
afterEach(() => { config.limits.maxSearchMs = maxSearchMs; });

describe('goal ranking (pure)', () => {
  const read = (hp: number, min: number, hitsToKill: number, monsterId = 1): TargetReading => ({ monsterId, hp, metrics: { min, hitsToKill } });
  const goal = { maxHitsToKill: 2 };

  it('is scale free: the same relative shortfall gives the same distance at any HP or damage', () => {
    const small = goalStanding([read(1_000, 250, 4)], goal);
    const huge = goalStanding([read(2_000_000_000, 500_000_000, 4)], goal);
    expect(small.feasible).toBe(false);
    expect(small.worst).toBeCloseTo(huge.worst, 12);
    expect(small.total).toBeCloseTo(huge.total, 12);
  });

  it('uses HP / min, so a move that adds damage without crossing a whole hit still shows', () => {
    const before = goalStanding([read(1_000, 300, 4)], goal); // 3.33 hits -> 4
    const after = goalStanding([read(1_000, 400, 3)], goal); // 2.5 hits -> 3
    expect(before.feasible).toBe(false);
    expect(after.worst).toBeLessThan(before.worst);
    expect(goalStanding([read(1_000, 500, 2)], goal)).toEqual({ feasible: true, worst: 0, total: 0 });
  });

  it('is decided by the worst target, never by an average, and an unreadable number is never met', () => {
    const mixed = goalStanding([read(1_000, 1_000, 1, 1), read(1_000, 250, 4, 2)], goal);
    expect(mixed.feasible).toBe(false);
    expect(mixed.worst).toBeGreaterThan(0);
    expect(goalStanding([{ monsterId: 1, metrics: {} }], goal).feasible).toBe(false);
    expect(goalStanding([], goal).feasible).toBe(false);
    // A far-off rule is squashed below 1: it cannot drown the others.
    expect(goalStanding([read(1_000, 1, 1000)], goal).worst).toBeLessThan(1);
  });

  it('never gives up a build that meets the goal for one that does not, however much DPS it brings', () => {
    const viable = { feasible: true, worst: 0, total: 0, value: 100 };
    const strongButShort = { feasible: false, worst: 0.1, total: 0.1, value: 1_000_000 };
    expect(improvesStanding(strongButShort, viable)).toBe(false);
    expect(compareStanding(viable, strongButShort)).toBeGreaterThan(0);
    // Reaching the goal is taken even at a loss of DPS, and a better DPS needs more than the 0.1% floor.
    expect(improvesStanding({ ...viable, value: 1 }, { ...strongButShort })).toBe(true);
    expect(improvesStanding({ ...viable, value: 100.05 }, viable)).toBe(false);
    expect(improvesStanding({ ...viable, value: 101 }, viable)).toBe(true);
  });

  it('while no build meets the goal, the distance decides first and DPS only breaks a tie', () => {
    const far = { feasible: false, worst: 0.5, total: 0.5, value: 900 };
    const near = { feasible: false, worst: 0.2, total: 0.2, value: 100 };
    expect(improvesStanding(near, far)).toBe(true);
    expect(improvesStanding({ ...far, value: 9_000 }, far)).toBe(true); // equal distance, better DPS
    expect(improvesStanding({ ...far, worst: 0.6, value: 9_000 }, far)).toBe(false); // farther: no DPS buys it
  });
});

describe('Greedy with a goal', () => {
  it('walks through intermediate moves that do not meet the goal yet, as long as they close the distance', async () => {
    // Dolocaris de Dois Olhos dies in 3 hits and 2 are asked: no single move gets there, so a search that only takes moves that already
    // meet the goal never starts.
    const found = await search({ target: { monsterId: TWO }, goal: { maxHitsToKill: 2 }, maxSolves: 800 });
    expect(found.feasibility.baseline.status).toBe('infeasible');
    expect(found.steps.length).toBeGreaterThanOrEqual(2);
    expect(found.feasibility.final.status).toBe('feasible');
    expect(found.feasibility.search.feasible).toBe(true);
    expect(found.feasibility.search.firstFeasible.evaluations).toBeGreaterThan(1);
    expect(found.feasibility.search.firstFeasible.evaluations).toBeLessThanOrEqual(found.solves);
  }, 300_000);

  it('judges every target on its own: the main one meets the goal, the secondary does not, and the search closes the secondary', async () => {
    // The objective (HP) says nothing about damage and the secondary weighs a thousandth: only the goal can move the secondary. The
    // old reading (the goal's rule as a filter on the first target) leaves it where it was; the ranking walks it to the goal.
    const targets = [{ monsterId: ONE }, { monsterId: THIRD, weight: 0.001 }];
    // 600 before the secondary's reads were charged to the budget. Measured now: first feasible at 716 counted evaluations (900 still stops 2.7% short), so 1500.
    const args = { objective: 'hp', targets, maxSolves: 1500, slots: ['weapon', 'armor', 'headUpper', 'garment'] };
    const filtered = await search({ ...args, require: [{ metric: 'hitsToKill', max: 2 }], constraints: {} });
    expect(statuses(filtered.feasibility.final)).toEqual([`${ONE}:feasible`, `${THIRD}:infeasible`]);

    const found = await search({ ...args, goal: { maxHitsToKill: 2 } });
    expect(statuses(found.feasibility.baseline)).toEqual([`${ONE}:feasible`, `${THIRD}:infeasible`]);
    expect(statuses(found.feasibility.final)).toEqual([`${ONE}:feasible`, `${THIRD}:feasible`]);
    expect(found.feasibility.final.status).toBe('feasible');
    expect(found.feasibility.search.firstFeasible.evaluations).toBeLessThanOrEqual(found.solves);
  }, 300_000);

  it('a build that already meets the goal is not traded for more DPS at the price of the goal', async () => {
    const first = await search({ target: { monsterId: TWO }, goal: { maxHitsToKill: 2 }, maxSolves: 800 });
    expect(first.feasibility.final.status).toBe('feasible');
    const again = await search({ build: { share: first.share }, target: { monsterId: TWO }, goal: { maxHitsToKill: 2 }, maxSolves: 300 });
    expect(again.feasibility.baseline.status).toBe('feasible');
    expect(again.feasibility.final.status).toBe('feasible');
    expect(again.final.dps).toBeGreaterThanOrEqual(again.baseline.dps);
  }, 300_000);

  describe('what the other targets cost', () => {
    const targets = [ONE, TWO, THIRD].map((monsterId) => ({ monsterId }));

    it('the reads of the other targets spend the budget, and what comes after the search is reported apart', async () => {
      const found = await search({ targets, goal: { maxHitsToKill: 2 }, maxSolves: 300 });
      const { evaluations } = found.feasibility.search;
      expect(evaluations.otherTargets).toBeGreaterThan(0);
      expect(evaluations.otherTargets).toBeLessThan(evaluations.counted);
      expect(evaluations.counted).toBe(found.solves);
      expect(evaluations.counted).toBeLessThanOrEqual(300);
      // Every fresh evaluation made while searching is in `counted` (the +1 is the baseline); the rest is the reports after it.
      expect(evaluations.unique - evaluations.afterSearch).toBe(evaluations.counted - 1);
      // The independent judgement of the base and of the answer: one run per target each, mandatory, outside the budget.
      expect(evaluations.finalChecks).toBe(2 * targets.length);
    }, 300_000);

    it('with the budget spent it reads no more targets: the candidate stays unjudged and cannot win, and the claim matches the independent judgement', async () => {
      const found = await search({ targets, goal: { maxHitsToKill: 2 }, maxSolves: 120 });
      const { evaluations, feasible } = found.feasibility.search;
      expect(evaluations.skippedForBudget).toBeGreaterThan(0);
      expect(evaluations.counted).toBeLessThanOrEqual(120);
      // `search.feasible` is the search's own reading; the final judgement recomputes every target, so a skipped read can never turn into a feasible claim.
      expect(found.feasibility.final.status === 'feasible').toBe(feasible);
    }, 300_000);

    it('a single target has nothing else to read: the count is the one it always was', async () => {
      const found = await search({ target: { monsterId: TWO }, goal: { maxHitsToKill: 2 }, maxSolves: 300 });
      expect(found.feasibility.search.evaluations).toMatchObject({ otherTargets: 0, skippedForBudget: 0, counted: found.solves });
    }, 300_000);
  });

  it('without a goal rule the search is the one it always was (a goal with no rule changes nothing)', async () => {
    const plain = await search({ target: { monsterId: ONE }, maxSolves: 150 });
    const kind = await search({ target: { monsterId: ONE }, goal: { kind: 'dps' }, maxSolves: 150 });
    expect(kind.share).toBe(plain.share);
    expect(kind.steps).toEqual(plain.steps);
    expect(kind.final).toEqual(plain.final);
    expect(kind.solves).toBe(plain.solves);
  }, 300_000);
});
