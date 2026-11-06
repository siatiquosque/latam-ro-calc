import { z } from 'zod';
import { AcquisitionKnowledge, AcquisitionRoute, effectiveRoutes, knowledgeSchema, reviseKnowledge } from './contracts';
export { knowledgeSchema, reviseKnowledge } from './contracts';

/** Explicit local curation uses the same append-only policy; identical replays are no-ops. */
export function applyCuratedKnowledge(base: AcquisitionKnowledge, additions: AcquisitionKnowledge) {
  base = knowledgeSchema.parse(base);
  additions = knowledgeSchema.parse(additions);
  const fresh = <T extends { id: string }>(existing: T[], incoming: T[]) => incoming.filter(next => {
    const previous = existing.find(row => row.id === next.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) throw new Error(`ID imutável: ${next.id}`);
    return !previous;
  });
  const routes = fresh(base.routes, additions.routes);
  const effects = fresh(base.effects, additions.effects);
  const sources = fresh(base.sources, additions.sources);
  const groups = fresh(base.enchantGroups, additions.enchantGroups);
  const changed = !!(routes.length || effects.length || sources.length || groups.length);
  const knowledge = reviseKnowledge(base, { ...additions, routes, effects, revision: changed ? additions.revision : base.revision });
  return { knowledge, issues: [], added: routes.length, enriched: 0, unchanged: additions.routes.length - routes.length, changed };
}

