import { describe, expect, it } from 'vitest';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import benchBuilds from './__tests__/fixtures/bench-builds.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from '../../../src/app/build-analysis/operations/optimize';
import { resolveBuild } from '../../../src/app/build-analysis/engine/build-input';
import { socketOptions } from '../../../src/app/build-analysis/engine/complements';
import { SEARCH_SLOTS } from '../../../src/app/build-analysis/engine/search-slots';
import { applyPatch } from '../../../src/app/build-analysis/engine/variants';

const ops = createOptimizationOperations(loadDatasetFromDisk(), config);
const run = (budgetMode: 'legacy' | 'unified', maxSolves: number) =>
  ops.optimizeBuild({ build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves, procMode: 'off', budgetMode }) as Promise<any>;

describe('budget of the equipment search', () => {
  it('unified mode pays the final socket pass from the same calculation budget', async () => {
    const maxSolves = 800;
    const unified = await run('unified', maxSolves);
    expect(unified.solves).toBeLessThanOrEqual(maxSolves + 5);
    expect(unified.final.dps).toBeGreaterThanOrEqual(unified.baseline.dps);
  }, 300_000);

  it('unified mode holds the cap at short budgets too, where the final pass is the largest share', async () => {
    for (const maxSolves of [150, 400]) {
      const found = await run('unified', maxSolves);
      expect(found.solves, `maxSolves ${maxSolves}`).toBeLessThanOrEqual(maxSolves + 5);
      expect(found.final.dps).toBeGreaterThanOrEqual(found.baseline.dps);
    }
  }, 300_000);

  it('legacy mode (the preserved baseline) is the default and keeps its own allowance for the pass', async () => {
    const legacy = await run('legacy', 800);
    const implicit = await ops.optimizeBuild({ build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 800, procMode: 'off' }) as any;
    expect(implicit.share).toBe(legacy.share);
  }, 300_000);

  describe('budget ledger (instrument: true)', () => {
    const instrumented = (budgetMode: 'legacy' | 'unified', maxSolves: number, extra: Record<string, unknown> = {}) =>
      ops.optimizeBuild({ build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves, procMode: 'off', budgetMode, instrument: true, ...extra } as any) as Promise<any>;
    const counters = (report: any) => [report.totalEngineCalls, report.uniqueEvaluations, report.uncachedEvaluations, report.cacheHits, report.discoveryEvaluations, report.searchEvaluations,
      report.socketEvaluations, report.finalVerificationEvaluations, report.wallClockMs, ...Object.values<any>(report.phases).flatMap((row) => Object.values<number>(row))];

    it('accounts for every phase, never goes negative and keeps hits, evaluations and engine calls apart', async () => {
      const found = await instrumented('unified', 400);
      const report = found.budgetReport;
      expect(counters(report).every((value: number) => value >= 0)).toBe(true);
      const phases = Object.values<any>(report.phases);
      expect(phases.reduce((sum, row) => sum + row.unique, 0)).toBe(report.uniqueEvaluations);
      expect(phases.reduce((sum, row) => sum + row.cacheHits, 0)).toBe(report.cacheHits);
      // One target and no averaged procs: one engine call per evaluation the cache did not have, and none per hit.
      expect(report.totalEngineCalls).toBe(report.uniqueEvaluations + report.uncachedEvaluations);
      expect(report.discoveryEvaluations + report.searchEvaluations + report.socketEvaluations).toBeGreaterThan(0);
      expect(typeof report.stoppedReason).toBe('string');
      expect(report.bestScoreByPhase.final).toBeGreaterThanOrEqual(report.bestScoreByPhase.baseline);
    }, 300_000);

    it('unified: the socket pass is inside the cap, which is never exceeded', async () => {
      const found = await instrumented('unified', 400);
      const report = found.budgetReport;
      expect(report.socketEvaluations).toBeGreaterThan(0);
      expect(report.budgeted.socketOutsideCap).toBe(0);
      expect(report.budgeted.inCap).toBeLessThanOrEqual(400);
      expect(report.budgeted.inCap).toBe(found.solves);
      expect(report.stoppedReason).toBe('search-budget');
    }, 300_000);

    it('legacy: the socket pass is outside the cap and is reported apart, so the real cost is the sum', async () => {
      const found = await instrumented('legacy', 400);
      const report = found.budgetReport;
      expect(report.budgeted.socketOutsideCap).toBeGreaterThan(0);
      expect(report.budgeted.effective).toBe(report.budgeted.inCap + report.budgeted.socketOutsideCap);
      expect(report.budgeted.socketOutsideCap).toBe(report.socketEvaluations);
    }, 300_000);

    it('effortBudget: unset it equals the search ceiling, and set it the cap only stops the walk (a prefix of the longer run)', async () => {
      const plain = await instrumented('unified', 600);
      const same = await instrumented('unified', 600, { effortBudget: plain.budgetReport.searchBudget });
      expect(same.budgetReport.checkpoints).toEqual(plain.budgetReport.checkpoints);
      expect(same.solves).toBe(plain.solves);
      const short = await instrumented('unified', 1000, { effortBudget: 2000 });
      const long = await instrumented('unified', 2000, { effortBudget: 2000 });
      const ceiling = short.budgetReport.searchBudget;
      // The accepted builds up to the short run's ceiling are the same ones, at the same cost: the checkpoints of a budget are reproducible.
      const upTo = (report: any) => report.checkpoints.filter((point: any) => point.phase !== 'socket' && point.spent < ceiling);
      expect(upTo(short.budgetReport)).toEqual(upTo(long.budgetReport));
      await expect(instrumented('unified', 600, { effortBudget: 0 })).rejects.toThrow('effortBudget');
    }, 600_000);

    it('socketRecheck touched: never costs more than the full re-check and keeps the result valid', async () => {
      const all = await instrumented('unified', 1500);
      const touched = await instrumented('unified', 1500, { socketRecheck: 'touched' });
      expect(touched.budgetReport.socketEvaluations).toBeLessThanOrEqual(all.budgetReport.socketEvaluations);
      expect(touched.budgetReport.budgeted.inCap).toBeLessThanOrEqual(1500);
      expect(touched.final.dps).toBeGreaterThan(0);
    }, 600_000);

    it('socketRecheck: a socket changed on one piece can move the best card of another; near keeps it, touched may not', async () => {
      // Adversarial start: every card field of the bench build gets a (seeded) random legal card, the equipment stays, and the effort
      // is tiny so the walk's own tuning does not repair it first. The first socket pass then changes many pieces, and the headgear
      // cards (headMiddle) are only worth another choice after the upper headgear changed.
      const dataset = loadDatasetFromDisk();
      const input = { preset: benchBuilds.b1.preset } as never;
      const rb = resolveBuild(input, dataset);
      let seed = 1;
      const next = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const gear: Record<string, number> = {};
      for (const slot of SEARCH_SLOTS) {
        const itemId = (rb.model as any)[slot] as number;
        if (itemId > 0) for (const option of socketOptions(dataset, slot, itemId)) if (option.kind === 'card' && option.ids.length) gear[option.field] = option.ids[Math.floor(next() * option.ids.length)];
      }
      const start = applyPatch(input, { gear } as never);
      const dps = async (socketRecheck: 'all' | 'touched' | 'near') => {
        const found: any = await ops.optimizeBuild({ build: start, target: { monsterId: 20994 }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', budgetMode: 'unified', maxSolves: 40000, effortBudget: 300, equipmentMode: 'current', socketRecheck, instrument: true } as never);
        return { dps: found.final.dps as number, evaluations: found.budgetReport.budgeted.effective as number };
      };
      // The socket pass gives each field a time slice: with a wall-clock limit the counts would depend on the machine's load.
      const limit = config.limits.maxSearchMs;
      config.limits.maxSearchMs = 6 * 3_600_000;
      let all, near, touched, byDefault: any;
      try {
      all = await dps('all');
      near = await dps('near');
      touched = await dps('touched');
      // near is the default; all stays available as the reference and the fallback.
      byDefault = await ops.optimizeBuild({ build: start, target: { monsterId: 20994 }, objective: 'dps', refine: 12, maxGrade: 'A', procMode: 'off', budgetMode: 'unified', maxSolves: 40000, effortBudget: 300, equipmentMode: 'current', instrument: true } as never);
      } finally { config.limits.maxSearchMs = limit; }
      expect(byDefault.final.dps).toBe(near.dps);
      expect(byDefault.budgetReport.budgeted.effective).toBe(near.evaluations);
      expect(near.dps).toBeCloseTo(all.dps, 0);
      expect(near.evaluations).toBeLessThan(all.evaluations);
      // touched is only an experiment: on this start it is allowed to lose the headMiddle card (-0.72% measured), never to win.
      expect(touched.dps).toBeLessThanOrEqual(all.dps + 1);
    }, 900_000);

    it('the reserve is an allocation: it moves the search ceiling and the total stays inside the cap', async () => {
      const small = await instrumented('unified', 400, { socketReserve: 0.1 });
      const large = await instrumented('unified', 400, { socketReserve: 0.4 });
      expect(small.budgetReport.searchBudget).toBe(360);
      expect(large.budgetReport.searchBudget).toBe(240);
      for (const found of [small, large]) expect(found.budgetReport.budgeted.inCap).toBeLessThanOrEqual(400);
      await expect(instrumented('unified', 400, { socketReserve: 0.95 })).rejects.toThrow(/socketReserve/);
    }, 300_000);

    it('is deterministic: the same input and conditions give the same build and the same counts', async () => {
      const first = await instrumented('unified', 400);
      const again = await instrumented('unified', 400);
      expect(again.share).toBe(first.share);
      expect(again.final.dps).toBe(first.final.dps);
      expect(again.budgetReport.uniqueEvaluations).toBe(first.budgetReport.uniqueEvaluations);
      expect(again.budgetReport.phases).toEqual(first.budgetReport.phases);
    }, 300_000);

    it('instrumenting changes nothing but the report; the final build is reproducible from its link', async () => {
      const plain = await run('unified', 400);
      const measured = await instrumented('unified', 400);
      const { budgetReport, ...rest } = measured;
      expect(budgetReport).toBeTruthy();
      expect(rest).toEqual(JSON.parse(JSON.stringify(plain, (key, value) => (key === 'budgetReport' ? undefined : value))));
      const again = await ops.evaluateVariants({ build: { share: measured.share }, variants: [{ label: 'final', patch: {} }], metrics: ['dps'], target: { monsterId: 20994 }, procMode: 'off' } as any) as any;
      expect(again.results[0].metrics.dps).toBeCloseTo(measured.final.dps, 0);
    }, 300_000);

    it('applies the same constraints to every strategy: mvpPolicy none keeps MVP cards out of legacy, unified and a restart', async () => {
      const first = await instrumented('unified', 400, { mvpPolicy: 'none' });
      const legacy = await instrumented('legacy', 400, { mvpPolicy: 'none' });
      const restart = await ops.optimizeBuild({ build: { share: first.share }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 400, procMode: 'off', budgetMode: 'unified', mvpPolicy: 'none' } as any) as any;
      for (const found of [first, legacy, restart]) {
        expect(found.mvpFree).toBe(true);
        expect(found.mvpPolicy).toBe('none');
      }
    }, 300_000);
  });
});
