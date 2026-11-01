import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { deduplicateCss } from './deduplicate-css.mjs';

it('removes the redundant CSS artifact, preserves distinct CSS and remaps lazy bundle metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calc-css-'));
  try {
    const first = join(dir, 'main.css'), duplicate = join(dir, 'lazy.css'), unique = join(dir, 'other.css');
    writeFileSync(first, '.a{color:red}\n/*# sourceMappingURL=main.css.map */');
    writeFileSync(duplicate, '.a{color:red}\n/*# sourceMappingURL=lazy.css.map */');
    writeFileSync(unique, '.b{color:blue}');
    writeFileSync(duplicate + '.map', '{}');
    const outputs: any = { [first]: {}, [duplicate]: {}, [duplicate + '.map']: {}, [unique]: {}, 'bootstrap.js': { cssBundle: duplicate } };
    expect(deduplicateCss(outputs, dir)).toEqual([duplicate]);
    expect(outputs['bootstrap.js'].cssBundle).toBe(first);
    expect(existsSync(duplicate)).toBe(false);
    expect(readFileSync(unique, 'utf8')).toContain('blue');
    expect(readFileSync(first, 'utf8')).toContain('red');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
