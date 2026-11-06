import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { FeasibilityInput, judgeFeasibility } from 'src/app/build-analysis/engine/feasibility';
import { adaptSpecs, constraintSpecSchema, goalSpecSchema, SpecFields } from 'src/app/build-analysis/engine/goal-spec';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { evaluate } from 'src/app/build-analysis/engine/evaluate';
import { decodeOnce } from 'src/app/build-analysis/engine/variants';

const dataset = loadDatasetFromDisk();
const base = (builds as Record<string, any>)['b1'];
const read = (monsterId: number, metrics: Record<string, number | undefined>, hp?: number) => ({ monsterId, name: `m${monsterId}`, hp, metrics });
// Legality is not what these cases test: `issues: []` isolates the goal and the constraints.
const judge = (extra: Partial<FeasibilityInput>) => judgeFeasibility({ dataset, base, build: base, readings: [], issues: [], ...extra });

describe('GoalSpec and ConstraintSpec contract', () => {
  it('rejects a margin without a hit limit, repeated targets and a consumable both allowed and forbidden', () => {
    expect(goalSpecSchema.safeParse({ margin: 0.1 }).success).toBe(false);
    expect(goalSpecSchema.safeParse({ targets: [{ monsterId: 1 }, { monsterId: 1 }] }).success).toBe(false);
    expect(goalSpecSchema.safeParse({ maxHitsToKill: 2, margin: 0.1, targets: [{ monsterId: 1 }, { monsterId: 2 }] }).success).toBe(true);
    expect(constraintSpecSchema.safeParse({ consumables: { allowed: [1], forbidden: [1] } }).success).toBe(false);
    expect(constraintSpecSchema.safeParse({ lockedSlots: ['notASlot'] }).success).toBe(false);
    expect(constraintSpecSchema.safeParse({ lockedSlots: ['weapon'], mvpPolicy: 'none' }).success).toBe(true);
  });

  it('adapts the older fields without changing a call that has no spec', () => {
    const plain = { build: { atkSkill: 'a==1' }, lock: ['armor'], require: [{ metric: 'hp' as const, min: 1 }] };
    expect(adaptSpecs(plain)).toBe(plain);

    const adapted = adaptSpecs<SpecFields>({
      ...plain,
      mvpPolicy: 'allow' as const,
      goal: { kind: 'burst' as const, skill: 'b==2', maxHitsToKill: 2, targets: [{ monsterId: 7 }] },
      constraints: { mvpPolicy: 'none' as const, lockedSlots: ['weapon'], unavailableIds: [14536], maxGrade: 'C' as const },
    });
    expect(adapted.build?.atkSkill).toBe('b==2');
    expect(adapted.targets).toEqual([{ monsterId: 7 }]);
    expect(adapted.profile).toBe('burst');
    expect(adapted.mvpPolicy).toBe('allow'); // the explicit flag wins over the spec
    expect(adapted.maxGrade).toBe('C');
    expect(adapted.lock).toEqual(['armor', 'weapon']);
    expect(adapted.exclude).toEqual([14536]);
    expect(adapted.require).toEqual([{ metric: 'hp', min: 1 }, { metric: 'hitsToKill', max: 2 }]);
  });
});

