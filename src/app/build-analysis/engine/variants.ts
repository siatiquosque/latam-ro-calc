/**
 * Building many near-identical builds from one: the share link is decoded once, and each
 * variant is the base with a sparse patch laid over it.
 */
import { z } from 'zod';
import { buildInputSchema, BuildInput } from './build-input';
import { parseShare } from './share';

/** The same sparse overrides a build takes, minus the ways of naming a base. */
export const patchSchema = buildInputSchema.omit({ share: true, preset: true }).partial();
export type BuildPatch = z.infer<typeof patchSchema>;

/** The patch as the tools advertise it: the fields of `calculate.build` (no `share`/`preset`), validated against the full schema. */
export const compactPatchSchema = z.looseObject({}).pipe(patchSchema);

/**
 * Resolve `share`/`preset` into a plain preset once, so each variant does not decompress the
 * link again. The result has no `share`, and carries the custom items the link embedded.
 */
export function decodeOnce(input: BuildInput): BuildInput {
  const imported = input.share ? parseShare(input.share) : null;

  return {
    ...input,
    share: undefined,
    preset: imported?.preset ?? input.preset,
    customItems: [...(imported?.items ?? []).map((item) => ({ ...item })), ...(input.customItems ?? [])],
  };
}

const defined = <T extends Record<string, unknown>>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

/**
 * `patch` laid over `base`: maps (stats, gear, options and the three skill maps) merge key by
 * key, so a patch naming one slot does not clear the others; everything else replaces.
 */
export function applyPatch(base: BuildInput, patch: BuildPatch): BuildInput {
  const merged: BuildInput = { ...base, ...defined(patch as Record<string, unknown>) } as BuildInput;

  merged.stats = { ...base.stats, ...defined(patch.stats) };
  merged.gear = { ...base.gear, ...patch.gear };
  merged.options = { ...base.options, ...patch.options };
  merged.customAttachments = { ...base.customAttachments, ...patch.customAttachments };
  merged.skills = {
    active: { ...base.skills?.active, ...patch.skills?.active },
    passive: { ...base.skills?.passive, ...patch.skills?.passive },
    buffs: { ...base.skills?.buffs, ...patch.skills?.buffs },
  };
  merged.customItems = [...(base.customItems ?? []), ...(patch.customItems ?? [])];

  return merged;
}
