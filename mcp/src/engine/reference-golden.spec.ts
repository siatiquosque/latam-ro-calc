/**
 * Reference values of the engine, to be read as "what the calculator says today", not as "what the game says". A change that moves
 * one of these numbers is either a deliberate fix (regenerate with UPDATE_GOLDEN=1 and read the diff) or a regression.
 *
 *   PowerShell:  $env:UPDATE_GOLDEN=1; npx vitest run mcp/src/engine/reference-golden.spec.ts
 *
 * Covers: every offensive skill of the Inquisitor at its top level (damage, critical rate, cast and cooldown timings, where the
 * 2026 rebalance and the POD/HP scalings live), the three bench builds, and the effect of an item set.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import benchBuilds from './__tests__/fixtures/bench-builds.json';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

const GOLDEN = join(import.meta.dirname, '__tests__', 'fixtures', 'reference-golden.json');
const update = !!process.env['UPDATE_GOLDEN'];
const dataset = loadDatasetFromDisk();
const BOSS_MEDIUM = 9000002;
const NORMAL_LARGE = 9000003;

let client: Client;
const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(((await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as any).content[0].text);

const snapshot = (result: any) => ({
  skill: result.damage.skill && { min: result.damage.skill.min, max: result.damage.skill.max, hits: result.damage.skill.hits, critRate: result.damage.skill.critRate, accuracy: result.damage.skill.accuracy },
  cast: result.stats.cast,
  stats: { atk: result.stats.atk, matk: result.stats.matk, hit: result.stats.hit, crit: result.stats.crit, aspd: result.stats.aspd, maxHp: result.stats.maxHp, def: result.stats.def, mdef: result.stats.mdef },
});

const measured: Record<string, unknown> = {};
const golden: Record<string, any> = update ? {} : JSON.parse(readFileSync(GOLDEN, 'utf8'));

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'golden', version: '1' });
  await Promise.all([createMcpServer(dataset).connect(b), client.connect(a)]);
});

const check = (key: string, value: unknown) => {
  measured[key] = value;
  if (!update) expect(value, key).toEqual(golden[key]);
};

describe('reference values', () => {
  const inquisitor = dataset.classes.newInstance(4262);
  const skills = inquisitor.atkSkills.filter((skill: any) => skill.levelList?.length).map((skill: any) => ({
    name: skill.name,
    top: Math.max(...skill.levelList.map((entry: { value: string }) => Number(String(entry.value).split('==').at(-1)))),
  }));

  it('lists the Inquisitor skills it will measure', () => {
    expect(skills.length).toBeGreaterThan(10);
    expect(skills.map((skill: { name: string }) => skill.name)).toEqual(expect.arrayContaining(['Explosion Blaster', 'Third Flame Bomb', 'Second Judgement']));
  });

  for (const skill of skills as { name: string; top: number }[]) {
    it(`${skill.name} Lv${skill.top} against a medium boss and a large normal dummy`, async () => {
      for (const [label, monsterId] of [['boss-medium', BOSS_MEDIUM], ['normal-large', NORMAL_LARGE]] as const) {
        const result = await call('calculate', { build: { preset: fixture.preset, atkSkill: `${skill.name}==${skill.top}` }, target: { monsterId } });
        check(`skill:${skill.name}:${label}`, snapshot(result));
      }
    });
  }

  for (const name of Object.keys(benchBuilds)) {
    it(`bench build ${name}`, async () => {
      const result = await call('calculate', { build: (benchBuilds as Record<string, unknown>)[name], target: { monsterId: BOSS_MEDIUM } });
      check(`build:${name}`, snapshot(result));
    });
  }

  it('an item set pays only with both halves (Carta Lobo Cinzento and its partner)', async () => {
    const card = dataset.itemIndex.record(300220);
    expect(JSON.stringify(card.script)).toContain('EQUIP_ID[300223]');
    const partners = await call('get_item', { id: 300220 });
    check('set:lobo-cinzento:partners', (partners.partners ?? []).map((partner: { id: number }) => partner.id).sort());
  });

  it('writes the file when asked', () => {
    if (!update) return;
    writeFileSync(GOLDEN, JSON.stringify(measured, null, 1) + '\n');
  });
});
