import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

let client: Client;
const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(((await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any).content[0].text);

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'scan', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
});

describe('scan_slot patches', () => {
  // The weapon has hundreds of candidates, so a modest budget ends before the full socket search: the rows used to carry the quick
  // stage's number with the bare patch, and the patch gave a lower DPS than the one announced (Varinha Invernal 129k against 73k).
  it.each([['weapon', 600], ['armor', 1500]])('%s: every patch, applied to the build, gives the DPS the row announces', async (slot, maxSolves) => {
    const scan = await call('scan_slot', { build: { preset: fixture.preset }, slot, target: { monsterId: 20994 }, includePatches: true, limit: 8, maxSolves, procMode: 'off' });
    expect(scan.ranking.length).toBeGreaterThan(0);
    const variants = [...scan.ranking.map((row: any, index: number) => ({ label: `row${index}`, patch: row.patch })), ...(scan.reference.patch ? [{ label: 'reference', patch: scan.reference.patch }] : [])];
    const measured = await call('evaluate_variants', { build: { preset: fixture.preset }, target: { monsterId: 20994 }, variants, metrics: ['dps'], limit: 20, procMode: 'off' });
    const dps = Object.fromEntries(measured.results.map((row: any) => [row.label, row.metrics.dps]));
    scan.ranking.forEach((row: any, index: number) => expect(dps[`row${index}`], `${row.name}`).toBeCloseTo(row.value, 0));
    if (scan.reference.patch) expect(dps['reference']).toBeCloseTo(scan.reference.value, 0);
  }, 300_000);
});
