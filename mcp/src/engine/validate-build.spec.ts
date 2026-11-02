import { describe, expect, it } from 'vitest';
import builds from './__tests__/fixtures/bench-builds.json';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { validateBuild } from 'src/app/build-analysis/engine/validate';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';

const dataset = loadDatasetFromDisk();
const fixtures = builds as Record<string, any>;

describe('validate_build', () => {
  it.each(Object.keys(fixtures))('accepts the real build %s', (name) => {
    const result = validateBuild(fixtures[name], dataset);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.unknowns.length).toBeGreaterThan(0);
  });

  it('blocks an MVP card only when asked, and by the card, not by the target', () => {
    const armor = fixtures['b1'].gear?.armor ?? fixtures['b1'].preset?.armor;
    const build = { ...fixtures['b1'], gear: { armor, armorCard: 4302 } };
    expect(MVP_CARD_IDS.has(4302)).toBe(true);
    expect(validateBuild(build, dataset, { excludeMvpCards: true }).errors.map((error) => error.code)).toContain('MVP_CARD_EXCLUDED');
    expect(validateBuild(build, dataset).errors.map((error) => error.code)).not.toContain('MVP_CARD_EXCLUDED');
  });

  it('does not treat an ordinary monster card as MVP', () => {
    expect(MVP_CARD_IDS.has(300220)).toBe(false);
    expect(MVP_CARD_IDS.has(4129)).toBe(false);
  });

  it('says an item the calculator cannot measure is an error, not zero', () => {
    const result = validateBuild({ ...fixtures['b1'], gear: { garment: 100901 } }, dataset);
    expect(result.valid).toBe(false);
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
  });

  it('reports an invalid build instead of throwing', () => {
    const result = validateBuild({ ...fixtures['b1'], class: 999999 }, dataset);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INCOMPATIBLE_CLASS');
  });
});
