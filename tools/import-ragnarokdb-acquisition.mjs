#!/usr/bin/env node
// Offline: RagnarokDB snapshot -> shared contract -> missing-fact merge -> internal catalog.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

async function main() {
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = option('--input');
if (!input) throw new Error('Usage: node tools/import-ragnarokdb-acquisition.mjs --input snapshot.json [--curation] [--apply] [--output catalog.json] [--report report.json]');
const output = resolve(option('--output') ?? 'data/acquisition/latam.v1.json');
const reportPath = option('--report');
if (reportPath && (resolve(reportPath) === output || resolve(reportPath) === resolve(input))) throw new Error('Report must not overwrite input/catalog');
const apply = args.includes('--apply');
const compiled = await build({ entryPoints: ['src/app/build-analysis/acquisition/import-ragnarokdb.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { transformRagnarokSnapshot, mergeImportedKnowledge, knowledgeSchema, applyCuratedKnowledge } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const digest = content => createHash('sha256').update(content).digest('hex');
const snapshotText = readFileSync(input, 'utf8');
const calc = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const client = JSON.parse(readFileSync('src/assets/demo/data/latam-items.json', 'utf8'));
const monsters = JSON.parse(readFileSync('src/assets/demo/data/monster.json', 'utf8'));
// Acquisition needs a monster's identity, not engine stats: the client list (id -> LATAM name) covers monsters the calculator cannot simulate yet.
const clientMonsters = JSON.parse(readFileSync('src/assets/demo/data/latam-monsters.json', 'utf8'));
const monsterIds = [...new Set([...Object.values(monsters).map(m => m.id), ...Object.keys(clientMonsters).map(Number)])];
const items = Object.fromEntries(Object.entries(client).map(([id, row]) => [Number(id), { aegisName: row.aegisName }]));
for (const row of Object.values(calc)) if (!items[row.id]) items[row.id] = { aegisName: row.aegisName };
const curation = args.includes('--curation');
const transformed = curation ? { knowledge: knowledgeSchema.parse(JSON.parse(snapshotText)), issues: [] }
  : transformRagnarokSnapshot(JSON.parse(snapshotText), { items, monsterIds }, digest(snapshotText));
let lock;
const lockPath = output + '.import.lock';
const temporary = output + `.${process.pid}.tmp`;
try {
  if (apply) lock = openSync(lockPath, 'wx');
  const previousText = readFileSync(output, 'utf8');
  const merged = curation
    ? applyCuratedKnowledge(JSON.parse(previousText), transformed.knowledge)
    : mergeImportedKnowledge(JSON.parse(previousText), transformed.knowledge);
  const changed = merged.changed ?? (merged.added > 0 || merged.enriched > 0);
  const report = { snapshotSha256: digest(snapshotText), inputVersion: transformed.knowledge.revision, applied: apply, changed,
    added: merged.added, enriched: merged.enriched, unchanged: merged.unchanged,
    sources: transformed.knowledge.sources, issues: [...transformed.issues, ...merged.issues] };
  if (apply && changed) {
    writeFileSync(temporary, JSON.stringify(merged.knowledge, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    if (digest(readFileSync(output, 'utf8')) !== digest(previousText)) throw new Error('Catalog changed during import; result not applied');
    renameSync(temporary, output);
  }
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ applied: apply, changed, added: merged.added, enriched: merged.enriched, unchanged: merged.unchanged,
    issues: report.issues.reduce((counts, issue) => ({ ...counts, [issue.code]: (counts[issue.code] ?? 0) + 1 }), {}) }));
} finally {
  try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
}
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
