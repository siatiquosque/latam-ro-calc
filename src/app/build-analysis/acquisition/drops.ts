import { z } from 'zod';
import type { AcquisitionRoute } from './contracts';

const id = z.number().int().positive();
const count = z.number().int().nonnegative();

/**
 * Monster drops as parallel columns (one row per item/monster/slot). A drop is a fact, not a procedure:
 * storing each one as a full route cost ~1.4 KB of JSON and ~2 KB of heap per row, so the routes are built per query.
 */
export const dropTableSchema = z.object({
  source: z.object({
    id: z.string(), url: z.string(), version: z.string(), retrievedOn: z.iso.date(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), license: z.string(), locator: z.string(), via: z.string().nullable(),
  }).strict(),
  /** Monsters RagnarokDB marks as LATAM (region and availableServers); the others are served as generic. */
  latamMonsters: z.array(id),
  maps: z.array(z.string()),
  /** One entry per drop, sorted by item then monster. */
  item: z.array(id), monster: z.array(id), slot: z.array(count),
  /** Fraction in [0,1]; null when unknown or when the unit is unverified (map-specific drops). */
  probability: z.array(z.number().min(0).max(1).nullable()),
  /** Sparse columns, `[row, ...]`: rows absent here are a normal drop, with no map restriction and no known quantity. */
  channels: z.array(z.tuple([count, z.union([z.literal(1), z.literal(2)])])),
  mapRows: z.array(z.tuple([count, count])),
  quantities: z.array(z.tuple([count, count.nullable(), count.nullable()])),
}).strict().superRefine((table, ctx) => {
  const rows = table.item.length;
  for (const column of ['monster', 'slot', 'probability'] as const) {
    if (table[column].length !== rows) ctx.addIssue({ code: 'custom', message: `Coluna ${column} com ${table[column].length} linhas, esperado ${rows}` });
  }
  for (const column of ['channels', 'mapRows', 'quantities'] as const) {
    if (table[column].some(([row]) => row >= rows)) ctx.addIssue({ code: 'custom', message: `Linha fora da tabela em ${column}` });
  }
  if (table.mapRows.some(([, index]) => index >= table.maps.length)) ctx.addIssue({ code: 'custom', message: 'Índice de mapa fora da tabela' });
});
export type DropTable = z.infer<typeof dropTableSchema>;

const CHANNELS = ['normal', 'mvp', 'map'] as const;
export const DROP_VERSION = 'default response (not historical variants)';

/** Exact reduced fraction of a decimal in [0,1]; same arithmetic as the snapshot importer. */
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

export interface DropIndex {
  table: DropTable;
  latam: ReadonlySet<number>;
  channel: ReadonlyMap<number, 1 | 2>;
  map: ReadonlyMap<number, number>;
  quantity: ReadonlyMap<number, readonly [number | null, number | null]>;
  byItem: ReadonlyMap<number, readonly number[]>;
  byMonster: ReadonlyMap<number, readonly number[]>;
}

export function indexDrops(table: DropTable): DropIndex {
  const byItem = new Map<number, number[]>();
  const byMonster = new Map<number, number[]>();
  table.item.forEach((itemId, row) => {
    (byItem.get(itemId) ?? byItem.set(itemId, []).get(itemId)!).push(row);
    const monsterId = table.monster[row];
    (byMonster.get(monsterId) ?? byMonster.set(monsterId, []).get(monsterId)!).push(row);
  });
  return { table, latam: new Set(table.latamMonsters), byItem, byMonster,
    channel: new Map(table.channels.map(([row, channel]) => [row, channel] as const)),
    map: new Map(table.mapRows.map(([row, index]) => [row, index] as const)),
    quantity: new Map(table.quantities.map(([row, min, max]) => [row, [min, max] as const])) };
}

export function dropImportKey(monsterId: number, channel: (typeof CHANNELS)[number], map: string | null, slot: number, itemId: number) {
  return `rdb-drop:${monsterId}:${channel}:${map ?? '*'}:${slot}:${itemId}`;
}

/** Same route the snapshot importer would have produced for this row. */
export function dropRoute({ table, latam, channel: channels, map: mapRows, quantity }: DropIndex, row: number): AcquisitionRoute {
  const channel = CHANNELS[channels.get(row) ?? 0];
  const itemId = table.item[row], monsterId = table.monster[row];
  const mapIndex = mapRows.get(row);
  const map = mapIndex == null ? null : table.maps[mapIndex];
  const [min, max] = quantity.get(row) ?? [null, null];
  const key = dropImportKey(monsterId, channel, map, table.slot[row], itemId);
  const sourceId = table.source.id;
  return {
    id: `${key}@${sourceId}`, importKey: key, family: 'ragnarokdb', label: key, method: 'drop',
    drop: { monsterId, channel, map, slot: table.slot[row], version: DROP_VERSION,
      probability: channel === 'map' ? null : fractionProbability(table.probability[row]),
      quantity: { min, max } },
    target: { itemIds: [itemId], aspect: 'item', enchantIds: [], position: null, refine: null, grade: null },
    server: latam.has(monsterId) ? 'LATAM' : 'generic', period: { start: null, end: null, known: false },
    review: 'unreviewed', confidence: 'low', sources: [sourceId],
    requirements: [{ kind: 'monster', monsterId, itemId: null, amount: null, minRefine: null, description: `Monster ${monsterId}; ${map ?? 'no map restriction in source'}` }],
    steps: [], success: null, outcomes: [],
    result: { refine: 'unknown', grade: 'unknown', cards: 'unknown', enchants: 'unknown', binding: 'unknown' },
    cost: { zeny: null, marketZeny: null, difficulty: 'unknown', reason: 'No economic/difficulty estimate imported.' },
    unknowns: ['LATAM procedure/availability requires regional review.'], supersedes: null,
    revisionReason: 'Selected external facts; no automatic regional confirmation.',
  };
}

export function dropRoutes(index: DropIndex, query: { itemId?: number; monsterId?: number }): AcquisitionRoute[] {
  const rows = query.itemId != null ? index.byItem.get(query.itemId) ?? []
    : query.monsterId != null ? index.byMonster.get(query.monsterId) ?? []
    : index.table.item.keys();
  const routes: AcquisitionRoute[] = [];
  for (const row of rows) routes.push(dropRoute(index, row));
  return routes;
}
