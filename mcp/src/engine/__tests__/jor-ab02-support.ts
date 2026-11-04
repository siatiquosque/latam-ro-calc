/**
 * Jor_ab02 study: the four shared builds as local snapshots (`fixtures/jor-ab02.json`, taken with `parse_share_link`; no test reads a URL) and the
 * derived starting state of the gear-only scenario.
 */
import fixture from './fixtures/jor-ab02.json';

export const JOR = fixture as { monsters: number[]; builds: Record<'original' | 'grauC' | 'invernal' | 'semGrau', { link: string; label: string; preset: Record<string, any> }> };
export const MONSTERS = JOR.monsters;
/** The kill every reference solution reaches on the five monsters (the original needs 3 to 4). */
export const GOAL = { maxHitsToKill: 2 } as const;

/** Keys of a preset that belong to equipment (items, refine, grade, cards, enchants, rolled options, costumes, shadow gear). */
export const GEAR_KEY = /^(weapon|shield|head|armor|garment|boot|acc|costume|shadow)|^rawOptionTxts$/;

export const preset = (name: keyof typeof JOR.builds): Record<string, any> => structuredClone(JOR.builds[name].preset);

/**
 * The state the gear-only scenario starts from: everything that is not equipment (attributes, skills, consumables) as the "grau C" solution
 * has it, the equipment exactly as the original has it. The original is not touched; this is a named, derived state, so the search can reach
 * the reference gear with the moves it is allowed to make, and nothing the Greedy cannot change is asked of it.
 */
export function gearOnlyStart(): Record<string, any> {
  const reference = preset('grauC');
  const original = preset('original');
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(reference)) if (!GEAR_KEY.test(key)) out[key] = value;
  for (const [key, value] of Object.entries(original)) if (GEAR_KEY.test(key)) out[key] = value;

  return out;
}

/** Keys whose values differ between two presets. */
export function changedKeys(a: Record<string, any>, b: Record<string, any>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
}
