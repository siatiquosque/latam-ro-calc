import { randomBytes } from 'node:crypto';
import { readShareToken } from 'src/app/core/share-path';

/** Persistent slug → share URL map behind the short-link routes. */
export interface LinkStore {
  /** The slug already issued for `url`, or a new one. Idempotent per URL. */
  save(url: string): string;
  find(slug: string): string | undefined;
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_URL = 64 * 1024;
export const newSlug = (length = 7): string =>
  Array.from(randomBytes(length), byte => ALPHABET[byte % ALPHABET.length]).join('');

/** In-memory store, for tests and for running the server without a database file. */
export function memoryLinks(): LinkStore {
  const bySlug = new Map<string, string>();
  const byUrl = new Map<string, string>();
  return {
    save(url) {
      let slug = byUrl.get(url);
      if (slug) return slug;
      do slug = newSlug(); while (bySlug.has(slug));
      bySlug.set(slug, url); byUrl.set(url, slug);
      return slug;
    },
    find: slug => bySlug.get(slug),
  };
}

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * Short links under `<origin>/l`, the contract the app's share dialog already speaks:
 * `POST /l/api/links`, `GET /l/api/links/<slug>` and a redirect on `GET /l/<slug>`.
 * Only URLs of this app that carry a build are stored, so it cannot be used as an open redirector.
 */
export async function handleLinks(request: Request, origin: string, store: LinkStore): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '/l' && !path.startsWith('/l/')) return null;
  const rest = path.slice(3);

  if (rest === 'api/links') {
    if (request.method !== 'POST') return bad('Método não permitido.', 405);
    let target: URL;
    try {
      const body = (await request.json()) as { url?: unknown };
      if (typeof body.url !== 'string' || body.url.length > MAX_URL) return bad('URL inválida.');
      target = new URL(body.url);
    } catch { return bad('URL inválida.'); }
    if (target.origin !== origin || !readShareToken(target.pathname)) return bad('Só links de simulação deste site podem ser encurtados.');
    // Drop the fragment and query: only the path carries the build.
    const canonical = `${origin}${target.pathname}`;
    return Response.json({ short_url: `${origin}/l/${store.save(canonical)}` });
  }

  const lookup = rest.match(/^api\/links\/([^/]+)$/);
  const slug = lookup ? decodeURIComponent(lookup[1]) : rest;
  if (!SLUG.test(slug) || (!lookup && rest.includes('/'))) return bad('Link curto não encontrado.', 404);
  if (request.method !== 'GET' && request.method !== 'HEAD') return bad('Método não permitido.', 405);
  const target = store.find(slug);
  if (!target) return bad('Link curto não encontrado.', 404);
  return lookup
    ? Response.json({ url: target })
    : new Response(null, { status: 302, headers: { location: target, 'cache-control': 'public, max-age=86400' } });
}
