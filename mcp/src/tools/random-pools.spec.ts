import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

let client: Client;
const call = async (args: Record<string, unknown>) => {
  const res: any = await client.callTool({ name: 'uncatalogued_pools', arguments: args });
  return { data: JSON.parse(res.content[0].text), isError: !!res.isError };
};

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec', version: '1.0.0' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
});

describe('uncatalogued_pools', () => {
  it('lists items no regional source confirms, never the confirmed ones, rAthena fallbacks first', async () => {
    const { data } = await call({ limit: 100 });
    expect(data.total).toBeGreaterThan(0);
    expect(data.items.some((item: any) => item.id === 410233)).toBe(false);
    const flags = data.items.map((item: any) => item.pool === 'rathena');
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
    expect(data.items.every((item: any) => ['rathena', 'nenhum'].includes(item.pool))).toBe(true);
  });
  it('pages, and filters by name', async () => {
    const first = (await call({ limit: 2 })).data;
    expect(first.shown).toBe(2);
    const second = (await call({ limit: 2, offset: 2 })).data;
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const none = (await call({ query: 'zzzz-nao-existe' })).data;
    expect(none.total).toBe(0);
  });
  it('drafts a pool from the upstream reference without calling it confirmed', async () => {
    const withPool = (await call({ limit: 100 })).data.items.find((item: any) => item.pool === 'rathena');
    if (!withPool) return;
    const { data } = await call({ itemId: withPool.id });
    expect(data.catalogued).toBe(false);
    expect(data.pool.confidence).toMatch(/confirmar no jogo/);
    expect(Array.isArray(data.pool.profiles[0].positions)).toBe(true);
    expect(Array.isArray(data.unmapped)).toBe(true);
  });
  it('says so when the item is already catalogued, and rejects unknown items', async () => {
    expect((await call({ itemId: 410233 })).data).toMatchObject({ catalogued: true });
    expect((await call({ itemId: 999999999 })).isError).toBe(true);
  });
});
