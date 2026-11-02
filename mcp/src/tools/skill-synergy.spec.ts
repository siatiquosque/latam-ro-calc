import { beforeAll, afterAll, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import fixture from '../engine/__tests__/fixtures/inquisitor-fogueira-optimization.json';

let client: Client;
beforeAll(async () => {
  const [a,b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'skill-synergy', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(a), client.connect(b)]);
});
afterAll(async () => client.close());
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
}
it('lets an agent discover HP dependencies, find a head card, and inspect its bonus without optimizing', async () => {
  const skill = await call('get_skill', { classId: 4262, skill: 'Fogueira Espiritual', level: 5 });
  expect(skill.description).toBeTruthy();
  expect(skill.scaling.resources).toContain('hp');
  const found = await call('search_items', { classId: 4262, skill: 'Fogueira Espiritual', synergy: true, slot: 'headCard', query: 'Derreting' });
  expect(found.items.some((row: any) => row.id === 300174)).toBe(true);
  const item = await call('get_item', { id: 300174 });
  expect(item.description).toBeTruthy();
  expect(item.bonuses.some((row: any) => row.key === 'hpPercent')).toBe(true);
  const measured = await call('evaluate_variants', { build: { preset: fixture.preset }, metrics: ['dps'], variants: [
    { label: 'atual', patch: {} }, { label: 'Derreting', patch: { gear: { headUpperCard: 300174 } } },
  ] });
  expect(measured.results).toHaveLength(2);
  expect(measured.results.every((row: any) => row.metrics.dps > 0)).toBe(true);
});
it('supports enchantment discovery for the same skill and validates requested levels', async () => {
  const found = await call('search_items', { classId: 4262, skill: 'Third Flame Bomb', synergy: true, slot: 'enchant', limit: 50 });
  expect(found.total).toBeGreaterThan(0);
  const error = await client.callTool({ name: 'get_skill', arguments: { classId: 4262, skill: 'Fogueira Espiritual', level: 99 } });
  expect(error.isError).toBe(true);
});
