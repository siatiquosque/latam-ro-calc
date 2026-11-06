/**
 * Starts for the discovery benchmark beyond Jor_ab02 (`optimize-discovery.bench.spec.ts`). All of them are equipped, none is bare.
 *
 *   METEOR_WEAK  Meister (4262, Third Flame Bomb, physical): `weak` of `bench-builds.json`, a real build with a weaker weapon (+8, Garra of a lower tier) and fewer
 *                shadow/costume pieces. METEOR_REFERENCE is `b1`, the same character with the full gear: the known solution, one set of gear moves away.
 *   MAGUS_GEARED Magus (4255, Crimson Rock, magic): no equipped magic build exists in the repository, so the gear is the real set of `b1` (armor, garment, boot,
 *                accessories, cards, enchants, shadow and costume pieces) with the class, attributes and skill of a Magus and a Cajado Arcanista do Éden +12. It is
 *                equipped and plausible, but it has no known solution to compare with: it measures coverage and feasibility, not a gap to a reference.
 */
import builds from './fixtures/bench-builds.json';

const fixtures = builds as unknown as Record<string, { preset: Record<string, any> }>;
export const METEOR_WEAK = (): Record<string, any> => structuredClone(fixtures['weak']!.preset);
export const METEOR_REFERENCE = (): Record<string, any> => structuredClone(fixtures['b1']!.preset);
/** Monsters of the Jor_ab02 study: strong enough that three hits to kill is not met by the weak Meister but is by the full one. */
export const METEOR_MONSTERS = [21544, 21601, 21542, 21539];

export function magusGeared(): Record<string, any> {
  const out = structuredClone(fixtures['b1']!.preset);
  for (const key of Object.keys(out)) if (/^weapon/.test(key)) delete out[key];
  Object.assign(out, {
    class: 4255,
    selectedAtkSkill: 'Crimson Rock==5',
    int: 120, jobInt: 8, dex: 120, jobDex: 8, spl: 100, jobSpl: 9, wis: 40, jobWis: 4, pow: 1, jobPow: 0, str: 1, jobStr: 0,
    weapon: 640023, weaponRefine: 12,
  });
  return out;
}
