import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp-server';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { synergyIndex } from 'src/app/build-analysis/engine/synergies';
import { createSynergyOperations } from 'src/app/build-analysis/operations/synergies';
import { config } from '../config';
import { CUSTOM_ITEM_MIN_ID } from 'src/app/core/custom-items';
import { SKILL_ID_BY_NAME } from 'src/app/skills';

const dataset = loadDatasetFromDisk();
const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Explosion Blaster==5', gear: { weapon: 560026, weaponRefine: 11 } };
let client: Client;
let server: ReturnType<typeof createMcpServer>;
const call = async (name: string, args: Record<string, unknown>) => {
  const result: any = await client.callTool({ name, arguments: args });
  return JSON.parse(result.content[0].text);
};
beforeAll(async () => {
  server = createMcpServer(dataset);
  client = new Client({ name: 'consultant', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
});
afterAll(async () => { await client.close(); await server.close(); });

describe('consultant experiments', () => {
  it('does not turn an impossible point budget into a stat recommendation', async () => {
    const result = await call('optimize_stats', { build: { ...build, stats: { pow: 100, sta: 50, con: 50 } }, maxSolves: 30 });
    expect(result.error).toContain('INSUFFICIENT_STAT_POINTS');
    expect(result).not.toHaveProperty('patch');
  });

  it('does not return a stat recommendation below an explicit hard requirement', async () => {
    const result = await call('optimize_stats', { build, require: [{ metric: 'hp', min: 1e12 }], maxSolves: 10 });
    expect(result.error).toContain('Nenhuma redistribuição encontrada atende a require');
    expect(result).not.toHaveProperty('patch');
  });

  it('returns a legal, reproducible partial stat result within the new-evaluation budget', async () => {
    const result = await call('optimize_stats', { build, maxSolves: 10 });
    expect(result.error).toBeUndefined();
    expect(result.solves).toBeLessThanOrEqual(10);
    expect(result.solves).toBe(result.evaluations.uniqueEvaluations);
    expect(result.complete).toBe(false);
    expect(result.stoppedReason).toBe('maxSolves');
    const checked = await call('validate_build', { build: { share: result.share } });
    expect(checked.valid).toBe(true);
    const measured = await call('evaluate_variants', { build, variants: [{ label: 'partial', patch: result.patch }], metrics: ['dps', 'max', 'hp'] });
    expect(measured.results[0].status).toBe('ok');
    expect(measured.results[0].metrics).toEqual(result.final);
  });

  it('minimizes hitsToKill in stat search instead of rewarding more hits', async () => {
    const result = await call('optimize_stats', { build, target: { monsterId: 21077 }, objective: 'hitsToKill', maxSolves: 150 });
    expect(result.error).toBeUndefined();
    expect(result.final.hitsToKill).toBeLessThanOrEqual(result.baseline.hitsToKill);
    const measured = await call('evaluate_variants', { build, target: { monsterId: 21077 }, variants: [{ label: 'farm', patch: result.patch }], metrics: ['hitsToKill'] });
    expect(measured.results[0].metrics.hitsToKill).toBe(result.final.hitsToKill);
  });

  it('refuses inherited errors and excess points by default, and labels explicit hypotheses', async () => {
    const illegal = { ...build, stats: { str: 130, agi: 130, vit: 130, int: 130, dex: 130, luk: 130 } };
    const variants = [{ label: 'same', patch: {} }];
    const strict = await call('evaluate_variants', { build: illegal, variants });
    expect(strict.baselineValid).toBe(false);
    expect(strict.results).toEqual([]);
    expect(strict.errors[0]).toMatchObject({ status: 'invalid', code: 'INSUFFICIENT_STAT_POINTS' });
    const hypothesis = await call('evaluate_variants', { build: illegal, variants, validationMode: 'hypothetical' });
    expect(hypothesis.results[0].status).toBe('hypothetical');
    expect(hypothesis.results[0].warnings.join(' ')).toContain('INSUFFICIENT_STAT_POINTS');
    const repaired = await call('evaluate_variants', { build: illegal, variants: [{ label: 'legal', patch: { stats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 } } }] });
    expect(repaired.results[0].status).toBe('ok');
  });

  it('reproduces every target, caches duplicate builds and sorts by the stated primary target', async () => {
    const variants = [{ label: 'same', patch: {} }, { label: 'same-again', patch: {} }, { label: 'upgrade', patch: { gear: { weaponRefine: 12 } } }];
    const result = await call('evaluate_variants', { build, variants, targets: [{ monsterId: 21077 }, { monsterId: 21066 }], metrics: ['dps', 'max'] });
    expect(result.results).toHaveLength(3);
    expect(result.rankingTarget).toBe(21077);
    expect(result.evaluations).toEqual({ uniqueEvaluations: 4, cacheHits: 4 });
    for (const monsterId of [21077, 21066]) {
      const single = await call('evaluate_variants', { build, variants, target: { monsterId }, metrics: ['dps', 'max'] });
      for (const row of result.results) {
        expect(row.perTarget.find((entry: any) => entry.monsterId === monsterId).metrics).toEqual(single.results.find((entry: any) => entry.label === row.label).metrics);
      }
      expect(result.baselinePerTarget.find((entry: any) => entry.monsterId === monsterId).metrics).toEqual(single.baseline);
    }
    expect(result.results[0].metrics).toEqual(result.results[0].perTarget[0].metrics);
  });

  it('requires the floor on every target, and refuses ambiguous target inputs', async () => {
    const variants = [{ label: 'base', patch: {} }];
    const args = { build, variants, targets: [{ monsterId: 21077 }, { monsterId: 21066 }], metrics: ['dps'] };
    const first = await call('evaluate_variants', args);
    const dps = first.results[0].perTarget.map((entry: any) => entry.metrics.dps);
    expect(dps[0]).not.toBe(dps[1]);
    const filtered = await call('evaluate_variants', { ...args, require: [{ metric: 'dps', min: (Math.min(...dps) + Math.max(...dps)) / 2 }] });
    expect(filtered.results).toEqual([]);
    expect(filtered.discarded.belowRequire).toBe(1);
    expect((await call('evaluate_variants', { ...args, target: { monsterId: 21077 } })).error).toContain('não ambos');
  });

  it('ranks fewer hits to kill first for farm experiments', async () => {
    const result = await call('evaluate_variants', { build, target: { monsterId: 21077 }, sortBy: 'hitsToKill', variants: [{ label: 'unarmed', patch: { gear: { weapon: null } } }, { label: 'armed', patch: {} }] });
    expect(result.sortOrder).toBe('asc');
    expect(result.results.map((row: any) => row.label)).toEqual(['armed', 'unarmed']);
    expect(result.results[0].metrics.hitsToKill).toBeLessThan(result.results[1].metrics.hitsToKill);
  });
});

describe('synergy evidence', () => {
  it('proposes grade, stat and learned-skill conditions only when each change is authorized', async () => {
    const id = CUSTOM_ITEM_MIN_ID + 905;
    const name = 'Will of Faith';
    const skillId = SKILL_ID_BY_NAME[name];
    const cases = [
      { expression: 'GRADE[me==B]1000', permission: 'grade', expected: (patch: any) => expect(patch.customAttachments.armor.grade).toBe('B') },
      { expression: 'str:120===1000', permission: 'stats', expected: (patch: any) => expect(patch.stats.str).toBe(120) },
      { expression: `SKILL_ID2[${skillId}==1]1000`, permission: 'skills', expected: (patch: any) => expect(patch.skills.passive[name]).toBeGreaterThanOrEqual(1) },
    ];
    for (const entry of cases) {
      const conditional = { ...build, stats: { str: 1 }, skills: { passive: { [name]: 0 } }, customItems: [{ id, name: 'Armadura de condições', kind: 'armor', itemLevel: 2, canGrade: true, script: { hp: [entry.expression] } }], gear: { ...build.gear, armor: id } };
      const args = { build: conditional, itemIds: [id], bonusKeys: ['hp'], includePatches: true };
      const denied = await call('find_synergies', args);
      expect(denied.groups[0].patchStatus, entry.expression).toBe('not-found');
      const allowed = await call('find_synergies', { ...args, allowChanges: [entry.permission] });
      expect(allowed.groups[0].patchStatus, JSON.stringify(allowed)).toBe('available');
      entry.expected(allowed.groups[0].patch);
      expect(allowed.groups[0].activation.active).toBe(true);
    }
  });

  it('indexes conditional custom items locally and carries them through strict evaluation and shares', async () => {
    const armor = CUSTOM_ITEM_MIN_ID + 901;
    const head = CUSTOM_ITEM_MIN_ID + 902;
    const customItems = [
      { id: armor, name: 'Armadura de teste MCP', kind: 'armor', script: { hp: ['9===1000'] }, isRefinable: true },
      { id: head, name: 'Elmo de teste MCP', kind: 'headUpper', script: { hp: [`EQUIP_ID[${armor}]200`] } },
    ];
    const customBuild = { ...build, customItems, gear: { ...build.gear, armor, headUpper: head } };
    const found = await call('find_synergies', { build: customBuild, itemIds: [armor, head], bonusKeys: ['hp'], includePatches: true, allowChanges: ['refine'], maxRefine: 9 });
    const conditional = found.groups.find((group: any) => group.sourceItemId === armor);
    expect(conditional.sourceConfidence).toBe('user-defined');
    expect(conditional.conditions).toContainEqual({ kind: 'refine', value: 9 });
    expect(conditional.patchStatus).toBe('available');
    expect(conditional.patch.customAttachments.armor.refine).toBe(9);
    const measured = await call('evaluate_variants', { build: customBuild, variants: [{ label: 'refine', patch: conditional.patch }], metrics: ['hp'] });
    expect(measured.results[0].status).toBe('ok');
    const reopened = await call('find_synergies', { build: { share: measured.results[0].share }, itemIds: [armor], bonusKeys: ['hp'] });
    expect(reopened.groups.some((group: any) => group.sourceItemId === armor)).toBe(true);
    expect((await call('find_synergies', { itemIds: [armor] })).groups).toEqual([]);
    expect(dataset.items[armor]).toBeUndefined();
  });

  it('respects opt-in, refine caps and locks when proposing conditional upgrades', async () => {
    const armor = CUSTOM_ITEM_MIN_ID + 903;
    const conditional = { ...build, customItems: [{ id: armor, name: 'Armadura condicional', kind: 'armor', isRefinable: true, script: { hp: ['9===1000'] } }], gear: { ...build.gear, armor } };
    for (const restrictions of [{}, { allowChanges: ['refine'], maxRefine: 8 }, { allowChanges: ['refine'], lock: ['armor'] }]) {
      const result = await call('find_synergies', { build: conditional, itemIds: [armor], bonusKeys: ['hp'], includePatches: true, ...restrictions });
      expect(result.groups.find((group: any) => group.sourceItemId === armor).patchStatus).toBe('not-found');
    }
  });

  it('uses custom sidecar cards and ignores stale legacy sockets like the motor', async () => {
    const armor = CUSTOM_ITEM_MIN_ID + 904;
    const customBuild = { ...build, customItems: [{ id: armor, name: 'Armadura com carta', kind: 'armor', cardCapacity: 1, defaultCards: [4218], script: {} }], gear: { ...build.gear, armor, armorCard: 4302, headUpper: 2221, headUpperCard: 4269 } };
    const valid = await call('validate_build', { build: customBuild, constraints: { excludeMvpCards: true } });
    expect(valid.valid).toBe(true);
    const actualMvp = await call('validate_build', { build: { ...customBuild, customAttachments: { armor: { itemId: armor, cards: [4302], enchants: [], bas: [], refine: 0, grade: '' } } }, constraints: { excludeMvpCards: true } });
    expect(actualMvp.valid).toBe(false);
    expect(actualMvp.errors.some((issue: any) => issue.code === 'MVP_CARD_EXCLUDED')).toBe(true);
    const found = await call('find_synergies', { build: customBuild, itemIds: [4218], bonusKeys: ['vit'], includePatches: true, mvpPolicy: 'none' });
    const group = found.groups.find((entry: any) => entry.sourceItemId === 4218);
    expect(group.equipmentRequirementsMet).toBe(true);
    expect(group.patchStatus).toBe('available');
    expect(group.activation.field).toContain('CustomCard');
  });

  const cardBuild = { ...build, gear: { ...build.gear, armor: 450177, headUpper: 2221 } };

  it('turns a real card set into a legal experiment and a reproducible share without Optimize', async () => {
    const found = await call('find_synergies', { build: cardBuild, itemIds: [4218], bonusKeys: ['vit'], includePatches: true });
    const group = found.groups.find((entry: any) => entry.sourceItemId === 4218);
    expect(group.patchStatus).toBe('available');
    expect(group.patch.gear).toMatchObject({ armorCard: 4218, headUpperCard: 4269 });
    expect(group.activation).toMatchObject({ active: true, value: 4, field: 'armorCard' });
    const measured = await call('evaluate_variants', { build: cardBuild, variants: [{ label: 'set', patch: group.patch }], metrics: ['hp'], sortBy: 'hp' });
    expect(measured.results[0].status).toBe('ok');
    expect(measured.results[0].metrics.hp).toBeGreaterThan(measured.baseline.hp);
    const reopened = await call('calculate', { build: { share: measured.results[0].share } });
    expect(reopened.stats.maxHp).toBe(measured.results[0].metrics.hp);
  });

  it('positions a four-piece equipment set without implicit upgrades', async () => {
    const found = await call('find_synergies', { build: { class: 12, level: 200, jobLevel: 60 }, itemIds: [15036], bonusKeys: ['2004'], includePatches: true });
    expect(found.error).toBeUndefined();
    const group = found.groups.find((entry: any) => entry.sourceItemId === 15036);
    expect(group.patchStatus).toBe('available');
    expect(group.activation).toMatchObject({ active: true, value: 50 });
    expect(group.patch.gear).toMatchObject({ armor: 15036, boot: 2475, garment: 2574 });
    expect(Object.values(group.patch.gear)).toContain(2883);
    for (const [key, value] of Object.entries(group.patch.gear)) if (key.endsWith('Refine')) expect(value).toBe(0);
    const checked = await call('validate_build', { build: { class: 12, level: 200, jobLevel: 60, ...group.patch } });
    expect(checked.valid).toBe(true);
  });

  it('respects locked sockets and excluded partners and requires a build for patches', async () => {
    const args = { build: cardBuild, itemIds: [4218], bonusKeys: ['vit'], includePatches: true };
    for (const constraints of [{ lock: ['armor'] }, { lock: ['armorCard'] }, { exclude: [4269] }]) {
      const found = await call('find_synergies', { ...args, ...constraints });
      const group = found.groups.find((entry: any) => entry.sourceItemId === 4218);
      expect(group.patchStatus).toBe('not-found');
      expect(group).not.toHaveProperty('patch');
    }
    expect((await call('find_synergies', { itemIds: [4218], includePatches: true })).error).toContain('requer build');
  });

  it('does not announce activation when the remaining condition fails in the motor', async () => {
    const expression = 'EQUIP_ID[4269]REFINE[11]4';
    const conditional = { ...dataset, items: { ...dataset.items, 4218: { ...dataset.items[4218], script: { vit: [expression] } } } };
    const found = await createSynergyOperations(conditional, config).findSynergies({ build: cardBuild, itemIds: [4218], bonusKeys: ['vit'], includePatches: true });
    const group = found.groups.find(entry => entry.sourceItemId === 4218)!;
    expect('patchStatus' in group && group.patchStatus).toBe('not-found');
    expect(group).not.toHaveProperty('patch');
    expect(group.expression).toBe(expression);
  });

  it('exposes real two-piece and five-piece card prerequisites without flattening them', async () => {
    for (const [itemId, required] of [[4218, [4269]], [4246, [4220, 4311, 4331, 4319]]] as const) {
      const result = await call('find_synergies', { itemIds: [itemId], limit: 30 });
      const rule = result.groups.find((entry: any) => entry.sourceItemId === itemId);
      expect(rule.allOf.map((group: any) => group.anyOf[0].itemIds[0])).toEqual(required);
      expect(rule.expression).toContain('EQUIP_ID[');
      expect(rule.sourceConfidence).toBe('authoritative-catalog');
      expect(rule).not.toHaveProperty('patch');
    }
  });

  it('retains OR alternatives, unresolved names and other conditions exactly', () => {
    const synthetic = { ...dataset, items: {
      1: { id: 1, name: 'Source', script: { atk: ['EQUIP_ID[2||3&&4]REFINE[11]20', 'EQUIP[Missing Name]5'] } },
      2: { id: 2, name: 'A' }, 3: { id: 3, name: 'B' }, 4: { id: 4, name: 'C' },
    } };
    const rules = synergyIndex(synthetic).forItems([1]);
    expect(rules[0].allOf.map(group => group.anyOf.map(option => option.itemIds))).toEqual([[[2], [3]], [[4]]]);
    expect(rules[0].remainingExpression).toBe('REFINE[11]20');
    expect(rules[0].conditionCoverage).toBe('structured');
    expect(rules[1].allOf[0].anyOf[0]).toEqual({ reference: 'Missing Name', itemIds: [] });
    expect(synergyIndex(synthetic).forItems([3])).toContain(rules[0]);
  });

  it('uses the same operation through MCP, paginates and does not claim an active bonus', async () => {
    const args = { build: { ...build, gear: { ...build.gear, armor: 15036 } }, itemIds: [15036], limit: 1 };
    const direct = await createSynergyOperations(dataset, config).findSynergies(args);
    expect(await call('find_synergies', args)).toEqual(JSON.parse(JSON.stringify(direct)));
    expect(direct.total).toBeGreaterThan(1);
    expect(direct.nextOffset).toBe(1);
    expect(direct.groups[0].equipmentRequirementsMet).toBe(false);
    const next = await call('find_synergies', { ...args, offset: 1 });
    expect(next.groups[0].id).not.toBe(direct.groups[0].id);
    expect((await call('find_synergies', {})).error).toContain('build ou itemIds');
  });
});
