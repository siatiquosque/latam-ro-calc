#!/usr/bin/env node
// Client-script effects the calculator does not model yet, kept beside item.json instead of in it.
//
//   node tools/build-item-script-extra.mjs --aegis <aegis.json> [--skill-ids <ids.json>] [--dry]
//
// Writes src/assets/demo/data/item-script-extra.json: { "<item id>": { "<key>": ["<clause>", ...] } }.
// Clauses follow item.json's script syntax (docs/item-json.md): a bare number is the value at refine 0,
// `N===V` adds V from refine N on, `GRADE[me==X]===V` adds V from grade X on. Keys are
// `fn__<Family>__<fixed arguments>__a<position of the number>`, e.g. SetAutoSpell2 User NPC_HELLPOWER 1 10 ->
// `fn__SetAutoSpell2__User__NPC_HELLPOWER__a1: ["1"]` and `...__a2: ["10"]`.
//
// item.json is never read for bonuses and never written: the calculator ignores this file today and can read
// it the day it models one of these families, and an upstream change to item.json cannot conflict with it.
//
// Inputs:
//   --aegis      { "<id>": { "aegis": "<aegisScript>" } } exported from the RagnarokDB (read-only), see docs/script-audit.md
//   --skill-ids  { "<AEGIS_SKILL_NAME>": <id> } (only needed to evaluate modelled calls the same way as the audit)
//
// Items that read context (partner piece, base stats, pet...) are evaluated with it neutral; see the audit report.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setSkillIds, Unsup } from "./lib/aegis-script.mjs";
import { clausesOf, seriesOf } from "./lib/script-clauses.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src/assets/demo/data");
const OUT = join(DATA, "item-script-extra.json");

/** One item's extra effects as clauses, or null when the script grants nothing outside the calculator's keys. */
export function extraFor(item, aegis) {
  const { series, grades } = seriesOf(item, aegis, { modelled: false });
  const script = {};
  for (const key of new Set(series.flatMap((s) => Object.keys(s)))) {
    const clauses = clausesOf(key, series, grades);
    if (clauses.length) script[key] = clauses;
  }
  return Object.keys(script).length ? script : null;
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const aegisPath = arg("--aegis");
  if (!aegisPath) {
    console.error("usage: node tools/build-item-script-extra.mjs --aegis <aegis.json> [--skill-ids <ids.json>] [--dry]");
    process.exit(2);
  }
  const aegis = JSON.parse(readFileSync(aegisPath, "utf8"));
  if (arg("--skill-ids")) setSkillIds(JSON.parse(readFileSync(arg("--skill-ids"), "utf8")));
  const items = JSON.parse(readFileSync(join(DATA, "item.json"), "utf8"));
  const out = {};
  let skipped = 0;
  for (const id of Object.keys(items).sort((a, b) => Number(a) - Number(b))) {
    const item = items[id];
    const script = aegis[id]?.aegis;
    if (item.name.startsWith("[Aluguel]") || !script || !/^event OnStartEquip:/m.test(script)) continue;
    try {
      const extra = extraFor(item, script);
      if (extra) out[id] = extra;
    } catch (error) {
      if (!(error instanceof Unsup)) throw error;
      skipped++;
    }
  }
  console.log(`${Object.keys(out).length} item(s) with effects outside the calculator's keys, ${skipped} script(s) the evaluator cannot read`);
  if (!argv.includes("--dry")) writeFileSync(OUT, JSON.stringify(out, null, 1).replace(/\n/g, "\r\n") + "\r\n");
}

main();