const id = z.number().int().positive();
const nonnegative = z.number().int().nonnegative();
const metadata = {
  id, rawId: id, region: z.string().nullable(), availableServers: z.array(z.string()),
  dpLastUpdate: z.string().nullable(), lastSyncedAt: z.string().nullable(), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
};
/** Selected upstream facts, not a second item/monster catalog. Reject schema drift. */
export const ragnarokSnapshotSchema = z.object({
  schemaVersion: z.literal(1), producerVersion: z.string().regex(/^[a-f0-9]{64}$/), retrievedOn: z.iso.date(),
  itemIds: z.array(id).min(1).max(256), missingItems: z.array(id),
  monsters: z.array(z.object({ ...metadata, drops: z.array(z.object({
    itemId: id, slot: nonnegative, channel: z.enum(['normal', 'mvp', 'map']), map: z.string().nullable(),
    probability: z.number().finite().nullable(), minQuantity: nonnegative.nullable(), maxQuantity: nonnegative.nullable(),
  }).strict()) }).strict()),
  items: z.array(z.object({ ...metadata, aegisName: z.string().nullable(),
    references: z.object({ enchantIds: z.array(id), extractionToolIds: z.array(id), containerIds: z.array(id) }).strict(),
    reforms: z.array(z.object({
      infoId: id, toolItemId: id, baseItemId: id, resultItemId: id,
      needRefineMin: nonnegative.nullable(), needRefineMax: nonnegative.nullable(), needOptionNumMin: nonnegative.nullable(),
      isEmptySocket: z.boolean().nullable(), changeRefineValue: z.number().int().nullable(),
      preserveSocketItem: z.boolean().nullable(), preserveGrade: z.boolean().nullable(), randomOptionCode: z.string().nullable(),
      materials: z.array(z.object({ itemId: id, amount: id.nullable() }).strict()),
    }).strict()),
  }).strict()),
  manualDrops: z.array(z.object({ itemId: id, monsterId: id, map: z.string(), provisionalPercent: z.number().nullable(), note: z.string(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict();

export interface ImportIssue { code: string; key: string; path: string; existing?: unknown; incoming?: unknown; sources?: string[] }
export interface AcquisitionIdentities { items: Record<number, { aegisName?: string }>; monsterIds: readonly number[] }

/** API drops[] is a fraction, never the aggregated mob_drops.rate column. */
export function fractionProbability(value: number | null) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Probability outside [0,1]');
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const decimals = (mantissa.split('.')[1] ?? '').length - Number(exponent);
  let numerator = Number(mantissa.replace('.', '')) * 10 ** Math.max(-decimals, 0);
  let denominator = 10 ** Math.max(decimals, 0);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) throw new Error('Probability precision exceeds safe integers');
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a; denominator /= a;
  return { numerator, denominator };
}

export function transformRagnarokSnapshot(input: unknown, identities: AcquisitionIdentities, snapshotVersion: string) {
  const snapshot = ragnarokSnapshotSchema.parse(input);
  if (!/^[a-f0-9]{64}$/.test(snapshotVersion)) throw new Error('Snapshot SHA-256 required');
  const issues: ImportIssue[] = [];
  const sources: AcquisitionKnowledge['sources'] = [];
  const routes: AcquisitionRoute[] = [];
  const scope = new Set(snapshot.itemIds);
  const knownMonsters = new Set(identities.monsterIds);
  const knownItem = (itemId: number) => Object.hasOwn(identities.items, itemId);
  const issue = (code: string, key: string, path: string, incoming?: unknown) => issues.push({ code, key, path, incoming });
  const sourceFor = (record: Omit<z.infer<typeof ragnarokSnapshotSchema>['monsters'][number], 'drops'>, kind: 'item' | 'monster') => {
    const sourceId = `rdb-${kind}-${record.id}-${record.rawSha256.slice(0, 12)}-${snapshot.producerVersion.slice(0, 8)}-${(record.lastSyncedAt ?? snapshot.retrievedOn).replace(/[^0-9]/g, '')}`;
    if (!sources.some(s => s.id === sourceId)) sources.push({ id: sourceId,
      url: `https://www.divine-pride.net/database/${kind}/${record.id}`, via: 'RagnarokDB raw_json (read-only snapshot)',
      version: `producer=${snapshot.producerVersion}; upstream=${record.dpLastUpdate ?? 'unknown'}; synced=${record.lastSyncedAt ?? 'unknown'}; raw=${record.rawSha256}`,
      sha256: record.rawSha256, retrievedOn: record.lastSyncedAt?.slice(0, 10) ?? snapshot.retrievedOn,
      license: 'Third-party Divine Pride/Gravity data; redistribution license unconfirmed', locator: `${kind}/${record.id} acquisition fields; requested region=${record.region}; servers=${record.availableServers.join(',')}` });
    return sourceId;
  };
  const makeRoute = (key: string, itemId: number, sourceId: string, server: string): AcquisitionRoute => ({
    id: `${key}@${sourceId}`, importKey: key, family: 'ragnarokdb', label: key,
    target: { itemIds: [itemId], aspect: 'item', enchantIds: [], position: null, refine: null, grade: null },
    server, period: { start: null, end: null, known: false }, review: 'unreviewed', confidence: 'low', sources: [sourceId],
    requirements: [], steps: [], success: null, outcomes: [],
    result: { refine: 'unknown', grade: 'unknown', cards: 'unknown', enchants: 'unknown', binding: 'unknown' },
    cost: { zeny: null, marketZeny: null, difficulty: 'unknown', reason: 'No economic/difficulty estimate imported.' },
    unknowns: ['LATAM procedure/availability requires regional review.'], supersedes: null, revisionReason: 'Selected external facts; no automatic regional confirmation.',
  });
  for (const mob of snapshot.monsters) {
    if (mob.id !== mob.rawId || !knownMonsters.has(mob.id)) { issue('unknown_or_mismatched_monster', String(mob.id), 'monsterId'); continue; }
    const sourceId = sourceFor(mob, 'monster');
    const server = mob.region === 'LATAM' && mob.availableServers.includes('LATAM') ? 'LATAM' : 'generic';
    if (server === 'generic') issue('server_fallback', String(mob.id), 'availableServers', mob.availableServers);
    for (const drop of mob.drops) {
      const key = `rdb-drop:${mob.id}:${drop.channel}:${drop.map ?? '*'}:${drop.slot}:${drop.itemId}`;
      if (!scope.has(drop.itemId) || !knownItem(drop.itemId)) { issue('unknown_or_out_of_scope_item', key, 'itemId', drop.itemId); continue; }
      let probability = null;
      if (drop.channel === 'map') issue('map_probability_unit_unverified', key, 'probability', drop.probability);
      else try { probability = fractionProbability(drop.probability); } catch { issue('invalid_probability', key, 'probability', drop.probability); }
      const route = makeRoute(key, drop.itemId, sourceId, server);
      route.method = 'drop';
      route.drop = { monsterId: mob.id, channel: drop.channel, map: drop.map, slot: drop.slot, version: 'default response (not historical variants)', probability,
        quantity: { min: drop.minQuantity, max: drop.maxQuantity } };
      route.requirements = [{ kind: 'monster', monsterId: mob.id, itemId: null, amount: null, minRefine: null, description: `Monster ${mob.id}; ${drop.map ?? 'no map restriction in source'}` }];
      routes.push(route);
    }
  }
  for (const item of snapshot.items) {
    if (item.id !== item.rawId || !scope.has(item.id) || !knownItem(item.id)) { issue('unknown_or_mismatched_item', String(item.id), 'itemId'); continue; }
    const localAegis = identities.items[item.id].aegisName;
    if (localAegis && item.aegisName && localAegis !== item.aegisName) { issue('aegis_conflict', String(item.id), 'aegisName', item.aegisName); continue; }
    const sourceId = sourceFor(item, 'item');
    for (const [name, values] of Object.entries(item.references)) if (values.length) issue('reference_without_procedure', String(item.id), name, values);
    for (const reform of item.reforms) {
      const key = `rdb-reform:${reform.infoId}:${reform.toolItemId}:${reform.baseItemId}:${reform.resultItemId}`;
      const refs = [reform.toolItemId, reform.baseItemId, reform.resultItemId, ...reform.materials.map(m => m.itemId)];
      if (reform.baseItemId !== item.id || !scope.has(reform.resultItemId) || refs.some(ref => !knownItem(ref))) { issue('unresolved_reform_identity', key, 'itemIds', refs); continue; }
      const route = makeRoute(key, reform.resultItemId, sourceId, 'generic');
      route.method = 'reform';
      if (reform.baseItemId === reform.resultItemId && reform.changeRefineValue != null && reform.needRefineMin != null && reform.needRefineMax != null) {
        route.target.aspect = 'refine';
        route.target.refine = { min: reform.needRefineMin + reform.changeRefineValue, max: reform.needRefineMax + reform.changeRefineValue };
      }
      route.requirements = [
        { kind: 'procedure', itemId: reform.toolItemId, amount: null, minRefine: null, consumed: null, description: 'UI trigger; consumption not inferred.' },
        { kind: 'equipment', itemId: reform.baseItemId, amount: 1, minRefine: reform.needRefineMin, maxRefine: reform.needRefineMax,
          requiredRandomOptions: reform.needOptionNumMin, emptySockets: reform.isEmptySocket, description: 'Reform input.' },
        ...reform.materials.map(m => ({ kind: 'material' as const, itemId: m.itemId, amount: m.amount, minRefine: null, consumed: true, description: `Material ${m.itemId}` })),
      ];
      route.resultProperties = { refineDelta: reform.changeRefineValue, cardsPreserved: reform.preserveSocketItem, enchantsPreserved: reform.preserveSocketItem, gradePreserved: reform.preserveGrade };
      route.outputs = [{ itemId: reform.resultItemId, quantity: { min: 1, max: 1 }, chance: null }];
      route.unknowns.push('Success/failure probability and random-option policy are not supplied by this relation.');
      routes.push(route);
    }
  }
  for (const relation of snapshot.manualDrops) {
    const key = `rdb-manual-drop:${relation.monsterId}:${relation.map}:${relation.itemId}`;
    if (!knownItem(relation.itemId) || !knownMonsters.has(relation.monsterId) || !scope.has(relation.itemId)) { issue('unresolved_manual_identity', key, 'itemId'); continue; }
    const sourceId = `rdb-manual-${relation.sourceSha256}`;
    if (!sources.some(s => s.id === sourceId)) sources.push({ id: sourceId, url: 'repo:RagnarokDB/manual_drops.json', via: 'RagnarokDB selected manual relation',
      sha256: relation.sourceSha256, retrievedOn: snapshot.retrievedOn, version: relation.sourceSha256, license: 'Manual annotations; upstream rights unconfirmed', locator: relation.note });
    issue('discarded_provisional_rate', key, 'probability', relation.provisionalPercent);
    const route = makeRoute(key, relation.itemId, sourceId, 'generic');
    route.method = 'drop';
    route.drop = { monsterId: relation.monsterId, map: relation.map, channel: 'manual', slot: 0, version: 'manual relation, foreign-server reference', probability: null, quantity: { min: null, max: null } };
    route.requirements = [{ kind: 'monster', monsterId: relation.monsterId, itemId: null, amount: null, minRefine: null, description: relation.map }];
    route.unknowns.push('Provisional manual rates discarded; relationship not confirmed for LATAM.');
    routes.push(route);
  }
  for (const missing of snapshot.missingItems) issue('absent_in_ragnarokdb', String(missing), 'itemId');
  const knowledge = knowledgeSchema.parse({ schemaVersion: 1, revision: `rdb-${snapshotVersion}`, sources, routes, effects: [], enchantGroups: [] });
  return { knowledge, issues };
}

/** Fill missing facts only. Contradictions are returned for curation, never last-writer-wins. */
export function mergeImportedKnowledge(base: AcquisitionKnowledge, incoming: AcquisitionKnowledge) {
  let knowledge = knowledgeSchema.parse(base);
  knowledgeSchema.parse(incoming);
  if (incoming.routes.some(r => r.review !== 'unreviewed' || !r.importKey || r.supersedes)) throw new Error('Importer accepts unreviewed, keyed candidates only');
  const issues: ImportIssue[] = [];
  let added = 0, enriched = 0, unchanged = 0;
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every(k => equal(a[k], b[k]));
  };
  for (const candidate of incoming.routes) {
    const previous = effectiveRoutes(knowledge).find(r => r.importKey === candidate.importKey);
    const sourceRecords = incoming.sources.filter(s => candidate.sources.includes(s.id));
    let next = candidate;
    if (previous) {
      let changed = false;
      const fill = (existing: unknown, value: unknown, path: string): unknown => {
        if (value == null || value === 'unknown' || equal(existing, value)) return existing;
        if (existing == null || existing === 'unknown') { changed = true; return value; }
        if (!Array.isArray(existing) && !Array.isArray(value) && typeof existing === 'object' && typeof value === 'object') {
          const result = { ...existing as object };
          for (const [key, child] of Object.entries(value)) result[key] = fill(existing[key], child, `${path}.${key}`);
          return result;
        }
        issues.push({ code: 'fact_conflict', key: candidate.importKey, path, existing, incoming: value, sources: candidate.sources });
        return existing;
      };
      const merged = { ...previous };
      for (const field of ['target', 'drop', 'requirements', 'steps', 'success', 'outputs', 'outputSelection', 'resultProperties', 'result', 'period'] as const) {
        merged[field] = fill(previous[field], candidate[field], field) as never;
      }
      if (!changed) { unchanged++; continue; }
      if (previous.review !== 'unreviewed') {
        issues.push({ code: 'protected_reviewed_rule', key: candidate.importKey, path: 'review', sources: candidate.sources });
        unchanged++; continue;
      }
      next = { ...merged, id: candidate.id, supersedes: previous.id, sources: [...new Set([...previous.sources, ...candidate.sources])], revisionReason: 'Missing imported facts enriched; known facts retained; predecessor preserved.' };
      enriched++;
    } else added++;
    knowledge = reviseKnowledge(knowledge, { schemaVersion: 1, revision: incoming.revision,
      sources: [...sourceRecords, ...knowledge.sources.filter(s => next.sources.includes(s.id) && !sourceRecords.some(n => n.id === s.id))], routes: [next], effects: [], enchantGroups: [] });
  }
  return { knowledge, issues, added, enriched, unchanged };
}
