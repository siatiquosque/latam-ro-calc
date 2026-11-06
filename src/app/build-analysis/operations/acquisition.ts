import { z } from 'zod';
import { Dataset } from '../data/dataset';
import { BuildInput, resolveBuild } from '../engine/build-input';
import { Shortener } from '../engine/share';
import { loadSkillTree, skillTreeLoaded } from '../engine/skill-tree';
import { validateBuild } from '../engine/validate';
import { AnalysisRuntime } from '../runtime';
import { changedComponents, configurationCoverage } from '../acquisition/brief';
import { assessAcquisition, EquipmentPossession, routeChance } from '../acquisition/assess';
import { acquisitionKnowledge } from '../acquisition/catalog';
import { AcquisitionKnowledge, AcquisitionRoute } from '../acquisition/contracts';
import { queryAcquisition } from '../acquisition/query';
import { compact } from './compact';
import { createBuildContext } from './context';

export const SERVER = 'LATAM';
const MAX_ROUTES = 5;
const MAX_PLAIN = 8;
/** Brief alert kinds, most urgent first. A known chance below 1% is "low"; this is a flag, not a difficulty score. */
const ALERTS = ['expired', 'exceptional', 'lowChance'] as const;
type Alert = (typeof ALERTS)[number];
const LOW_CHANCE = 0.01;
export const MAX_BUILDS = 10;

export const possessionSchema = z.object({
  itemId: z.number().int().positive(), refine: z.number().int().min(0), grade: z.string(),
  attachments: z.object({}).catchall(z.number().int().positive()),
  randomOptions: z.array(z.string()).optional(), acquiredOn: z.iso.date(),
});

export interface AcquisitionArgs {
  /** Exactly one of itemId, monsterId or builds (e.g. the `share` links of optimize finalists). */
  itemId?: number;
  monsterId?: number;
  builds?: BuildInput[];
  asOf?: string;
  owned?: EquipmentPossession[];
  requireGuaranteed?: boolean;
}

type QueriedRoute = ReturnType<typeof queryAcquisition>[number];
const AVAILABILITY_ORDER = ['active', 'unknown', 'future', 'expired'];
const byAvailability = (a: { availability: string }, b: { availability: string }) =>
  AVAILABILITY_ORDER.indexOf(a.availability) - AVAILABILITY_ORDER.indexOf(b.availability);

/** One entry per route: what is needed, what is documented, what is unknown. Full source records live once, in `sources`. */
function routeView(route: AcquisitionRoute & { availability: string }, itemName: (id: number) => string | undefined) {
  const drop = route.drop;
  return compact({
    id: route.id, label: route.label, method: route.method, availability: route.availability,
    server: route.server, review: route.review, confidence: route.confidence,
    period: route.period.start || route.period.end ? { start: route.period.start, end: route.period.end, known: route.period.known } : undefined,
    chance: routeChance(route),
    drop: drop ? { monster: drop.monsterId, map: drop.map ?? undefined, probability: drop.probability ?? null } : undefined,
    success: route.success ?? undefined,
    steps: route.steps.length ? route.steps.map(s => compact({
      from: s.fromLevel, to: s.toLevel, success: s.success,
      materials: s.materials.map(m => `${m.amount}x ${itemName(m.itemId) ?? m.itemId} (${m.itemId})`),
      failure: s.failure,
    })) : undefined,
    outcomes: route.outcomes.length ? route.outcomes : undefined,
    requires: route.requirements.map(r => r.description),
    result: route.resultProperties,
    unknowns: route.unknowns.length ? route.unknowns : undefined,
    sources: route.sources,
    revisionReason: route.supersedes ? route.revisionReason : undefined,
  });
}

