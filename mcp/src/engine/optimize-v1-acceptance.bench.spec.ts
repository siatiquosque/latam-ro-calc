/** Reproduce with V1_BENCH=1, V1_CASES/V1_BUDGETS to narrow. UI/MCP use the same core. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { engineCallCount } from 'src/app/build-analysis/engine/evaluate';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { GOAL, gearOnlyStart, MONSTERS, SCENARIO_EXACT } from './__tests__/jor-ab02-support';
import { METEOR_WEAK, METEOR_MONSTERS } from './__tests__/discovery-builds';

const dataset = loadDatasetFromDisk();
const replay: any = decodeReplay(loadReplayFixture('mg-pazzolino-field-arrow.rrf'));
const imported: any = replayToModel(replay, dataset.items);
const magic: any = { ...imported.model, selectedAtkSkill: 'Tornado Storm==5', skillFormulaVersion: 'pre-rebalance' };
const magicClass = dataset.classes.newInstance(magic.class);
magic.passiveSkillMap = Object.fromEntries(magicClass.passiveSkills.flatMap((skill: any) => {
  const id = SKILL_ID_BY_NAME[skill.name as keyof typeof SKILL_ID_BY_NAME];
  const level = id ? imported.learnedSkills[id] : 0;
  return level ? [[skill.name, level]] : [];
}));
// The same active setup used by the packet-validation fixture.
magic.activeSkillMap = { 'Recognized Spell': 1, 'Mystical Amplification': 10 };
const cases = [
  { name: 'jor-restricted', start: gearOnlyStart(), targets: MONSTERS, goal: { ...GOAL, margin: 0.1 }, constraints: SCENARIO_EXACT },
  { name: 'meister', start: METEOR_WEAK(), targets: METEOR_MONSTERS, goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: {} },
  { name: 'meister-sets', start: METEOR_WEAK(), targets: METEOR_MONSTERS, goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: { lockedSlots: ['weapon', 'shield'] } },
  { name: 'magus-replay', start: magic, targets: [21065], goal: { maxHitsToKill: 3, margin: 0.1 }, constraints: {} },
];
const only = process.env['V1_CASES']?.split(',');
const budgets = (process.env['V1_BUDGETS'] ?? '800').split(',').map(Number);
const modes = (process.env['V1_MODES'] ?? 'goal,general').split(',');
const runtime = process.env['V1_RUNTIME'] ?? 'mcp';
const procMode = (process.env['V1_PROC'] ?? 'off') as 'off' | 'average';
const maxSearchMs = runtime === 'ui' ? 60_000 : runtime === 'deadline' ? 5_000 : config.limits.maxSearchMs;
const OUT = 'docs/benchmarks/optimize-v1';
const file = `${OUT}/${process.env['V1_FILE'] ?? 'production.json'}`;

describe.skipIf(!process.env['V1_BENCH'])('V1 real limits', () => {
  it('measures actual requests and verifies returned links and patches', async () => {
    mkdirSync(OUT, { recursive: true });
    const rows: any[] = [];
    const ops = createOptimizationOperations(dataset, { ...config, limits: { ...config.limits, maxSearchMs } });
    for (const item of cases.filter(x => !only || only.includes(x.name))) for (const maxSolves of budgets) for (const mode of modes) {
      const started = Date.now(), before = engineCallCount();
      try {
        const chosenTargets = runtime === 'ui' ? item.targets.slice(0, 1) : item.targets;
        const args: any = { build: { preset: item.start }, targets: chosenTargets.map(monsterId => ({ monsterId })), objective: 'dps', procMode, ...(procMode === 'average' ? { procHitsPerSecond: 3 } : {}), maxSolves, instrument: true,
          ...(runtime === 'ui' ? { refine: 12, maxGrade: 'A', detail: true } : { constraints: item.constraints }),
          ...(process.env['V1_NARROW'] ? { slots: ['weapon'], candidates: { weapon: [item.start['weapon']] }, refine: 12, maxGrade: 'C' } : {}),
          ...(mode === 'goal' ? { goal: item.goal } : {}) };
        const found: any = await ops.optimizeBuild(args);
        const wallMs = Date.now() - started, engineCalls = engineCallCount() - before;
        const measured: any = await ops.evaluateVariants({ build: { share: found.share }, targets: args.targets, variants: [{ label: 'final', patch: {} }], metrics: ['dps'], validationMode: 'hypothetical', procMode, ...(procMode === 'average' ? { procHitsPerSecond: 3 } : {}) } as any);
        const direct: any = await ops.evaluateVariants({ build: args.build, targets: args.targets, variants: [{ label: 'patch', patch: found.patch }], metrics: ['dps'], validationMode: 'hypothetical', procMode, ...(procMode === 'average' ? { procHitsPerSecond: 3 } : {}) } as any);
        const average = (result: any) => { const values = result.results?.[0]?.perTarget?.map((x: any) => x.metrics.dps) ?? []; return values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null; };
        const reproduced = average(measured), patchDps = average(direct);
        const row = { name: item.name, mode, runtime, procMode, maxSearchMs, maxSolves, wallMs, engineCalls, budgetUsage: found.budgetUsage,
          baseline: found.baseline.dps, dps: found.final.dps, reproduced, patchDps, replayErrors: direct.errors ?? [], share: found.share, patch: found.patch, stopped: found.stopped ?? null,
          feasibility: found.feasibility, report: { phases: found.budgetReport.phases, phaseEngineMs: found.budgetReport.phaseEngineMs, stoppedReason: found.budgetReport.stoppedReason, wallClockMs: found.budgetReport.wallClockMs },
          replay: item.name === 'magus-replay' ? { equippedCount: imported.summary.equippedCount, skippedItems: imported.summary.skippedItems, skippedCards: imported.summary.skippedCards, skippedOptions: imported.summary.skippedOptions, traits: imported.summary.traits, learnedSkillCount: imported.summary.learnedSkillCount, activeSetup: magic.activeSkillMap, formulaVersion: magic.skillFormulaVersion } : undefined };
        rows.push(row);
        expect(engineCalls).toBe(found.budgetUsage.engineCalls);
      } catch (error) { rows.push({ name: item.name, mode, runtime, maxSearchMs, maxSolves, wallMs: Date.now() - started, error: String(error) }); }
      writeFileSync(file, JSON.stringify({ rows }, null, 2));
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
