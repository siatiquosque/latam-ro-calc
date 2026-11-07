import { z } from 'zod';
import { dropTableSchema } from './drops';

const id = z.number().int().positive();
const count = z.number().int().nonnegative();
export const probabilitySchema = z.object({ numerator: count, denominator: id }).strict()
  .refine(p => p.numerator <= p.denominator, 'Probabilidade maior que 1');
const date = z.iso.date();
const sourceSchema = z.object({
  id: z.string(), url: z.string(), version: z.string(), retrievedOn: date,
  sha256: z.string().regex(/^[a-f0-9]{64}$/), license: z.string(), locator: z.string(),
  via: z.string().nullable(),
}).strict();
const quantitySchema = z.object({ min: count.nullable(), max: count.nullable() }).strict()
  .refine(q => q.min == null || q.max == null || q.min <= q.max, 'Quantidade inválida');
const requirementSchema = z.object({
  kind: z.enum(['equipment', 'material', 'npc', 'procedure', 'monster']),
  itemId: id.nullable(), amount: count.nullable(), minRefine: count.nullable(),
  anyItemIds: z.array(id).min(1).optional(), monsterId: id.optional(),
  maxRefine: count.nullable().optional(), consumed: z.boolean().nullable().optional(),
  enchantId: id.optional(), position: count.max(3).optional(),
  requiredRandomOptions: count.nullable().optional(), emptySockets: z.boolean().nullable().optional(),
  description: z.string(),
}).strict();
const stepSchema = z.object({
  fromLevel: count, toLevel: count, materials: z.array(z.object({ itemId: id, amount: id }).strict()),
  zeny: count.nullable(), success: probabilitySchema.nullable(),
  failure: z.object({ destroysItem: z.boolean().nullable(), levelDelta: z.number().int().nullable(), floor: count.nullable() }).strict(),
}).strict();
export const routeSchema = z.object({
  id: z.string(), family: z.string(), label: z.string(),
  importKey: z.string().optional(),
  method: z.enum(['drop', 'exchange', 'extraction', 'enchant', 'reform', 'container']).optional(),
  drop: z.object({ monsterId: id, map: z.string().nullable(), slot: count,
    channel: z.enum(['normal', 'mvp', 'map', 'manual']), version: z.string(),
    probability: probabilitySchema.nullable(), quantity: quantitySchema,
  }).strict().optional(),
  outputs: z.array(z.object({ itemId: id, quantity: quantitySchema, chance: probabilitySchema.nullable() }).strict()).optional(),
  outputSelection: z.enum(['one', 'all', 'unknown']).optional(),
  resultProperties: z.object({ refineDelta: z.number().int().nullable(), cardsPreserved: z.boolean().nullable(),
    gradePreserved: z.boolean().nullable(), enchantsPreserved: z.boolean().nullable(),
  }).strict().optional(),
  target: z.object({
    itemIds: z.array(id).min(1), aspect: z.enum(['item', 'enchant', 'refine', 'grade']),
    enchantIds: z.array(id), position: count.nullable(),
    refine: z.object({ min: count, max: count }).strict().nullable(), grade: z.string().nullable(),
  }).strict(),
  server: z.string(), period: z.object({ start: date.nullable(), end: date.nullable(), known: z.boolean() }).strict(),
  review: z.enum(['unreviewed', 'reviewed', 'confirmed']), confidence: z.enum(['low', 'medium', 'high']),
  sources: z.array(z.string()).min(1), requirements: z.array(requirementSchema),
  steps: z.array(stepSchema), success: probabilitySchema.nullable(),
  outcomes: z.array(z.object({ level: count, chance: probabilitySchema }).strict()),
  result: z.object({ refine: z.string(), grade: z.string(), cards: z.string(), enchants: z.string(), binding: z.string() }).strict(),
  cost: z.object({ zeny: count.nullable(), marketZeny: count.nullable(), difficulty: z.enum(['ordinary', 'high', 'unknown']), reason: z.string() }).strict(),
  unknowns: z.array(z.string()),
  supersedes: z.string().nullable(), revisionReason: z.string(),
}).strict();
export const knowledgeSchema = z.object({
  schemaVersion: z.literal(1), revision: z.string(), sources: z.array(sourceSchema), routes: z.array(routeSchema),
  enchantGroups: z.array(z.object({ id: z.string(), name: z.string(), levels: z.array(z.object({ level: id, itemId: id }).strict()) }).strict()),
  effects: z.array(z.object({
    id: z.string(), server: z.string(), itemIds: z.array(id).min(1), minRefineSum: count,
    effect: z.string(), engineCoverage: z.enum(['represented', 'missing', 'partial']), sources: z.array(z.string()).min(1),
  }).strict()),
  /** Monster drops served as columns, not routes (see drops.ts). Absent in latam.v1.json; catalog.ts attaches drops.v1.json. */
  drops: dropTableSchema.optional(),
}).strict().superRefine((kb, ctx) => {
  const sources = new Set(kb.sources.map(s => s.id));
  if (sources.size !== kb.sources.length) ctx.addIssue({ code: 'custom', message: 'Fonte duplicada' });
  const routes = new Set<string>();
  for (const route of kb.routes) {
    if (routes.has(route.id)) ctx.addIssue({ code: 'custom', message: `Rota duplicada: ${route.id}` });
    routes.add(route.id);
    if (route.target.aspect === 'enchant' && (!route.target.enchantIds.length || route.target.position == null || route.target.position > 3)) ctx.addIssue({ code: 'custom', message: `Alvo de encanto inválido: ${route.id}` });
    if (route.outcomes.length && Math.abs(route.outcomes.reduce((sum, o) => sum + o.chance.numerator / o.chance.denominator, 0) - 1) > 1e-9) ctx.addIssue({ code: 'custom', message: `Distribuição incompleta: ${route.id}` });
    if (route.period.start && route.period.end && route.period.start > route.period.end) ctx.addIssue({ code: 'custom', message: `Período inválido: ${route.id}` });
    if (route.target.refine && route.target.refine.min > route.target.refine.max) ctx.addIssue({ code: 'custom', message: `Refino inválido: ${route.id}` });
    if (route.method === 'drop' && !route.drop) ctx.addIssue({ code: 'custom', message: `Drop sem monstro/slot: ${route.id}` });
  }
  for (const record of [...kb.routes, ...kb.effects]) for (const source of record.sources) {
    if (!sources.has(source)) ctx.addIssue({ code: 'custom', message: `Fonte ausente: ${source}` });
  }
});
export type AcquisitionKnowledge = z.infer<typeof knowledgeSchema>;
export type AcquisitionRoute = z.infer<typeof routeSchema>;

