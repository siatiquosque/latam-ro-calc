import { z } from 'zod';
import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import type { ResolvedBuild } from '../engine/build-input';
import type { AcquisitionKnowledge, AcquisitionRoute } from './contracts';
import { acquisitionKnowledge } from './catalog';
import { queryAcquisition } from './query';

export interface EquipmentPossession {
  itemId: number;
  refine: number;
  grade: string;
  /** Exact attachment fields, including cards; a bare item never proves an enchanted item is owned. */
  attachments: Record<string, number>;
  randomOptions?: string[];
  acquiredOn: string;
}
export interface AcquisitionPreferences {
  asOf?: string;
  owned?: EquipmentPossession[];
  requireGuaranteed?: boolean;
  /** Restricts the report to some components (slot key, diagnostic path). Absent: every component. */
  include?: (slotKey: string, path: string) => boolean;
}
export type AcquisitionStatus = 'obtainable' | 'expired_routes' | 'difficult' | 'insufficient_information' | 'owned';

type RouteChance = 'certain' | 'known' | 'unknown';
const CHANCE_RANK: Record<RouteChance, number> = { certain: 2, known: 1, unknown: 0 };
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;
const certain = (p: { numerator: number; denominator: number } | null) => p != null && p.numerator === p.denominator;

/** What the route itself says about its odds; a missing number is `unknown`, never 100% or 0%. */
export function routeChance(route: AcquisitionRoute): RouteChance {
  if (route.drop) return route.drop.probability == null ? 'unknown' : certain(route.drop.probability) ? 'certain' : 'known';
  if (route.outcomes.length) return 'known';
  const odds = route.steps.length ? route.steps.map(s => s.success) : [route.success];
  if (odds.some(p => p == null)) return 'unknown';
  return odds.every(certain) ? 'certain' : 'known';
}

/**
 * Independent facets of one conclusion. Absence of a route is `none`, never impossibility;
 * `insufficient` means the strongest route still has unknown facts or there is no route at all.
 */
function evidenceOf(matched: (AcquisitionRoute & { availability: string })[]) {
  const active = matched.filter(r => r.availability === 'active');
  const considered = active.length ? active : matched;
  const has = (availability: string) => matched.some(r => r.availability === availability);
  const best = considered.reduce<AcquisitionRoute | null>((top, r) => !top || CONFIDENCE_RANK[r.confidence] > CONFIDENCE_RANK[top.confidence] ? r : top, null);
  return {
    documentedRoute: matched.length > 0,
    availability: has('active') ? 'confirmed' as const : has('unknown') ? 'unconfirmed' as const
      : has('future') ? 'future_only' as const : has('expired') ? 'expired_only' as const : 'none' as const,
    chance: considered.length ? considered.map(routeChance).sort((a, b) => CHANCE_RANK[b] - CHANCE_RANK[a])[0] : 'none' as const,
    exceptional: matched.some(r => r.period.start != null || r.period.end != null),
    insufficient: !considered.length || considered.every(r => r.unknowns.length > 0 || routeChance(r) === 'unknown'),
    unknowns: [...new Set(considered.flatMap(r => r.unknowns))].slice(0, 5),
    confidence: best?.confidence ?? null,
    review: best?.review ?? null,
    sources: [...new Set(considered.flatMap(r => r.sources))],
  };
}

type Model = ResolvedBuild['model'];
const numericField = (model: Model, field: string) => typeof model[field] === 'number' && model[field] > 0 ? model[field] as number : 0;

/**
 * The physical pieces of a build and the components of each (base item, cards, enchants, refine, grade, random options).
 * Shared by the assessment and by the Optimize brief, so "what is a component" has one definition.
 */
export function equipmentFacets(model: Model) {
  const numeric = (field: string) => numericField(model, field);
  const pieces = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = numeric(slot.key);
    if (!itemId) continue;
    const custom = model.customAttachments?.[slot.key];
    const customMatches = custom?.itemId === itemId;
    const attachments: Record<string, number> = {};
    for (const field of [...slot.cardFields, ...slot.enchantFields.filter(Boolean)]) {
      if (numeric(field)) attachments[field] = numeric(field);
    }
    if (customMatches) {
      for (const key of Object.keys(attachments)) delete attachments[key];
      custom.cards.forEach((id, i) => { if (id) attachments[`card${i}`] = id; });
      custom.enchants.forEach((id, i) => { if (id) attachments[`enchant${i}`] = id; });
    }
    const refine = customMatches ? custom.refine ?? 0 : numeric(`${slot.key}Refine`);
    const grade = customMatches ? custom.grade ?? '' : String(model[`${slot.key}Grade`] ?? '');
    const randomOptions = customMatches ? custom.bas.map(value => value ?? '') : slot.optionIndexes.map(index => model.rawOptionTxts?.[index] ?? '');
    const facets = [{ path: slot.key as string, aspect: 'item', id: itemId, position: null as number | null },
      ...Object.entries(attachments).map(([field, id]) => ({ path: field, aspect: field.toLowerCase().includes('enchant') ? 'enchant' : 'item', id,
        position: customMatches ? Number(field.replace('enchant', '')) : slot.enchantFields.indexOf(field as never) })),
      ...(refine ? [{ path: `${slot.key}Refine`, aspect: 'refine', id: itemId, position: null }] : []),
      ...(grade ? [{ path: `${slot.key}Grade`, aspect: 'grade', id: itemId, position: null }] : [])];
    pieces.push({ slot, itemId, attachments, refine, grade, randomOptions, facets });
  }
  return pieces;
}

