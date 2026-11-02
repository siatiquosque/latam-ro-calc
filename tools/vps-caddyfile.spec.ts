import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deploy Caddyfile', () => {
  const caddyfile = readFileSync(join(import.meta.dirname, '..', 'deploy', 'vps', 'Caddyfile'), 'utf8');

  it('answers 404 for /.well-known/* before the simulator fallback can turn it into index.html', () => {
    const wellKnown = caddyfile.indexOf('@wellknown path /.well-known/*');
    const fallback = caddyfile.indexOf('try_files {path} /index.html');
    expect(wellKnown).toBeGreaterThan(-1);
    expect(caddyfile.slice(wellKnown, fallback)).toContain('respond 404');
    expect(wellKnown).toBeLessThan(fallback);
  });
});
