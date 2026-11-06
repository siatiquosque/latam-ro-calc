import { describe, expect, it } from 'vitest';
import { acquisitionKnowledge } from './catalog';
import { effectiveRoutes, knowledgeSchema } from './contracts';
import { applyCuratedKnowledge, fractionProbability, mergeImportedKnowledge, transformRagnarokSnapshot } from './import-ragnarokdb';
import { queryAcquisition } from './query';
import snapshot from '../../../../data/acquisition/inputs/ragnarokdb.v1.json';
import items from '../../../assets/demo/data/latam-items.json';
import monsters from '../../../assets/demo/data/monster.json';

const sha = 'a'.repeat(64);
const empty = () => ({ schemaVersion: 1 as const, revision: 'test', sources: [], routes: [], effects: [], enchantGroups: [] });
const fixture = () => ({ schemaVersion: 1, producerVersion: sha, retrievedOn: '2026-11-05', itemIds: [600030], missingItems: [], items: [], manualDrops: [],
  monsters: [{ id: 21526, rawId: 21526, region: 'LATAM', availableServers: ['LATAM'], dpLastUpdate: 'upstream-v1', lastSyncedAt: '2026-11-01T00:00:00Z', rawSha256: sha,
    drops: [{ itemId: 600030, slot: 0, channel: 'normal', map: null, probability: 0.0015, minQuantity: null, maxQuantity: null }] }] });
const identities = { items: { 600030: { aegisName: 'D_Glacier_T_Sword' } }, monsterIds: [21526] };
const transform = (input: unknown = fixture()) => transformRagnarokSnapshot(input, identities, sha);

