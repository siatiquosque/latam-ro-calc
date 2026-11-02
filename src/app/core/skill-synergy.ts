import { AtkSkillModel } from '../jobs/_character-base.abstract';

/**
 * What a skill's formula reads beyond the usual ATK/MATK stats, and the item bonus keys that feed it. Found by running the formula
 * once on an input that records every property it touches, so the 130-odd skills that scale with a trait, HP or SP are
 * documented without a second table that would drift from the code (a skill that reads something kept in the class's own state, such as the cart weight, is not seen), whatever the version (the rebalanced formulas read their
 * inputs through helpers, which source text would not show). A `scaling` entry on the skill adds the wording and wins on the
 * explanation. Only the branch the formula takes with no buff or state active is seen.
 */
const FORMULA_INPUTS: { name: string; label: string; keys: string[]; resource?: 'hp' | 'sp' }[] = [
  { name: 'maxHp', label: 'HP máximo', keys: ['hp', 'hpPercent', 'vit', 'allStatus'], resource: 'hp' },
  { name: 'maxSp', label: 'SP máximo', keys: ['sp', 'spPercent', 'int', 'allStatus'], resource: 'sp' },
  { name: 'totalPow', label: 'POD', keys: ['pow', 'allTrait'] },
  { name: 'totalSta', label: 'STA', keys: ['sta', 'allTrait'] },
  { name: 'totalWis', label: 'SAB', keys: ['wis', 'allTrait'] },
  { name: 'totalSpl', label: 'FEI', keys: ['spl', 'allTrait'] },
  { name: 'totalCon', label: 'CON', keys: ['con', 'allTrait'] },
  { name: 'totalCrt', label: 'CRV', keys: ['crt', 'allTrait'] },
];

/** A value that is any number, any object and any function, and remembers the names it was asked for. */
function recorder(seen: Set<string>): unknown {
  return new Proxy(function () { /* callable stand-in */ }, {
    get: (_target, key) => {
      if (key === Symbol.toPrimitive || key === 'valueOf') return () => 1;
      if (typeof key === 'string') seen.add(key);

      return recorder(seen);
    },
    apply: () => recorder(seen),
  });
}

const inputsCache = new WeakMap<object, { label: string; keys: string[]; resource?: 'hp' | 'sp' }[]>();

export function formulaInputs(skill: AtkSkillModel): { label: string; keys: string[]; resource?: 'hp' | 'sp' }[] {
  if (typeof skill.formula !== 'function') return [];
  const known = inputsCache.get(skill.formula);
  if (known) return known;

  const seen = new Set<string>();
  try {
    skill.formula(recorder(seen) as Parameters<AtkSkillModel['formula']>[0]);
  } catch {
    /* a formula that needs more than the recorder gives still told what it read before it stopped */
  }
  const inputs = FORMULA_INPUTS.filter((input) => seen.has(input.name));
  inputsCache.set(skill.formula, inputs);

  return inputs;
}

/** Effects worth investigating, not a claim that they all increase damage in every build. */
export function skillSynergyKeys(skill: AtkSkillModel): string[] {
  const keys = new Set(skill.scaling?.bonusKeys ?? []);
  for (const resource of skill.scaling?.resources ?? []) {
    for (const key of resource === 'hp' ? ['hp', 'hpPercent', 'vit', 'allStatus'] : ['sp', 'spPercent', 'int', 'allStatus']) keys.add(key);
  }
  for (const input of formulaInputs(skill)) for (const key of input.keys) keys.add(key);

  return [...keys];
}
