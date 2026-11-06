/** Isolated transcript runner: a real MCP client, hand-authored agent requests, frozen local data. No model API. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp-server';
import { config } from '../config';
import { loadDatasetFromDisk } from '../data/dataset.node';
import source from './__tests__/fixtures/jor-ab02.json';
import { solveController } from 'src/app/build-analysis/engine/solve';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { evaluate } from 'src/app/build-analysis/engine/evaluate';
import { judgedMetrics } from 'src/app/build-analysis/engine/goal-spec';
import { judgeFeasibility } from 'src/app/build-analysis/engine/feasibility';
import { applyPatch } from 'src/app/build-analysis/engine/variants';
import { createOptimizationOperations } from 'src/app/build-analysis/operations/optimize';
import { APP_VERSION } from 'src/app/core/app-version';

const root = 'docs/benchmarks/ai-guided-poc';
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const fixture = {
  provenance: { source: 'mcp/src/engine/__tests__/fixtures/jor-ab02.json#builds.original', originalSlug: '5hTy6pd', shortLinkResolved: false },
  build: { preset: source.builds.original.preset },
  targets: source.monsters.map(monsterId => ({ monsterId })),
  goal: { maxHitsToKill: 2, margin: 0 },
  constraints: { mvpPolicy: 'none' as const, maxGrade: 'C' as const, forbiddenEffects: ['Oleum Sanctum'], consumables: { forbidden: [14536] } },
  versions: { app: APP_VERSION, sourceSnapshot: hash('mcp/src/engine/__tests__/fixtures/jor-ab02.json'),
    items: hash('src/assets/data/items-core.json'), monsters: hash('src/assets/data/monsters.json'),
    optimize: hash('src/app/build-analysis/operations/optimize.ts'), evaluator: hash('src/app/build-analysis/engine/evaluate.ts') },
};

describe.skipIf(!process.env['AI_POC'])('knowledge-guided MCP proof of concept', () => {
  it('executes the next explicit experiment or agent-authored batch', async () => {
    mkdirSync(root, { recursive: true });
    const freeze = join(root, 'fixture.json');
    if (existsSync(freeze)) expect(JSON.parse(readFileSync(freeze, 'utf8'))).toEqual(fixture);
    else writeFileSync(freeze, JSON.stringify(fixture, null, 2));
    const data = loadDatasetFromDisk();
    const batchName = process.env['POC_BATCH']!;
    const batch = JSON.parse(readFileSync(join(root, 'requests', `${batchName}.json`), 'utf8'));
    const dir = join(root, batch.experiment); mkdirSync(dir, { recursive: true });
    const previous = readdirSync(dir).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(join(dir, file), 'utf8')));
    expect(existsSync(join(dir, `${batchName}.json`)), 'Never overwrite an agent transcript silently').toBe(false);
    let total = previous.reduce((sum, row) => sum + row.calls, 0), calls = 0;
    const start = performance.now(), cpu = process.cpuUsage();
    const original = solveController.solveSkill;
    const spy = vi.spyOn(solveController, 'solveSkill').mockImplementation(function(...args) {
      if (total + calls >= batch.budget - (batch.final ? 0 : 10)) throw new Error('POC shared engine-call limit');
      calls++;
      return original.apply(solveController, args);
    });
    const rows: any[] = [];
    const expand = (value: any): any => value === '$build' ? structuredClone(fixture.build) : value === '$targets' ? fixture.targets
      : value === '$constraints' ? fixture.constraints : value === '$goal' ? fixture.goal : Array.isArray(value) ? value.map(expand)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expand(entry)])) : value;
    try {
      if (batch.automatic) {
        const checkpoints: any[] = [];
        const args = { build: fixture.build, targets: fixture.targets, goal: fixture.goal, constraints: fixture.constraints,
          objective: 'dps' as const, procMode: 'off' as const, maxGrade: 'C' as const, refine: 12,
          maxSolves: 100_000, maxEngineCalls: batch.budget - total - 10, instrument: true,
          execution: { onCheckpoint: (checkpoint: any) => checkpoints.push({ calls: total + calls, metrics: checkpoint.final, feasibility: checkpoint.feasibility?.final }) },
          ...expand(batch.automatic) };
        const runtime = { ...config, limits: { ...config.limits, maxSearchMs: 60_000, maxSolves: 100_000 } };
        const result = await createOptimizationOperations(data, runtime).optimizeBuild(args as any);
        rows.push({ tool: 'optimize_build-core', args: { ...args, execution: undefined }, result, checkpoints });
      }
      if (batch.requests?.length) {
        const [a, b] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'ai-poc-live-agent', version: '1' });
        const server = createMcpServer(data);
        await Promise.all([server.connect(b), client.connect(a)]);
        try {
          for (const request of batch.requests) {
            const args = expand(request.args), before = calls, started = performance.now(), cpuStart = process.cpuUsage();
            const result: any = await client.callTool({ name: request.tool, arguments: args }, undefined, { timeout: 300_000 });
            const raw = result.content?.find((entry: any) => entry.type === 'text')?.text ?? '{}';
            rows.push({ hypothesis: request.hypothesis, tool: request.tool, args, calls: calls - before,
              wallMs: performance.now() - started, cpu: process.cpuUsage(cpuStart),
              requestBytes: Buffer.byteLength(JSON.stringify(args)), responseBytes: Buffer.byteLength(raw),
              isError: result.isError ?? false, result: JSON.parse(raw) });
          }
        } finally { await client.close(); await server.close(); }
      }
      for (const verification of batch.verifications ?? [batch.verify]) if (verification) {
        const before = calls, selected = verification.share ? { share: verification.share } : applyPatch(fixture.build, verification.patch ?? {});
        const wanted = [...new Set([...judgedMetrics(fixture.goal), 'min', 'dps', 'hit'] as const)];
        const readings = fixture.targets.map(({ monsterId }) => ({ monsterId, name: data.monsters[monsterId].name,
          hp: data.monsters[monsterId].stats.health, metrics: evaluate(selected, undefined, data, data.monsters[monsterId], [], wanted).metrics }));
        const feasibility = judgeFeasibility({ dataset: data, base: fixture.build, build: selected, goal: fixture.goal,
          constraints: fixture.constraints, readings });
        const baseline = resolveBuild(fixture.build, data).model, final = resolveBuild(selected, data).model;
        const changes = Object.keys(final).filter(key => JSON.stringify(final[key]) !== JSON.stringify(baseline[key]));
        rows.push({ tool: 'independent-final-verification', calls: calls - before, patch: verification.patch ?? {}, share: verification.share, readings, feasibility, changes });
      }
    } finally {
      spy.mockRestore();
      writeFileSync(join(dir, `${batchName}.json`), JSON.stringify({ batchName, budget: batch.budget, previousCalls: total, calls,
        cumulativeCalls: total + calls, wallMs: performance.now() - start, cpu: process.cpuUsage(cpu), rows }, null, 2));
    }
    expect(total + calls).toBeLessThanOrEqual(batch.budget);
    for (const row of rows) expect(row.isError, JSON.stringify(row.result ?? row).slice(0, 300)).not.toBe(true);
  }, 300_000);
});
