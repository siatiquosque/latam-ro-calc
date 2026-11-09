import { describe, expect, it } from 'vitest';
import { ITEM_DB } from './worn-bonus';

/**
 * Reformed armor, headgear, garments, boots and accessories: 103 other equipment from https://hazyforest.com/equipment:item_reform, listed as `preRelease` previews with the English divine-pride text; bonuses were converted from that text.
 *
 * Still left out, for want of an engine stage:
 *   - hit physical damage (no engine key)
 *   - other sentences the parser could not read
 *   - "when dealing normal melee physical damage" conditions
 *   - auto-cast procs and "when using <skill>" effects
 *   - "grade of each" set conditions
 *   - enabling or requiring a learned skill level
 *   - set partners absent from the item list
 *   - skills missing from the catalog (mostly Alitea)
 *   - unsupported damage targets
 * Each is kept in the description only; no number was invented for them.
 */

const IDS = [28145, 28785, 28789, 300482, 400608, 400609, 400610, 400628, 400629, 400630, 400650, 400652, 400661, 400662, 400663, 400673, 400674, 400675, 400694, 400695, 400696, 400723, 400724, 401058, 401059, 401060, 401115, 401116, 401117, 401118, 401119, 401120, 401172, 401173, 401174, 401175, 401176, 401216, 401217, 401218, 401219, 401220, 401338, 401339, 401340, 450270, 450271, 450274, 450279, 450280, 450281, 450282, 450283, 450284, 450285, 450350, 450351, 450412, 450413, 450531, 450532, 450533, 450534, 460072, 460147, 460148, 470197, 470198, 470260, 470261, 470265, 470303, 470304, 470420, 470421, 470422, 470423, 480283, 480284, 480349, 480350, 480351, 480352, 480415, 480416, 480495, 480496, 480751, 480752, 480753, 480754, 480781, 490276, 490277, 490278, 490620, 490621, 490622, 490623, 490934, 490935, 490936, 490937];

describe('Reformed armor, headgear, garments, boots and accessories', () => {
  it.each(IDS)('%i is present with English text', (id) => {
    expect(ITEM_DB[id]).toBeDefined();
    expect(ITEM_DB[id].description).toMatch(/[A-Za-z]/);
    expect(ITEM_DB[id].description).not.toMatch(/[฀-๿]|^[0-9a-fA-F]{6}/);
  });

  it.each(IDS)('%i is a preview', (id) => {
    expect(ITEM_DB[id].preRelease).toBe(true);
  });
});
