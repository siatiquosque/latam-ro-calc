import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createMainModel } from 'src/app/utils';
import { equipStatusOf, makeCalculator } from './make-calculator';

/**
 * Engine dump for the item-script audit (docs/script-audit.md, step "dump"). It is NOT a test:
 * it only runs when `AUDIT_OUT` is set, so the normal suite skips it. `node tools/audit-item-scripts.mjs dump`
 * sets AUDIT_IN (a JSON list of item ids) and AUDIT_OUT and runs this file through vitest.
 *
 * Output: { "<id>": { slot, rows: { "<refine>|<grade|->": { "<bonus key>": value } } } | { skip } }.
 * Each row is the bonus the item adds on its own: the item is worn alone, then the same character
 * without it is subtracted. Cards use an inert knife and enchants an inert helm as the host.
 */
const OUT = process.env['AUDIT_OUT'];
const IN = process.env['AUDIT_IN'];
const db = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));

const REFINES = Array.from({ length: 21 }, (_, i) => i);
const GRADES: (string | undefined)[] = [undefined, 'D', 'C', 'B', 'A'];
const HOST_W = 1201; // Faca [3], inert
const HOST_H = 5171; // Elmo das Valquírias, inert
const NO_REFINE = new Set(['accRight', 'accLeft', 'headMiddle', 'headLower']);
const SLOT: Record<string, string> = {
  '2/512': 'headUpper', '2/513': 'armor', '2/514': 'shield', '2/515': 'garment', '2/516': 'boot',
  '2/510': 'accRight', '2/511': 'accLeft',
  '10/280': 'shadowWeapon', '10/526': 'shadowArmor', '10/527': 'shadowShield', '10/528': 'shadowBoot',
  '10/529': 'shadowEarring', '10/530': 'shadowPendant',
};
const slotOf = (item: any): string | null =>
  item.itemTypeId === 1 ? 'weapon' : SLOT[`${item.itemTypeId}/${item.itemSubTypeId}`] ?? null;

const status = (items: Record<number, any>, set: (m: any) => void) => {
  const model: any = createMainModel();
  model.level = 200;
  set(model);
  return equipStatusOf(makeCalculator(items), model);
};
const minus = (res: any, base: any) => {
  const diff: Record<string, number> = {};
  for (const [k, v] of Object.entries(res)) {
    const d = (v as number) - (base[k] ?? 0);
    if (typeof d === 'number' && d !== 0 && Number.isFinite(d)) diff[k] = d;
  }
  return diff;
};

const worn = (id: number, slot: string, refine: number, grade?: string) =>
  status({ [id]: db[id] }, (m) => {
    m[slot] = id;
    if (!NO_REFINE.has(slot)) m[slot + 'Refine'] = refine;
    if (grade) m[slot + 'Grade'] = grade;
  });
const knife = () => ({ [HOST_W]: db[HOST_W] });
const helm = () => ({ [HOST_H]: { ...db[HOST_H], itemTypeId: 2, itemSubTypeId: 512 } });
const carded = (id: number, refine: number) =>
  status({ ...knife(), [id]: { ...db[id], itemTypeId: 6, itemSubTypeId: 0 } }, (m) => {
    m.weapon = HOST_W;
    m.weaponRefine = refine;
    m.weaponCard1 = id;
  });
const knifeAlone = (refine: number) =>
  status(knife(), (m) => {
    m.weapon = HOST_W;
    m.weaponRefine = refine;
  });
const enchanted = (id: number) =>
  status({ ...helm(), [id]: db[id] }, (m) => {
    m.headUpper = HOST_H;
    m.headUpperRefine = 0;
    m.headUpperEnchant1 = id;
  });
const helmAlone = () =>
  status(helm(), (m) => {
    m.headUpper = HOST_H;
    m.headUpperRefine = 0;
  });

describe.skipIf(!OUT)('item audit engine dump', () => {
  it('dumps the engine bonus per refine and grade', () => {
    const ids: number[] = JSON.parse(readFileSync(IN!, 'utf8'));
    const nothing = status({}, () => undefined);
    const knives = REFINES.map(knifeAlone);
    const bareHelm = helmAlone();
    const out: Record<number, unknown> = {};
    for (const id of ids) {
      const item = db[id];
      if (!item) continue;
      try {
        const rows: Record<string, Record<string, number>> = {};
        if (item.itemTypeId === 11) {
          rows['0|-'] = minus(enchanted(id), bareHelm);
          out[id] = { slot: 'enchant', rows };
        } else if (item.itemTypeId === 6) {
          for (const r of REFINES) rows[`${r}|-`] = minus(carded(id, r), knives[r]);
          out[id] = { slot: 'card', rows };
        } else {
          const slot = slotOf(item);
          if (!slot) {
            out[id] = { skip: `slot ${item.itemTypeId}/${item.itemSubTypeId}` };
            continue;
          }
          const grades = item.canGrade && !slot.startsWith('shadow') ? GRADES : [undefined];
          const refines = NO_REFINE.has(slot) ? [0] : REFINES;
          for (const g of grades)
            for (const r of refines) rows[`${r}|${g ?? '-'}`] = minus(worn(id, slot, r, g), nothing);
          out[id] = { slot, rows };
        }
      } catch (e: any) {
        out[id] = { skip: 'error ' + String(e?.message).slice(0, 120) };
      }
    }
    writeFileSync(OUT!, JSON.stringify(out));
  }, 30 * 60 * 1000);
});
