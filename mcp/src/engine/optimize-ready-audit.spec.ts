import { afterEach, expect, it, vi } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { evaluate, engineCallCount } from 'src/app/build-analysis/engine/evaluate';
import { JobBudget } from 'src/app/build-analysis/engine/job-budget';
import { solveController } from 'src/app/build-analysis/engine/solve';
import { judgeFeasibility } from 'src/app/build-analysis/engine/feasibility';
import { gearOnlyStart, MONSTERS } from './__tests__/jor-ab02-support';
import { applyPatch } from 'src/app/build-analysis/engine/variants';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { constraintViolations } from 'src/app/build-analysis/engine/feasibility';
import { prepareProcPolicy } from 'src/app/build-analysis/engine/proc';
import { calcDmgDpsDetailed } from 'src/app/utils/calc-dmg-dps';

const data = loadDatasetFromDisk();
const build = { preset: gearOnlyStart() };
const ops = createOptimizationOperations(data, config);
const args = { build, target: { monsterId: MONSTERS[0] }, slots: [] as string[], complements: false, procMode: 'off' as const, maxEngineCalls: 80 };
afterEach(() => vi.restoreAllMocks());

it('rejects unavailable equipment already worn, including a locked slot', async () => {
  for (const lockedSlots of [[], ['weapon']]) await expect(ops.optimizeBuild({ ...args, constraints: {
    unavailableIds: [build.preset['weapon']], lockedSlots,
  } })).rejects.toThrow(/ITEM_UNAVAILABLE/);
});

it('rejects an already active forbidden consumable and a selected forbidden effect', async () => {
  await expect(ops.optimizeBuild({ ...args, build: { ...build, consumables: [14536] }, constraints: { consumables: { forbidden: [14536] } } })).rejects.toThrow(/CONSUMABLE_FORBIDDEN/);
  await expect(ops.optimizeBuild({ ...args, effects: ['audit-proc'], constraints: { forbiddenEffects: ['audit-proc'] } })).rejects.toThrow(/FORBIDDEN_EFFECT_ACTIVE/);
});

it('counts every rotation skill recalculation, including restoration, against the same ceiling', () => {
  const skill = vi.spyOn(solveController, 'solveSkill');
  const budget = new JobBudget(20, 0);
  const start = engineCallCount();
  evaluate({ ...build, preset: { ...build.preset, rotation: [build.preset['selectedAtkSkill']] } }, undefined,
    data, data.monsters[MONSTERS[0]], [], ['rotationDps'], [], 1, false, budget);
  expect(budget.calls).toBe(skill.mock.calls.length);
  expect(engineCallCount() - start).toBe(skill.mock.calls.length);
  expect(budget.calls).toBeGreaterThan(1);
});

it('never starts a rotation recalculation without balance', () => {
  const skill = vi.spyOn(solveController, 'solveSkill');
  const budget = new JobBudget(1, 0);
  expect(() => evaluate({ ...build, preset: { ...build.preset, rotation: [build.preset['selectedAtkSkill']] } }, undefined,
    data, data.monsters[MONSTERS[0]], [], ['rotationDps'], [], 1, false, budget)).toThrow(/esgotado/);
  expect(skill).toHaveBeenCalledTimes(1);
});

it('never guarantees a proc-dependent kill or reports hard constraints met per target when violated', () => {
  const common = { dataset: data, base: build, build, issues: [], goal: { maxHitsToKill: 2 },
    readings: [{ monsterId: MONSTERS[0], hp: 100, metrics: { hitsToKill: 1, canCri: 0, hitChance: 100, conditionalEffects: 1 } }] };
  expect(judgeFeasibility(common).kill?.reliability).toBe('conditional');
  const invalid = judgeFeasibility({ ...common, constraints: { unavailableIds: [build.preset['weapon']] } });
  expect(invalid.targets[0].kill?.constraintsMet).toBe(false);
});

it('judges effects selected outside skill maps as forbidden too', () => {
  const found = judgeFeasibility({ dataset: data, base: build, build, issues: [], readings: [],
    effects: ['audit-proc'], constraints: { forbiddenEffects: ['audit-proc'] } } as any);
  expect(found.violations.map(v => v.code)).toContain('FORBIDDEN_EFFECT_ACTIVE');
});

