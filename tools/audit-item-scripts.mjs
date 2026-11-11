#!/usr/bin/env node
// Audit of the item bonuses in src/assets/demo/data/item.json against the sources, in one command.
// The procedure, the order of the sources and the classes are in docs/script-audit.md. This never edits item.json,
// the RagnarokDB (read-only) or anything on the VPS: it only writes into the work folder.
//
//   node tools/audit-item-scripts.mjs <phase> [--work <dir>] [--raw <ragassets raw dir>] [--db <ragnarok.db>] [--aegis <aegis.json>]
//
// Phases (each reads the previous one's files from the work folder, so they can be rerun one at a time):
//   check    which sources exist, and so which mode runs (full: script + text | text: no RagnarokDB)
//   export   RagnarokDB -> <work>/aegis.json (needs --db or RAGNAROK_DB; skipped when --aegis is given)
//   dump     what the engine applies per item, refine and grade -> <work>/dump.json (runs the vitest dump spec)
//   compare  script vs DB and pt-BR text vs DB -> <work>/script.json, <work>/text.json
//   report   classification -> <work>/report.json and <work>/report.md
//   all      check, export, dump, compare, report
// Default work folder: .tmp/item-audit (ignored by git).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./audit/classify.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const phase = argv[0];
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const WORK = resolve(ROOT, arg("--work") ?? ".tmp/item-audit");
const file = (name) => join(WORK, name);
const PHASES = ["check", "export", "dump", "compare", "report"];
// item.json types that carry bonuses the audit looks at: weapon, armor/accessory/shadow, card, enchant.
const TYPES = new Set([1, 2, 6, 10, 11]);

const log = (msg) => console.log(`[audit] ${msg}`);
const fail = (msg) => {
  console.error(`[audit] ${msg}`);
  process.exit(1);
};
const run = (cmd, args, env = {}) => {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" && cmd === "npx", env: { ...process.env, ...env } });
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} failed (exit ${res.status})`);
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function sources() {
  const aegis = arg("--aegis") ?? (existsSync(file("aegis.json")) ? file("aegis.json") : undefined);
  const db = arg("--db") ?? process.env.RAGNAROK_DB;
  const raw = arg("--raw");
  return {
    aegis,
    db: db && existsSync(db) ? db : undefined,
    raw: raw && existsSync(join(raw, "skills.json")) ? raw : undefined,
    latamText: existsSync(join(ROOT, "src/assets/demo/data/latam-items.json")),
  };
}

function check() {
  const s = sources();
  const mode = s.aegis || s.db ? "full" : "text";
  log(`RagnarokDB script: ${s.aegis ? `aegis file ${s.aegis}` : s.db ? `database ${s.db} (will be exported)` : "NOT available"}`);
  log(`ragassets raw (skills.json): ${s.raw ?? "NOT given (--raw), the text phase needs it"}`);
  log(`pt-BR texts (latam-items.json): ${s.latamText ? "found" : "NOT found"}`);
  log(`mode: ${mode}${mode === "text" ? " (no RagnarokDB: only pt-BR text vs DB; previews come out as N/A)" : ""}`);
  if (!s.raw) fail("pass --raw <ragassets raw dir> (the folder with skills.json)");
  if (!s.latamText) fail("src/assets/demo/data/latam-items.json is missing; run tools/sync-latam-db.mjs first");
  mkdirSync(WORK, { recursive: true });
  writeFileSync(file("mode.json"), JSON.stringify({ mode, raw: s.raw }));
  return mode;
}

function exportAegis() {
  const s = sources();
  if (arg("--aegis") || existsSync(file("aegis.json"))) return log("export skipped: aegis file already there");
  if (!s.db) return log("export skipped: no RagnarokDB (text mode)");
  run("python", ["-I", "-X", "utf8", "tools/export-ragnarokdb-aegis.py", file("aegis.json"), s.db]);
}

function dump() {
  const db = readJson(join(ROOT, "src/assets/demo/data/item.json"));
  const ids = Object.entries(db)
    .filter(([, it]) => TYPES.has(it.itemTypeId))
    .map(([id]) => Number(id));
  mkdirSync(WORK, { recursive: true });
  writeFileSync(file("ids.json"), JSON.stringify(ids));
  log(`dumping ${ids.length} items through the engine (a few minutes)`);
  run("npx", ["vitest", "run", "src/app/core/__tests__/item-audit-dump.spec.ts"], { AUDIT_IN: file("ids.json"), AUDIT_OUT: file("dump.json") });
}

function compare() {
  if (!existsSync(file("dump.json"))) fail("no dump.json: run the dump phase first");
  const { raw } = readJson(file("mode.json"));
  const aegis = sources().aegis;
  if (aegis) {
    run("node", ["tools/audit/script-vs-db.mjs", "--aegis", aegis, "--dump", file("dump.json"), "--out", file("script.json"), "--skill-ids", "tools/audit/skill-ids.json"]);
  } else {
    writeFileSync(file("script.json"), "{}");
    log("script phase skipped: no RagnarokDB");
  }
  run("node", ["tools/audit/text-vs-db.mjs", "--dump", file("dump.json"), "--raw", raw, "--out", file("text.json")]);
}

function report() {
  const script = readJson(file("script.json"));
  const text = readJson(file("text.json"));
  const result = classify(script, text);
  const dump = readJson(file("dump.json"));
  for (const id of Object.keys(dump)) if (!result[id] && !dump[id].skip) result[id] = { name: "", confidence: "none", status: "N/A", keys: [] };
  const count = (pick) => {
    const m = {};
    for (const r of Object.values(result)) m[pick(r)] = (m[pick(r)] ?? 0) + 1;
    return m;
  };
  const byStatus = count((r) => r.status);
  const byConfidence = count((r) => r.confidence);
  const byClass = {};
  for (const r of Object.values(result)) for (const k of r.keys) byClass[k.class] = (byClass[k.class] ?? 0) + 1;
  writeFileSync(file("report.json"), JSON.stringify(result));
  const rows = Object.entries(result)
    .filter(([, r]) => r.keys.length)
    .sort((a, b) => a[1].keys[0].class.localeCompare(b[1].keys[0].class) || Number(a[0]) - Number(b[0]))
    .map(([id, r]) => `| ${id} | ${r.name} | ${r.confidence} | ${r.keys.map((k) => `${k.class}:${k.key}`).join(", ")} |`);
  const table = (o) => Object.entries(o).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const md = [
    "# Relatório da auditoria",
    "",
    "## Status por item",
    table(byStatus),
    "",
    "## Confiança (fontes disponíveis por item)",
    table(byConfidence),
    "",
    "## Divergências por classe (chaves)",
    table(byClass),
    "",
    "## Itens com divergência",
    "| id | nome | confiança | classe:chave |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(file("report.md"), md);
  log(`status ${JSON.stringify(byStatus)}`);
  log(`confidence ${JSON.stringify(byConfidence)}`);
  log(`classes ${JSON.stringify(byClass)}`);
  log(`report: ${file("report.md")}`);
}

const STEPS = { check, export: exportAegis, dump, compare, report };
if (phase === "all") for (const p of PHASES) STEPS[p]();
else if (STEPS[phase]) STEPS[phase]();
else {
  console.error(`usage: node tools/audit-item-scripts.mjs <${[...PHASES, "all"].join("|")}> [--work <dir>] [--raw <dir>] [--db <ragnarok.db>] [--aegis <aegis.json>]`);
  process.exit(2);
}
