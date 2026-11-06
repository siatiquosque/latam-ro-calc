/** `get_acquisition`, called the way an agent would: through a real in-memory MCP client. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

const dataset = loadDatasetFromDisk();
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content[0].text as string;
  return { data: JSON.parse(text), bytes: text.length, isError: !!res.isError };
};

const BUILD = {
  class: 4262, level: 236, jobLevel: 50,
  stats: { str: 120, agi: 50, vit: 120, int: 80, dex: 120, luk: 63, pow: 100, con: 43 },
  gear: { weapon: 560026, weaponRefine: 11, headUpper: 19482, headUpperEnchant1: 29080 },
  atkSkill: 'Explosion Blaster==5',
};

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec', version: '1.0.0' });
  await Promise.all([createMcpServer(dataset).connect(serverTransport), client.connect(clientTransport)]);
});

describe('get_acquisition', () => {
  it('reports a material drop with its documented fraction, source and unconfirmed LATAM status', async () => {
    const { data, isError } = await call('get_acquisition', { itemId: 25864, asOf: '2026-11-05' });
    expect(isError).toBe(false);
    const drop = data.routes.find((r: any) => r.drop?.probability);
    expect(drop.drop.probability).toEqual({ numerator: expect.any(Number), denominator: expect.any(Number) });
    expect(drop.availability).toBe('unknown');
    expect(drop.review).toBe('unreviewed');
    expect(Object.keys(data.sources).length).toBeGreaterThan(0);
    expect(data.omittedRoutes ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('says "no documented route" without calling the item impossible', async () => {
    const { data } = await call('get_acquisition', { itemId: 560026 });
    expect(data.routes).toEqual([]);
    expect(data.missing[0]).toContain('não prova');
  });

  it('assesses a build: mechanical validity apart from acquisition, shared route table, event facets', async () => {
    const { data, bytes } = await call('get_acquisition', { builds: [BUILD], asOf: '2026-11-05' });
    const [result] = data.builds;
    expect(['valid', 'invalid']).toContain(result.mechanical);
    const enchant = result.documented.find((c: any) => c.aspect === 'enchant');
    expect(enchant).toMatchObject({ availability: 'confirmed', chance: 'known', exceptional: true });
    expect(enchant.routes.every((id: string) => data.routes[id])).toBe(true);
    expect(data.routes['temporal-exchange-17-v1']).toMatchObject({ availability: 'expired' });
    expect(result.undocumented.items).toContain(560026);
    expect(data.names[560026]).toBeTruthy();
    expect(result.undocumentedByAspect.refine).toBe(1);
    expect(bytes).toBeLessThan(8_000);
  });

  it('assesses several finalists in one call without repeating shared routes', async () => {
    const { data } = await call('get_acquisition', { builds: [BUILD, { ...BUILD, gear: { ...BUILD.gear, headUpperEnchant1: 29075 } }] });
    expect(data.builds).toHaveLength(2);
    const ids = data.builds.flatMap((b: any) => b.documented.flatMap((c: any) => c.routes));
    expect(Object.keys(data.routes).length).toBeLessThan(ids.length);
  });

  it('rejects ambiguous selectors', async () => {
    expect((await call('get_acquisition', {})).isError).toBe(true);
    expect((await call('get_acquisition', { itemId: 1, monsterId: 2 })).isError).toBe(true);
  });
});
