import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fixture from './__tests__/fixtures/inquisitor-fogueira-optimization.json';
import { config } from '../config';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { readShareToken } from 'src/app/core/share-path';

/** Every tool that takes a build must follow a short link the way `parse_share_link` does: validate_build used to read it as a token. */
const saved = { shortenerUrl: config.shortenerUrl, appOrigin: config.appOrigin };
let client: Client;
let longShare: string;
let shortUrl: string;

const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse(((await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as any).content[0].text);

beforeAll(async () => {
  Object.assign(config, { shortenerUrl: 'https://short.test/l', appOrigin: 'https://app.test' });
  shortUrl = 'https://short.test/l/abc123';
  const plain = createMcpServer(loadDatasetFromDisk());
  const [a0, b0] = InMemoryTransport.createLinkedPair();
  const first = new Client({ name: 'first', version: '1' });
  await Promise.all([plain.connect(b0), first.connect(a0)]);
  longShare = JSON.parse(((await first.callTool({ name: 'calculate', arguments: { build: { preset: fixture.preset } } })) as any).content[0].text).share;

  // The shortener answers with a redirect to the real share, as the production one does.
  const shortener = { fetch: async (url: string) => (url === shortUrl ? new Response(null, { status: 302, headers: { location: longShare } }) : new Response('not found', { status: 404 })) };
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'short', version: '1' });
  await Promise.all([createMcpServer(loadDatasetFromDisk(), shortener as never).connect(b), client.connect(a)]);
});

afterAll(() => { Object.assign(config, saved); });

describe('short links', () => {
  it.each(['calculate', 'validate_build', 'parse_share_link'])('%s accepts the encoded build token without its URL', async (name) => {
    const token = readShareToken(longShare)!;
    expect(token).toBeTruthy();
    const fromLong = await call(name, name === 'parse_share_link' ? { share: longShare } : { build: { share: longShare } });
    const fromToken = await call(name, name === 'parse_share_link' ? { share: token } : { build: { share: token } });
    expect(fromToken.error).toBeUndefined();
    if (name === 'validate_build') {
      expect(fromToken.valid).toBe(fromLong.valid);
      expect(fromToken.errors).toEqual(fromLong.errors);
    } else {
      expect(fromToken.build).toEqual(fromLong.build);
      if (name === 'calculate') expect(fromToken.damage).toEqual(fromLong.damage);
    }
  });

  it.each(['calculate', 'validate_build', 'parse_share_link'])('%s resolves a bare short-link slug', async (name) => {
    const viaSlug = await call(name, name === 'parse_share_link' ? { share: 'abc123' } : { build: { share: 'abc123' } });
    const viaUrl = await call(name, name === 'parse_share_link' ? { share: shortUrl } : { build: { share: shortUrl } });
    expect(viaSlug.error).toBeUndefined();
    expect(JSON.stringify(viaSlug.build ?? viaSlug.errors)).toBe(JSON.stringify(viaUrl.build ?? viaUrl.errors));
  });

  it('validate_build accepts a valid short link and reads the same build as the long one', async () => {
    const viaShort = await call('validate_build', { build: { share: shortUrl } });
    const viaLong = await call('validate_build', { build: { share: longShare } });
    expect(viaShort.errors).toEqual(viaLong.errors);
    expect(viaShort.errors.map((error: any) => error.code)).not.toContain('INVALID_BUILD');
    expect(viaShort.valid).toBe(viaLong.valid);
  });

  it('parse_share_link and validate_build agree on what the short link is', async () => {
    const parsed = await call('parse_share_link', { share: shortUrl });
    expect(parsed.error).toBeUndefined();
    const viaShort = await call('validate_build', { build: { share: shortUrl } });
    expect(viaShort.errors.length).toBe(0);
  });
});
