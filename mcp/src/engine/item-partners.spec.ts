import { expect, it } from 'vitest';
import { partnerIndex } from 'src/app/build-analysis/engine/item-partners';
import { loadDatasetFromDisk } from '../data/dataset.node';

it('wholeSet returns every piece of a set of three or more, one per slot', () => {
  const partners = partnerIndex(loadDatasetFromDisk());
  // Cajado da Afeição, Xale, Túnica and Sapatos da Afeição: a four-piece set.
  const whole = partners.wholeSet(1657, () => true);
  expect(whole.size).toBeGreaterThanOrEqual(4);
  expect([...whole.values()]).toEqual(expect.arrayContaining([1657, 2569, 15029, 2471]));
  expect(new Set(whole.keys()).size).toBe(whole.size);
});

it('wholeSet leaves out what the caller does not accept and respects the cap', () => {
  const partners = partnerIndex(loadDatasetFromDisk());
  expect([...partnerIndex(loadDatasetFromDisk()).wholeSet(1657, (partner) => partner !== 15029).values()]).not.toContain(15029);
  expect(partners.wholeSet(1657, () => true, 2).size).toBe(2);
});
