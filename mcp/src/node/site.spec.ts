import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeBuild } from 'src/app/core/share-codec';
import { createSite, previewHtml } from './site';
import { memoryLinks } from './links';
import { APP_VERSION } from 'src/app/core/app-version';
import history from '../../../src/releases/history.json';

const origin = 'https://laro-calc.siatiquosque.com.br';
const token = encodeBuild({ class: 4262, level: 236, jobLevel: 50 });
const site = () => createSite({ siteRoot: 'src', origin, ogOrigin: 'https://social.latam-tools.com.br',
  vars: { PUBLIC_APP_ORIGIN: origin, ALLOWED_HOSTS: 'laro-calc.siatiquosque.com.br', ALLOWED_ORIGINS: origin } });
afterEach(() => vi.unstubAllGlobals());

describe('VPS share previews and MCP', () => {
  it('identifies the same release in HTTP health and Novidades', async () => {
    expect(history[0].v).toBe(APP_VERSION);
    const response = await site()(new Request(`${origin}/healthz`));
    await expect(response.json()).resolves.toEqual({ ok: true, version: APP_VERSION });
  });
  it('rewrites the real app shell with the configured domain and build identity', () => {
    const html = previewHtml(readFileSync('src/index.html', 'utf8'), token, origin);
    expect(html).toContain('Inquisidor Nv. 236/50');
    expect(html).toContain(`${origin}/s/${token}/og.png`);
    expect(html).toContain(`content="${origin}/s/${token}/"`);
    expect(html).toContain('noindex, follow');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
  });
  it('serves a share containing periods and uses the configured origin rather than an untrusted Host', async () => {
    const response = await site()(new Request(`https://untrusted.test/s/${token}/`));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`${origin}/s/${token}/og.png`);
    expect(html).not.toContain('untrusted.test');
  });
  it('preserves the generic page on malformed tokens and handles HEAD', async () => {
    expect(previewHtml('<head><title>Generic</title></head>', 'invalid', origin)).toContain('Generic');
    const response = await site()(new Request(`${origin}/s/${token}/`, { method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
  it('does not freeze an upstream image fallback as a successful permanent card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302 })));
    const response = await site()(new Request(`${origin}/s/${token}/og.png`));
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('content-type')).toBe('image/png');
  });
  it('reuses the MCP host checks and serves the real tools on the configured domain', async () => {
    const handle = site();
    const init = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };
    expect((await handle(new Request('https://untrusted.test/mcp', init))).status).toBe(403);
    const response = await handle(new Request(`${origin}/mcp`, init));
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.result.tools.map((t: any) => t.name)).toContain('optimize_build');
  });
});

describe('short links', () => {
  const withLinks = () => createSite({ siteRoot: 'src', origin, ogOrigin: '', links: memoryLinks(),
    vars: { PUBLIC_APP_ORIGIN: origin, ALLOWED_HOSTS: 'laro-calc.siatiquosque.com.br', ALLOWED_ORIGINS: origin } });
  const create = (handle: ReturnType<typeof withLinks>, url: string) => handle(new Request(`${origin}/l/api/links`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }));

  it('shortens a build once, resolves the slug and redirects to the canonical share', async () => {
    const handle = withLinks();
    const long = `${origin}/s/${token}/`;
    const { short_url } = (await (await create(handle, long)).json()) as { short_url: string };
    expect(short_url).toMatch(new RegExp(`^${origin}/l/[A-Za-z0-9]{7}$`));
    await expect((await create(handle, `${long}?utm=1#x`)).json()).resolves.toEqual({ short_url });
    const slug = short_url.split('/').pop();
    await expect((await handle(new Request(`${origin}/l/api/links/${slug}`))).json()).resolves.toEqual({ url: long });
    const redirect = await handle(new Request(short_url));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe(long);
  });
  it('refuses anything that is not a build of this site and unknown slugs', async () => {
    const handle = withLinks();
    expect((await create(handle, `https://evil.example/s/${token}/`)).status).toBe(400);
    expect((await create(handle, `${origin}/mcp`)).status).toBe(400);
    expect((await handle(new Request(`${origin}/l/nope`))).status).toBe(404);
  });
  it('does not exist without a store', async () => {
    expect((await site()(new Request(`${origin}/l/api/links`, { method: 'POST', body: '{}' }))).status).toBe(405);
  });
});
