import { expect, it } from 'vitest';
import { randomOptionCatalogFor, randomPoolTier, restrictToPool, validateCataloguedRolls } from './random-option-catalog';
import { createExtraOptionList, ExtraOptionMap } from '../utils/create-extra-option-list';

it('links every Loki lower seal with distinct attribute and effect positions', () => {
  expect(validateCataloguedRolls(420210, ['str:5', 'melee:7'])).toBeNull();
  expect(validateCataloguedRolls(420210, ['melee:7', 'str:5'])).not.toBeNull();
  expect(validateCataloguedRolls(420210, ['str:5', 'range:7'])).not.toBeNull();
  expect(validateCataloguedRolls(420213, ['int:5', 'sMatk:7'])).toBeNull();
  expect(validateCataloguedRolls(420220, ['dex:5', 'range:7'])).toBeNull();
  expect(validateCataloguedRolls(420269, ['vit:5', 'def:101'])).not.toBeNull();
});

it('links slotted Loki to a sourced pool and prevents mixing different coin profiles', () => {
  expect(randomOptionCatalogFor(410233)?.profiles).toHaveLength(4);
  expect(validateCataloguedRolls(410233, ['atk:20', 'melee:5'])).toBeNull();
  expect(validateCataloguedRolls(410233, ['atk:21', null])).not.toBeNull();
  expect(validateCataloguedRolls(410233, ['melee:5', 'range:5'])).not.toBeNull();
  expect(validateCataloguedRolls(410233, ['melee:5', 'sMatk:5'])).not.toBeNull();
  expect(randomOptionCatalogFor(410232)).toBeUndefined();
});

it('narrows the picker to the pool of a catalogued item and leaves other items open', () => {
  const roots = createExtraOptionList();
  const pool = restrictToPool(410233, 0, roots, ExtraOptionMap)!;
  const leaves = [...pool.leaves.keys()];
  expect(leaves).toContain('atk:20');
  expect(leaves).toContain('melee:5');
  expect(leaves).not.toContain('atk:21');
  expect(leaves).not.toContain('p_race_all:5');
  expect(pool.roots.length).toBeGreaterThan(0);
  const treeLeaves = (nodes: any[]): string[] => nodes.flatMap(n => n.children ? treeLeaves(n.children) : [n.value]);
  expect(treeLeaves(pool.roots).sort()).toEqual(leaves.sort());
  expect(restrictToPool(410233, 2, roots, ExtraOptionMap)).toBeNull();
  expect(restrictToPool(1234567, 0, roots, ExtraOptionMap)).toBeNull();
});

it('ranks the sources: code, regional JSON, bROWiki, then rAthena as the fallback', () => {
  expect(randomPoolTier(410233)).toBe('code');
  expect(randomPoolTier(480812)).toBe('wiki');
  expect(randomPoolTier(2963)).toBe('rathena'); // Anel Intensificador Físico: only the kRO pool exists.
  expect(randomPoolTier(1)).toBeUndefined();
});

it('narrows the picker of an item to its rAthena pool, but does not hold a shared build to it', () => {
  const pool = restrictToPool(2963, 0, createExtraOptionList(), ExtraOptionMap)!;
  expect(pool).not.toBeNull();
  expect(pool.leaves.size).toBeGreaterThan(0);
  expect(pool.leaves.size).toBeLessThan(ExtraOptionMap.size / 4);
  expect(validateCataloguedRolls(2963, ['atk:9999'])).toBeNull();
  expect(validateCataloguedRolls(480812, ['atk:9999', undefined])).not.toBeNull();
});
