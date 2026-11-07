import { describe, expect, it } from 'vitest';
import { acquisitionKnowledge } from './catalog';
import { knowledgeSchema, routeSchema } from './contracts';
import { dropRoute, dropRoutes, dropTableSchema, indexDrops } from './drops';
import { transformRagnarokSnapshot } from './import-ragnarokdb';
import { queryAcquisition } from './query';
import calcItems from '../../../assets/demo/data/item.json';
import clientItems from '../../../assets/demo/data/latam-items.json';
import calcMonsters from '../../../assets/demo/data/monster.json';
import clientMonsters from '../../../assets/demo/data/latam-monsters.json';

const sha = 'a'.repeat(64);
const table = () => dropTableSchema.parse({
  source: { id: 'rdb-drops-test', url: 'https://example.test', via: null, retrievedOn: '2026-11-05', sha256: sha, version: 'v', license: 'l', locator: 'x' },
  latamMonsters: [21526], maps: ['prt_fild08'],
  item: [600030, 600030, 600031], monster: [21526, 1002, 1002], slot: [0, 3, 0], probability: [0.0015, 0.5, null],
  channels: [[1, 2], [2, 1]], mapRows: [[1, 0]], quantities: [[1, 1, 2]],
});
const query = { server: 'LATAM', asOf: '2026-11-05' };

describe('columnar drop table', () => {
  it('rejects columns of different length and map indexes outside the table', () => {
    const base = JSON.parse(JSON.stringify(table()));
    expect(() => dropTableSchema.parse({ ...base, slot: [0] })).toThrow(/Coluna slot/);
    expect(() => dropTableSchema.parse({ ...base, mapRows: [[1, 4]] })).toThrow(/mapa/);
    expect(() => dropTableSchema.parse({ ...base, quantities: [[7, 1, 2]] })).toThrow(/Linha fora/);
    expect(() => dropTableSchema.parse({ ...base, probability: [2, null, null] })).toThrow();
  });

  it('expands to the same route the snapshot importer builds for that drop', () => {
    const index = indexDrops(table());
    const imported = transformRagnarokSnapshot({
      schemaVersion: 1, producerVersion: sha, retrievedOn: '2026-11-05', itemIds: [600030], missingItems: [], items: [], manualDrops: [],
      monsters: [{ id: 21526, rawId: 21526, region: 'LATAM', availableServers: ['LATAM'], dpLastUpdate: null, lastSyncedAt: null, rawSha256: sha,
        drops: [{ itemId: 600030, slot: 0, channel: 'normal', map: null, probability: 0.0015, minQuantity: null, maxQuantity: null }] }],
    }, { items: { 600030: {} }, monsterIds: [21526] }, sha).knowledge.routes[0];
    const route = dropRoute(index, 0);
    expect(routeSchema.parse(route)).toEqual(route);
    expect(route.importKey).toBe(imported.importKey);
    const { id, sources, ...stored } = route;
    const { id: importedId, sources: importedSources, ...expected } = imported;
    expect(stored).toEqual(expected);
    expect(id).toBe(`${route.importKey}@rdb-drops-test`);
  });

  it('keeps map-specific probability unknown and serves non-LATAM monsters as generic', () => {
    const routes = dropRoutes(indexDrops(table()), { itemId: 600030 });
    expect(routes.map(r => [r.drop?.channel, r.server, r.drop?.probability])).toEqual([
      ['normal', 'LATAM', { numerator: 3, denominator: 2000 }], ['map', 'generic', null]]);
    expect(routes[1].drop?.quantity).toEqual({ min: 1, max: 2 });
  });

  it('indexes by item, by monster and all rows', () => {
    const index = indexDrops(table());
    expect(dropRoutes(index, { monsterId: 1002 }).map(r => r.target.itemIds[0])).toEqual([600030, 600031]);
    expect(dropRoutes(index, { itemId: 999 })).toEqual([]);
    expect(dropRoutes(index, {})).toHaveLength(3);
  });
});

describe('queries over the bundled table', () => {
  it('serves drops of items that have no catalog route, as unreviewed with a resolvable source', () => {
    const table = acquisitionKnowledge.drops!;
    const itemId = table.item.find(id => !acquisitionKnowledge.routes.some(r => r.target.itemIds.includes(id)))!;
    const routes = queryAcquisition({ ...query, itemId }).filter(r => r.method === 'drop');
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(r => r.review === 'unreviewed' && r.availability === 'unknown')).toBe(true);
    expect(routes[0].sourceDetails.map(s => s.id)).toEqual([table.source.id]);
    expect(queryAcquisition({ ...query, monsterId: routes[0].drop!.monsterId }).map(r => r.id)).toContain(routes[0].id);
  });

  it('does not duplicate a drop the catalog already carries', () => {
    const kb = knowledgeSchema.parse({ ...acquisitionKnowledge, routes: [] });
    const route = dropRoute(indexDrops(kb.drops!), 0);
    const curated = knowledgeSchema.parse({ ...kb, sources: [...kb.sources], routes: [{ ...route, id: 'curated', review: 'reviewed', sources: [kb.drops!.source.id] }] });
    const ids = queryAcquisition({ ...query, itemId: route.target.itemIds[0], monsterId: route.drop!.monsterId }, curated)
      .filter(r => r.importKey === route.importKey).map(r => r.id);
    expect(ids).toEqual(['curated']);
  });

  it('every table drop points at a map and a source the catalog can show', () => {
    const t = acquisitionKnowledge.drops!;
    expect(t.mapRows.every(([, i]) => i < t.maps.length)).toBe(true);
    expect(acquisitionKnowledge.sources.some(s => s.id === t.source.id)).toBe(true);
  });

  // After a sync with upstream the item/monster lists can change. A failure here means the table
  // names ids the calculator no longer knows: rerun tools/export-ragnarokdb-drops.py (see docs/acquisition).
  it('only names items and monsters the calculator data knows', () => {
    const t = acquisitionKnowledge.drops!;
    const items = new Set([...Object.keys(clientItems).map(Number), ...Object.values(calcItems).map((i: { id: number }) => i.id)]);
    const monsters = new Set([...Object.keys(clientMonsters).map(Number), ...Object.values(calcMonsters).map((m: { id: number }) => m.id)]);
    expect([...new Set(t.item)].filter(id => !items.has(id))).toEqual([]);
    expect([...new Set(t.monster)].filter(id => !monsters.has(id))).toEqual([]);
  });
});
