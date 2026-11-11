import { describe, expect, it } from 'vitest';
import { ITEM_DB } from './worn-bonus';

/**
 * Reformed shadow equipment: 165 shadow gear (weapon, armor, shield, boots, earring, pendant) from https://hazyforest.com/equipment:item_reform, listed as `preRelease` previews with the English divine-pride text; bonuses were converted from that text.
 *
 * Still left out, for want of an engine stage:
 *   - other sentences the parser could not read
 *   - "grade of each" set conditions
 *   - enabling or requiring a learned skill level
 *   - auto-cast procs and "when using <skill>" effects
 *   - set partners absent from the item list
 *   - skills missing from the catalog (mostly Alitea)
 * Each is kept in the description only; no number was invented for them.
 */

const IDS = [24906, 24907, 24908, 24909, 24910, 24911, 24912, 24913, 24914, 24915, 24916, 24917, 24918, 24919, 24920, 24921, 24922, 24923, 24924, 24925, 24926, 24927, 24928, 24929, 24936, 24937, 24938, 24939, 24940, 24941, 24942, 24943, 24944, 24945, 24946, 24947, 24948, 24949, 24950, 24951, 24952, 24953, 24954, 24955, 24956, 24957, 24958, 24959, 24967, 24968, 24969, 24970, 24971, 24972, 24973, 24974, 24975, 24976, 24977, 24978, 24979, 24980, 24981, 24982, 24983, 24984, 24985, 24986, 24987, 24988, 24989, 24990, 24999, 400651, 401171, 510153, 510165, 510166, 610064, 610065, 610085, 1270023, 1270024, 1270025, 1270026, 1270027, 1270028, 1270029, 1270030, 1270031, 1270032, 1270033, 1270034, 1270035, 1270036, 1270037, 1270038, 1270039, 1270040, 1270041, 1270042, 1270043, 1270044, 1270045, 1270046, 1270079, 1270080, 1270081, 1270082, 1270083, 1270084, 1270085, 1270086, 1270087, 1270088, 1270089, 1270090, 1270091, 1270092, 1270093, 1270094, 1270095, 1270096, 1270097, 1270098, 1270099, 1270100, 1270101, 1270102, 1270115, 1270116, 1270117, 1270118, 1270119, 1270120, 1270121, 1270122, 1270123, 1270124, 1270125, 1270126, 1270130, 1270131, 1270132, 1270133, 1270134, 1270135, 1270136, 1270137, 1270138, 1270139, 1270140, 1270141, 1270175, 1270176, 1270177, 1270178, 1270179, 1270180, 1270181, 1270182, 1270200, 1270201, 1270202, 1270203];

describe('Reformed shadow equipment', () => {
  it.each(IDS)('%i is present with English text', (id) => {
    expect(ITEM_DB[id]).toBeDefined();
    expect(ITEM_DB[id].description).toMatch(/[A-Za-z]/);
    expect(ITEM_DB[id].description).not.toMatch(/[฀-๿]|^[0-9a-fA-F]{6}/);
  });

  it.each(IDS)('%i is a preview', (id) => {
    expect(ITEM_DB[id].preRelease).toBe(true);
  });
});
