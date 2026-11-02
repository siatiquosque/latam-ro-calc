/**
 * The derived-state steps the app runs after loading a preset, ported from
 * `RoCalculatorComponent`: setClassLvl (1763), setJobBonus (1874),
 * setSkillModelArray (1842) and setDefaultSkill (1784).
 *
 * Order matters — `loadItemSet` runs clamp before job bonus, because the bonus is a
 * function of the clamped jobLevel.
 */
import { JobBuffs } from 'src/app/constants/job-buffs';
import { CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { MainModel } from 'src/app/models/main.model';
import { normalizeClassLimits } from 'src/app/core/class-limits';
import { defaultAtkSkill } from 'src/app/core/rotation';
import { resolveSkillMeta, SKILL_ID_BY_NAME } from 'src/app/skills';

/** Pull level/jobLevel into the class's legal range, with the app's fallbacks. */
export function clampLevels(model: MainModel, char: CharacterBase): void {
  normalizeClassLimits(model, char);
}

/**
 * Copy the job-level stat bonuses onto the model. Not optional: the trait bonuses
 * (jobCon in particular) feed the hit formula, and omitting them yields NaN accuracy.
 */
export function applyJobBonus(model: MainModel, char: CharacterBase): void {
  const { str, agi, vit, int, dex, luk, pow, sta, wis, spl, con, crt } = char.getJobBonusStatus(model.jobLevel);
  Object.assign(model, {
    jobStr: str,
    jobAgi: agi,
    jobVit: vit,
    jobInt: int,
    jobDex: dex,
    jobLuk: luk,
    jobPow: pow,
    jobSta: sta,
    jobWis: wis,
    jobSpl: spl,
    jobCon: con,
    jobCrt: crt,
  });
}

/**
 * Rebuild the positional skill arrays the engine consumes from the name-keyed maps.
 *
 * The positional fallback only applies when the saved array length matches this
 * class's list — otherwise a level saved for a different class would land on an
 * unrelated skill. A level with no matching dropdown entry resets to 0.
 */
export function applySkillMaps(model: MainModel, char: CharacterBase): void {
  const m = model as any;
  const buffMap = m.skillBuffMap && typeof m.skillBuffMap === 'object' ? m.skillBuffMap : {};
  const activeMap = m.activeSkillMap && typeof m.activeSkillMap === 'object' ? m.activeSkillMap : {};
  const passiveMap = m.passiveSkillMap && typeof m.passiveSkillMap === 'object' ? m.passiveSkillMap : {};

  const resolve = (defs: any[], map: Record<string, number>, saved: number[], sameLength: boolean): number[] =>
    defs.map((skill, i) => {
      const savedVal = map[skill.name] ?? (sameLength ? saved?.[i] : 0);
      return skill.dropdown.find((a: any) => a.value === savedVal) ? savedVal : 0;
    });

  const { activeSkills, passiveSkills } = char;
  const passiveSameLength = char.matchesSavedSkillCount('passive', m.passiveSkills?.length);

  // Mirrors the component: the buff array's positional fallback is gated on the
  // *passive* list length, not the buff list's own.
  m.skillBuffs = resolve(JobBuffs, buffMap, m.skillBuffs, passiveSameLength);
  m.activeSkills = resolve(activeSkills, activeMap, m.activeSkills, char.matchesSavedSkillCount('active', m.activeSkills?.length));
  m.passiveSkills = resolve(passiveSkills, passiveMap, m.passiveSkills, passiveSameLength);
}

const foldName = (text: unknown) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Validate `selectedAtkSkill` against the class's offensive skills. Accepts the three forms the picker produces (a skill's own
 * `value`, one of its `values[]` variants, or an entry from its `levelList[]`) and, for a caller who types it, the bare name, the
 * pt-BR label or the skill id, with or without `==level` (no level means the top one). A skill the class does not have falls back to
 * the class default, as it always did for an old link, and is returned so the caller can say so (and refuse it when the caller
 * asked for it by name): calculating another skill without a word is how an Explosion Blaster request came back as Asura Strike.
 */
export function resolveAtkSkill(model: MainModel, char: CharacterBase): { unresolved: string; usedInstead: string } | undefined {
  const atkSkills = char.atkSkills;
  const fallback = defaultAtkSkill(atkSkills);
  const wanted = model.selectedAtkSkill;
  if (!wanted) {
    model.selectedAtkSkill = fallback;
    return undefined;
  }

  const direct = atkSkills.find((a) => a.value === wanted || (Array.isArray(a.values) && a.values.includes(wanted)));
  const byLevel = atkSkills.find((a) => Array.isArray(a.levelList) && a.levelList.some((lv: any) => lv.value === wanted));

  if (byLevel?.value) { model.selectedAtkSkill = wanted; return undefined; }
  if (direct?.value) { model.selectedAtkSkill = direct.value; return undefined; }

  // The bare name, label or id, with or without a level.
  const [namePart, levelPart] = String(wanted).split('==');
  const key = foldName(namePart);
  const typed = atkSkills.find((a) => [a.name, String(a.value).split('==')[0], a.label, resolveSkillMeta(a.name)?.label, SKILL_ID_BY_NAME[a.name]].some((candidate) => candidate !== undefined && foldName(candidate) === key));
  if (typed) {
    const levels: string[] = (typed.levelList ?? []).map((entry: any) => String(entry.value));
    const asked = levelPart === undefined ? undefined : `${typed.name}==${levelPart}`;
    const valid = !asked || levels.includes(asked);
    model.selectedAtkSkill = asked && valid ? asked : typed.value;
    // A level the skill does not have is not a guess to make: the top level is used and it is said.
    return valid ? undefined : { unresolved: String(wanted), usedInstead: String(typed.value) };
  }
  model.selectedAtkSkill = fallback;

  return { unresolved: String(wanted), usedInstead: String(fallback) };
}
