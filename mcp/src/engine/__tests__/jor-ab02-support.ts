/**
 * Jor_ab02 study: the four shared builds as local snapshots (`fixtures/jor-ab02.json`, taken with `parse_share_link`; no test reads a URL) and the
 * derived starting state of the gear-only scenario.
 */
import fixture from './fixtures/jor-ab02.json';
import { Dataset } from '../../../../src/app/build-analysis/data/dataset';
import { BuildInput, resolveBuild } from '../../../../src/app/build-analysis/engine/build-input';
import { constraintViolations } from '../../../../src/app/build-analysis/engine/feasibility';
import { applyPatch, BuildPatch } from '../../../../src/app/build-analysis/engine/variants';

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

/**
 * The hard constraints of the study as written in `docs/optimize-roadmap-status.md`, in the terms the engine states them: no MVP card, grade C at most,
 * Abrasivo (14536) and Casaco Pirata (480174) unavailable, the active effect of Oleum Sanctum forbidden. No `maxRefine`: the study does not set one.
 */
export const SCENARIO_RULES = { mvpPolicy: 'none', maxGrade: 'C', unavailableIds: [14536, 480174], forbiddenEffects: ['Oleum Sanctum'] } as const;
/**
 * Two limits of the study the spec cannot say field by field: Insígnia do Talento 5 stays (headUpperEnchant1) and the Cordão do Inquisidor takes no new
 * enchant (accRightEnchant1..3). A lock is per slot, so the search is run with the whole slot locked (narrower than the study, never wider) and
 * `fieldLocks` checks the study's own wording on any build.
 */
export const SCENARIO_SLOT_LOCKS = ['headUpper', 'accRight'] as const;
export const SCENARIO = { ...SCENARIO_RULES, lockedSlots: [...SCENARIO_SLOT_LOCKS] };
const FIELD_LOCKS = ['headUpperEnchant1', 'accRightEnchant1', 'accRightEnchant2', 'accRightEnchant3'] as const;
export const SCENARIO_EXACT = { ...SCENARIO_RULES, lockedFields: [...FIELD_LOCKS] };
const blank = (value: unknown) => (value === null || value === undefined || value === 0 || value === '' ? null : value);

/** Every limit of the study that applies to `build` (a preset patched over `start`), by the study's own wording. Empty means the build respects them. */
export function audit(dataset: Dataset, start: Record<string, any>, patch?: BuildPatch): string[] {
  const input: BuildInput = { preset: start } as BuildInput;
  const base = resolveBuild(input, dataset).model as Record<string, any>;
  const model = resolveBuild(patch ? applyPatch(input, patch) : input, dataset).model as Record<string, any>;
  const rules = constraintViolations(SCENARIO_RULES as never, dataset, base as never, model as never).map((violation) => `${violation.code}: ${violation.message}`);
  const moved = FIELD_LOCKS.filter((key) => JSON.stringify(blank(base[key])) !== JSON.stringify(blank(model[key]))).map((key) => `FIELD_LOCK: ${key} mudou (${blank(base[key])} → ${blank(model[key])}).`);

  return [...rules, ...moved];
}

/** Keys whose values differ between two presets. */
export function changedKeys(a: Record<string, any>, b: Record<string, any>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
}
