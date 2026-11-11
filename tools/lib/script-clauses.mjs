// Shared by tools/build-item-script-extra.mjs and tools/build-item-script-kro.mjs.
// Turns what an equip script grants at refine 0..20 (and per grade) into item.json script clauses.
import { evalAegis } from "./aegis-script.mjs";

const SELF_BY_LOCATION = { Armor: "BODY", Shoes: "SHOES", Garment: "ROBE", Shield: "LARM", Middle: "HEAD2", Upper: "HEAD", Lower: "HEAD3" };
/** Which LOCATION_* the script's own piece answers to. Weapons and cards sit on the right hand, enchants on the head. */
export const selfOf = (item) => (item.itemTypeId === 1 || item.itemTypeId === 6 ? "RARM" : item.itemTypeId === 11 ? "HEAD" : SELF_BY_LOCATION[item.location] ?? "X");
export const fmt = (n) => String(Math.round(n * 1e6) / 1e6);

/** The script's grants at one refine/grade, as { key: sum }. `extra` families get `fn__...` keys, modelled ones keep the calculator's key. */
export function evaluate(item, aegis, refine, grade, { modelled }) {
  const env = { r: refine, g: grade, self: selfOf(item), comp: {}, ctx: {}, used: new Set(), extra: [], extraFail: new Set() };
  const { bon } = evalAegis(aegis, env);
  const sums = {};
  if (modelled) for (const [key, value] of bon) sums[key] = (sums[key] ?? 0) + value;
  else
    for (const call of env.extra)
      call.nums.forEach((v, i) => {
        const key = ["fn", call.fn, ...call.statics, `a${i + 1}`].join("__");
        sums[key] = (sums[key] ?? 0) + v;
      });
  return sums;
}

/** Per-refine series and per-grade series for one item. Cards and enchants have no refine of their own. */
export function seriesOf(item, aegis, opts) {
  const refines = item.itemTypeId === 6 || item.itemTypeId === 11 ? [0] : [...Array(21).keys()];
  const series = refines.map((r) => evaluate(item, aegis, r, 0, opts));
  const grades = item.canGrade && refines.length > 1 ? [1, 2, 3, 4].map((g) => evaluate(item, aegis, 0, g, opts)) : [];
  return { series, grades };
}

/** Clauses for one key: bare value at refine 0, `N===delta` from refine N on, `GRADE[me==X]===delta` from grade X on. */
export function clausesOf(key, series, grades) {
  const values = series.map((s) => s[key] ?? 0);
  const clauses = [];
  if (values[0]) clauses.push(fmt(values[0]));
  for (let r = 1; r < values.length; r++) if (values[r] !== values[r - 1]) clauses.push(`${r}===${fmt(values[r] - values[r - 1])}`);
  let previous = 0;
  grades.forEach((g, i) => {
    const delta = (g[key] ?? 0) - values[0] - previous;
    if (delta) clauses.push(`GRADE[me==${"DCBA"[i]}]===${fmt(delta)}`);
    previous += delta;
  });
  return clauses;
}
