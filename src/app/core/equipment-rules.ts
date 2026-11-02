import { SLOTS_BY_KEY } from '../app-config/equipment-slots';
import { ItemModel } from '../models/item.model';

/** Game limits, independent of a search's chosen investment level. */
export function refineLimitFor(slot: string, item?: Partial<ItemModel>): number {
  const rule = SLOTS_BY_KEY.get(slot as any)?.refine;
  if (rule === 'shadow') return 10;
  if (rule === 'none') return item?.isRefinable ? 20 : 0;
  if (!rule || rule === 'accessory' && !item?.isRefinable) return 0;
  return 20;
}

/** Known cross-position NPC rules. Position pools still belong to enchantPoolsFor. */
export function enchantCombinationError(item: Pick<ItemModel, 'aegisName'> | undefined, enchants: readonly (Partial<ItemModel> | undefined)[]): string | undefined {
  if (!item || !/^Auto_(Armor|Engine|Leg|Shield|B_|BC_)/.test(item.aegisName ?? '')) return undefined;
  const counts = new Map<string, number>();
  let fantastic = 0;
  for (const enchant of enchants) {
    const name = enchant?.aegisName ?? '';
    const match = /^Automatic_Orb(\d+)$/.exec(name);
    if (!match) continue;
    const n = Number(match[1]);
    const cap = n <= 2 ? 3 : n === 21 && item.aegisName.includes('Shield') ? 1
      : n >= 3 && n <= 10 || n >= 15 && n <= 23 || n >= 46 && n <= 96 ? 2 : 1;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (count > cap) return `${enchant.name ?? name}: no máximo ${cap} por equipamento Automatron.`;
    if (n >= 40 && n <= 45 && ++fantastic > 2) return 'Automatron: no máximo 2 encantamentos Fantásticos diferentes por equipamento.';
  }
  return undefined;
}
