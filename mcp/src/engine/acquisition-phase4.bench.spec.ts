/**
 * Acquisition audit, Phase 4: unique components (not configurations) of what Optimize and the MCP recommend, over a wider sample than Phase 3
 * (bench builds, Inquisitor fixtures, the four Jor_ab02 builds and their optimize/scan results). Writes `.tmp/acquisition-phase4/<tag>.json`.
 *   PowerShell:  $env:BENCH=1; $env:PHASE4_TAG='before'; node node_modules/vitest/vitest.mjs run mcp/src/engine/acquisition-phase4.bench.spec.ts --maxWorkers=1
 * Optimize/scan results are cached in `.tmp/acquisition-phase4/sample.json` so the before/after runs assess the same builds.
 */
import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import benchBuilds from './__tests__/fixtures/bench-builds.json';
import jor from './__tests__/fixtures/jor-ab02.json';
import fogueira from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import inquisitor from './__tests__/fixtures/inquisitor-optimization.json';
import geared from './__tests__/fixtures/inquisitor-geared-hp.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { config } from '../config';

const BOSS = 20994;
const AS_OF = '2026-11-05';
const DIR = '.tmp/acquisition-phase4';
const SLOTS = ['weapon', 'headUpper', 'armor'];

describe.skipIf(!process.env['BENCH'])('acquisition phase 4 audit', () => {
  it('lists the unique components and their evidence', async () => {
    config.limits.maxSearchMs = 300_000;
    config.limits.maxSolves = 20_000;
    const server = createMcpServer(loadDatasetFromDisk());
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'audit4', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (tool: string, args: Record<string, unknown>) =>
      JSON.parse(((await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 900_000 })) as any).content[0].text);

    mkdirSync(DIR, { recursive: true });
    let sample: { origin: string; build: Record<string, unknown> }[];
    if (existsSync(`${DIR}/sample.json`)) sample = JSON.parse(readFileSync(`${DIR}/sample.json`, 'utf8'));
    else {
      sample = [];
      for (const [name, build] of Object.entries(benchBuilds as Record<string, Record<string, unknown>>)) {
        sample.push({ origin: `${name}:baseline`, build });
        const optimized = await call('optimize_build', { build, target: { monsterId: BOSS }, objective: 'dps', maxSolves: 2000, refine: 12, maxGrade: 'A', procMode: 'off' });
        sample.push({ origin: `${name}:optimize_build`, build: { share: optimized.share } });
        if (name !== 'b1') continue;
        for (const slot of SLOTS) {
          const scan = await call('scan_slot', { build, slot, target: { monsterId: BOSS }, limit: 8, maxSolves: 1500 });
          for (const row of scan.ranking ?? []) if (row.id) sample.push({ origin: `${name}:scan_slot:${slot}`, build: { ...build, gear: { [slot]: row.id } } });
        }
      }
      sample.push({ origin: 'fogueira:baseline', build: { preset: (fogueira as any).preset } });
      sample.push({ origin: 'inquisitor:baseline', build: { preset: (inquisitor as any).preset } });
      sample.push({ origin: 'geared-hp:baseline', build: { preset: geared } });
      for (const [name, v] of Object.entries((jor as any).builds)) sample.push({ origin: `jor:${name}`, build: { preset: (v as any).preset } });
      writeFileSync(`${DIR}/sample.json`, JSON.stringify(sample));
    }

    type Row = { aspect: string; itemId: number; name: string; configs: number; origins: string[]; documented: boolean; availability?: string; chance?: string; exceptional?: boolean; insufficient?: boolean; routes?: string[]; missing?: string[] };
    const unique = new Map<string, Row>();
    const touch = (aspect: string, itemId: number, name: string, origin: string, extra: Partial<Row>) => {
      const key = `${aspect}:${itemId}`;
      const row = unique.get(key) ?? { aspect, itemId, name, configs: 0, origins: [], documented: false };
      row.configs++;
      const tag = origin.split(':')[0];
      if (!row.origins.includes(tag)) row.origins.push(tag);
      Object.assign(row, extra);
      unique.set(key, row);
    };
    let invalid = 0;
    for (let i = 0; i < sample.length; i += 10) {
      const chunk = sample.slice(i, i + 10);
      const data = await call('get_acquisition', { builds: chunk.map(s => s.build), asOf: AS_OF });
      data.builds.forEach((r: any, j: number) => {
        const origin = chunk[j].origin;
        if (r.mechanical === 'invalid') invalid++;
        for (const c of r.documented) touch(c.aspect, c.itemId, c.name ?? '', origin, { documented: true, availability: c.availability, chance: c.chance, exceptional: !!c.exceptional, insufficient: !!c.insufficient, routes: c.routes, missing: c.missing });
        for (const id of r.undocumented.items) touch('item', id, data.names[id] ?? '', origin, {});
        for (const id of r.undocumented.enchants) touch('enchant', id, data.names[id] ?? '', origin, {});
      });
    }
    const rows = [...unique.values()].sort((x, y) => x.aspect.localeCompare(y.aspect) || y.configs - x.configs);
    const summary = {
      asOf: AS_OF, configurations: sample.length, mechanicallyInvalid: invalid, uniqueComponents: rows.length,
      byAspect: rows.reduce<Record<string, { unique: number; documented: number; undocumented: number }>>((acc, r) => {
        const s = (acc[r.aspect] ??= { unique: 0, documented: 0, undocumented: 0 });
        s.unique++; r.documented ? s.documented++ : s.undocumented++;
        return acc;
      }, {}),
    };
    const tag = process.env['PHASE4_TAG'] ?? 'run';
    writeFileSync(`${DIR}/${tag}.json`, JSON.stringify({ summary, rows }, null, 1));
    console.info(JSON.stringify(summary, null, 1));
  }, 3_600_000);
});
