import { Dataset } from '../data/dataset';
import { MAIN_ITEM_SLOTS } from './build-input';

interface Partners {
  /** Items this item's script names as the other half of a set (`EQUIP_ID[...]`, `EQUIP[...]`). */
  of(id: number): number[];
  /** The main equipment slot an item goes in, if it has one. */
  slotOf(id: number): string | undefined;
  /**
   * The whole set an item belongs to, one piece per slot: the item plus every partner reachable through partners of partners
   * that `accept` allows (the caller decides what is eligible). A set of three or more pieces can pay only when worn whole.
   * Slot order is discovery order; `max` caps the walk.
   */
  wholeSet(id: number, accept: (partner: number, slot: string) => boolean, max?: number): Map<string, number>;
}

const partnerIndexes = new WeakMap<Dataset, Partners>();

/**
 * Set bonuses live in the *scripts*: an item says "+10% while wearing X". Reading those references gives the
 * pairs a one-slot-at-a-time search cannot see, because neither half pays anything alone.
 * `EQUIP[...]` may use an English display name instead of an aegis name.
 */
export function partnerIndex(dataset: Dataset): Partners {
  const known = partnerIndexes.get(dataset);
  if (known) return known;

  const norm = (text: string): string => text.replace(/\s*\[\d+\]\s*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let byName: Map<string, number[]> | undefined;
  const named = (name: string): number[] => {
    if (!byName) {
      byName = new Map();
      for (const [id, item] of Object.entries(dataset.items)) {
        for (const name of new Set([item?.aegisName, item?.enName, item?.name])) {
          if (!name) continue;
          const key = norm(name);
          if (key) byName.set(key, [...(byName.get(key) ?? []), Number(id)]);
        }
      }
    }

    return byName.get(norm(name)) ?? [];
  };

  const cache = new Map<number, number[]>();
  // A set can be declared only on its other half (e.g. Selo de Copas names
  // Selo de Loki). Index both directions so the worn half can discover it.
  for (const [rawId, item] of Object.entries(dataset.items)) {
      const id = Number(rawId);
      const text = JSON.stringify(item?.script ?? {});
      const found = new Set<number>();
      for (const match of text.matchAll(/EQUIP_ID\[([^\]]+)\]/g)) for (const n of match[1].split(/[^0-9]+/)) if (n) found.add(Number(n));
      for (const match of text.matchAll(/EQUIP\[([^\]]+)\]/g)) for (const name of match[1].split(/&&|\|\|/)) for (const partner of named(name.trim())) found.add(partner);
      found.delete(id);

      for (const partner of found) if (dataset.items[partner]) {
        cache.set(id, [...new Set([...(cache.get(id) ?? []), partner])]);
        cache.set(partner, [...new Set([...(cache.get(partner) ?? []), id])]);
      }
  }
  const index: Partners = {
    // An item LATAM has not shipped is never offered, whatever set it belongs to.
    of: id => (cache.get(id) ?? []).filter(partner => dataset.itemIndex.get(partner)?.latam),
    slotOf: (id) => dataset.itemIndex.get(id)?.slotTags?.find((tag) => MAIN_ITEM_SLOTS.includes(tag)),
    wholeSet(id, accept, max = 6) {
      const slot = index.slotOf(id);
      const whole = new Map<string, number>(slot ? [[slot, id]] : []);
      const queue = [id];
      for (let at = 0; at < queue.length && whole.size < max; at++) {
        for (const partner of index.of(queue[at])) {
          const partnerSlot = index.slotOf(partner);
          if (whole.size < max && partnerSlot && !whole.has(partnerSlot) && accept(partner, partnerSlot)) { whole.set(partnerSlot, partner); queue.push(partner); }
        }
      }

      return whole;
    },
  };
  partnerIndexes.set(dataset, index);

  return index;
}

