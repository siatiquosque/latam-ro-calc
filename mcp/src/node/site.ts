import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { buildShareMeta } from '../../../worker/share-meta';
import { readShareToken } from 'src/app/core/share-path';
import { handleMcp, McpEnv } from '../../../worker/mcp/handler';
import { APP_VERSION } from 'src/app/core/app-version';
import { handleLinks, LinkStore } from './links';

const escapeAttribute = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Replace only the known head tags, retaining the same preview contract as the Worker. */
export function previewHtml(html: string, token: string, origin: string): string {
  const meta = buildShareMeta(token, origin);
  if (!meta) return html;
  const values: Record<string, string> = {
    description: meta.description, 'og:title': meta.title, 'og:description': meta.description,
    'og:url': meta.canonical, 'og:image': meta.image, 'og:image:alt': meta.title,
    'twitter:title': meta.title, 'twitter:description': meta.description, 'twitter:image': meta.image,
  };
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head => head
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttribute(meta.title)}</title>`)
    .replace(/<meta\b[^>]*>/gi, tag => {
      const key = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
      return key && values[key] ? tag.replace(/content=["'][^"']*["']/i, `content="${escapeAttribute(values[key])}"`) : tag;
    })
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, tag => tag.replace(/href=["'][^"']*["']/i, `href="${escapeAttribute(meta.canonical)}"`))
    .replace('</head>', '<meta name="robots" content="noindex, follow"></head>'));
}

export interface SiteOptions {
  siteRoot: string;
  origin: string;
  ogOrigin: string;
  vars: Record<string, string | undefined>;
  /** Enables `/l` short links; without it the routes do not exist. */
  links?: LinkStore;
}

export function createSite(options: SiteOptions) {
  const root = resolve(options.siteRoot);
  const origin = new URL(options.origin).origin;
  const assets = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 400 }); }
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep)) return new Response(null, { status: 404 });
    try {
      const body = await readFile(file);
      const type = path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      return new Response(body, { headers: { 'content-type': type } });
    } catch { return new Response(null, { status: 404 }); }
  };
  // The MCP resolves and issues short links in-process instead of calling its own public URL.
  const shortener = { fetch: (url: string, init: RequestInit) => handle(new Request(url, init)) };
  const env = { ...options.vars, ASSETS: { fetch: assets }, SHORTENER: options.links ? shortener : undefined } as unknown as McpEnv;
  const ctx = { waitUntil: (promise: Promise<unknown>) => { void promise.catch(error => console.error(error)); } } as ExecutionContext;
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (options.links) {
      const link = await handleLinks(request, origin, options.links);
      if (link) return link;
    }
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return handleMcp(request, env, ctx);
    if (url.pathname === '/healthz') return Response.json({ ok: true, version: APP_VERSION });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    const token = readShareToken(url.pathname);
    if (token && url.pathname.endsWith('/og.png')) {
      if (options.ogOrigin) try {
        const card = await fetch(`${options.ogOrigin}/ro-calc/build.png?b=${token}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        if (card.ok && card.headers.get('content-type')?.startsWith('image/')) return new Response(request.method === 'HEAD' ? null : card.body,
          { headers: { 'content-type': card.headers.get('content-type')!, 'cache-control': 'public, max-age=604800, immutable' } });
      } catch { /* Same fallback as the Cloudflare route. */ }
      const cover = await assets(new Request(`${origin}/assets/og-cover.png`));
      return new Response(request.method === 'HEAD' ? null : cover.body, { status: cover.status,
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' } });
    }
    const shell = await assets(new Request(`${origin}/index.html`));
    if (!shell.ok) return shell;
    const html = token ? previewHtml(await shell.text(), token, origin) : await shell.text();
    return new Response(request.method === 'HEAD' ? null : html,
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  };
  return handle;
}
