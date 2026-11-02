import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSite } from './site';
import { sqliteLinks } from './sqlite-links';

const origin = new URL(process.env['PUBLIC_APP_ORIGIN'] ?? 'http://localhost:8787').origin;
const port = Number(process.env['PORT'] ?? 8787);
const site = createSite({
  siteRoot: resolve(process.env['SITE_ROOT'] ?? 'dist/sakai-ng'), origin,
  ogOrigin: process.env['OG_ORIGIN'] ?? '',
  links: sqliteLinks(resolve(process.env['LINKS_DB'] ?? 'data/links.sqlite')),
  vars: { ...process.env, PUBLIC_APP_ORIGIN: origin,
    ALLOWED_HOSTS: process.env['ALLOWED_HOSTS'] ?? new URL(origin).hostname,
    ALLOWED_ORIGINS: process.env['ALLOWED_ORIGINS'] ?? `https://claude.ai,https://chatgpt.com,https://chat.openai.com,${origin}` },
});

const server = createServer(async (req, res) => {
  try {
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 256 * 1024) { res.writeHead(413).end(); return; }
      parts.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    // Preserve the incoming Host for MCP's allowlist validation. Preview URLs use
    // the configured public origin, never a caller-controlled Host header.
    const url = new URL(req.url ?? '/', origin);
    url.host = req.headers.host ?? new URL(origin).host;
    const request = new Request(url, { method: req.method, headers,
      ...(!['GET', 'HEAD'].includes(req.method ?? '') ? { body: Buffer.concat(parts) } : {}) });
    const response = await site(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.requestTimeout = 30_000;
server.listen(port, process.env['HOST'] ?? '127.0.0.1', () => console.log(`RO Calc HTTP: ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
