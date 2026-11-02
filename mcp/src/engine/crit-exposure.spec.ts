import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

let client: Client;
const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(((await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as any).content[0].text);

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'crit', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
});

describe('critical chance of a skill', () => {
  const build = { preset: fixture.preset, atkSkill: 'Explosion Blaster==5' };

  it('explain_damage says the chance the skill really rolls against the target, with its terms', async () => {
    const boss = await call('explain_damage', { build, target: { monsterId: 20994 }, parts: ['crit'] });
    const calculated = await call('calculate', { build, target: { monsterId: 20994 } });
    expect(boss.crit.skillChancePct).toBe(calculated.damage.skill.critRate);
    expect(boss.crit.skillChancePct).toBeGreaterThan(0);
    expect(boss.crit.steps.length).toBeGreaterThan(0);
    // A dummy without crit shield: the same build rolls more.
    const dummy = await call('explain_damage', { build, target: { monsterId: 9000002 }, parts: ['crit'] });
    expect(dummy.crit.skillChancePct).toBeGreaterThan(boss.crit.skillChancePct);
  });

  it('a skill that cannot crit says 0 and why', async () => {
    const bomb = await call('explain_damage', { build: { preset: fixture.preset, atkSkill: 'Third Flame Bomb==5' }, target: { monsterId: 20994 }, parts: ['crit'] });
    expect(bomb.crit.skillChancePct).toBe(0);
    expect(bomb.crit.note).toContain('não critica');
  });

  it('get_skill carries how the skill uses the crit', async () => {
    const info = await call('get_skill', { classId: 4262, skill: 'Explosion Blaster' });
    expect(info.crit).toMatchObject({ canCrit: true, shareOfCharacterCrit: 1, shareOfCritDamage: 0.5 });
  });

  // The skill typed without its level used to be replaced by the class default (Asura Strike, which does not crit) and the answer
  // said so only by echoing the other name: "Explosion Blaster" came back with a critical chance of 0.
  it.each(['Explosion Blaster', 'explosion blaster', 'Técnica da Mão Explosiva', '5244', 'Explosion Blaster==5'])('%s is Explosion Blaster, not the class default', async (typed) => {
    const result = await call('calculate', { build: { preset: fixture.preset, atkSkill: typed }, target: { monsterId: 20994 } });
    expect(result.build.atkSkill).toBe('Explosion Blaster==5');
    expect(result.damage.skill.critRate).toBeGreaterThan(0);
  });

  it('a lower level typed by name is kept', async () => {
    const result = await call('calculate', { build: { preset: fixture.preset, atkSkill: 'Explosion Blaster==3' }, target: { monsterId: 20994 } });
    expect(result.build.atkSkill).toBe('Explosion Blaster==3');
  });

  it('refuses a skill the class does not have, or a level it does not offer, instead of calculating another', async () => {
    for (const typed of ['Banana Strike', 'Explosion Blaster==9']) {
      const result = await call('calculate', { build: { preset: fixture.preset, atkSkill: typed }, target: { monsterId: 20994 } });
      expect(result.error, typed).toContain('list_skills');
    }
  });
});
