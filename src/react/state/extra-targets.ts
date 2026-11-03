/**
 * The extra targets a build is tested against besides the main one. Pure helpers: the
 * session owns the list and the solves, this file owns the rules (cap, dedupe, storage).
 */

/** Targets in all, the card's one included. */
export const MAX_TARGETS = 20;
export const MAX_EXTRA_TARGETS = MAX_TARGETS - 1;
export const EXTRA_TARGETS_STORAGE_KEY = 'monsterExtras';

/** What the table and the pill say about a monster, as the battle card does. */
export interface TargetInfo {
  hp: number | null;
  elementUpper: string;
  size: string;
  race: string;
  hitFor100: number | null;
}

export interface ExtraTargetRow extends TargetInfo {
  id: number;
  name: string;
  /** Sustained DPS of the user's rotation against this target. */
  dps: number;
  /** Damage of one pass of the rotation (one use when it is a single skill). */
  perCycle: number;
  /** Crit chance against this target for the rotation's first step, or null when it cannot crit. */
  critRate: number | null;
  /** "Morre em" text, or null when nothing can die. */
  ttkText: string | null;
  ttkSeconds: number | null;
  cyclesToKill: number | null;
}

/** Keeps positive integer ids, drops repeats and the main target, and caps the list. */
export function sanitizeExtraTargets(ids: unknown, mainId: number, known?: (id: number) => boolean): number[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<number>([mainId]);
  const out: number[] = [];
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || (known && !known(id))) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_EXTRA_TARGETS) break;
  }
  return out;
}

export function readExtraTargets(raw: string | null, mainId: number, known?: (id: number) => boolean): number[] {
  if (!raw) return [];
  try {
    return sanitizeExtraTargets(JSON.parse(raw), mainId, known);
  } catch {
    return [];
  }
}

/** The target the build does worst against (lowest DPS), or null with nothing to compare. */
export function worstTarget<T extends { dps: number }>(rows: readonly T[]): T | null {
  let worst: T | null = null;
  for (const row of rows) if (!worst || row.dps < worst.dps) worst = row;
  return worst;
}

/** Reads the fields the battle card prints off a solved monster (the domain Monster). */
export function describeTarget(monster: any): TargetInfo {
  return {
    hp: monster?.hp ?? null,
    elementUpper: monster?.elementLevelUpper ?? '',
    size: monster?.sizeFullUpper ?? '',
    race: monster?.raceUpper ?? '',
    hitFor100: monster?.hitRequireFor100 ?? null,
  };
}

/**
 * Crit chance against the target, as the card's "Taxa Crít." reads it for the rotation's
 * first step: the basic attack's, or the skill's when the skill can crit at all.
 */
export function critRateOf(view: { entries?: { isBasic?: boolean; summary?: any }[] } | null | undefined): number | null {
  const entry = view?.entries?.[0];
  const dmg = entry?.summary?.dmg;
  if (!dmg) return null;
  const rate = entry!.isBasic ? dmg.criRateToMonster : dmg.skillCanCri ? dmg.skillCriRateToMonster : null;
  return typeof rate === 'number' ? rate : null;
}