/** Internal input is resolveBuild(...).model (or MainModel in the UI), never unresolved share/overrides. */
export function assessAcquisition(
  build: Pick<ResolvedBuild, 'model'>,
  server: string,
  preferences: AcquisitionPreferences = {},
  knowledge: AcquisitionKnowledge = acquisitionKnowledge,
) {
  const asOf = z.iso.date().parse(preferences.asOf ?? new Date().toISOString().slice(0, 10));
  const model = build.model;
  const routesByItem = new Map<number, ReturnType<typeof queryAcquisition>>();
  const routesFor = (itemId: number) => routesByItem.get(itemId) ?? routesByItem.set(itemId, queryAcquisition({ server, asOf, itemId }, knowledge)).get(itemId)!;
  const sourceDetails = (ids: string[]) => knowledge.sources.filter(s => ids.includes(s.id));
  const diagnostics: { path: string; itemId: number; aspect: string; status: AcquisitionStatus; reason: string;
    evidence: ReturnType<typeof evidenceOf>;
    routes: (AcquisitionRoute & { availability: string; guaranteedForRequestedOutcome: boolean; sourceDetails: AcquisitionKnowledge['sources'] })[] }[] = [];
  const numeric = (field: string) => numericField(model, field);
  const included = (slotKey: string, path: string) => preferences.include?.(slotKey, path) ?? true;

  for (const { slot, itemId, attachments, refine, grade, randomOptions, facets } of equipmentFacets(model)) {
    const owned = preferences.owned?.some(p => {
      z.iso.date().parse(p.acquiredOn);
      return p.itemId === itemId && p.refine === refine && p.grade === grade && p.acquiredOn <= asOf
        && Object.keys(p.attachments).length === Object.keys(attachments).length
        && Object.entries(attachments).every(([field, id]) => p.attachments[field] === id)
        && randomOptions.every((value, index) => value === (p.randomOptions?.[index] ?? ''));
    });
    for (const facet of facets) {
      if (!included(slot.key, `gear.${facet.path}`)) continue;
      const matched = routesFor(facet.aspect === 'enchant' ? itemId : facet.id).filter(r => r.target.aspect === facet.aspect && r.target.itemIds.includes(facet.aspect === 'enchant' ? itemId : facet.id)
        && (facet.aspect !== 'enchant' || r.target.position === facet.position && r.target.enchantIds.includes(facet.id))
        && (facet.aspect !== 'refine' || r.target.refine && refine >= r.target.refine.min && refine <= r.target.refine.max)
        && (facet.aspect !== 'grade' || r.target.grade === grade))
        .map(r => ({ ...r, guaranteedForRequestedOutcome: r.success != null && r.success.numerator === r.success.denominator
          && !r.outcomes.length && r.steps.every(s => s.success != null && s.success.numerator === s.success.denominator),
        }));
      const active = matched.filter(r => r.availability === 'active');
      const usable = active.filter(r => !r.unknowns.length);
      const easy = usable.some(r => r.cost.difficulty === 'ordinary' && (!preferences.requireGuaranteed || r.guaranteedForRequestedOutcome));
      const status: AcquisitionStatus = owned ? 'owned' : easy ? 'obtainable' : usable.length ? 'difficult'
        : matched.some(r => r.availability === 'expired') ? 'expired_routes' : 'insufficient_information';
      diagnostics.push({ path: `gear.${facet.path}`, itemId: facet.id, aspect: facet.aspect, status,
        reason: owned ? 'Posse declarada desta configuração exata; prazo da rota não invalida o equipamento.'
          : status === 'obtainable' ? 'Procedimento regional documentado, condicionado aos requisitos da rota.'
          : status === 'difficult' ? 'Rota documentada com investimento elevado, aleatoriedade ou dificuldade econômica desconhecida.'
          : status === 'expired_routes' ? 'Há rota encerrada; cobertura não exaustiva, não é prova de impossibilidade atual.'
          : matched.length ? 'Rota documentada sem disponibilidade LATAM confirmada (genérica, não revisada ou sem período); não é prova de obtenção nem de impossibilidade.'
          : 'Cobertura insuficiente; ausência de regra não demonstra impossibilidade.', evidence: evidenceOf(matched), routes: matched });
    }
    if (randomOptions.some(Boolean) && included(slot.key, `gear.${slot.key}.randomOptions`)) diagnostics.push({ path: `gear.${slot.key}.randomOptions`, itemId, aspect: 'randomOptions',
      status: owned ? 'owned' : 'insufficient_information', reason: 'Pools mecânicos não comprovam a rota de sorteio dos bônus aleatórios.', evidence: evidenceOf([]), routes: [] });
    // Costume enchant subslots have no descriptor of their own.
    for (const sub of slot.subItemSlots ?? []) {
      if (numeric(sub.key) && included(slot.key, `gear.${sub.key}`)) diagnostics.push({ path: `gear.${sub.key}`, itemId: numeric(sub.key), aspect: 'item', status: 'insufficient_information', reason: 'Rota de encanto visual ainda não catalogada.', evidence: evidenceOf([]), routes: [] });
    }
  }
  return {
    schemaVersion: 1 as const, knowledgeRevision: knowledge.revision, server, asOf,
    mechanicalValidity: 'not_assessed' as const, economicCost: null,
    scope: 'Avaliação por componente; não prova estoque, orçamento, composição completa de rotas nem posse de materiais.',
    diagnostics,
    effects: knowledge.effects.filter(e => e.server === server && e.itemIds.every(id => EQUIPMENT_SLOTS.some(s => numeric(s.key) === id))
      && EQUIPMENT_SLOTS.reduce((sum, s) => sum + (e.itemIds.includes(numeric(s.key)) ? numeric(`${s.key}Refine`) : 0), 0) >= e.minRefineSum)
      .map(e => ({ ...e, sourceDetails: sourceDetails(e.sources) })),
  };
}