/** Item-level and build-level acquisition reports. Pure lookups over the bundled knowledge: no search, no probability simulation. */
export function createAcquisitionOperations(
  dataset: Dataset,
  config: Pick<AnalysisRuntime, 'shortenerUrl' | 'defaultTargetId'>,
  shortener?: Shortener,
  knowledge: AcquisitionKnowledge = acquisitionKnowledge,
) {
  const { normalizeShare } = createBuildContext(config, shortener);
  const itemName = (id: number) => dataset.itemIndex.get(id)?.name ?? dataset.itemIndex.latamName(id);
  const sources = new Map(knowledge.sources.map(s => [s.id, s]));
  const sourceTable = (ids: Iterable<string>) => Object.fromEntries([...new Set(ids)].map(id => {
    const s = sources.get(id)!;
    return [id, { url: s.url, version: s.version, retrievedOn: s.retrievedOn, license: s.license }];
  }));

  function lookup({ itemId, monsterId, asOf }: { itemId?: number; monsterId?: number; asOf: string }) {
    const all = queryAcquisition({ server: SERVER, asOf, itemId, monsterId }, knowledge).sort(byAvailability);
    const shown = all.slice(0, MAX_ROUTES);
    return compact({
      subject: itemId != null ? { itemId, name: itemName(itemId) } : { monsterId },
      asOf, server: SERVER, knowledgeRevision: knowledge.revision,
      routes: shown.map(r => routeView(r, itemName)),
      omittedRoutes: all.length > shown.length ? all.length - shown.length : undefined,
      sources: sourceTable(shown.flatMap(r => r.sources)),
      missing: all.length ? undefined : ['Nenhuma rota documentada. Isso não prova que o item é inalcançável: a base cobre só as famílias importadas.'],
    });
  }

  async function assess({ itemId, monsterId, builds, asOf = new Date().toISOString().slice(0, 10), owned, requireGuaranteed }: AcquisitionArgs) {
    z.iso.date().parse(asOf);
    if ([itemId != null, monsterId != null, builds != null].filter(Boolean).length !== 1) throw new Error('Informe exatamente um de: itemId, monsterId ou builds.');
    if (!builds) return lookup({ itemId, monsterId, asOf });
    if (!builds.length || builds.length > MAX_BUILDS) throw new Error(`builds aceita de 1 a ${MAX_BUILDS} builds.`);

    await loadSkillTree();
    const routeViews = new Map<string, ReturnType<typeof routeView>>();
    const effects = new Map<string, AcquisitionKnowledge['effects'][number]>();
    const results = [];
    const names: Record<number, string> = {};
    for (const input of builds) {
      const normalized = await normalizeShare(input);
      const validation = validateBuild(normalized, dataset, {}, skillTreeLoaded());
      const rb = resolveBuild(normalized, dataset);
      const assessment = assessAcquisition(rb, SERVER, { asOf, owned, requireGuaranteed }, knowledge);
      const byStatus: Record<string, number> = {};
      const documented = [];
      const undocumented = { items: new Set<number>(), enchants: new Set<number>() };
      const undocumentedByAspect: Record<string, number> = {};
      for (const d of assessment.diagnostics) {
        byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
        const { evidence: e } = d;
        if (!e.documentedRoute) {
          undocumentedByAspect[d.aspect] = (undocumentedByAspect[d.aspect] ?? 0) + 1;
          // Refine, grade and random options have no routes in the knowledge yet: the count says it, a line per piece would only cost tokens.
          if (d.aspect === 'item' || d.aspect === 'enchant') { undocumented[d.aspect === 'item' ? 'items' : 'enchants'].add(d.itemId); names[d.itemId] = rb.items[d.itemId]?.name ?? itemName(d.itemId) ?? ''; }
          continue;
        }
        const shown = [...d.routes].sort(byAvailability).slice(0, MAX_ROUTES);
        for (const r of shown) if (!routeViews.has(r.id)) routeViews.set(r.id, routeView(r, itemName));
        documented.push(compact({
          path: d.path, itemId: d.itemId, name: rb.items[d.itemId]?.name ?? itemName(d.itemId), aspect: d.aspect, status: d.status,
          availability: e.availability, chance: e.chance, exceptional: e.exceptional || undefined, insufficient: e.insufficient || undefined,
          confidence: e.confidence ?? undefined, routes: shown.map(r => r.id),
          omittedRoutes: d.routes.length > shown.length ? d.routes.length - shown.length : undefined,
          missing: e.unknowns.length ? e.unknowns : undefined,
        }));
      }
      for (const effect of assessment.effects) effects.set(effect.id, effect);
      results.push(compact({
        mechanical: validation.valid ? 'valid' : 'invalid',
        errors: validation.valid ? undefined : validation.errors.slice(0, 3),
        summary: { components: assessment.diagnostics.length, ...byStatus },
        documented,
        undocumented: { items: [...undocumented.items], enchants: [...undocumented.enchants] },
        undocumentedByAspect,
        effects: assessment.effects.map(e => e.id),
      }));
    }
    return {
      asOf, server: SERVER, knowledgeRevision: knowledge.revision,
      scope: 'Cada componente é avaliado separado: sem custo, sem tempo de farm, sem ranking. Ausência de rota não é impossibilidade; `chance: unknown` é probabilidade não documentada.',
      builds: results,
      names,
      routes: Object.fromEntries(routeViews),
      effects: [...effects.values()].map(e => ({ id: e.id, effect: e.effect, engineCoverage: e.engineCoverage, sources: e.sources })),
      sources: sourceTable([...routeViews.values()].flatMap(r => r.sources as string[]).concat([...effects.values()].flatMap(e => e.sources))),
    };
  }

  /**
   * Compact acquisition diagnostic for an optimization: only what the recommended build changes or adds relative to the original.
   * Pieces kept as they were are counted, not assessed. Routes are summarised (best route only); `get_acquisition` has the rest.
   */
  async function brief({ original, final, asOf = new Date().toISOString().slice(0, 10) }: { original: BuildInput; final: BuildInput; asOf?: string }) {
    z.iso.date().parse(asOf);
    const before = resolveBuild(await normalizeShare(original), dataset);
    const after = resolveBuild(await normalizeShare(final), dataset);
    const { include, total, changed: keys } = changedComponents(before.model, after.model);
    const assessment = assessAcquisition(after, SERVER, { asOf, include }, knowledge);
    const clip = (text: string, n: number) => text.length > n ? `${text.slice(0, n - 3)}...` : text;
    const components = assessment.diagnostics.map(d => ({ d, name: rb(after, d.itemId, itemName) }));
    const configuration = configurationCoverage(components.map(({ d, name }) => ({ path: d.path, aspect: d.aspect, label: name, evidence: d.evidence })), total - keys.size);
    // Components with a route, grouped when several slots ask for the same thing (e.g. the same card twice).
    const groups = new Map<string, { first: (typeof components)[number]; paths: string[] }>();
    for (const c of components) {
      if (!c.d.evidence.documentedRoute) continue;
      const key = `${c.d.itemId}|${c.d.aspect}|${c.d.status}|${c.d.routes.map(r => r.id).join(',')}`;
      const group = groups.get(key);
      if (group) group.paths.push(c.d.path); else groups.set(key, { first: c, paths: [c.d.path] });
    }
    const hosts = new Map<string, number>();
    const uncertainties = new Map<string, number>();
    const entries = [...groups.values()].map(({ first: { d, name }, paths }) => {
      const e = d.evidence;
      const best = [...d.routes].sort(byAvailability)[0];
      for (const id of e.sources) { const host = hostOf(sources.get(id)?.url); hosts.set(host, (hosts.get(host) ?? 0) + 1); }
      for (const text of e.unknowns.slice(0, 1)) uncertainties.set(clip(text, 120), (uncertainties.get(clip(text, 120)) ?? 0) + paths.length);
      const probability = best.drop?.probability ?? undefined;
      const odds = probability ? `${probability.numerator}/${probability.denominator}` : undefined;
      const requires = best.drop ? [] : best.requirements.slice(0, 2).map(r => clip(r.description, 90));
      const alert: Alert = e.availability === 'expired_only' ? 'expired' : e.exceptional ? 'exceptional' : probability && probability.numerator / probability.denominator < LOW_CHANCE ? 'lowChance' : undefined;
      return { alert, entry: compact({
        alert,
        paths: paths.length > 1 ? paths : undefined, path: paths.length > 1 ? undefined : paths[0], itemId: d.itemId, name, aspect: d.aspect, status: d.status,
        availability: e.availability, chance: e.chance, exceptional: e.exceptional || undefined, insufficient: e.insufficient || undefined,
        route: compact({ method: best.method, monsterId: best.drop?.monsterId, map: best.drop?.map ?? undefined, odds, requires: requires.length ? requires : undefined, until: best.period.end ?? undefined }),
        otherRoutes: d.routes.length > 1 ? d.routes.length - 1 : undefined,
      }) };
    });
    const rank = (alert?: Alert) => alert ? ALERTS.indexOf(alert) : ALERTS.length;
    entries.sort((x, y) => rank(x.alert) - rank(y.alert));
    // Alerts are never dropped to save space; only the unremarkable routes are capped.
    const flagged = entries.filter(x => x.alert);
    const plain = entries.filter(x => !x.alert);
    // Names only: the odds, period and route of each flagged component are on its `changed` entry.
    const alerts = Object.fromEntries(ALERTS.flatMap(kind => {
      const names = flagged.filter(x => x.alert === kind).flatMap(x => x.entry.name ?? []);
      return names.length ? [[kind, names]] : [];
    }));
    return {
      asOf, server: SERVER, knowledgeRevision: knowledge.revision,
      configuration,
      alerts,
      changed: [...flagged, ...plain.slice(0, MAX_PLAIN)].map(x => x.entry),
      omitted: plain.length > MAX_PLAIN ? plain.length - MAX_PLAIN : undefined,
      uncertainties: [...uncertainties].map(([text, components]) => ({ text, components })),
      sources: Object.fromEntries(hosts),
      detail: 'get_acquisition (itemId ou builds:[{share}]) traz rotas completas, materiais, chances e ids de fontes.',
    };
  }
  return { assess, brief };
}

/** Provenance label: the site for web sources, the repository path root (`repo:RagnarokDB`) for bundled ones. */
const hostOf = (url = '') => { try { const { hostname } = new URL(url); if (hostname) return hostname.replace(/^www\./, ''); } catch { /* not a URL */ } return url.split('/')[0] || 'unknown'; };
const rb = (build: ReturnType<typeof resolveBuild>, id: number, itemName: (id: number) => string | undefined) => build.items[id]?.name ?? itemName(id);
