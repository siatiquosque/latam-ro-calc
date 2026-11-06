import { ConstraintSpec, slotOfField } from './goal-spec';
import { MAIN_ITEM_SLOTS } from './build-input';
import { BuildPatch } from './variants';
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';

/** Field locks pin the owner; slot locks freeze its rolls and all its fields too. */
export function equipmentLocks(model: Record<string, any>, constraints?: ConstraintSpec) {
  const slots = new Set(constraints?.lockedSlots ?? []);
  const lockedOptions = new Set([...slots].flatMap(slot => (ItemOptionMap.get(slot as ItemTypeEnum) ?? []).map(String)));
  const fields = new Set(constraints?.lockedFields ?? []);
  const pinned = new Set([...fields].map(slotOfField));
  const blank = (value: unknown) => value == null || value === 0 || value === '' ? null : value;
  const blocks = (field: string) => fields.has(field) || slots.has(slotOfField(field) ?? '');
  return {
    fields,
    pinned,
    blocks,
    permitsItem: (field: string, id: number) => !(blocks(field) || MAIN_ITEM_SLOTS.includes(field) && pinned.has(field)) || model[field] === id,
    choices: (choices: BuildPatch[][]) => choices.map(group => group.filter(patch => !Object.keys(patch.gear ?? {}).some(blocks) &&
      !Object.keys(patch.options ?? {}).some(index => lockedOptions.has(index)))).filter(group => group.length),
    // swapPatch may upgrade the worn piece: restore exactly the fields the caller froze.
    preserve(patch: BuildPatch): BuildPatch {
      const gear = { ...patch.gear };
      for (const key of Object.keys(gear)) if (blocks(key)) delete gear[key];
      const options = patch.options && Object.fromEntries(Object.entries(patch.options).filter(([index]) => !lockedOptions.has(index)));
      return { ...patch, gear, ...(options ? { options } : {}) };
    },
    permits(patch: BuildPatch) {
      return Object.entries(patch.gear ?? {}).every(([key, value]) => {
        if (blocks(key)) return blank(value) === blank(model[key]);
        return !MAIN_ITEM_SLOTS.includes(key) || !pinned.has(key) || blank(value) === blank(model[key]);
      });
    },
  };
}