/** Same revision policy for queries and import: drafts may replace drafts only. */
export function effectiveRoutes(knowledge: AcquisitionKnowledge): AcquisitionRoute[] {
  const byId = new Map(knowledge.routes.map(route => [route.id, route]));
  const superseded = new Set<string>();
  for (const next of knowledge.routes) {
    const previous = next.supersedes ? byId.get(next.supersedes) : undefined;
    if (previous && (next.review !== 'unreviewed' || previous.review === 'unreviewed')
      && (previous.review !== 'confirmed' || next.review === 'confirmed')
      && (previous.server === 'generic' || next.server === previous.server)) superseded.add(previous.id);
  }
  return knowledge.routes.filter(r => !superseded.has(r.id));
}

/** Append-only revisions. Extracted candidates never replace reviewed regional rules. */
export function reviseKnowledge(base: AcquisitionKnowledge, additions: AcquisitionKnowledge): AcquisitionKnowledge {
  knowledgeSchema.parse(base);
  knowledgeSchema.parse(additions);
  const baseRoutes = new Map(base.routes.map(route => [route.id, route]));
  for (const next of additions.routes) {
    if (baseRoutes.has(next.id)) throw new Error(`ID imutável: ${next.id}`);
    if (!next.supersedes) continue;
    const previous = baseRoutes.get(next.supersedes);
    if (!previous || !next.revisionReason.trim() || next.review === 'unreviewed' && previous.review !== 'unreviewed' || previous.review === 'confirmed' && next.review !== 'confirmed'
      || previous.server !== 'generic' && next.server !== previous.server) {
      throw new Error(`Substituição não revisada: ${next.id}`);
    }
  }
  const sources = [...base.sources];
  const sourceById = new Map(sources.map(source => [source.id, source]));
  for (const source of additions.sources) {
    const previous = sourceById.get(source.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error(`Fonte imutável: ${source.id}`);
    if (!previous) { sources.push(source); sourceById.set(source.id, source); }
  }
  const enchantGroups = [...base.enchantGroups];
  const groupById = new Map(enchantGroups.map(group => [group.id, group]));
  for (const group of additions.enchantGroups) {
    const previous = groupById.get(group.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(group)) throw new Error(`Grupo imutável: ${group.id}`);
    if (!previous) { enchantGroups.push(group); groupById.set(group.id, group); }
  }
  return knowledgeSchema.parse({ ...base, revision: additions.revision, sources,
    enchantGroups, routes: [...base.routes, ...additions.routes], effects: [...base.effects, ...additions.effects] });
}