describe('selective RagnarokDB acquisition import', () => {
  it('imports raw drop slots exactly and never assigns a missing quantity or probability', () => {
    const input = fixture();
    input.monsters[0].drops.push({ ...input.monsters[0].drops[0], slot: 1, probability: null });
    const { knowledge } = transform(input);
    expect(knowledge.routes).toHaveLength(2);
    expect(knowledge.routes[0].drop.probability).toEqual({ numerator: 3, denominator: 2000 });
    expect(knowledge.routes[1].drop.probability).toBeNull();
    expect(knowledge.routes[0].drop.quantity).toEqual({ min: null, max: null });
    expect(knowledge.routes.every(r => r.review === 'unreviewed' && !r.period.known)).toBe(true);
  });
  it('represents 0% and 100% without treating zero as missing; rejects invalid units', () => {
    expect(fractionProbability(0)).toEqual({ numerator: 0, denominator: 1 });
    expect(fractionProbability(1)).toEqual({ numerator: 1, denominator: 1 });
    expect(fractionProbability(1e-7)).toEqual({ numerator: 1, denominator: 10000000 });
    expect(() => fractionProbability(15)).toThrow();
    const input = fixture(); input.monsters[0].drops[0].probability = 15;
    expect(transform(input).issues.some(i => i.code === 'invalid_probability')).toBe(true);
    expect(transform(input).knowledge.routes[0].drop.probability).toBeNull();
  });
  it('keeps server fallback and ambiguous map units unconfirmed', () => {
    const input = fixture(); input.monsters[0].availableServers = ['kROM'];
    input.monsters[0].drops[0].channel = 'map';
    const result = transform(input);
    expect(result.knowledge.routes[0].server).toBe('generic');
    expect(result.knowledge.routes[0].drop.probability).toBeNull();
    expect(queryAcquisition({ itemId: 600030, server: 'LATAM', asOf: '2026-11-05' }, result.knowledge)[0].availability).toBe('unknown');
  });
  it('rejects unknown IDs and mismatched payload identities, never creates internal items/monsters', () => {
    const input = fixture(); input.monsters[0].rawId = 99;
    expect(transform(input).knowledge.routes).toEqual([]);
    expect(transformRagnarokSnapshot(fixture(), { items: {}, monsterIds: [21526] }, sha).knowledge.routes).toEqual([]);
  });
  it('is idempotent including sources, revisions and byte-equivalent JSON', () => {
    const incoming = transform().knowledge;
    const first = mergeImportedKnowledge(empty(), incoming);
    const second = mergeImportedKnowledge(first.knowledge, incoming);
    expect(first.added).toBe(1);
    expect(second.added).toBe(0); expect(second.enriched).toBe(0);
    expect(JSON.stringify(second.knowledge)).toBe(JSON.stringify(first.knowledge));
  });
  it('enriches missing facts with append-only history and keeps conflicting known values', () => {
    const original = transform().knowledge;
    original.routes[0].drop.probability = null;
    original.routes[0].drop.quantity.min = 1;
    const base = mergeImportedKnowledge(empty(), original).knowledge;
    const next = transform().knowledge;
    next.routes[0].id += '-updated';
    next.routes[0].drop.quantity.min = 3;
    const result = mergeImportedKnowledge(base, next);
    expect(result.enriched).toBe(1);
    expect(result.knowledge.routes).toHaveLength(2);
    const active = effectiveRoutes(result.knowledge)[0];
    expect(active.drop.probability).toEqual({ numerator: 3, denominator: 2000 });
    expect(active.drop.quantity.min).toBe(1);
    expect(active.supersedes).toBe(base.routes[0].id);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'fact_conflict', path: 'drop.quantity.min' }));
    expect(mergeImportedKnowledge(result.knowledge, next).enriched).toBe(0);
  });
  it('cannot erase known probability with unknown or fill a reviewed rule automatically', () => {
    const original = transform().knowledge;
    const absent = structuredClone(original); absent.routes[0].drop.probability = null;
    expect(mergeImportedKnowledge(original, absent).knowledge).toEqual(original);
    const reviewed = structuredClone(absent); reviewed.routes[0].review = 'confirmed';
    const result = mergeImportedKnowledge(reviewed, original);
    expect(result.knowledge).toEqual(reviewed);
    expect(result.issues.some(i => i.code === 'protected_reviewed_rule')).toBe(true);
  });
  it('explicit curation is idempotent and refuses mutations of an existing revision', () => {
    const addition = transform().knowledge;
    const first = applyCuratedKnowledge(empty(), addition);
    expect(applyCuratedKnowledge(first.knowledge, addition).changed).toBe(false);
    const changed = structuredClone(addition); changed.routes[0].success = { numerator: 1, denominator: 1 };
    expect(() => applyCuratedKnowledge(first.knowledge, changed)).toThrow('ID imutável');
  });
  it('imports the real selected snapshot and discards all provisional manual rates', () => {
    const localItems = Object.fromEntries(Object.entries(items).map(([id, row]) => [id, { aegisName: 'aegisName' in row ? row.aegisName : undefined }]));
    const result = transformRagnarokSnapshot(snapshot, { items: localItems, monsterIds: Object.values(monsters).map(m => m.id) }, sha);
    expect(result.knowledge.routes.length).toBeGreaterThan(0);
    expect(result.issues.some(i => i.code === 'discarded_provisional_rate')).toBe(true);
    expect(result.knowledge.routes.filter(r => r.drop?.channel === 'manual').every(r => r.drop.probability === null)).toBe(true);
    expect(result.knowledge.routes.every(r => r.review === 'unreviewed')).toBe(true);
    const weapon = queryAcquisition({ itemId: 600030, server: 'LATAM', asOf: '2026-11-05' }, result.knowledge);
    expect(weapon.some(r => r.drop?.monsterId === 21526 && r.drop.map === 'jor_dun01')).toBe(true);
    const again = mergeImportedKnowledge(mergeImportedKnowledge(empty(), result.knowledge).knowledge, result.knowledge);
    expect(again.added).toBe(0); expect(again.enriched).toBe(0);
  });
  it('preserves all existing Phase 1 data and refuses unknown schema versions', () => {
    const result = mergeImportedKnowledge(acquisitionKnowledge, transform().knowledge);
    expect(result.knowledge.routes.filter(r => acquisitionKnowledge.routes.some(old => old.id === r.id))).toEqual(acquisitionKnowledge.routes);
    expect(() => transform({ ...fixture(), schemaVersion: 2 })).toThrow();
    expect(() => knowledgeSchema.parse({ ...empty(), schemaVersion: 2 })).toThrow();
  });
});
