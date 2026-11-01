import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { json, registerJsonTool, useShortener } from './helpers';

const saved = { shortenerUrl: config.shortenerUrl, appOrigin: config.appOrigin };
afterEach(() => Object.assign(config, saved));

async function run(payload: unknown, shortenerUrl: string, fetch?: (url: string) => Promise<Response>) {
  Object.assign(config, { shortenerUrl, appOrigin: 'https://app.test' });
  let callback!: () => Promise<any>;
  const server = { registerTool: (_n: string, _c: unknown, cb: typeof callback) => { callback = cb; } } as unknown as McpServer;
  useShortener(server, fetch ? { fetch: (url) => fetch(url) } : undefined);
  registerJsonTool(server, 't', {}, () => json(payload));
  return JSON.parse((await callback()).content[0].text);
}

describe('short build links in tool results', () => {
  const long = 'https://app.test/s/N4Ig.abc-def/';
  const reply = () => Response.json({ short_url: 'https://app.test/l/aB3dE9x' });

  it('replaces share and url links of this app, once per link', async () => {
    const calls: string[] = [];
    const out = await run({ share: long, patch: { url: long }, ref: 'https://other.test/s/x/' }, 'https://app.test/l',
      async (url) => { calls.push(url); return reply(); });
    expect(out).toEqual({ share: 'https://app.test/l/aB3dE9x', patch: { url: 'https://app.test/l/aB3dE9x' }, ref: 'https://other.test/s/x/' });
    expect(calls).toEqual(['https://app.test/l/api/links']);
  });
  it('keeps the long link when the shortener fails or is not configured', async () => {
    await expect(run({ share: long }, 'https://app.test/l', async () => new Response(null, { status: 500 }))).resolves.toEqual({ share: long });
    await expect(run({ share: long }, '')).resolves.toEqual({ share: long });
  });
});
