import snapshot from '../../../data/random-options/rathena-audit.json';

type Reference = { group: string; file: string; origin: string; conditions: Record<string, unknown>; url: string; groupDefined: boolean; hasRollPool: boolean; identityMatched: boolean };
type AuditItem = { aegisName: string; name: string; policy: string; capacity: number; status: string; references: Reference[] };
type Group = { Group: string; Slots?: { Slot: number; Options: unknown[] }[]; MaxRandom?: number; Random?: unknown[] };
const items = snapshot.items as Record<string, AuditItem>;
const groups = snapshot.groups as Record<string, Group>;
const options = snapshot.options as Record<string, { id: number; calculatorKey?: string; mapping: string }>;

/** Upstream evidence stays separate from the validated regional catalog. */
export function randomOptionReferencesFor(itemId: number) {
  const item = items[itemId];
  if (!item) return undefined;
  return {
    status: item.status,
    policy: item.policy,
    revision: snapshot.revision,
    disclaimer: snapshot.disclaimer,
    references: item.references.map(ref => ({
      ...ref,
      ...(ref.identityMatched && ref.hasRollPool && groups[ref.group] ? {
        pool: groups[ref.group],
        options: Object.fromEntries([
          ...(groups[ref.group].Slots ?? []).flatMap(slot => slot.Options),
          ...(groups[ref.group].Random ?? []),
        ].map(option => {
          const name = (option as { Option: string }).Option;
          return [name, options[name] ?? { calculatorKey: undefined, mapping: 'not-mapped' }];
        })),
      } : {}),
    })),
  };
}

/** Items the audit knows about, with what is needed to list them without reading every reference. */
export function auditedRandomItems() {
  return Object.entries(items).map(([id, item]) => ({ id: Number(id), aegisName: item.aegisName, name: item.name, policy: item.policy, capacity: item.capacity,
    groups: [...new Set(item.references.filter(ref => ref.identityMatched && ref.hasRollPool).map(ref => ref.group))] }));
}

/**
 * A starting point for `regional-pools.json`, built from the rAthena pool of the item. It is a draft: only
 * options that map to a calculator key (`exact-script`) become rules, and nothing here is confirmed for LATAM.
 */
const drafts = new Map<number, ReturnType<typeof draftPoolFor>>();
/** The rAthena draft, memoised: the same item is asked for by every candidate that wears it. Never confirmed for LATAM. */
export function upstreamPoolFor(itemId: number) {
  if (!drafts.has(itemId)) drafts.set(itemId, draftPoolFor(itemId));
  return drafts.get(itemId)?.pool;
}

export function draftPoolFor(itemId: number) {
  const references = randomOptionReferencesFor(itemId)?.references.filter(ref => 'pool' in ref && ref.pool) ?? [];
  if (!references.length) return undefined;
  const unmapped = new Set<string>();
  const profiles = references.map(ref => {
    const known = (ref as { options: Record<string, { calculatorKey?: string }> }).options;
    const slots = ((ref as { pool: Group }).pool.Slots ?? []);
    return {
      combiner: ref.group,
      positions: slots.map(slot => (slot.Options as { Option: string; MinValue?: number; MaxValue?: number }[]).flatMap(option => {
        const key = known[option.Option]?.calculatorKey;
        if (!key || option.MinValue === undefined) { unmapped.add(option.Option); return []; }
        return [{ key, min: option.MinValue, max: option.MaxValue ?? option.MinValue }];
      })),
    };
  });
  return {
    pool: { source: `rAthena ${snapshot.revision}`, confidence: 'rascunho do rAthena; confirmar no jogo antes de usar', profiles },
    unmapped: [...unmapped].sort(),
  };
}

type Rule = { key: string; min: number; max: number };
const range = (min: number | undefined, max: number | undefined) => min === undefined ? '' : max === undefined || max === min ? ` ${min}` : ` ${min}-${max}`;

/** A confirmed pool as short strings ("atk 1-20") per position, instead of one object per rule. */
export const compactCatalog = (pool: { source: string; profiles: { combiner?: string; positions: Rule[][] }[] }) => ({
  source: pool.source,
  profiles: pool.profiles.map(profile => ({ combiner: profile.combiner, positions: profile.positions.map(position => position.map(rule => `${rule.key}${range(rule.min, rule.max)}`)) })),
});

/**
 * The rAthena reference without its bookkeeping: per group, the options of each slot as "OPTION min-max",
 * with `?` marking the ones the calculator has no key for. `detail` on the tool returns the raw pools.
 */
export function compactUpstream(reference: NonNullable<ReturnType<typeof randomOptionReferencesFor>>) {
  return {
    status: reference.status,
    policy: reference.policy,
    note: 'Referência do rAthena, sem confirmação LATAM. `?` = opção sem chave no simulador.',
    groups: reference.references.map(ref => {
      const withPool = ref as typeof ref & { pool?: Group; options?: Record<string, { calculatorKey?: string }> };
      return {
        group: ref.group,
        ...(Object.keys(ref.conditions ?? {}).length ? { conditions: ref.conditions } : {}),
        ...(withPool.pool ? {
          slots: (withPool.pool.Slots ?? []).map(slot => (slot.Options as { Option: string; MinValue?: number; MaxValue?: number }[]).map(option => {
            const key = withPool.options?.[option.Option]?.calculatorKey;
            return `${key ?? `?${option.Option}`}${range(option.MinValue, option.MaxValue)}`;
          })),
        } : { pool: ref.groupDefined ? 'sem sorteio' : 'indefinido' }),
      };
    }),
  };
}
