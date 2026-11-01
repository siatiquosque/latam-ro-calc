import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LinkStore, newSlug } from './links';

/** Short links in a single SQLite file (Node's built-in driver, no dependency). */
export function sqliteLinks(file: string): LinkStore & { close(): void } {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS links (slug TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)');
  const bySlug = db.prepare('SELECT url FROM links WHERE slug = ?');
  const byUrl = db.prepare('SELECT slug FROM links WHERE url = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO links (slug, url, created_at) VALUES (?, ?, ?)');
  return {
    save(url) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const existing = byUrl.get(url) as { slug: string } | undefined;
        if (existing) return existing.slug;
        insert.run(newSlug(), url, Date.now());
      }
      throw new Error('Não foi possível gerar um link curto.');
    },
    close: () => db.close(),
    find: slug => (bySlug.get(slug) as { url: string } | undefined)?.url,
  };
}
