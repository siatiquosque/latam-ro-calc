import { describe, expect, it } from 'vitest';
import { createMainModel } from 'src/app/utils';
import { resolveBuild } from '../engine/build-input';
import { loadDatasetFromDisk } from '../../../../mcp/src/data/dataset.node';
import { acquisitionKnowledge } from './catalog';
import { assessAcquisition } from './assess';
import { knowledgeSchema, reviseKnowledge } from './contracts';
import extracted from '../../../../data/acquisition/rathena-experimental.v1.json';
import enchantExtracted from '../../../../data/acquisition/rathena-enchant-experimental.v1.json';

const build = (gear: Record<string, unknown>) => ({ model: Object.assign(createMainModel(), gear) });
const assess = (gear: Record<string, unknown>, asOf = '2026-11-05') => assessAcquisition(build(gear), 'LATAM', { asOf });
const enchant = (result: ReturnType<typeof assess>) => result.diagnostics.find(d => d.aspect === 'enchant')!;

describe('shared acquisition knowledge', () => {
  it('validates curated and experimentally extracted versioned data', () => {
    expect(knowledgeSchema.parse(acquisitionKnowledge).routes.filter(r => !r.importKey && r.family !== 'rathena-experimental')).toHaveLength(67);
    expect(knowledgeSchema.parse(extracted).routes).toHaveLength(2);
    expect(knowledgeSchema.parse(enchantExtracted).routes).toHaveLength(3);
  });
  it('keeps expired routes visible alongside an active probabilistic alternative', () => {
    const result = enchant(assess({ headUpper: 19482, headUpperEnchant1: 29080 }));
    expect(result.status).toBe('difficult');
    expect(result.routes.find(r => r.id === 'temporal-exchange-17-v1')?.availability).toBe('expired');
    expect(result.routes.find(r => r.id === 'temporal-evolution-10-v1')?.availability).toBe('active');
    expect(result.routes.every(r => r.sourceDetails.length)).toBe(true);
  });
  it('reports expired-only evidence without concluding impossibility', () => {
    const kb = { ...acquisitionKnowledge, routes: acquisitionKnowledge.routes.filter(r => r.id === 'temporal-exchange-17-v1') };
    const result = assessAcquisition(build({ headUpper: 19482, headUpperEnchant1: 29080 }), 'LATAM', { asOf: '2026-11-05' }, kb);
    expect(enchant(result).status).toBe('expired_routes');
    expect(enchant(result).reason).toContain('não é prova de impossibilidade');
  });
  it('preserves previously produced equipment and requires exact declared possession', () => {
    const b = build({ headUpper: 19482, headUpperEnchant1: 29080, headUpperRefine: 12 });
    const p = { itemId: 19482, refine: 12, grade: '', attachments: { headUpperEnchant1: 29080 }, acquiredOn: '2026-10-10' };
    expect(assessAcquisition(b, 'LATAM', { asOf: '2026-11-05', owned: [p] }).diagnostics.every(d => d.status === 'owned')).toBe(true);
    expect(enchant(assessAcquisition(b, 'LATAM', { asOf: '2026-11-05', owned: [{ ...p, attachments: {} }] })).status).toBe('difficult');
    expect(enchant(assessAcquisition(b, 'LATAM', { asOf: '2026-11-05', owned: [{ ...p, acquiredOn: '2026-12-01' }] })).status).toBe('difficult');
  });
  it('models probabilistic evolution as transitions with regression, not independent total cost', () => {
    const route = acquisitionKnowledge.routes.find(r => r.id === 'temporal-evolution-10-v1')!;
    expect(route.steps.map(s => s.success?.numerator)).toEqual([50, 35, 20, 10, 7, 5, 2, 1, 1]);
    expect(route.steps.map(s => s.materials[0].amount)).toEqual([4, 6, 8, 10, 12, 16, 20, 28, 40]);
    expect(route.steps.every(s => s.failure.levelDelta === -1 && s.failure.floor === 1 && s.failure.destroysItem === false)).toBe(true);
    expect(route.cost.zeny).toBeNull();
  });
  it('exposes a guaranteed high-refine exchange only during its period', () => {
    const get = (date: string) => enchant(assess({ headUpper: 19482, headUpperEnchant1: 29080 }, date)).routes.find(r => r.id === 'temporal-exchange-17-v1')!;
    expect(get('2026-09-14').availability).toBe('future');
    expect(get('2026-10-12').availability).toBe('active');
    expect(get('2026-10-13').availability).toBe('expired');
    expect(get('2026-10-01').requirements).toContainEqual(expect.objectContaining({ itemId: 18551, minRefine: 17 }));
    expect(get('2026-10-01').success).toEqual({ numerator: 100, denominator: 100 });
    expect(get('2026-10-01').cost.difficulty).toBe('high');
  });
  it('does not turn guaranteed tear application into a guaranteed level or level 10', () => {
    const routes = acquisitionKnowledge.routes.filter(r => r.id.startsWith('temporal-tear-'));
    expect(routes.map(r => r.outcomes.map(o => o.chance.numerator))).toEqual([[35, 25, 20, 15, 5], [25, 22, 20, 18, 15]]);
    expect(routes.every(r => !r.target.enchantIds.includes(29080))).toBe(true);
    const result = enchant(assess({ headUpper: 19482, headUpperEnchant1: 29075 }, '2026-10-01'));
    expect(result.routes.filter(r => r.id.startsWith('temporal-tear-')).every(r => !r.guaranteedForRequestedOutcome)).toBe(true);
  });
  it('does not treat possession with different random bonuses as the same configuration', () => {
    const options: string[] = [];
    options[8] = 'atk:5';
    const result = assessAcquisition(build({ headUpper: 19482, rawOptionTxts: options }), 'LATAM', { asOf: '2026-11-05',
      owned: [{ itemId: 19482, refine: 0, grade: '', attachments: {}, acquiredOn: '2026-10-01' }] });
    expect(result.diagnostics.some(d => d.status === 'owned')).toBe(false);
    expect(result.diagnostics.find(d => d.aspect === 'randomOptions')?.status).toBe('insufficient_information');
  });
  it('covers the guaranteed Memorial path through level 5 but not level 6', () => {
    const five = enchant(assess({ headUpper: 18978, headUpperEnchant1: 29075 }));
    const guaranteed = five.routes.find(r => r.id === 'memorable-guaranteed-5-v1')!;
    expect(guaranteed.cost.zeny).toBe(35500000);
    expect(guaranteed.steps.reduce((n, s) => n + s.materials[0].amount, 0)).toBe(1100);
    expect(enchant(assess({ headUpper: 18978, headUpperEnchant1: 29076 })).routes.some(r => r.id.includes('guaranteed'))).toBe(false);
  });
  it('keeps unknown items, refinements, grades, wrong positions and other servers unknown', () => {
    for (const gear of [{ headUpper: 99999999 }, { headUpper: 19482, headUpperRefine: 20 }, { headUpper: 19482, headUpperGrade: 'A' }, { headUpper: 19482, headUpperEnchant2: 29080 }]) {
      expect(assess(gear).diagnostics.some(d => d.status === 'insufficient_information')).toBe(true);
    }
    expect(assessAcquisition(build({ headUpper: 19482 }), 'iRO', { asOf: '2026-11-05' }).diagnostics[0].status).toBe('insufficient_information');
  });
  it('does not promote generic rAthena extraction to LATAM availability', () => {
    const result = assessAcquisition(build({ shadowShield: 24732 }), 'LATAM', { asOf: '2026-11-05' }, knowledgeSchema.parse(extracted));
    expect(result.diagnostics[0].status).toBe('insufficient_information');
    expect(result.diagnostics[0].routes[0].availability).toBe('unknown');
  });
  it('reports confirmed procedural obtainability separately from mechanical validation', () => {
    const result = assess({ headUpper: 19482 });
    expect(result.diagnostics[0].status).toBe('obtainable');
    expect(result.mechanicalValidity).toBe('not_assessed');
    expect(result.economicCost).toBeNull();
  });
  it('reads a real resolved build without changing public BuildInput', () => {
    const resolved = resolveBuild({ class: 4255, gear: { headUpper: 19482, headUpperEnchant1: 29080 } }, loadDatasetFromDisk());
    expect(enchant(assessAcquisition(resolved, 'LATAM', { asOf: '2026-11-05' })).status).toBe('difficult');
  });
  it('recognizes two distinct gem sets at sum 18; does not infer a cross-pair or count other pieces', () => {
    expect(assess({ shadowArmor: 24675, shadowBoot: 24676, shadowArmorRefine: 9, shadowBootRefine: 9 }).effects.map(e => e.engineCoverage)).toEqual(['missing', 'represented']);
    expect(assess({ shadowEarring: 24677, shadowPendant: 24678, shadowEarringRefine: 10, shadowPendantRefine: 10 }).effects).toHaveLength(3);
    expect(assess({ shadowArmor: 24675, shadowBoot: 24676, shadowArmorRefine: 8, shadowBootRefine: 9 }).effects).toEqual([]);
    expect(assess({ shadowArmor: 24675, shadowPendant: 24678, shadowArmorRefine: 10, shadowPendantRefine: 10 }).effects).toEqual([]);
  });
  it('protects confirmed revisions, keeps history and requires a new immutable ID', () => {
    const previous = acquisitionKnowledge.routes.find(r => r.review === 'confirmed')!;
    const next = { ...previous, id: 'next', supersedes: previous.id, review: 'unreviewed' as const };
    const addition = { ...acquisitionKnowledge, routes: [next], effects: [] };
    expect(() => reviseKnowledge(acquisitionKnowledge, addition)).toThrow('Substituição');
    const revised = reviseKnowledge(acquisitionKnowledge, { ...addition, routes: [{ ...next, review: 'confirmed', revisionReason: 'Correção conferida na fonte regional.' }] });
    expect(revised.routes.some(r => r.id === previous.id)).toBe(true);
    expect(revised.routes.some(r => r.id === 'next')).toBe(true);
    expect(() => reviseKnowledge(acquisitionKnowledge, { ...addition, routes: [previous] })).toThrow('ID imutável');
  });
  it('rejects malformed dates and schema versions', () => {
    expect(() => assess({ headUpper: 19482 }, '2026-02-31')).toThrow();
    expect(() => knowledgeSchema.parse({ ...acquisitionKnowledge, schemaVersion: 2 })).toThrow();
  });
});
