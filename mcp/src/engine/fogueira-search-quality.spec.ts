import { describe, expect, it } from 'vitest';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { complementChoices, relevantKeys, searchComplements, swapPatch } from './complements';
import { resolveBuild } from './build-input';
import { solve } from './solve';
import { evaluate, createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { prepareProcPolicy } from './proc';
import { config } from '../config';
import { skillInfo } from 'src/app/build-analysis/engine/skill-info';

await loadRandomPools();
const dataset = loadDatasetFromDisk();
const build = { preset: fixture.preset };
const monster = dataset.monsters[21077];

describe('Fogueira: legal, skill-directed recommendations', () => {
  it('documents HP scaling and includes Derreting and Tao Gunka in legal card candidates', () => {
    const rb = resolveBuild(build, dataset);
    const keys = relevantKeys(solve(rb, dataset, monster));
    expect(keys).toEqual(expect.arrayContaining(['hp', 'hpPercent', 'vit']));
    const hat = complementChoices(dataset, 'headUpper', Number(rb.model.headUpper), keys, new Set());
    expect(hat.flat().some(patch => patch.gear?.['headUpperCard'] === 300174)).toBe(true);
    const armor = complementChoices(dataset, 'armor', Number(rb.model.armor), keys, new Set());
    expect(armor.flat().some(patch => patch.gear?.['armorCard'] === 4302)).toBe(true);
    const info = skillInfo(rb.char, 'Fogueira Espiritual');
    expect(info.description).toBeTruthy();
    expect(info.scaling.resources).toContain('hp');
    expect(info.levels).toContain(5);
  });
  it('finds a head card at least as strong as Derreting instead of stopping at Alga Brilhante', () => {
    const rb = resolveBuild(build, dataset);
    const initial = evaluate(build, undefined, dataset, monster, [], ['dps']);
    const fields = complementChoices(dataset, 'headUpper', Number(rb.model.headUpper), relevantKeys(initial.solved.calc), new Set());
    const result = searchComplements({ patch: {}, result: initial }, fields, 'dps', patch => {
      try { return evaluate(build, patch, dataset, monster, [], ['dps']); } catch { return null; }
    });
    const derreting = evaluate(build, { gear: { headUpperCard: 300174 } }, dataset, monster, [], ['dps']);
    expect(result.result.metrics.dps).toBeGreaterThanOrEqual(derreting.metrics.dps);
  });
  it('rejects impossible module combinations and misplaced Issgard enchants', () => {
    expect(() => resolveBuild({ ...build, gear: { accLeftEnchant2: 310120, accLeftEnchant3: 310120 } }, dataset)).toThrow('máximo 1');
    expect(() => resolveBuild({ ...build, gear: { weapon: 560037, weaponEnchant1: 310120 } }, dataset)).toThrow('não é permitido');
  });
  it('never recommends +11/+12 shadows, even with a global +12 request', () => {
    const rb = resolveBuild(build, dataset);
    for (const slot of ['shadowWeapon', 'shadowShield', 'shadowArmor', 'shadowBoot', 'shadowEarring', 'shadowPendant']) {
      expect(swapPatch(dataset, rb, slot, Number(rb.model[slot]), { refine: 12 }).gear?.[`${slot}Refine`]).toBe(10);
    }
    expect(() => resolveBuild({ ...build, gear: { shadowWeaponRefine: 12 } }, dataset)).toThrow('máximo +10');
  });
  it('weights the boot proc between off and always-active instead of dropping it', async () => {
    const off = evaluate(build, undefined, dataset, monster, [], ['dps']);
    const active = evaluate(build, undefined, dataset, monster, [], ['dps'], [], 1, true);
    const policy = await prepareProcPolicy(dataset, 'average', 1);
    const average = evaluate(build, undefined, dataset, monster, [], ['dps'], [], 1, policy);
    expect(active.metrics.dps).toBeGreaterThan(off.metrics.dps);
    expect(average.metrics.dps).toBeGreaterThan(off.metrics.dps);
    expect(average.metrics.dps).toBeLessThan(active.metrics.dps);
    expect(average.procEvaluation.counted.length).toBeGreaterThan(0);
  });
  it('preserves equipment/refine/grade while tuning only current pieces', async () => {
    const ops = createOptimizationOperations(dataset, { ...config, limits: { ...config.limits, maxSolves: 1000, maxSearchMs: 30_000 } });
    const result = await ops.optimizeBuild({ build, slots: ['headUpper'], equipmentMode: 'current', procMode: 'off', maxSolves: 1000, levelChecks: false });
    const rb = resolveBuild(build, dataset);
    expect(result.patch.gear?.['headUpper']).toBe(rb.model.headUpper);
    expect(result.patch.gear?.['headUpperRefine']).toBe(rb.model.headUpperRefine);
    expect(result.final.dps).toBeGreaterThanOrEqual(result.baseline.dps);
  }, 45_000);
  it('screens enchant families including Wolf and Varmundt, with Nebula gated by level', async () => {
    const ops = createOptimizationOperations(dataset, { ...config, limits: { ...config.limits, maxSolves: 3000, maxSearchMs: 30_000 } });
    const search = (level: number) => ops.optimizeBuild({ build: { ...build, level }, slots: ['armor', 'garment', 'boot'], complements: false, procMode: 'off', levelChecks: false, rounds: 1, detail: true });
    const names = (result: Awaited<ReturnType<typeof search>>) => Object.values(result.candidateIds).flat().map(id => dataset.items[id]?.name ?? '').join('\n');
    const result = await search(236);
    const below = names(result);
    expect(below).toMatch(/Lobo Cinzento/);
    // LATAM localizes these as Runas Flamejantes/Vicejantes rather than Varmundt.
    for (const slot of ['boot', 'garment']) expect(result.candidateIds[slot].some(id => /Barmund_|(?:Flame|Plain|Ice|Death)_Rune_/.test(dataset.items[id]?.aegisName))).toBe(true);
    expect(below).not.toMatch(/Nebulosa/);
    expect(names(await search(240))).toMatch(/Nebulosa/);
  }, 65_000);
});
