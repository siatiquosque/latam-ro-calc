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
  client = new Client({ name: 'polish', version: '1' });
  await Promise.all([createMcpServer(dataset).connect(b), client.connect(a)]);
});

describe('last pass over the sockets', () => {
  it('does not leave a better card behind even when the budget is short (Fogueira: Derreting, Tao Gunka)', async () => {
    // A short budget is where the ranked search stops before it has looked at every slot: it used to keep Carta Alga Brilhante
    // in the Selo and Carta Abrigo in the armor. The last pass checks each socket against every legal card.
    const found = await call('optimize_build', { build: { preset: fixture.preset }, target: { monsterId: 20994 }, objective: 'dps', maxSolves: 800, procMode: 'off' });
    const variants = [{ label: 'found', patch: {} }, { label: 'derreting', patch: { gear: { headMiddleCard: 300174 } } }, { label: 'tao-gunka', patch: { gear: { armorCard: 4302 } } }];
    const measured = await call('evaluate_variants', { build: { share: found.share }, variants, metrics: ['dps'], target: { monsterId: 20994 }, limit: 10 });
    const dps = Object.fromEntries(measured.results.map((row: any) => [row.label, row.metrics.dps]));

    expect(dps['found']).toBeGreaterThanOrEqual(dps['derreting'] * 0.999);
    expect(dps['found']).toBeGreaterThanOrEqual(dps['tao-gunka'] * 0.999);
  }, 300_000);
});
