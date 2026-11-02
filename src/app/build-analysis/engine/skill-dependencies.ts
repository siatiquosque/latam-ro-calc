import { AtkSkillModel, CharacterBase } from 'src/app/jobs/_character-base.abstract';
import { SKILL_ID_BY_NAME } from 'src/app/skills';

/** Runtime observations of existing callbacks, never another formula or an exhaustive branch proof. */
export function skillDependencies(char: CharacterBase, skill: AtkSkillModel) {
  const inputs = new Set<string>();
  const references = new Map<string, { skill: string; id?: number; state: string; hooks: Set<string> }>();
  const callbacks: Record<string, unknown> = { formula: skill.formula, canCrit: skill.canCri, accuracy: skill.accuracy,
    flatDamage: skill.flatDamage, customFormula: skill.customFormula, finalDamage: skill.finalDmgFormula,
    secondPacket: skill.part2?.formula, ratio: skill.ratioCalc };
  const hooks = Object.entries(callbacks).filter((entry): entry is [string, (...args: any[]) => unknown] => typeof entry[1] === 'function');
  const instance = char as unknown as Record<string, any>;
  const names = { isSkillActive: 'active', activeSkillLv: 'active-level', learnLv: 'learned-level' };
  const saved = Object.fromEntries(Object.keys(names).map(name => [name, Object.getOwnPropertyDescriptor(char, name)]));
  let hook = '';
  let active = false;
  let selected: string | undefined;
  let reverse = false;
  const readState = (state: string, ref: string | { name: string }) => {
    const name = typeof ref === 'string' ? ref : ref?.name;
    if (!name) return state === 'active' ? false : 0;
    const key = `${name}:${state}`;
    const entry = references.get(key) ?? { skill: name, id: SKILL_ID_BY_NAME[name as keyof typeof SKILL_ID_BY_NAME], state, hooks: new Set<string>() };
    entry.hooks.add(hook);
    references.set(key, entry);
    const enabled = selected === undefined ? active : (name === selected) !== reverse;
    return state === 'active' ? enabled : enabled ? 10 : 0;
  };
  const record = (path: string, numeric: number): any => new Proxy(function () { /* callable numeric stand-in */ }, {
    get: (_target, key) => {
      if (key === Symbol.toPrimitive || key === 'valueOf') return () => numeric;
      if (typeof key !== 'string') return undefined;
      const next = path ? `${path}.${key}` : key;
      inputs.add(next);
      if (next === 'skills.isActive') return (ref: string) => readState('active', ref);
      if (next === 'skills.activeLevel') return (ref: string) => readState('active-level', ref);
      if (next === 'skills.learnedLevel') return (ref: string) => readState('learned-level', ref);
      return record(next, numeric);
    },
    apply: () => record(path, numeric),
  });
  let probes = 0;
  const run = (numeric: number) => {
    for (const [name, callback] of hooks) {
      hook = name;
      try { callback(record('', numeric)); } catch { /* retain reads made before an unsupported operation */ }
    }
    probes++;
  };
  try {
    for (const [name, state] of Object.entries(names)) Object.defineProperty(char, name, { configurable: true, value: (ref: string) => readState(state, ref) });
    for (const enabled of [false, true]) {
      active = enabled;
      for (const numeric of [0, 1, 250]) run(numeric);
    }
    for (const name of new Set([...references.values()].map(entry => entry.skill))) {
      if (probes >= 30) break;
      selected = name;
      for (const opposite of [false, true]) { reverse = opposite; run(250); }
    }
  } finally {
    for (const name of Object.keys(names)) {
      if (saved[name]) Object.defineProperty(char, name, saved[name]!);
      else delete instance[name];
    }
  }
  return {
    skills: [...references.values()].map(entry => ({ ...entry, hooks: [...entry.hooks] })),
    inputs: [...inputs].filter(path => ![...inputs].some(other => other.startsWith(`${path}.`))),
    hooks: hooks.map(([name]) => name),
    coverage: 'observed-branches', probes,
    note: 'Dependências observadas executando callbacks existentes com estados ativos/inativos e entradas de amostragem. Não é prova de todos os ramos; não cobre todo estado privado da classe. As substituições locais de leitura de skills são restauradas; nenhum valor de dano amostrado é recomendado. Confirme estados concretos com calculate/evaluate_variants.',
  };
}
