import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import knowledge from '../data/acquisition/latam.v1.json';
import curation from '../data/acquisition/curation/reference-families.v1.json';

const directory = mkdtempSync(resolve('.tmp/acquisition-cli-test-'));
const output = join(directory, 'catalog.json');
const input = join(directory, 'input.json');
const run = (...args: string[]) => execFileSync(process.execPath, ['tools/import-ragnarokdb-acquisition.mjs', '--input', input, '--output', output, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
afterAll(() => {
  if (!resolve(directory).startsWith(resolve('.tmp') + sep)) throw new Error('Unexpected cleanup target');
  rmSync(directory, { recursive: true });
});

describe('acquisition import CLI', () => {
  it('dry-runs without writing; applies and reprocesses curation byte-identically', () => {
    const original = { ...knowledge, routes: [], effects: [], enchantGroups: [] };
    const addition = { ...curation, routes: curation.routes.filter(r => !r.supersedes) };
    writeFileSync(output, JSON.stringify(original));
    writeFileSync(input, JSON.stringify(addition));
    const before = readFileSync(output, 'utf8');
    expect(JSON.parse(run('--curation')).changed).toBe(true);
    expect(readFileSync(output, 'utf8')).toBe(before);
    expect(JSON.parse(run('--curation', '--apply')).added).toBe(13);
    const applied = readFileSync(output, 'utf8');
    expect(JSON.parse(run('--curation', '--apply')).changed).toBe(false);
    expect(readFileSync(output, 'utf8')).toBe(applied);
  });
  it('preserves the catalog on invalid schema and refuses simultaneous writers', () => {
    writeFileSync(output, JSON.stringify(knowledge));
    const before = readFileSync(output, 'utf8');
    writeFileSync(input, JSON.stringify({ schemaVersion: 999 }));
    expect(() => run('--apply')).toThrow();
    expect(readFileSync(output, 'utf8')).toBe(before);
    writeFileSync(input, JSON.stringify({ ...curation, routes: [] }));
    writeFileSync(output + '.import.lock', 'test lock');
    expect(() => run('--curation', '--apply')).toThrow();
    expect(readFileSync(output, 'utf8')).toBe(before);
    rmSync(output + '.import.lock');
  });
});
