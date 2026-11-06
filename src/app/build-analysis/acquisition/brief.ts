import type { ResolvedBuild } from '../engine/build-input';
import { equipmentFacets } from './assess';

type Model = ResolvedBuild['model'];
const GRADES = ['', 'none', 'D', 'C', 'B', 'A'];
const gradeRank = (grade: string) => GRADES.indexOf(grade);

/**
 * Which components of `after` must be obtained that `before` does not already have. A piece kept as it is — same base item, same cards,
 * enchants, refine, grade and random options — is not an acquisition. A new base item makes every component on it new. Lowering a refine
 * or grade is not an acquisition either. Keys are `${slotKey}|${diagnosticPath}`, the same paths `assessAcquisition` reports.
 */
export function changedComponents(before: Model, after: Model) {
  const previous = new Map(equipmentFacets(before).map(piece => [piece.slot.key as string, piece]));
  const changed = new Set<string>();
  let total = 0;
  for (const piece of equipmentFacets(after)) {
    const old = previous.get(piece.slot.key as string);
    const samePiece = old?.itemId === piece.itemId;
    const mark = (path: string, isChanged: boolean) => { total++; if (isChanged) changed.add(`${piece.slot.key}|gear.${path}`); };
    for (const facet of piece.facets) {
      if (facet.aspect === 'refine') mark(facet.path, !samePiece || piece.refine > (old?.refine ?? 0));
      else if (facet.aspect === 'grade') mark(facet.path, !samePiece || gradeRank(piece.grade) > gradeRank(old?.grade ?? '') || gradeRank(piece.grade) < 0 && piece.grade !== old?.grade);
      else if (facet.path === piece.slot.key) mark(facet.path, !samePiece);
      else mark(facet.path, !samePiece || old?.attachments[facet.path] !== facet.id);
    }
    if (piece.randomOptions.some(Boolean)) mark(`${piece.slot.key}.randomOptions`, !samePiece || JSON.stringify(piece.randomOptions) !== JSON.stringify(old?.randomOptions));
    for (const sub of piece.slot.subItemSlots ?? []) {
      const id = typeof after[sub.key] === 'number' ? after[sub.key] as number : 0;
      if (id > 0) mark(sub.key, !samePiece || before[sub.key] !== id);
    }
  }
  return { changed, total, include: (slotKey: string, path: string) => changed.has(`${slotKey}|${path}`) };
}

export interface BriefComponent {
  path: string; aspect?: string; label?: string; evidence: { documentedRoute: boolean; availability: string; chance: string; insufficient: boolean };
}

/**
 * Coverage of what the recommendation asks the player to obtain. "Complete" means every changed component has a documented, LATAM-confirmed
 * route with known odds; it never means easy or guaranteed. Missing documentation is "without procedure", not "impossible".
 * Only the components without a procedure are listed (they have no entry elsewhere); the other facets are counts, the per-component
 * detail lives in `changed`.
 */
const MAX_NAMED = 8;
/** Counts by aspect plus the distinct names of items and enchants (refine, grade and random options have no routes at all, so a name per piece adds nothing). */
function withoutProcedure(missing: BriefComponent[]) {
  const byAspect: Record<string, number> = {};
  const names = new Set<string>();
  for (const c of missing) {
    const aspect = c.aspect ?? 'item';
    byAspect[aspect] = (byAspect[aspect] ?? 0) + 1;
    if ((aspect === 'item' || aspect === 'enchant') && c.label) names.add(c.label);
  }
  const named = [...names];
  return { count: missing.length, byAspect, named: named.slice(0, MAX_NAMED), moreNamed: named.length > MAX_NAMED ? named.length - MAX_NAMED : undefined };
}

export function configurationCoverage(changed: BriefComponent[], preserved: number) {
  const documented = changed.filter(c => c.evidence.documentedRoute);
  const count = (pick: (c: BriefComponent) => boolean) => changed.filter(pick).length;
  const complete = changed.length > 0 && changed.every(c => c.evidence.documentedRoute && !c.evidence.insufficient && c.evidence.availability === 'confirmed');
  return {
    level: !changed.length ? 'unchanged' as const : complete ? 'complete' as const : documented.length ? 'partial' as const : 'undocumented' as const,
    components: { changed: changed.length, preserved, documented: documented.length },
    withoutProcedure: withoutProcedure(changed.filter(c => !c.evidence.documentedRoute)),
    expiredOnly: count(c => c.evidence.availability === 'expired_only'),
    unknownChance: count(c => c.evidence.documentedRoute && c.evidence.chance === 'unknown'),
    unconfirmedLatam: count(c => c.evidence.availability === 'unconfirmed'),
    note: 'complete = rota documentada, confirmada no LATAM e com chance conhecida em cada componente novo; não significa fácil nem garantida. Sem procedimento = sem informação, não impossível.',
  };
}
