/** The acquisition diagnostic is isolated: when it fails, the optimization result is intact and the failure is stated. */
import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';

vi.mock('src/app/build-analysis/operations/acquisition', () => ({ createAcquisitionOperations: () => { throw new Error('catalog unavailable'); } }));

describe('optimize_build acquisition failure', () => {
  it('keeps the result and reports the diagnostic as unavailable', async () => {
    const server = createMcpServer(loadDatasetFromDisk());
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'spec', version: '1' });
    await Promise.all([server.connect(b), client.connect(a)]);
    const args = { build: { class: 4262, level: 236, jobLevel: 50, gear: { weapon: 560026, weaponRefine: 11 }, atkSkill: 'Explosion Blaster==5' }, maxSolves: 120, rounds: 1, candidatesPerSlot: 3 };
    const run = async (extra: object) => JSON.parse(((await client.callTool({ name: 'optimize_build', arguments: { ...args, ...extra } })) as any).content[0].text);
    const plain = await run({});
    const { acquisition, ...rest } = await run({ acquisition: 'brief' });
    expect(rest).toEqual(plain);
    expect(acquisition).toEqual({ status: 'unavailable', reason: 'catalog unavailable' });
  }, 300_000);
});
