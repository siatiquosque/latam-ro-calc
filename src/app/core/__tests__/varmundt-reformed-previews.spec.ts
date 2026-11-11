import { describe, expect, it } from 'vitest';
import { ITEM_DB, wornBonus } from './worn-bonus';

/**
 * The reformed Varmundt rune gear (Flame, Plain, Ice and Death armor, boots and manteau, plus
 * the three rune and three magic rings), listed as `preRelease` previews. The recipes are on
 * https://hazyforest.com/equipment:item_reform (Zelunium + Varmeal Tickets + a "<element> Rune
 * Upgrade" item); the text is the divine-pride English one, mirrored in RagnarokDB.
 */

const ARMOR = [450234, 450243, 450244, 450245];
const BOOTS = [470173, 470174, 470175, 470176];
const MANTEAU = [480230, 480231, 480232, 480233];
const RINGS = [490302, 490303, 490304, 490305, 490306, 490307];

describe('reformed Varmundt rune gear previews', () => {
  it.each([...ARMOR, ...BOOTS, ...MANTEAU, ...RINGS])('%i is a preview with English text', (id) => {
    expect(ITEM_DB[id]).toMatchObject({ id, preRelease: true });
    expect(ITEM_DB[id].description).toMatch(/[A-Za-z]/);
    expect(ITEM_DB[id].description).not.toMatch(/[฀-๿]/);
  });

  it.each([0, 1, 2, 3])('manteau %i pays its set line only with the armor and boots of its own element', (i) => {
    const pays = (worn: Parameters<typeof wornBonus>[0]) => JSON.stringify(wornBonus(worn));
    const full = { garment: MANTEAU[i], armor: ARMOR[i], boot: BOOTS[i] };
    expect(pays(full)).not.toBe(pays({ ...full, boot: BOOTS[(i + 1) % 4] }));
    expect(pays({ ...full, armor: undefined })).toBe(pays({ garment: MANTEAU[i], boot: BOOTS[i] }));
  });

  it('Plain manteau also resists earth damage with its set', () => {
    const set = wornBonus({ garment: 480231, armor: 450243, boot: 470174 });
    const alone = wornBonus({ garment: 480231 });
    expect((set['subele_earth'] ?? 0) - (alone['subele_earth'] ?? 0)).toBe(10);
  });
});
