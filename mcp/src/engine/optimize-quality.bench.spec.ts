/**
 * Quality ratchet for the optimizer. A change to the search (candidates, effort, ranking, budget) can quietly make the
 * recommendation worse while every unit test still passes; this measures it. For each build it runs `optimize_build` with
 * generous limits, measures the recommended build with the same engine, and fails if it falls below the floor in
 * `__tests__/fixtures/optimize-golden.json` (the best result recorded, less a small tolerance for time-dependent runs).
 *
 * It takes minutes, so it only runs on request:
 *   PowerShell:  $env:BENCH=1; npx vitest run mcp/src/engine/optimize-quality.bench.spec.ts --maxWorkers=1
 * When a change finds a better build, raise the floor in the golden file (never lower it to make a run pass).
 */
import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import golden from './__tests__/fixtures/optimize-golden.json';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { config } from '../config';

const BOSS = 20994;

describe.skipIf(!process.env['BENCH'])('optimizer quality', () => {
  it.each(Object.keys(golden.floors))('%s: the recommended build does not fall below the recorded one', async (name) => {
    config.limits.maxSearchMs = 300_000;
    config.limits.maxSolves = 20_000;
    const server = createMcpServer(loadDatasetFromDisk());
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'bench', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (tool: string, args: Record<string, unknown>) => JSON.parse(((await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 900_000 })) as any).content[0].text);

    const found = await call('optimize_build', { build: (builds as Record<string, unknown>)[name], target: { monsterId: BOSS }, objective: 'dps', maxSolves: 20_000, refine: 12, maxGrade: 'A', procMode: 'off' });
    const measured = await call('evaluate_variants', { build: { share: found.share }, variants: [{ label: 'x', patch: {} }], metrics: ['dps'], target: { monsterId: BOSS } });
    const dps = measured.results[0].metrics.dps as number;
    const floor = (golden.floors as Record<string, number>)[name];

    console.info(`${name}: ${dps} (floor ${floor})`);
    expect(dps).toBeGreaterThanOrEqual(floor * (1 - golden.tolerance));
  }, 900_000);
});
