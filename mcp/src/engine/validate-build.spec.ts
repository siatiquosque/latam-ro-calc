import { beforeAll, describe, expect, it } from 'vitest';
import { loadSkillTree, skillTreeLoaded, SkillTreeData } from 'src/app/build-analysis/engine/skill-tree';
import builds from './__tests__/fixtures/bench-builds.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { validateBuild } from 'src/app/build-analysis/engine/validate';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';

const dataset = loadDatasetFromDisk();
const fixtures = builds as Record<string, any>;

describe('validate_build', () => {
  it.each(Object.keys(fixtures))('accepts the real build %s', (name) => {
    const result = validateBuild(fixtures[name], dataset);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.unknowns.length).toBeGreaterThan(0);
  });

  it('blocks an MVP card only when asked, and by the card, not by the target', () => {
    const armor = fixtures['b1'].gear?.armor ?? fixtures['b1'].preset?.armor;
    const build = { ...fixtures['b1'], gear: { armor, armorCard: 4302 } };
    expect(MVP_CARD_IDS.has(4302)).toBe(true);
    expect(validateBuild(build, dataset, { excludeMvpCards: true }).errors.map((error) => error.code)).toContain('MVP_CARD_EXCLUDED');
    expect(validateBuild(build, dataset).errors.map((error) => error.code)).not.toContain('MVP_CARD_EXCLUDED');
  });

  it('does not treat an ordinary monster card as MVP', () => {
    expect(MVP_CARD_IDS.has(300220)).toBe(false);
    expect(MVP_CARD_IDS.has(4129)).toBe(false);
  });

  it('says an item the calculator cannot measure is an error, not zero', () => {
    const result = validateBuild({ ...fixtures['b1'], gear: { garment: 100901 } }, dataset);
    expect(result.valid).toBe(false);
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
  });

  describe('limits and budgets', () => {
    const real = () => structuredClone(fixtures['b1']);
    const codes = (build: unknown) => validateBuild(build as never, dataset).errors.map((error) => error.code);

    it('flags a level the class cannot have instead of letting the engine use another one', () => {
      expect(codes({ ...real(), level: 999 })).toContain('INVALID_LEVEL');
    });

    it('flags a stat above the class maximum and points the level does not pay for', () => {
      expect(codes({ ...real(), stats: { str: 200 } })).toContain('INVALID_STAT');
      const spent = validateBuild({ ...real(), level: 100, stats: { str: 130, agi: 130, vit: 130, int: 130, dex: 130, luk: 130 } } as never, dataset);
      expect(spent.errors.map((error) => error.code)).toContain('INSUFFICIENT_STAT_POINTS');
    });

    it('flags a skill the class does not have and a level it does not offer', () => {
      expect(codes({ ...real(), skills: { active: { 'Skill Que Nao Existe': 5 } } })).toContain('UNKNOWN_SKILL');
      const passive = dataset.classes.newInstance(real().preset.class).passiveSkills.find((skill: { dropdown: unknown[] }) => skill.dropdown.length > 1);
      const level = validateBuild({ ...real(), skills: { passive: { [passive.name]: 987 } } } as never, dataset);
      expect(level.errors.map((error) => error.code)).toContain('INVALID_SKILL_LEVEL');
    });

    it('says the skill point budget and prerequisites are not checked', () => {
      expect(validateBuild(real(), dataset).unknowns.join(' ')).toContain('árvore de habilidades');
    });
  });

  it('reports an invalid build instead of throwing', () => {
    const result = validateBuild({ ...fixtures['b1'], class: 999999 }, dataset);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INCOMPATIBLE_CLASS');
  });
});

describe('evaluate_variants and the build rules', () => {
  it('refuses a variant above the trait maximum, but only warns about points beyond the level budget', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createMcpServer } = await import('../mcp-server');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'rules', version: '1' });
    await Promise.all([createMcpServer(dataset).connect(b), client.connect(a)]);
    const result = JSON.parse(((await client.callTool({ name: 'evaluate_variants', arguments: {
      build: fixtures['b1'], target: { monsterId: 9000002 }, metrics: ['dps'],
      variants: [{ label: 'pow 130', patch: { stats: { pow: 130 } } }, { label: 'mais str', patch: { stats: { str: 130, agi: 130 } } }],
    } })) as any).content[0].text);
    expect(result.errors).toEqual([expect.objectContaining({ label: 'pow 130', status: 'invalid', code: 'INVALID_STAT' })]);
    const measured = result.results.find((row: any) => row.label === 'mais str');
    expect(measured.status).toBe('ok');
    expect(measured.warnings.join(' ')).toContain('Atributos usam');
  });
});

describe('skill tree reference (kRO)', () => {
  const inquisitor = () => ({ preset: structuredClone(fixtures['b1']).preset });
  let tree: SkillTreeData;
  beforeAll(async () => { await loadSkillTree(); tree = skillTreeLoaded()!; });
  const warn = (build: unknown) => validateBuild(build as never, dataset, {}, tree).warnings;

  it('is only a warning, and says what it checked against', () => {
    const result = validateBuild({ ...inquisitor(), skills: { active: { 'Oleum Sanctum': 5 }, passive: { 'Will of Faith': 1 } } } as never, dataset, {}, tree);
    expect(result.errors.map((error) => error.code)).not.toContain('SKILL_PREREQUISITE_NOT_MET');
    const issue = result.warnings.find((entry) => entry.code === 'SKILL_PREREQUISITE_NOT_MET');
    expect(issue?.message).toContain('Will Of Faith nível 3');
    expect(result.unknowns.join(' ')).toContain('kRO');
  });

  it('does not complain when the prerequisite is met', () => {
    expect(warn({ ...inquisitor(), skills: { active: { 'Oleum Sanctum': 5 }, passive: { 'Will of Faith': 10 } } }).map((entry) => entry.code)).not.toContain('SKILL_PREREQUISITE_NOT_MET');
  });

  it('warns when the class skills cost more points than the class level gives', () => {
    const issues = warn({ ...inquisitor(), jobLevel: 1, skills: { passive: { 'Will of Faith': 10 } } });
    expect(issues.map((entry) => entry.code)).toContain('SKILL_POINTS_OVER_BUDGET');
  });
});
