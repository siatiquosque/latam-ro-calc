import { readFileSync } from 'node:fs';
import { createMainModel } from 'src/app/utils';
import { createRawTotalBonus } from 'src/app/utils/create-raw-total-bonus';
import { ITEM_BONUS_LABELS } from './bonus-key-label';
import { equipStatusOf, makeCalculator } from './__tests__/make-calculator';

/**
 * `noGemCost` marks gear that removes the gem consumption of a skill (Carta Abelha-Rainha,
 * the Racing set). It is DISPLAY ONLY (docs/item-json.md §3.4): the calculator never spends
 * gems, so the key exists for the item list and the MCP, and never changes damage.
 */
const db = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));

describe('noGemCost is a display-only key', () => {
  it('starts at zero and has a pt-BR label', () => {
    expect((createRawTotalBonus() as any).noGemCost).toBe(0);
    expect(ITEM_BONUS_LABELS['noGemCost']).toBeTruthy();
  });

  it('is granted by Carta Abelha-Rainha and leaves the damage stats untouched', () => {
    const model = { ...createMainModel(), level: 200, shield: 2124 };
    const bare: any = equipStatusOf(makeCalculator({ 2124: db[2124] }), model);
    const withIt: any = equipStatusOf(makeCalculator({ 2124: db[2124], 4132: db[4132] }), { ...model, shieldCard: 4132 });

    expect(withIt.noGemCost).toBe(1);
    for (const key of ['atk', 'matk', 'atkPercent', 'matkPercent', 'melee', 'range', 'criDmg', 'flatDmg', 'def', 'mdef']) {
      expect(withIt[key] || 0, key).toBe(bare[key] || 0);
    }
  });
});
