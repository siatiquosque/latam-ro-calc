import { z } from 'zod';
import { acquisitionKnowledge } from './catalog';
import { AcquisitionKnowledge, AcquisitionRoute, effectiveRoutes } from './contracts';
import { DropIndex, dropRoutes, indexDrops } from './drops';

export function routeAvailability(route: AcquisitionRoute, server: string, asOf: string) {
  if (route.server !== server || route.review === 'unreviewed' || !route.period.known) return 'unknown' as const;
  if (route.period.end && asOf > route.period.end) return 'expired' as const;
  if (route.period.start && asOf < route.period.start) return 'future' as const;
  return 'active' as const;
}

/** Effective routes and their item/enchant/monster indexes (drops stay columnar and are expanded per query, unless a catalog route already carries the same fact), built once per knowledge object (the quadratic revision scan must not run per query). */
const indexes = new WeakMap<AcquisitionKnowledge, { routes: AcquisitionRoute[]; byItem: Map<number, AcquisitionRoute[]>; byMonster: Map<number, AcquisitionRoute[]>; drops?: DropIndex; curated: Set<string> }>();
function indexOf(knowledge: AcquisitionKnowledge) {
  let index = indexes.get(knowledge);
  if (index) return index;
  const routes = effectiveRoutes(knowledge);
  const byItem = new Map<number, AcquisitionRoute[]>();
  const byMonster = new Map<number, AcquisitionRoute[]>();
  for (const route of routes) {
    for (const id of new Set([...route.target.itemIds, ...route.target.enchantIds])) byItem.set(id, [...(byItem.get(id) ?? []), route]);
    if (route.drop) byMonster.set(route.drop.monsterId, [...(byMonster.get(route.drop.monsterId) ?? []), route]);
  }
  indexes.set(knowledge, index = { routes, byItem, byMonster, drops: knowledge.drops && indexDrops(knowledge.drops),
    curated: new Set(knowledge.routes.flatMap(route => route.importKey ? [route.importKey] : [])) });
  return index;
}

/** Direct relations only: no probability simulation, remote calls or implicit chain planning. */
export function queryAcquisition(
  query: { server: string; asOf: string; itemId?: number; monsterId?: number; aspect?: AcquisitionRoute['target']['aspect'] },
  knowledge: AcquisitionKnowledge = acquisitionKnowledge,
) {
  z.iso.date().parse(query.asOf);
  const index = indexOf(knowledge);
  const stored = query.itemId != null ? index.byItem.get(query.itemId) ?? []
    : query.monsterId != null ? index.byMonster.get(query.monsterId) ?? [] : index.routes;
  const pool = index.drops && (query.aspect == null || query.aspect === 'item') ? [...stored, ...dropRoutes(index.drops, query).filter(route => !index.curated.has(route.importKey!))] : stored;
  return pool.filter(route => (route.server === query.server || route.server === 'generic')
    && (query.monsterId == null || route.drop?.monsterId === query.monsterId)
    && (query.aspect == null || route.target.aspect === query.aspect))
    .map(route => ({ ...route, availability: routeAvailability(route, query.server, query.asOf),
      sourceDetails: knowledge.sources.filter(source => route.sources.includes(source.id)),
      dependencies: [...new Set(route.requirements.flatMap(requirement => [
        ...(requirement.anyItemIds ?? (requirement.itemId ? [requirement.itemId] : [])),
        ...(requirement.enchantId ? [requirement.enchantId] : []),
      ]))],
    }));
}