describe('FeasibilityEvaluator', () => {
  const goal = { maxHitsToKill: 2, minCritRate: 50 };

  it('judges every target on its own and names the worst one', () => {
    const report = judge({ goal, readings: [read(1, { hitsToKill: 2, critRate: 80 }), read(2, { hitsToKill: 3, critRate: 80 }), read(3, { hitsToKill: 5, critRate: 60 })] });
    expect(report.status).toBe('infeasible');
    expect(report.targets.map((target) => [target.monsterId, target.status])).toEqual([[1, 'feasible'], [2, 'infeasible'], [3, 'infeasible']]);
    expect(report.targets[1].violations[0]).toMatchObject({ metric: 'hitsToKill', actual: 3, required: { max: 2 } });
    expect(report.worstTarget?.monsterId).toBe(3);
  });

  it('is feasible only when every target meets every rule', () => {
    const report = judge({ goal, readings: [read(1, { hitsToKill: 1, critRate: 90 }), read(2, { hitsToKill: 2, critRate: 50 })] });
    expect(report.status).toBe('feasible');
    expect(report.worstTarget?.monsterId).toBe(2);
  });

  it('never counts an unreadable number as met', () => {
    expect(judge({ goal, readings: [read(1, { hitsToKill: 1 })] }).status).toBe('unknown');
    expect(judge({ goal, readings: [] }).status).toBe('unknown');
    // A target that surely fails decides the verdict over one that could not be read.
    expect(judge({ goal, readings: [read(1, { hitsToKill: 1 }), read(2, { hitsToKill: 9, critRate: 99 })] }).status).toBe('infeasible');
  });

  it('applies the older require rules the same way', () => {
    expect(judge({ require: [{ metric: 'hp', min: 5000 }], readings: [read(1, { hp: 4000 })] }).status).toBe('infeasible');
    expect(judge({ require: [{ metric: 'hp', min: 5000 }], readings: [read(1, {})] }).status).toBe('unknown');
  });

  it('asks the weakest hit to cover the HP with the margin', () => {
    const asked = { maxHitsToKill: 2, margin: 0.25 };
    expect(judge({ goal: asked, readings: [read(1, { hitsToKill: 2, min: 1000 }, 1500)] }).status).toBe('feasible');
    expect(judge({ goal: asked, readings: [read(1, { hitsToKill: 2, min: 900 }, 1500)] }).status).toBe('infeasible');
    expect(judge({ goal: asked, readings: [read(1, { hitsToKill: 2, min: 900 })] }).status).toBe('unknown');
  });

  describe('damage goal, explicit constraints and the certainty of the kill', () => {
    // Per-target figures a farm check reads. HP 1000 and 2 hits: a hit of 500 kills in 2.
    const kill = (goal: object, metrics: Record<string, number | undefined>, hp = 1000) => judge({ goal: { maxHitsToKill: 2, ...goal }, readings: [read(1, metrics, hp)] });
    // A skill that cannot crit: its minimum is the non-crit minimum.
    const noCrit = { hitsToKill: 2, min: 500, canCri: 0, critRate: 0, hitChance: 100 };
    // A skill that can crit: the engine's minimum is the crit path, the non-crit minimum is apart.
    const canCrit = { hitsToKill: 2, min: 600, canCri: 1, hitChance: 100 };

    it('margin defaults to 0, and above 0 asks more of the damage', () => {
      expect(kill({}, { ...noCrit, min: 700 }, 1500).kill?.damageFeasible).toBe(true); // margin 0 trusts the engine hitsToKill
      expect(kill({ margin: 0 }, noCrit).status).toBe('feasible');
      expect(kill({ margin: 0.1 }, { ...noCrit, min: 500 }).kill?.damageFeasible).toBe(false); // 2 × 500 < 1100
      expect(kill({ margin: 0.1 }, { ...noCrit, min: 600 }).kill?.damageFeasible).toBe(true);
      expect(kill({ margin: 0.1 }, { ...noCrit, min: undefined }).kill?.damageFeasible).toBeNull();
    });

    it('a skill that kills without a crit is guaranteed, with no accuracy or crit limit asked', () => {
      const report = kill({}, noCrit);
      expect(report.status).toBe('feasible');
      expect(report.kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'guaranteed' });
    });

    it('a kill that rests on crits is only conditional, even when the crit limit the user set is met', () => {
      const dependsOnCrit = { ...canCrit, critRate: 80, minNoCri: 300 }; // 2 × 300 < 1000
      const report = kill({ minCritRate: 80 }, dependsOnCrit);
      expect(report.status).toBe('feasible'); // the damage goal and the limit hold
      expect(report.kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'conditional' });
      expect(report.targets[0].kill?.reasons.join(' ')).toMatch(/depende de críticos/);
      // Without any limit the answer is the same: nothing is promised by a limit.
      expect(kill({}, dependsOnCrit).kill?.reliability).toBe('conditional');
    });

    it('a crit below 100% does not matter when the non-crit hit already kills', () => {
      const report = kill({}, { ...canCrit, critRate: 30, minNoCri: 500 });
      expect(report.kill?.reliability).toBe('guaranteed');
    });

    it('a crit chance of 100% makes a crit-only kill certain (it is the engine figure, not a rule)', () => {
      expect(kill({}, { ...canCrit, critRate: 100, minNoCri: 300 }).kill?.reliability).toBe('guaranteed');
    });

    it('a hit chance below 100% makes the kill conditional, and a limit on it is a constraint', () => {
      const shaky = { ...noCrit, hitChance: 85, hit: 150 };
      expect(kill({}, shaky).kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'conditional' });
      expect(kill({}, shaky).targets[0].kill?.reasons.join(' ')).toMatch(/85%/);

      // Not enough accuracy for the floor the user set: the constraint fails (the build is not a solution), the damage still counts.
      const short = kill({ minAccuracy: 200 }, shaky);
      expect(short.status).toBe('infeasible');
      expect(short.kill).toEqual({ damageFeasible: true, constraintsMet: false, reliability: 'conditional' });
    });

    it('keeps the accuracy limit (a constraint) apart from the hit chance (certainty)', () => {
      // The skill always hits (hitChance 100) but the build misses the floor the user set: constraint broken, kill still certain.
      const floor = kill({ minAccuracy: 200 }, { ...noCrit, hit: 150 });
      expect(floor.status).toBe('infeasible');
      expect(floor.kill).toEqual({ damageFeasible: true, constraintsMet: false, reliability: 'guaranteed' });
      // The floor is met but the skill can miss: constraint satisfied, kill not certain.
      const meets = kill({ minAccuracy: 200 }, { ...noCrit, hit: 250, hitChance: 90 });
      expect(meets.status).toBe('feasible');
      expect(meets.kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'conditional' });
      // The accuracy could not be read: the constraint is unknown, never met.
      expect(kill({ minAccuracy: 200 }, noCrit).kill).toEqual({ damageFeasible: true, constraintsMet: null, reliability: 'guaranteed' });
    });

    it('without a non-crit figure for a skill that can crit, the kill is never guaranteed', () => {
      const report = kill({}, { ...canCrit, critRate: 100 }); // minNoCri missing
      expect(report.status).toBe('feasible');
      expect(report.kill).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'unknown' });
      expect(kill({}, { ...noCrit, canCri: undefined }).kill?.reliability).toBe('unknown');
      expect(kill({}, { ...noCrit, hitChance: undefined }).kill?.reliability).toBe('unknown');
      // A crit-only kill whose crit chance cannot be read is not guaranteed either.
      expect(kill({}, { ...canCrit, minNoCri: 300, critRate: undefined }).kill?.reliability).toBe('unknown');
    });

    it('with insufficient damage there is no kill to classify', () => {
      const report = kill({}, { ...noCrit, hitsToKill: 3 });
      expect(report.status).toBe('infeasible');
      expect(report.kill).toEqual({ damageFeasible: false, constraintsMet: true });
    });

    it('judges every target and the worst one decides, for damage, constraints and certainty', () => {
      const report = judge({
        goal: { maxHitsToKill: 2, minAccuracy: 100 },
        readings: [read(1, { ...noCrit, hit: 150 }, 1000), read(2, { ...canCrit, minNoCri: 300, critRate: 60, hit: 150 }, 1000), read(3, { ...noCrit, hit: 50 }, 1000)],
      });
      expect(report.targets.map((target) => target.kill?.reliability)).toEqual(['guaranteed', 'conditional', 'guaranteed']);
      expect(report.kill).toEqual({ damageFeasible: true, constraintsMet: false, reliability: 'conditional' });
      expect(report.status).toBe('infeasible');
      expect(report.worstTarget?.monsterId).toBe(3);
    });

    it('classifies a goal with no hit limit as having no kill assessment', () => {
      const report = judge({ goal: { minCritRate: 10 }, readings: [read(1, { critRate: 20 })] });
      expect(report.status).toBe('feasible');
      expect(report.kill).toBeUndefined();
    });
  });

  it('calls a build that breaks a hard constraint invalid, even when the goal is met', () => {
    const carded = { ...base, gear: { ...base.gear, armorCard: 4302 } }; // an MVP card
    const report = judge({ build: carded, constraints: { mvpPolicy: 'none' }, goal, readings: [read(1, { hitsToKill: 1, critRate: 99 })] });
    expect(report.status).toBe('invalid');
    expect(report.violations.map((violation) => violation.code)).toContain('MVP_CARD_EXCLUDED');
    expect(judge({ build: carded, constraints: { mvpPolicy: 'exclude-new' } }).status).toBe('invalid');
    // Already worn on the base: exclude-new tolerates it, none does not.
    expect(judge({ base: carded, build: carded, constraints: { mvpPolicy: 'exclude-new' } }).status).toBe('feasible');
    expect(judge({ base: carded, build: carded, constraints: { mvpPolicy: 'none' } }).status).toBe('invalid');
  });

  it('keeps the learned skill apart from the forbidden active effect', () => {
    const constraints = { forbiddenEffects: ['Oleum Sanctum'] };
    const learned = { ...base, skills: { passive: { 'Oleum Sanctum': 5 } } };
    const active = { ...base, skills: { buffs: { 'Oleum Sanctum': 5 } } };
    expect(judge({ build: learned, constraints }).status).toBe('feasible');
    expect(judge({ build: active, constraints }).violations.map((violation) => violation.code)).toEqual(['FORBIDDEN_EFFECT_ACTIVE']);
  });

  it('reports locked slots, unavailable items, grade caps, consumables and stat resets', () => {
    const changed = { ...base, gear: { ...base.gear, weapon: 1234, armorGrade: 'A', garment: 14536 }, consumables: [1, 2, 3], stats: { str: 1 } };
    const codes = judge({
      build: changed,
      constraints: { lockedSlots: ['weapon'], unavailableIds: [14536], maxGrade: 'C', consumables: { forbidden: [2], max: 2 }, allowStatReset: false },
    }).violations.map((violation) => violation.code);
    expect(codes).toEqual(expect.arrayContaining(['LOCKED_SLOT_CHANGED', 'ITEM_UNAVAILABLE', 'GRADE_ABOVE_MAX', 'CONSUMABLE_FORBIDDEN', 'CONSUMABLE_LIMIT', 'STAT_RESET_NOT_ALLOWED']));
  });

  it('reports validation errors, and lets through only those the base build already has', () => {
    const issues = [{ code: 'INSUFFICIENT_STAT_POINTS', path: 'stats', message: 'x' }];
    expect(judge({ issues }).status).toBe('invalid');
    // `validateBuild(base)` defines "inherited": a clean base inherits nothing, so the error still counts.
    expect(judge({ issues, tolerateInherited: true }).status).toBe('invalid');
  });
});

