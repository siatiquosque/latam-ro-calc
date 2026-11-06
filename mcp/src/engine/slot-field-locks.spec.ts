import { beforeAll, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp-server';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { gearOnlyStart } from './__tests__/jor-ab02-support';

let client: Client;
const start = gearOnlyStart();
beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'locks', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
});
const call = async (name: string, extra: object) => {
  const res: any = await client.callTool({ name, arguments: { build: { preset: start }, target: { monsterId: 20994 }, ...extra } });
  expect(res.isError).toBeFalsy();
  return JSON.parse(res.content[0].text);
};

it.each(['optimize_slot', 'scan_slot'])('%s rejects an invalid field lock', async name => {
  const result: any = await client.callTool({ name, arguments: { build: { preset: start }, slot: 'weapon', candidates: [start['weapon']], constraints: { lockedFields: ['weaponCard9'] } } });
  expect(result.isError).toBe(true);
});

it('optimize_slot filters replacement pieces when a socket pins its owner', async () => {
  const result = await call('optimize_slot', { slot: 'weapon', candidates: [start['weapon'], 640023], constraints: { lockedFields: ['weaponCard1', 'weaponRefine', 'weaponGrade'] } });
  expect(result.tested).toBe(1);
  expect(result.ranking[0].id).toBe(start['weapon']);
}, 300_000);

it('optimize_slot cannot replace a locked socket directly', async () => {
  const result = await call('optimize_slot', { slot: 'weaponCard1', candidates: [start['weaponCard1'], 4001], constraints: { lockedFields: ['weaponCard1'] } });
  expect(result.ranking.map((row: any) => row.id)).toEqual([start['weaponCard1']]);
}, 300_000);

it('a locked weapon still allows optimize_slot to improve its cards', async () => {
  const withoutCards = { ...start, weaponCard1: 0, weaponCard2: 0 };
  const result = await call('optimize_slot', { build: { preset: withoutCards }, slot: 'weapon', candidates: [start['weapon']], constraints: { lockedFields: ['weapon'] } });
  const parsed = await call('parse_share_link', { share: result.share });
  expect(parsed.compare.items.weapon.id).toBe(start['weapon']);
  expect(parsed.compare.items.weaponCard1?.id ?? 0).toBeGreaterThan(0);
}, 300_000);

it('scan_slot returns only the pinned piece and keeps its locked upgrades', async () => {
  const result = await call('scan_slot', { slot: 'weapon', maxSolves: 100, includePatches: true, constraints: { lockedFields: ['weaponRefine', 'weaponGrade', 'weaponCard1'] } });
  expect(result.ranking.length).toBe(1);
  expect(result.ranking[0].id).toBe(start['weapon']);
  const gear = result.ranking[0].patch.gear;
  for (const key of ['weaponRefine', 'weaponGrade', 'weaponCard1']) expect(gear[key] ?? start[key]).toBe(start[key]);
}, 300_000);
