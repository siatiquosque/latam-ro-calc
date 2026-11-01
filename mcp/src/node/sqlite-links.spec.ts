import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// node:sqlite ships unflagged from Node 22.13; production runs Node 24.
const sqlite = await import('node:sqlite').then(() => true, () => false);

describe.skipIf(!sqlite)('sqliteLinks', () => {
  it('keeps links across reopenings and reuses the slug of a URL', async () => {
    const { sqliteLinks } = await import('./sqlite-links');
    const dir = mkdtempSync(join(tmpdir(), 'links-'));
    try {
      const file = join(dir, 'nested', 'links.sqlite');
      const first = sqliteLinks(file);
      const slug = first.save('https://app.test/s/abc/');
      first.close();
      const reopened = sqliteLinks(file);
      expect(reopened.find(slug)).toBe('https://app.test/s/abc/');
      expect(reopened.save('https://app.test/s/abc/')).toBe(slug);
      expect(reopened.find('missing')).toBeUndefined();
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