describe('operations with a spec', () => {
  const ops = createOptimizationOperations(dataset, config);

  it('evaluate_variants without a spec has no feasibility; with one, only feasible variants are ranked', async () => {
    const variants = [{ label: 'same', patch: {} }];
    const plain = await ops.evaluateVariants({ build: base, variants, metrics: ['hitsToKill', 'hit'], validationMode: 'hypothetical' }) as any;
    expect(plain.results[0].feasibility).toBeUndefined();

    const unmet = await ops.evaluateVariants({ build: base, variants, metrics: ['hitsToKill'], validationMode: 'hypothetical', goal: { minAccuracy: 1e9 } }) as any;
    expect(unmet.results).toEqual([]);
    expect(unmet.discarded.belowRequire).toBe(1);

    const met = await ops.evaluateVariants({ build: base, variants, metrics: ['hitsToKill'], validationMode: 'hypothetical', goal: { minAccuracy: 1 }, constraints: { mvpPolicy: 'allow' } }) as any;
    expect(met.results[0].feasibility).toMatchObject({ status: 'feasible' });
    expect(met.results[0].feasibility.targets).toHaveLength(1);

    const locked = await ops.evaluateVariants({ build: base, variants: [{ label: 'new weapon', patch: { gear: { weapon: 1234 } } }], validationMode: 'hypothetical', constraints: { lockedSlots: ['weapon'] } }) as any;
    expect(locked.results).toEqual([]);
    expect(locked.errors[0]).toMatchObject({ status: 'invalid' });
  });

  it('optimize_build reports the feasibility of the baseline and of the final build, and the same search without a spec is untouched', async () => {
    const args = { build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps' as const, maxSolves: 40, procMode: 'off' as const, complements: false };
    const plain = await ops.optimizeBuild(args) as any;
    expect(plain.feasibility).toBeUndefined();

    const judged = await ops.optimizeBuild({ ...args, goal: { minAccuracy: 1 }, constraints: { lockedSlots: ['weapon'], unavailableIds: [999999999] } }) as any;
    expect(judged.feasibility.final.targets).toHaveLength(1);
    expect(['feasible', 'invalid']).toContain(judged.feasibility.final.status);
    expect(judged.patch.gear?.weapon).toBeUndefined(); // the locked slot reached the search
    expect(judged.final.dps).toBeGreaterThanOrEqual(judged.baseline.dps);
  }, 120_000);
});

describe('the figures the certainty is read from', () => {
  const ops = createOptimizationOperations(dataset, config);
  const monster = dataset.monsters[20994];
  const read = (build: any, skill?: string) => evaluate(decodeOnce(skill ? { ...build, atkSkill: skill } : build), undefined, dataset, monster, [], ['min', 'minNoCri', 'canCri', 'hitChance', 'critRate', 'hitsToKill']).metrics;

  it('reads, off the real engine, a skill that cannot crit and one that can', () => {
    const plain = read(base); // Third Flame Bomb: no crit, one minimum
    expect(plain).toMatchObject({ canCri: 0, hitChance: 100 });
    expect(plain.minNoCri).toBe(plain.min);

    const crit = read((builds as Record<string, any>)['b2']); // Explosion Blaster: the crit path is far above the non-crit minimum
    expect(crit.canCri).toBe(1);
    expect(crit.critRate).toBeGreaterThan(0);
    expect(crit.minNoCri).toBeGreaterThan(0);
    expect(crit.minNoCri!).toBeLessThan(crit.min!);
  });

  it('classifies real builds: a certain hit chance and no crit is guaranteed, a 98% hit chance or a crit-only kill is conditional', async () => {
    const run = (build: any, maxHitsToKill: number) => ops.evaluateVariants({
      build, target: { monsterId: 20994 }, variants: [{ label: 'same', patch: {} }], validationMode: 'hypothetical', goal: { maxHitsToKill },
    }) as Promise<any>;
    const kill = async (build: any, hits: number) => (await run(build, hits)).results[0]?.feasibility.kill;

    expect(await kill(base, 20_000)).toEqual({ damageFeasible: true, constraintsMet: true, reliability: 'guaranteed' });
    expect((await kill({ preset: fixture.preset }, 20_000)).reliability).toBe('conditional'); // hit chance 98%
    // b2 kills in 10125 hits only on the crit path; without crit it needs ~3.4x more: crit-dependent below that.
    expect((await kill((builds as Record<string, any>)['b2'], 11_000)).reliability).toBe('conditional');
    // Damage short of the goal: the variant is not ranked at all.
    expect((await run(base, 10)).results).toEqual([]);
  }, 120_000);

  it('optimize_build with a hit goal reports damage, constraints and certainty apart', async () => {
    const result = await ops.optimizeBuild({
      build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 30, procMode: 'off', complements: false,
      goal: { maxHitsToKill: 20_000 },
    }) as any;
    const kill = result.feasibility.final.kill;
    expect(kill.damageFeasible).toBe(true);
    expect(kill.constraintsMet).toBe(true);
    expect(['guaranteed', 'conditional', 'unknown']).toContain(kill.reliability);
    expect(result.feasibility.final.targets[0].kill.reasons).toBeInstanceOf(Array);
  }, 120_000);
});
