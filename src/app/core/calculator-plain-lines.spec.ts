import { readFileSync } from 'node:fs';
import { Calculator } from './calculator';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';

/**
 * calcScriptEntryValue skips validateCondition for a line with no `[` and no `:`. That is exact only while every condition the
 * validator knows needs one of the two. This holds the shortcut equal to the validator over every line of item.json (and any
 * line a new upstream grammar adds), so a condition that stops needing a bracket fails here instead of silently reading as plain.
 */
const items: Record<string, { script?: Record<string, unknown> }> = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));

describe('lines without a condition bracket', () => {
  it('are valid and unchanged for the validator, on every item.json line', () => {
    const calc = new Calculator() as any;
    // Whatever the build holds, such a line has nothing to test: leave the state empty, but with a monster-less default.
    calc.model = { level: 1, jobLevel: 1, str: 1, int: 1, dex: 1, agi: 1, vit: 1, luk: 1 };
    const lines = new Set<string>();
    for (const item of Object.values(items)) for (const value of Object.values(item.script ?? {})) {
      if (Array.isArray(value)) for (const line of value) if (typeof line === 'string' && line.indexOf('[') < 0 && line.indexOf(':') < 0) lines.add(line);
    }
    expect(lines.size).toBeGreaterThan(300);
    const different: string[] = [];
    for (const line of lines) for (const itemType of [ItemTypeEnum.weapon, ItemTypeEnum.armor, 'consumable' as ItemTypeEnum]) {
      const result = calc.validateCondition({ itemType, itemRefine: 7, script: line });
      if (result.isValid !== true || result.restCondition !== line) different.push(`${itemType} ${line} -> ${JSON.stringify(result)}`);
    }
    expect(different.slice(0, 10)).toEqual([]);
  });
});
