import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

const dataset = loadDatasetFromDisk();
let client: Client;
const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(((await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any).content[0].text);

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'mvp', version: '1' });
  await Promise.all([createMcpServer(dataset).connect(b), client.connect(a)]);
});

describe('MVP cards', () => {
  it('search_items leaves them out only when asked', async () => {
    const all = await call('search_items', { query: 'Tao Gunka', slot: 'armorCard' });
    const filtered = await call('search_items', { query: 'Tao Gunka', slot: 'armorCard', excludeMvpCards: true });
    expect(all.items.map((item: any) => item.id)).toContain(4302);
    expect(filtered.items.map((item: any) => item.id)).not.toContain(4302);
    const described = await call('search_items', { query: 'Tao Gunka', slot: 'armorCard', withBonuses: true });
    expect(described.items[0].bonuses.length).toBeGreaterThan(0);
  });

  it('get_item says which card is MVP and lists the set partners', async () => {
    expect((await call('get_item', { id: 4302 })).mvpCard).toBe(true);
    const wolf = await call('get_item', { id: 300220 });
    expect(wolf.mvpCard).toBeUndefined();
    expect(wolf.partners?.length).toBeGreaterThan(0);
  });

  it('evaluate_variants refuses an MVP variant with a code, and still measures the others', async () => {
    const result = await call('evaluate_variants', {
      build: { preset: fixture.preset },
      target: { monsterId: 20994 },
      excludeMvpCards: true,
      variants: [{ label: 'mvp', patch: { gear: { armorCard: 4302 } } }, { label: 'plain', patch: { gear: { armorCard: 4393 } } }],
      metrics: ['dps'],
    });
    expect(result.errors).toEqual([expect.objectContaining({ label: 'mvp', code: 'MVP_CARD_EXCLUDED' })]);
    expect(result.results.map((row: any) => row.label)).toContain('plain');
    expect(result.results.map((row: any) => row.label)).not.toContain('mvp');
    expect(typeof result.engineVersion).toBe('string');
  });

  it('evaluate_variants refuses a variant that leaves a card in a piece with no sockets, and marks the rest ok', async () => {
    const socketless = dataset.items && Object.values(dataset.items as Record<string, any>).find((item) => !item.slots && dataset.itemIndex.get(item.id)?.latam && dataset.itemIndex.get(item.id)?.slotTags?.includes('armor'));
    const result = await call('evaluate_variants', {
      build: { preset: fixture.preset },
      target: { monsterId: 20994 },
      variants: [{ label: 'no-sockets', patch: { gear: { armor: socketless.id } } }, { label: 'same', patch: {} }],
      metrics: ['dps'],
    });
    expect(result.errors).toEqual([expect.objectContaining({ label: 'no-sockets', status: 'invalid', code: 'INVALID_SLOT' })]);
    expect(result.results).toEqual([expect.objectContaining({ label: 'same', status: 'ok' })]);
  });

  it('optimize_build does not add one', async () => {
    const before = await call('validate_build', { build: { preset: fixture.preset }, constraints: { excludeMvpCards: true } });
    const found = await call('optimize_build', { build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 400, procMode: 'off', excludeMvpCards: true });
    const after = await call('validate_build', { build: { share: found.share }, constraints: { excludeMvpCards: true } });
    const already = new Set(before.errors.filter((error: any) => error.code === 'MVP_CARD_EXCLUDED').map((error: any) => error.itemId));
    const added = after.errors.filter((error: any) => error.code === 'MVP_CARD_EXCLUDED' && !already.has(error.itemId));
    expect(added).toEqual([]);
  }, 300_000);

  describe('strictMvp', () => {
    // A build that wears Carta Tao Gunka (an MVP card) in the Traje do Lobo Cinzento.
    const worn = { preset: fixture.preset, gear: { armor: 450177, armorCard: 4302 } };

    it('takes the worn MVP cards out and returns a build with none', async () => {
      const before = await call('validate_build', { build: worn, constraints: { excludeMvpCards: true } });
      expect(before.errors.map((error: any) => error.code)).toContain('MVP_CARD_EXCLUDED');
      const found = await call('optimize_build', { build: worn, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 800, procMode: 'off', mvpPolicy: 'none', excludeMvpCards: false });
      expect(found.mvpPolicy).toBe('none');
      expect(found.mvpFree).toBe(true);
      const after = await call('validate_build', { build: { share: found.share }, constraints: { excludeMvpCards: true } });
      expect(after.errors.map((error: any) => error.code)).not.toContain('MVP_CARD_EXCLUDED');
      expect(JSON.stringify(found.steps)).toContain('Tao Gunka');
    }, 300_000);

    it('refuses when the MVP card sits on a locked piece', async () => {
      const result = await client.callTool({ name: 'optimize_build', arguments: { build: worn, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 200, procMode: 'off', strictMvp: true, lock: ['armor'] } }, undefined, { timeout: 300_000 }) as any;
      expect(JSON.parse(result.content[0].text).error).toContain('strictMvp');
    }, 300_000);
  });
});
