import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArchBishop, Cardinal } from '../jobs';
import { Calculator } from './calculator';
import { CalculatorController } from './calculator-controller';
import { buildAutoCastSimulation } from './auto-cast';
import { ElementType } from '../constants/element-type.const';
import { createMainModel } from '../utils';

// https://issues.latam-tools.com.br/?card=0viQgMUWeihuYUVNNgU7
// Client skill descriptions establish both sources; chances and light properties:
// https://browiki.org/wiki/Gemini_Lumen and https://browiki.org/wiki/Petitio
const items = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const monsters = JSON.parse(readFileSync('src/assets/demo/data/monster.json', 'utf8'));

function simulate(cls: ArchBishop, gemini = 0, petitio = 0, overrides: Record<string, any> = {}) {
  const model = Object.assign(createMainModel(), {
    level: 200, jobLevel: 60, str: 100, int: 100, dex: 100, agi: 100,
    weapon: 540021, weaponRefine: 9,
  }, overrides);
  const monster = { ...monsters[21067], id: 21067 };
  const bonuses = cls.setLearnSkills({
    activeSkillIds: cls.activeSkills.map(({ name }) => name === 'Duple Light' ? gemini : 0),
    passiveSkillIds: cls.passiveSkills.map(({ name }) => name === 'Petitio' ? petitio : 0),
  }).getSkillBonusAndName();
  const calc = new Calculator().setMasterItems(items)
    .setHpSpTable([{ jobs: { [cls.className]: true }, baseHp: Array(301).fill(20000), baseSp: Array(301).fill(1500) }] as any)
    .setClass(cls).setMonster(monster).loadItemFromModel(model);
  new CalculatorController().runChain(calc, {
    monster, ...bonuses, buffEquips: {}, buffMasterys: {}, consumeData: [], aspdPotion: 0,
    extraOptionScripts: [], selectedAtkSkill: '', selectedChances: [], usedHpL: false,
  });
  const summary = calc.getTotalSummary();
  return buildAutoCastSimulation({ calc, model, summary, hasSelectedEffects: false });
}

describe('native cleric autocasts', () => {
  it('shows locked sources with the required skills, even without equipment', () => {
    const result = simulate(new Cardinal(), 0, 0, { weapon: undefined });
    expect(result.sources).toEqual([]);
    expect(result.blockedSources).toEqual([
      expect.objectContaining({ name: 'Gemini Lumen', reason: 'Ative Gemini Lumen em Habilidades' }),
      expect.objectContaining({ name: 'Petitio', reason: 'Aprenda Petitio em Habilidades · Ative Gemini Lumen em Habilidades' }),
    ]);
    expect(simulate(new ArchBishop()).blockedSources.map(({ name }) => name)).toEqual(['Gemini Lumen']);
  });

  it.each([ArchBishop, Cardinal].map(Job => ({ name: Job.name, Job })))('inherits both independent light rolls on $name', ({ Job }) => {
    for (const level of [1, 5, 10]) {
      const result = simulate(new Job(), level);
      const lights = result.sources.filter(({ source }) => source.skillId === 2054);
      expect(lights).toHaveLength(2);
      expect(lights.map(({ name }) => name)).toEqual(['Gemini Lumen (luz física)', 'Gemini Lumen (luz mágica)']);
      for (const light of lights) {
        expect(light.source).toMatchObject({ skillLevel: level, chance: 10 + 2 * level, trigger: 'melee-physical-hit' });
        expect(light.activationsPerSecond).toBeCloseTo(result.eligibleAttacksPerSecond * (10 + 2 * level) / 100);
        expect(light.expectedDamagePerActivation).toBeGreaterThan(0);
        expect(light.summary.skillBonusFromEquipment).toBe(40); // Bíblia Adulter Fides +9: 15 base + 25 (+7); both use 2054.
      }
      expect(lights.map(({ summary }) => summary.dmgType)).toEqual(['Range', 'Magical']);
    }
  });

  it('uses weapon property for Magni and Neutral for Modi', () => {
    const result = simulate(new ArchBishop(), 10, 0, { propertyAtk: ElementType.Holy });
    expect(result.sources.map(({ summary }) => summary.skillPropertyAtk)).toEqual([ElementType.Holy, ElementType.Neutral]);
  });

  it('requires learned Petitio as well as active Gemini Lumen', () => {
    for (const [gemini, petitio, reason] of [
      [0, 10, 'Ative Gemini Lumen em Habilidades'],
      [10, 0, 'Aprenda Petitio em Habilidades'],
    ] as const) {
      const result = simulate(new Cardinal(), gemini, petitio);
      expect(result.sources.some(({ source }) => source.skillId === 5283)).toBe(false);
      expect(result.blockedSources).toContainEqual(expect.objectContaining({ name: 'Petitio', reason }));
    }
  });

  it.each([1, 5, 10])('autocasts Petitio at learned level %i, independently of the attack skill picker', level => {
    const result = simulate(new Cardinal(), 10, level);
    const petitio = result.sources.find(({ source }) => source.skillId === 5283)!;
    expect(petitio.source).toMatchObject({ skillLevel: level, chance: level, trigger: 'physical-attack' });
    expect(petitio.activationsPerSecond).toBeCloseTo(result.attacksPerSecond * level / 100);
    expect(petitio.dps).toBeGreaterThan(0);
    expect(petitio.canCrit).toBe(true);
    expect(result.blockedSources).toEqual([]);
  });

  it('obeys Petitio weapon restrictions and does not add it to Archbishops', () => {
    expect(simulate(new ArchBishop(), 10, 10).sources.some(({ source }) => source.skillId === 5283)).toBe(false);
    expect(simulate(new Cardinal(), 10, 10, { weapon: 1602 }).sources.some(({ source }) => source.skillId === 5283)).toBe(false);
    const mace = simulate(new Cardinal(), 10, 10, { weapon: 16095 });
    expect(mace.sources.find(({ source }) => source.skillId === 5283)?.summary.dmgType).toBe('Range');
  });

  it('suppresses the light rolls on ranged basic attacks', () => {
    expect(simulate(new ArchBishop(), 10, 0, { weapon: 1701 }).sources.filter(({ source }) => source.skillId === 2054)).toEqual([]);
  });
});
