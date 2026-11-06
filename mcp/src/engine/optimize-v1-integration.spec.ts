import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp-server';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { gearOnlyStart, MONSTERS } from './__tests__/jor-ab02-support';

it('exposes budget and a reproducible, field-locked partial result over MCP', async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'v1-contract', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
  const build = { preset: gearOnlyStart() }, targets = MONSTERS.slice(0, 2).map(monsterId => ({ monsterId }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    expect(result.isError).toBeFalsy();
    return JSON.parse(result.content[0].text);
  };
  const found = await call('optimize_build', { build, targets, goal: { maxHitsToKill: 2 }, constraints: { lockedFields: ['weaponCard1'] },
    objective: 'dps', procMode: 'off', complements: false, maxSolves: 100 });
  expect(found.budgetUsage.hardTotalLimit).toBe(false);
  expect(found.budgetUsage.engineCalls).toBeGreaterThan(found.solves);
  expect(found.budgetUsage.feasibilityVerificationCalls).toBe(4);
  expect(found.feasibility.final.violations).toEqual([]);
  expect(found.patch.gear.weaponCard1 ?? build.preset['weaponCard1']).toBe(build.preset['weaponCard1']);
  const variants = await call('evaluate_variants', { build, targets, variants: [{ label: 'patch', patch: found.patch }], metrics: ['dps'], validationMode: 'hypothetical', procMode: 'off' });
  const average = variants.results[0].perTarget.reduce((n: number, x: any) => n + x.metrics.dps, 0) / targets.length;
  expect(average).toBeCloseTo(found.final.dps, 1);
  const fromLink = await call('evaluate_variants', { build: { share: found.share }, targets, variants: [{ label: 'link', patch: {} }], metrics: ['dps'], validationMode: 'hypothetical', procMode: 'off' });
  const linkAverage = fromLink.results[0].perTarget.reduce((n: number, x: any) => n + x.metrics.dps, 0) / targets.length;
  expect(linkAverage).toBeCloseTo(found.final.dps, 1);
  const limited = await call('optimize_build', { build, targets, goal: { maxHitsToKill: 2 }, constraints: { lockedFields: ['weaponCard1'] },
    objective: 'dps', procMode: 'off', complements: false, maxSolves: 100, maxEngineCalls: 100 });
  expect(limited.budgetUsage.hardTotalLimit).toBe(true);
  expect(limited.budgetUsage.engineCalls).toBeLessThanOrEqual(100);
  expect(limited.feasibility.final.violations).toEqual([]);
  await client.close();
}, 300_000);

it('returns the same semantic result through MCP and the worker core contract', async () => {
  const { createOptimizationOperations } = await import('src/app/build-analysis/operations/optimize');
  const { config } = await import('../config');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'ui-mcp-parity', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
  const preset = gearOnlyStart();
  const args: any = { build: { preset }, targets: MONSTERS.map(monsterId => ({ monsterId })),
    goal: { maxHitsToKill: 2, margin: 0.1 }, constraints: { lockedFields: ['weaponCard1'], mvpPolicy: 'exclude-new', maxGrade: 'C' },
    objective: 'dps', procMode: 'off', slots: ['weapon'], candidates: { weapon: [preset['weapon']] },
    equipmentMode: 'current', complements: false, maxSolves: 100, maxEngineCalls: 80 };
  const response: any = await client.callTool({ name: 'optimize_build', arguments: args }, undefined, { timeout: 300_000 });
  expect(response.isError).toBeFalsy();
  const mcp = JSON.parse(response.content[0].text);
  const ui: any = await createOptimizationOperations(loadDatasetFromDisk(), config).optimizeBuild({ ...args, execution: { signal: new AbortController().signal, onCheckpoint: () => {} } });
  expect(ui.patch).toEqual(mcp.patch);
  expect(ui.final).toEqual(mcp.final);
  expect(ui.feasibility.final).toEqual(mcp.feasibility.final);
  expect(ui.budgetUsage.stoppedBy).toBe(mcp.budgetUsage.stoppedBy);
  expect(ui.budgetUsage.engineCalls).toBeLessThanOrEqual(80);
  await client.close();
}, 300_000);

it('keeps DPS without GoalSpec equivalent between MCP and the worker core contract', async () => {
  const { createOptimizationOperations } = await import('src/app/build-analysis/operations/optimize');
  const { config } = await import('../config');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'ui-mcp-dps', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk()).connect(b), client.connect(a)]);
  const preset = gearOnlyStart();
  const args: any = { build: { preset }, targets: [{ monsterId: MONSTERS[0] }], constraints: { mvpPolicy: 'allow', lockedSlots: [], lockedFields: [] },
    profile: 'sustained', procMode: 'off', equipmentMode: 'current', slots: ['weapon'], complements: false, maxSolves: 100, maxEngineCalls: 30 };
  const response: any = await client.callTool({ name: 'optimize_build', arguments: args }, undefined, { timeout: 300_000 });
  expect(response.isError).toBeFalsy();
  const mcp = JSON.parse(response.content[0].text);
  const ui: any = await createOptimizationOperations(loadDatasetFromDisk(), config).optimizeBuild({ ...args, execution: { signal: new AbortController().signal, onCheckpoint: () => {} } });
  expect(ui.patch).toEqual(mcp.patch);
  expect(ui.final).toEqual(mcp.final);
  expect(ui.feasibility.final).toEqual(mcp.feasibility.final);
  await client.close();
}, 300_000);
