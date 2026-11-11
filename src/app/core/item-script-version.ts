/**
 * Which server's item bonuses the calculator reads.
 *
 * `latam` is item.json as it stands: it follows the pt-BR text the LATAM client prints.
 * `kro` lays `item-script-kro.json` over it, key by key — the client script and rAthena
 * wherever they disagree with that text, which is what a preview or a later LATAM patch
 * is expected to bring. docs/script-audit.md explains how the overlay is built.
 */
export type ItemScriptVersion = 'latam' | 'kro';

/** key -> clauses. An empty list means the client script grants nothing for that key. */
export type ItemScriptOverlay = Record<string, Record<string, string[]>>;

export function normalizeItemScriptVersion(value: unknown): ItemScriptVersion {
  return value === 'kro' ? 'kro' : 'latam';
}

/** The item with the overlay's keys replacing its own; the item itself when it has none. */
export function applyItemScriptOverlay<T extends { script?: Record<string, any> }>(item: T, overlay?: Record<string, string[]>): T {
  if (!item || !overlay) return item;
  const script: Record<string, any> = { ...item.script };
  for (const [key, clauses] of Object.entries(overlay)) {
    if (clauses.length) script[key] = clauses;
    else delete script[key];
  }
  return { ...item, script };
}
