import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('preserves explicit RagnarokDB translations and calculator labels across feed refreshes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calc-monster-names-'));
  try {
    const out = join(dir, 'src/assets/demo/data');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'latam-monsters.json'), JSON.stringify({ 999999: 'Prior fallback' }));
    const source = join(dir, 'mobs.json');
    writeFileSync(source, JSON.stringify([
      { id: 21520, name: 'Limacina' },
      { id: 20573, name: 'Amdarais' },
    ]));
    execFileSync(process.execPath, [resolve('tools/build-latam-monsters.mjs'), '--src', source], { cwd: dir });
    const names = JSON.parse(readFileSync(join(out, 'latam-monsters.json'), 'utf8'));
    expect(names['21520']).toBe('Remakina');
    expect(names['20573']).toBe('Miragem de Amdarais - Nível 10');
    expect(names['999999']).toBe('Prior fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
