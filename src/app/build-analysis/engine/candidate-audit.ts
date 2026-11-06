/**
 * What the candidate generator did with the catalog, piece by piece and socket by socket. Pure bookkeeping: it reads nothing the search did
 * not already compute and it never changes a choice. Every count is of DISTINCT candidates (a set, not a call counter), so a cache hit or a
 * repeated move is not counted twice.
 *
 * A piece goes through these stations, each one reached only by the ones the station before it let through:
 *
 *   unavailable | mvp     excluded by the caller's constraints (never reachable);
 *   notRelevant           in the catalog for the slot, but no script key / skill / enchant pool ties it to the damage formula;
 *   screenCut             relevant, but past the share of the discovery budget the slot got, so it was never measured bare;
 *   bareCut               measured bare and left out of the pool by its bare score (cap per slot, plus a representative of each enchant family);
 *   pooled                in the slot's pool (a move exists), but no move with it was evaluated (discovery cap, budget or time);
 *   evaluated             a move with it was evaluated (and not accepted);
 *   accepted              the answer wears it.
 */
export type PieceFate = 'unavailable' | 'mvp' | 'notRelevant' | 'screenCut' | 'bareCut' | 'pooled' | 'evaluated' | 'accepted';

const RANK: Record<PieceFate, number> = { unavailable: 0, mvp: 0, notRelevant: 1, screenCut: 2, bareCut: 3, pooled: 4, evaluated: 5, accepted: 6 };

export interface SlotAudit {
  /** Pieces of the catalog that fit the slot (class, level and LATAM filters already applied by the index). */
  catalog: number;
  excluded: { unavailable: number; mvp: number };
  notRelevant: number;
  /** Relevant and allowed: what the generator may measure. */
  eligible: number;
  /** Measured bare. */
  screened: number;
  truncated: { byShare: number; byBareScore: number };
  pooled: number;
  evaluated: number;
  accepted: number;
  /** In the pool but never evaluated / evaluated and not accepted. */
  pooledNotEvaluated: number;
  evaluatedRejected: number;
}

export interface FieldAudit {
  field: string;
  /** Every legal card/enchant for the field. */
  legal: number;
  /** What the complement search offers (ranked by the formula's keys, cut by locks and unavailable ids). */
  offered: number;
  /** Distinct choices a calculation was spent on, whichever pass made it. */
  tried: number;
  locked: boolean;
}

export function candidateRecorder() {
  const slots = new Map<string, Map<number, PieceFate>>();
  const fixed = new Map<string, string>();
  const tried = new Set<string>();
  const table = (slot: string) => slots.get(slot) ?? slots.set(slot, new Map()).get(slot)!;

  return {
    /** The slot's catalog and what the caller's constraints exclude from it. */
    open(slot: string, ids: Iterable<number>, why: (id: number) => 'unavailable' | 'mvp' | undefined) {
      const map = table(slot);
      for (const id of ids) map.set(id, why(id) ?? 'notRelevant');
    },
    /** The slot was not searched (locked, pinned to the worn piece, a caller's list): said apart, never counted as a failure of discovery. */
    fix(slot: string, reason: string) { fixed.set(slot, reason); },
    /** Raise a piece to a later station; never lowers one, never touches an excluded piece. */
    reach(slot: string, id: number, fate: PieceFate) {
      const map = table(slot);
      const at = map.get(id);
      if (at === 'unavailable' || at === 'mvp') return;
      if (at === undefined || RANK[fate] > RANK[at]) map.set(id, fate);
    },
    tryField(key: string, id: unknown) { tried.add(`${key}:${id ?? 'null'}`); },
    hasTried: (key: string, id: unknown) => tried.has(`${key}:${id ?? 'null'}`),
    fateOf(slot: string, id: number): PieceFate | 'notInCatalog' | 'slotNotSearched' {
      if (fixed.has(slot)) return 'slotNotSearched';
      return slots.get(slot)?.get(id) ?? 'notInCatalog';
    },
    fixedSlots: () => Object.fromEntries(fixed),
    triedCount: (key: string) => [...tried].filter((entry) => entry.startsWith(`${key}:`)).length,
    report(accepted: (slot: string, id: number) => boolean): Record<string, SlotAudit> {
      const out: Record<string, SlotAudit> = {};
      for (const [slot, map] of slots) {
        const count = (...fates: PieceFate[]) => [...map.values()].filter((fate) => fates.includes(fate)).length;
        for (const [id, fate] of map) if (fate === 'evaluated' && accepted(slot, id)) map.set(id, 'accepted');
        const eligible = count('screenCut', 'bareCut', 'pooled', 'evaluated', 'accepted');
        out[slot] = {
          catalog: map.size,
          excluded: { unavailable: count('unavailable'), mvp: count('mvp') },
          notRelevant: count('notRelevant'),
          eligible,
          screened: count('bareCut', 'pooled', 'evaluated', 'accepted'),
          truncated: { byShare: count('screenCut'), byBareScore: count('bareCut') },
          pooled: count('pooled', 'evaluated', 'accepted'),
          evaluated: count('evaluated', 'accepted'),
          accepted: count('accepted'),
          pooledNotEvaluated: count('pooled'),
          evaluatedRejected: count('evaluated'),
        };
      }
      return out;
    },
  };
}
export type CandidateRecorder = ReturnType<typeof candidateRecorder>;