it('keeps exclude distinct from unavailableIds when an excluded item is already equipped', async () => {
  const found: any = await ops.optimizeBuild({ ...args, exclude: [build.preset['weapon']], goal: { maxHitsToKill: 1, margin: 10 } });
  expect(resolveBuild(applyPatch(build, found.patch), data).model.weapon).toBe(build.preset['weapon']);
  expect(found.feasibility.final.status).toBe('infeasible');
  expect(found.feasibility.final.violations).toEqual([]);
});

it('removes an initial MVP card under none, but rejects a lock that prevents removal', async () => {
  const carded = { ...build, gear: { armorCard: 4302 } };
  const found: any = await ops.optimizeBuild({ ...args, build: carded, mvpPolicy: 'none', constraints: { mvpPolicy: 'none' } });
  expect(resolveBuild(applyPatch(carded, found.patch), data).model.armorCard).toBeFalsy();
  expect(found.feasibility.final.violations).toEqual([]);
  await expect(ops.optimizeBuild({ ...args, build: carded, constraints: { mvpPolicy: 'none', lockedSlots: ['armor'] } })).rejects.toThrow(/travada/);
});

it('preserves simultaneous piece/card and enchant/refine/grade locks even with replacement candidates', async () => {
  const fields = ['weapon', 'weaponCard1', 'weaponRefine', 'weaponGrade', 'accRightEnchant1'];
  const constraints = { lockedFields: fields };
  const found: any = await ops.optimizeBuild({ ...args, slots: ['weapon', 'accRight'], candidates: { weapon: [560026], accRight: [490181] }, constraints });
  const before = resolveBuild(build, data).model, after = resolveBuild(applyPatch(build, found.patch), data).model;
  for (const field of fields) expect(after[field]).toEqual(before[field]);
  expect(after.accRight).toBe(before.accRight);
  expect(constraintViolations(constraints, data, before, after)).toEqual([]);
});

it('rejects a forbidden buff already active without erasing the learned skill', async () => {
  await expect(ops.optimizeBuild({ ...args, build: { ...build, skills: { buffs: { 'Oleum Sanctum': 5 } } }, constraints: { forbiddenEffects: ['Oleum Sanctum'] } })).rejects.toThrow(/FORBIDDEN_EFFECT_ACTIVE/);
});

it('filters forbidden automatically offered proc states and keys the cache by that restriction', async () => {
  const off = evaluate(build, undefined, data, data.monsters[MONSTERS[0]], [], ['dps']);
  const names = off.solved.calc.chanceList.map(chance => chance.name).filter(Boolean);
  expect(names.length).toBeGreaterThan(0);
  for (const policy of [true, await prepareProcPolicy(data, 'average')]) {
    const blocked = evaluate(build, undefined, data, data.monsters[MONSTERS[0]], [], ['dps', 'conditionalEffects'], [], 1, policy, undefined, names);
    expect(blocked.procEvaluation.counted).toEqual([]);
    expect(blocked.metrics.dps).toBe(off.metrics.dps);
    expect(blocked.metrics.conditionalEffects).toBe(0);
  }
});

it('rejects repeated targets and invalid goal inputs in the shared operation too', async () => {
  await expect(ops.optimizeBuild({ ...args, target: undefined, targets: [{ monsterId: MONSTERS[0] }, { monsterId: MONSTERS[0] }] })).rejects.toThrow(/repetidos/);
  await expect(ops.optimizeBuild({ ...args, goal: { margin: 0.1 } })).rejects.toThrow(/maxHitsToKill/);
});

it('uses the engine critical-hit branch: at 100% crit the ordinary hit chance no longer gates the attack', () => {
  const damage = { min: 100, max: 100, cri: 100, criDmg: 500, hitsPerSec: 1 };
  expect(calcDmgDpsDetailed({ ...damage, accRate: 65 }).oneHitDps).toBe(calcDmgDpsDetailed({ ...damage, accRate: 100 }).oneHitDps);
  const report = judgeFeasibility({ dataset: data, base: build, build, issues: [], goal: { maxHitsToKill: 2 },
    readings: [{ monsterId: MONSTERS[0], hp: 1000, metrics: { hitsToKill: 2, canCri: 1, critRate: 100, minNoCri: 100, hitChance: 65 } }] });
  expect(report.kill?.reliability).toBe('guaranteed');
});
