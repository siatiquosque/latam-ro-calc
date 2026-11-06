/** Run JOB_COMPARE=1; fixtures and budgets are fixed, no network. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { gearOnlyStart, MONSTERS } from './__tests__/jor-ab02-support';

describe.skipIf(!process.env['JOB_COMPARE'])('equal actual-call comparison', () => {
  it('compares the legacy job, hard cap, timeout and cooperative cancel', async () => {
    const start = gearOnlyStart(), data = loadDatasetFromDisk(), rows: any[] = [];
    const targets = MONSTERS.slice(0, 2).map(monsterId => ({ monsterId }));
    const args: any = { build: { preset: start }, targets, objective: 'dps', procMode: 'off',
      slots: ['weapon'], candidates: { weapon: [start['weapon']] }, refine: 12, maxGrade: 'C',
      complements: false, maxSolves: 150, goal: { maxHitsToKill: 2 }, instrument: true };
    const run = async (name: string, extra: any = {}, ms = 45_000) => {
      const ops = createOptimizationOperations(data, { ...config, limits: { ...config.limits, maxSearchMs: ms } });
      const started = Date.now();
      const out: any = await ops.optimizeBuild({ ...args, ...extra });
      rows.push({ name, wallMs: Date.now() - started, baseDps: out.baseline.dps, dps: out.final.dps, calls: out.budgetUsage.engineCalls,
        verificationCalls: out.budgetUsage.feasibilityVerificationCalls, stoppedBy: out.budgetUsage.stoppedBy,
        status: out.feasibility.final.status, patch: out.patch, share: out.share, budgetUsage: out.budgetUsage });
      return out;
    };
    const legacy = await run('legacy');
    const cap = legacy.budgetUsage.engineCalls;
    const strict = await run('hard', { maxEngineCalls: cap });
    expect(strict.budgetUsage.engineCalls).toBeLessThanOrEqual(cap);
    await run('deadline', { maxEngineCalls: cap }, 1);
    const abort = new AbortController(), checkpoints: any[] = [];
    await run('cancel', { maxEngineCalls: cap, execution: { signal: abort.signal, onCheckpoint: (value: any) => {
      checkpoints.push(value); if (checkpoints.length > 1) abort.abort();
    } } });
    expect(checkpoints.length).toBeGreaterThan(1);
    expect(rows.at(-1).patch).toEqual(checkpoints.at(-1).patch);
    mkdirSync('docs/benchmarks/optimize-job-budget', { recursive: true });
    writeFileSync('docs/benchmarks/optimize-job-budget/comparison.json', JSON.stringify({ cap, rows }, null, 2));
  }, 300_000);
});
