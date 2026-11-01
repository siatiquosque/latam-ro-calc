/** Locally rendered cover, sourced from src/assets/og-cover.svg. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const png = readFileSync('src/assets/og-cover.png');

describe('the vendored social cover', () => {
  it('is a PNG', () => {
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('is the size the meta tags declare', () => {
    // src/index.html advertises og:image:width 1200 / og:image:height 630. A mismatch
    // makes some crawlers refuse the image outright rather than scale it.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
