import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Offline import: reviewed source snapshots, not a live scrape. See docs/hp-sp.md.
const tablePath = fileURLToPath(new URL('../src/assets/demo/data/hp_sp_table.json', import.meta.url));
const original = readFileSync(tablePath, 'utf8');
const table = JSON.parse(original);
let changed = 0;
for (const group of ['fourth', 'expanded']) {
  const csv = readFileSync(new URL(`../data/hp-sp/taiwan-${group}.csv`, import.meta.url), 'utf8');
  const [header, ...lines] = csv.trim().split(/\r?\n/).map(line => line.split(','));
  const expectedClasses = group === 'fourth'
    ? ['DragonKnight', 'ArchMage', 'Cardinal', 'ShadowCross', 'Meister', 'Windhawk',
      'ImperialGuard', 'ElementalMaster', 'Inquisitor', 'AbyssChaser', 'Biolo', 'Troubadour']
    : ['SkyEmperor', 'SoulAscetic', 'Shinkiro', 'Shiranui', 'NightWatch', 'HyperNovice', 'SpiritHandler'];
  const expectedHeader = ['level', ...expectedClasses.flatMap(name => [`${name}.hp`, `${name}.sp`])];
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader) || lines.length !== 50) {
    throw new Error(`Unexpected header or level coverage in taiwan-${group}.csv`);
  }
  for (const [index, cells] of lines.entries()) {
    const numbers = cells.map(Number);
    const level = numbers[0];
    if (cells.length !== header.length || level !== index + 201 ||
        numbers.some(value => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`Invalid values at taiwan-${group}.csv:${index + 2}`);
    }
    for (const [classIndex, className] of expectedClasses.entries()) {
      const rows = table.filter(row => row.jobs[className] && Object.hasOwn(row.baseHp, level));
      if (rows.length !== 1) throw new Error(`Expected one ${className} row at ${level}`);
      const row = rows[0];
      for (const [offset, field] of [[1, 'baseHp'], [2, 'baseSp']]) {
        // Traditional fourth-job observations already include x1.25. Preserve the
        // fractional normalized value: floor(39157 / 1.25) loses a point on restoration.
        const value = numbers[classIndex * 2 + offset] / (group === 'fourth' ? 1.25 : 1);
        if (row[field][level] !== value) changed++;
        row[field][level] = value;
      }
    }
  }
}
const check = process.argv.slice(2);
if (check.some(arg => arg !== '--check')) throw new Error('Usage: node tools/import-hp-sp-taiwan.mjs [--check]');
if (check.includes('--check')) {
  console.log(`${changed} HP/SP entries differ from the reviewed Taiwan snapshots.`);
  if (changed) process.exitCode = 1;
} else {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(tablePath, (JSON.stringify(table, null, 4) + '\n').replace(/\n/g, newline));
  console.log(`Updated ${changed} HP/SP entries (201-250); level 200 and earlier rows preserved.`);
}
