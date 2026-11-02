import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { config } from '../config';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { createCalculationOperations } from 'src/app/build-analysis/operations/calculate';
import { createOptimizationOperations, evaluate } from 'src/app/build-analysis/operations/optimize';
import { round } from 'src/app/utils';

const dataset = loadDatasetFromDisk();
const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 30_000 } };
const build = { class: 4262, level: 236, jobLevel: 50,
  stats: { str: 120, agi: 50, vit: 120, int: 80, dex: 120, luk: 63, pow: 100, con: 43 },
  gear: { weapon: 560026, weaponRefine: 11 }, atkSkill: 'Explosion Blaster==5',
  skills: { active: { 'Total Spirit': 15, 'Powerful Faith': 5 } } };
let client: Client;
beforeAll(async () => {
  await loadRandomPools();
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'shared-parity', version: '1' });
  await Promise.all([createMcpServer(dataset).connect(a), client.connect(b)]);
});
const call = async (name: string, args: any) => {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeFalsy();
  return JSON.parse((result.content[0] as { text: string }).text);
};

describe('shared build operations and MCP adapter', () => {
  it('returns the same calculation without any MCP envelope in the shared API', async () => {
    const args = { build, target: { monsterId: 9000002 } };
    const direct = await createCalculationOperations(dataset, runtime).calculate(args);
    expect(direct).not.toHaveProperty('content');
    expect(JSON.parse(JSON.stringify(direct))).toEqual(await call('calculate', args));
  });

  it('finds the same equipment and preserves locked slots through both entries', async () => {
    const args = { build, target: { monsterId: 9000002 }, slots: ['weapon', 'boot'], lock: ['weapon'],
      candidates: { boot: [470069] }, complements: false, combos: false, levelChecks: false, refine: 11, maxSolves: 80 };
    const direct = await createOptimizationOperations(dataset, runtime).optimizeBuild(args);
    const mcp = await call('optimize_build', args);
    expect(direct.patch).toEqual(mcp.patch);
    expect(direct.final).toEqual(mcp.final);
    expect(direct.baseline).toEqual(mcp.baseline);
    expect(direct.patch.gear?.['weapon']).toBeUndefined();
  });

  it('reproduces scan scores from the exact suggested patches, including socket cleanup', async () => {
    const ops = createOptimizationOperations(dataset, runtime);
    const args = { build, slot: 'weapon', target: { monsterId: 9000002 }, query: 'Soqueira Vil Invernal',
      includePatches: true, topSockets: 0, maxSolves: 80 };
    const scan = await ops.scanSlot(args);
    expect(scan.ranking.length).toBeGreaterThan(0);
    expect(scan.ranking.some(row => row.id !== build.gear.weapon)).toBe(true);
    for (const row of scan.ranking) {
      expect(row.patch).toBeDefined();
      const measured = evaluate(args.build, row.patch, dataset, dataset.monsters[9000002], [], [scan.objective]);
      expect(round(measured.metrics[scan.objective], 2)).toBe(row.value);
    }
    const viaMcp = await call('scan_slot', args);
    expect(viaMcp.ranking.map((row: any) => row.patch)).toEqual(scan.ranking.map(row => row.patch));
    const compact = await ops.scanSlot({ ...args, includePatches: false });
    expect(compact.ranking[0]).not.toHaveProperty('patch');
  });
});
