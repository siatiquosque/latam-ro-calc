import { readFileSync } from 'node:fs';

/**
 * `item-script-kro.json` (the client-script side where it differs from the LATAM text; the calculator lays it over
 * item.json when the reader picks the kRO item version) and `item-script-extra.json` (effects the calculator has no
 * key for, not read yet) sit beside item.json. They must stay well-formed and point at real items.
 * See docs/script-audit.md.
 */
const read = (name: string): Record<string, Record<string, string[]>> => JSON.parse(readFileSync(`src/assets/demo/data/${name}`, 'utf8'));
const items = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));

describe.each(['item-script-kro.json', 'item-script-extra.json'])('%s', (file) => {
  const overlay = read(file);

  it('only names items that exist in item.json', () => {
    expect(Object.keys(overlay).filter((id) => !items[id])).toEqual([]);
  });

  it('holds clauses as strings, with the value (or an empty list) per key', () => {
    const bad: string[] = [];
    for (const [id, keys] of Object.entries(overlay))
      for (const [key, clauses] of Object.entries(keys))
        if (!Array.isArray(clauses) || clauses.some((clause) => typeof clause !== 'string' || clause === '')) bad.push(`${id} ${key}`);
    expect(bad).toEqual([]);
  });
});

describe('item-script-kro.json', () => {
  it('only overrides keys the calculator models, never an fn__ effect', () => {
    const fn = Object.entries(read('item-script-kro.json')).flatMap(([id, keys]) => Object.keys(keys).filter((key) => key.startsWith('fn__')).map((key) => `${id} ${key}`));
    expect(fn).toEqual([]);
  });
});
