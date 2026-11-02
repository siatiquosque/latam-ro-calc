import { Dataset } from '../data/dataset';
import { ItemIndex } from '../data/item-index';
import { ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, ResolvedBuild } from './build-input';
import { ensureCustomAttachment } from 'src/app/core/custom-attachments';
import { isCustomItem } from 'src/app/core/custom-items';

/** A request-local catalog view. Custom definitions never enter the shared dataset or indexes. */
export function itemContext(dataset: Dataset, resolved: ResolvedBuild): Dataset {
  if (resolved.customItems.every(item => dataset.items[item.id]?.custom && JSON.stringify(dataset.items[item.id]) === JSON.stringify(item))) return dataset;
  return resolved.customItems.length ? { ...dataset, items: resolved.items, itemIndex: new ItemIndex(resolved.items, dataset.latamExtra) } : dataset;
}

/** Mirrors the motor's attachment source: custom sidecars replace legacy sockets. */
export function equippedSources(resolved: ResolvedBuild) {
  const customParents = MAIN_ITEM_SLOTS.filter(slot => isCustomItem(resolved.items[resolved.model[slot]]));
  const hidden = new Set(customParents.flatMap(slot => [...relatedItemKeys(slot)]));
  const sources = ITEM_ID_KEYS.filter(field => !hidden.has(field) && resolved.model[field] > 0)
    .map(field => ({ field, id: Number(resolved.model[field]) }));
  for (const slot of customParents) {
    const state = ensureCustomAttachment(resolved.model, slot, resolved.items[resolved.model[slot]]);
    for (const [kind, ids] of [['Card', state?.cards], ['Enchant', state?.enchants]] as const) {
      ids?.forEach((id, index) => { if (id) sources.push({ field: `${slot}Custom${kind}${index + 1}`, id }); });
    }
  }
  return sources;
}
