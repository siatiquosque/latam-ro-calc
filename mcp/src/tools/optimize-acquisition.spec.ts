/** `optimize_build` with `acquisition: 'brief'`: a post-search diagnostic of what the recommendation changes, on the real catalog. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { config } from '../config';
import { createAcquisitionOperations } from 'src/app/build-analysis/operations/acquisition';
import { engineCallCount } from 'src/app/build-analysis/engine/evaluate';
import { acquisitionKnowledge } from 'src/app/build-analysis/acquisition/catalog';

const dataset = loadDatasetFromDisk();
const BASE = { class: 4262, level: 236, jobLevel: 50, stats: { str: 120, agi: 50, vit: 120, int: 80, dex: 120, luk: 63, pow: 100, con: 43 }, atkSkill: 'Explosion Blaster==5' };
const withGear = (gear: Record<string, unknown>) => ({ ...BASE, gear });
const TEMPORAL = { headUpper: 19482, headUpperEnchant1: 29080 };
const VIS = { weapon: 500054, weaponEnchant1: 311453 };
const AS_OF = '2026-11-05';
const ops = createAcquisitionOperations(dataset, config);
const brief = (original: object, final: object, asOf = AS_OF, o = ops) => o.brief({ original: original as never, final: final as never, asOf });
const byPath = (b: Awaited<ReturnType<typeof brief>>, path: string) => b.changed.find(c => c.path === path || c.paths?.includes(path))!;
const paths = (b: Awaited<ReturnType<typeof brief>>) => b.changed.flatMap(c => c.paths ?? [c.path!]);

describe('acquisition brief (real catalog)', () => {
  it('identical original and final: nothing to obtain, everything counted as preserved', async () => {
    const b = await brief(withGear({ ...TEMPORAL, ...VIS }), withGear({ ...TEMPORAL, ...VIS }));
    expect(b.changed).toEqual([]);
    expect(b.configuration).toMatchObject({ level: 'unchanged', components: { changed: 0 }, withoutProcedure: { count: 0 } });
    expect(b.configuration.components.preserved).toBeGreaterThanOrEqual(4);
  });

  it('kept piece with a changed enchant: only the enchant is a new acquisition, never the base item', async () => {
    const b = await brief(withGear({ headUpper: 19482, headUpperEnchant1: 29075 }), withGear(TEMPORAL));
    expect(paths(b)).toEqual(['gear.headUpperEnchant1']);
    expect(b.configuration.components).toEqual({ changed: 1, preserved: 1, documented: 1 });
    expect(byPath(b, 'gear.headUpperEnchant1')).toMatchObject({ itemId: 29080, aspect: 'enchant', exceptional: true, availability: 'confirmed', chance: 'known' });
    expect(b.alerts['exceptional']).toHaveLength(1);
    expect(b.alerts['expired']).toBeUndefined();
    expect(b.configuration.level).toBe('complete');
    expect(b.configuration.note).toContain('não significa fácil');
  });

  it('a new base item makes the enchants on it new too; a lowered refine is not an acquisition', async () => {
    const b = await brief(withGear({ headUpper: 19481, headUpperEnchant1: 29080, weapon: 500054, weaponRefine: 12 }), withGear({ ...TEMPORAL, weapon: 500054, weaponRefine: 10 }));
    expect(paths(b).sort()).toEqual(['gear.headUpper', 'gear.headUpperEnchant1']);
  });

  it('an ended event: the expired route is reported, not hidden and not called impossible', async () => {
    const expired = { ...acquisitionKnowledge, routes: acquisitionKnowledge.routes.filter(r => r.id === 'temporal-exchange-17-v1') };
    const b = await brief(withGear({ headUpper: 19482 }), withGear(TEMPORAL), AS_OF, createAcquisitionOperations(dataset, config, undefined, expired));
    expect(byPath(b, 'gear.headUpperEnchant1')).toMatchObject({ status: 'expired_routes', availability: 'expired_only', exceptional: true });
    expect(b.alerts['expired']).toEqual([expect.any(String)]);
    expect(b.alerts['exceptional']).toBeUndefined();
    expect(b.configuration).toMatchObject({ level: 'partial', expiredOnly: 1 });
  });

  it('documented route with unknown odds and unconfirmed LATAM availability is partial, never easy', async () => {
    const b = await brief(withGear({ weapon: 560026 }), withGear(VIS));
    expect(byPath(b, 'gear.weaponEnchant1')).toMatchObject({ chance: 'unknown', insufficient: true });
    expect(byPath(b, 'gear.weapon')).toMatchObject({ availability: 'unconfirmed', chance: 'unknown' });
    expect(b.configuration.level).toBe('partial');
    expect(b.configuration.unknownChance).toBeGreaterThanOrEqual(2);
    expect(b.configuration.unconfirmedLatam).toBeGreaterThanOrEqual(1);
    expect(b.changed.every(c => c.status !== 'obtainable')).toBe(true);
    expect(b.alerts['expired']).toBeUndefined();
  });

  it('a known odds below 1% is flagged as low chance, never as impossible', async () => {
    const b = await brief(withGear({}), withGear({ weapon: 560020, weaponCard1: 300240 }));
    expect(b.alerts['lowChance']?.length).toBeGreaterThan(0);
    expect(b.changed.filter(c => c.alert === 'lowChance').every(c => c.route.odds === '1/10000')).toBe(true);
    expect(JSON.stringify(b.alerts)).not.toMatch(/imposs/i);
  });

  it('never evaluates damage: neither the brief nor the item detail calls the calculation engine', async () => {
    const before = engineCallCount();
    await brief(withGear({ weapon: 560026 }), withGear({ ...TEMPORAL, ...VIS }));
    await ops.assess({ itemId: 29080, asOf: AS_OF });
    expect(engineCallCount()).toBe(before);
  });

  it('no route at all: "without procedure", not impossible', async () => {
    const b = await brief(withGear({}), withGear({ weapon: 560026 }));
    expect(b.configuration).toMatchObject({ level: 'undocumented', withoutProcedure: { count: 1, byAspect: { item: 1 } } });
    expect(b.changed).toEqual([]);
  });

  it('compact: one best-route line per component, host counts instead of source ids', async () => {
    const b = await brief(withGear({}), withGear({ ...TEMPORAL, ...VIS }));
    for (const c of b.changed) expect(c.route).toBeTruthy();
    expect(Object.values(b.sources).every(n => typeof n === 'number')).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/@rdb-/);
    expect(JSON.stringify(b).length).toBeLessThan(6000);
  });
});

describe('optimize_build acquisition option', () => {
  let client: Client;
  beforeAll(async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'spec', version: '1' });
    await Promise.all([createMcpServer(dataset).connect(b), client.connect(a)]);
  });
  const optimize = async (extra: Record<string, unknown>) => JSON.parse(((await client.callTool({ name: 'optimize_build', arguments: {
    build: { ...BASE, gear: { weapon: 560026, weaponRefine: 11, headUpper: 19482, headUpperEnchant1: 29075 } }, maxSolves: 120, rounds: 1, candidatesPerSlot: 3, ...extra } })) as any).content[0].text);

  it('same search result with and without the option; only `acquisition` is added', async () => {
    const plain = await optimize({});
    const withBrief = await optimize({ acquisition: 'brief' });
    const { acquisition, ...rest } = withBrief;
    expect(rest).toEqual(plain);
    expect(plain.acquisition).toBeUndefined();
    expect(acquisition.configuration.level).toBeTruthy();
    expect(acquisition.changed.length + acquisition.configuration.components.preserved).toBeGreaterThan(0);
  }, 300_000);
});
