#!/usr/bin/env node
// Script vs DB: the client's equip script (RagnarokDB aegisScript, OnStartEquip) against what the engine applies.
//
//   node tools/audit/script-vs-db.mjs --aegis <aegis.json> --dump <engine-dump.json> --out <result.json> [--skill-ids <ids.json>]
//
// Evaluates the script per refine/grade (and over partner/stat/level/skill/job contexts when it reads them) and
// compares with the engine dump. Status per item: MATCH, MATCH-CTX (matches in one context), DIFF, SKIP.
// Each DIFF key carries its per-point series so tools/audit-item-scripts.mjs can classify it. docs/script-audit.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { evalAegis, fold, setSkillIds, Unsup } from '../lib/aegis-script.mjs';
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
if (!arg('--aegis') || !arg('--dump') || !arg('--out')) {
  console.error('usage: node tools/audit/script-vs-db.mjs --aegis <aegis.json> --dump <dump.json> --out <result.json> [--skill-ids <ids.json>]');
  process.exit(2);
}
if (arg('--skill-ids')) setSkillIds(J(arg('--skill-ids')));
const rdb = J(arg('--aegis'));
const items = J(new URL('../../src/assets/demo/data/item.json', import.meta.url));
const dump = J(arg('--dump'));
const GRADES = { '-': 0, D: 1, C: 2, B: 3, A: 4 };
const SELF = { Armor: 'BODY', Shoes: 'SHOES', Garment: 'ROBE', Shield: 'LARM', Middle: 'HEAD2', Upper: 'HEAD', Lower: 'HEAD3' };
const selfOf = (it) => (it.itemTypeId === 1 || it.itemTypeId === 6 ? 'RARM' : it.itemTypeId === 11 ? 'HEAD' : SELF[it.location] ?? 'X');
const LOCS = ['RARM', 'BODY', 'HEAD2', 'HEAD', 'SHOES', 'ROBE', 'LARM', 'SHIELD_SHADOW', 'WEAPON_SHADOW', 'ARMOR_SHADOW', 'SHOES_SHADOW', 'EARRING_SHADOW', 'PENDANT_SHADOW'];
const IGN = new Set(['def', 'mdef']);
const sumOf = (bon) => { const m = {}; for (const [k, v] of bon) m[k] = (m[k] ?? 0) + v; return fold(m); };
function envFor(it, r, g, combo) { const comp = {}; if (combo.comp) for (const L of LOCS) comp['LOCATION_' + L] = combo.comp; return { r, g, self: selfOf(it), comp, ctx: combo.ctx, used: new Set() }; }
function combos(text, used) {
  const dims = []; const hasLoc = [...used].some((u) => u.startsWith('LOCATION_')); const hasStat = [...used].some((u) => u.startsWith('VAR_STANDARD'));
  const hasLvl = used.has('VAR_CLEVEL') || used.has('VAR_JOBLEVEL'); const hasSkill = [...used].some((u) => u.startsWith('skill:'));
  const hasPrem = used.has('premium'); const hasJob = used.has('job') || used.has('VAR_JOB');
  let out = [{ name: 'base', comp: null, ctx: {} }];
  const mul = (opts) => { const n = []; for (const o of out) for (const [label, patch] of opts) n.push({ name: o.name + (label ? ' ' + label : ''), comp: patch.comp ?? o.comp, ctx: { ...o.ctx, ...(patch.ctx ?? {}) } }); out = n; };
  if (hasLoc) mul([['', {}], ['parceira+9/B', { comp: { r: 9, g: 2 } }], ['parceira+15/A', { comp: { r: 15, g: 4 } }]]);
  const allStat = (v) => Object.fromEntries(['STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK', 'POW', 'STA', 'WIS', 'SPL', 'CON', 'CRT'].map((k) => [k, v]));
  if (hasStat) mul([['', {}], ['stat90', { ctx: { stat: allStat(90) } }], ['stat130', { ctx: { stat: allStat(130) } }]]);
  if (hasLvl) mul([['', {}], ['nv99', { ctx: { level: 99, jobLevel: 50 } }], ['nv150', { ctx: { level: 150, jobLevel: 70 } }]]);
  if (hasSkill) { const sk = {}; for (const u of used) if (u.startsWith('skill:')) sk[u.slice(6).replace(/[\[\]\s]/g, '')] = 10; mul([['', {}], ['skill10', { ctx: { skill: sk } }]]); }
  if (hasPrem) mul([['', {}], ['premium', { ctx: { premium: 2 } }]]);
  if (hasJob) { const js = new Set(); for (const l of text.split(/\r?\n/)) if (/VAR_JOB|GetPureJob/.test(l)) for (const m of l.matchAll(/==\s*([A-Z][A-Z0-9_]+)/g)) js.add(m[1]); mul([['', {}], ...[...js].slice(0, 12).map((j) => ['job=' + j, { ctx: { job: j } }])]); }
  if (used.has('wclass')) { const cs = new Set(); for (const m of text.matchAll(/WEAPONTYPE_\w+/g)) cs.add(m[0]); mul([['', {}], ...[...cs].slice(0, 20).map((c) => ['cls=' + c, { ctx: { wclass: c } }])]); }
  if (used.has('wlv')) mul([['', {}], ['wlv4', { ctx: { wlv: 4 } }], ['wlv3', { ctx: { wlv: 3 } }], ['wlv2', { ctx: { wlv: 2 } }]]);
  if (used.has('alv')) mul([['', {}], ['alv2', { ctx: { alv: 2 } }]]);
  return out.slice(0, 400);
}
const evalPoints = (it, rd, e, combo) => {
  const perPoint = {}; const domain = new Set(); const unm = new Set(); const used = new Set();
  for (const point of Object.keys(e.rows)) {
    const [rf, g] = point.split('|'); const env = envFor(it, Number(rf), GRADES[g], combo);
    const { bon, unmapped } = evalAegis(rd.aegis, env); unmapped.forEach((u) => unm.add(u)); env.used.forEach((u) => used.add(u));
    perPoint[point] = fold(sumOf(bon)); Object.keys(perPoint[point]).forEach((k) => domain.add(k));
  }
  return { perPoint, domain, unm, used };
};
const diffOf = (e, perPoint, domain) => {
  const byKey = {}; let n = 0;
  for (const point of Object.keys(e.rows)) {
    const dbv = fold(e.rows[point]), av = perPoint[point];
    for (const k of new Set([...Object.keys(av), ...Object.keys(dbv).filter((k) => domain.has(k) && !IGN.has(k))])) {
      if (IGN.has(k)) continue; const x = av[k] ?? 0, y = dbv[k] ?? 0;
      if (Math.abs(x - y) > 1e-9) { (byKey[k] ??= []).push([point, x, y]); n++; }
    }
  }
  return { byKey, n };
};
const res = {}; const cnt = {};
for (const id of Object.keys(dump)) {
  const e = dump[id]; const it = items[id]; const rd = rdb[id];
  if (!it || e.skip || it.name.startsWith('[Aluguel]') || !rd?.aegis || !/^event OnStartEquip:/m.test(rd.aegis)) continue;
  try {
    const base = evalPoints(it, rd, e, { comp: null, ctx: {} });
    let best = { combo: { name: 'base' }, ...base, ...diffOf(e, base.perPoint, base.domain) };
    let ncombo = 1;
    if (base.used.size && best.n > 0) {
      for (const combo of combos(rd.aegis, base.used).slice(1)) {
        ncombo++; const r = evalPoints(it, rd, e, combo); const d = diffOf(e, r.perPoint, r.domain);
        if (d.n < best.n) best = { combo, ...r, ...d };
        if (best.n === 0) break;
      }
    }
    const diffs = Object.entries(best.byKey).map(([key, l]) => ({ key, points: l.length, sample: l.slice(0, 4).map(([p, a, d]) => `${p}: aegis=${a} db=${d}`), series: l }));
    const status = !diffs.length ? (best.combo.name === 'base' ? 'MATCH' : 'MATCH-CTX') : 'DIFF';
    cnt[status] = (cnt[status] ?? 0) + 1;
    res[id] = { name: it.name, status, ctx: best.combo.name, diffs, unmapped: [...best.unm], used: [...base.used], ncombo };
  } catch (err) { if (!(err instanceof Unsup)) throw err; res[id] = { name: it.name, status: 'SKIP', why: err.message }; cnt.SKIP = (cnt.SKIP ?? 0) + 1; }
}
writeFileSync(arg('--out'), JSON.stringify(res));
console.log(cnt);
const sk = {}; for (const v of Object.values(res)) if (v.status === 'SKIP') sk[v.why] = (sk[v.why] ?? 0) + 1; console.log('skips', JSON.stringify(sk));
const dk = {}; for (const v of Object.values(res)) for (const d of v.diffs ?? []) dk[d.key] = (dk[d.key] ?? 0) + 1;
console.log('diff keys', Object.entries(dk).sort((a, b) => b[1] - a[1]).slice(0, 25).map((x) => x.join(':')).join(' '));
