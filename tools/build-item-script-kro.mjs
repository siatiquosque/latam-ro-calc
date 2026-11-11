#!/usr/bin/env node
// The kRO / client-script side of the bonuses where it differs from item.json (which follows the LATAM pt-BR text).
//
//   node tools/build-item-script-kro.mjs --aegis <aegis.json> --keys <keys.json> [--skill-ids <ids.json>] [--dry]
//
// Writes src/assets/demo/data/item-script-kro.json: { "<item id>": { "<bonus key>": ["<clause>", ...] } } in
// item.json's script syntax (docs/item-json.md). A key listed there REPLACES that key of the item's script when the
// kRO version is selected; an empty list means the client script grants nothing for that key. item.json is never
// read for bonuses and never written, so an upstream change to it cannot conflict with this file.
//
// Inputs:
//   --aegis  { "<id>": { "aegis": "<aegisScript>" } } exported from the RagnarokDB (read-only), see docs/script-audit.md
//   --keys   { "<id>": ["<bonus key>", ...] } the keys the audit found different from the client script
// Items that read context (partner piece, base stats, pet...) are evaluated with it neutral.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setSkillIds, Unsup } from "./lib/aegis-script.mjs";
import { clausesOf, seriesOf } from "./lib/script-clauses.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src/assets/demo/data");
const OUT = join(DATA, "item-script-kro.json");

function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  if (!arg("--aegis") || !arg("--keys")) {
    console.error("usage: node tools/build-item-script-kro.mjs --aegis <aegis.json> --keys <keys.json> [--skill-ids <ids.json>] [--dry]");
    process.exit(2);
  }
  const aegis = JSON.parse(readFileSync(arg("--aegis"), "utf8"));
  const wanted = JSON.parse(readFileSync(arg("--keys"), "utf8"));
  if (arg("--skill-ids")) setSkillIds(JSON.parse(readFileSync(arg("--skill-ids"), "utf8")));
  const items = JSON.parse(readFileSync(join(DATA, "item.json"), "utf8"));
  const out = {};
  let skipped = 0;
  for (const id of Object.keys(wanted).sort((a, b) => Number(a) - Number(b))) {
    const item = items[id];
    const script = aegis[id]?.aegis;
    if (!item || !script) continue;
    try {
      const { series, grades } = seriesOf(item, script, { modelled: true });
      const entry = {};
      for (const key of wanted[id]) entry[key] = clausesOf(key, series, grades);
      out[id] = entry;
    } catch (error) {
      if (!(error instanceof Unsup)) throw error;
      skipped++;
    }
  }
  console.log(`${Object.keys(out).length} item(s) in the kRO overlay, ${skipped} script(s) the evaluator cannot read`);
  if (!argv.includes("--dry")) writeFileSync(OUT, JSON.stringify(out, null, 1).replace(/\n/g, "\r\n") + "\r\n");
}

main();
