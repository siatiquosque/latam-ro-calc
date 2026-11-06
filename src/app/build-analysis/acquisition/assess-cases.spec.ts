import { describe, expect, it } from 'vitest';
import { createMainModel } from 'src/app/utils';
import { acquisitionKnowledge } from './catalog';
import { assessAcquisition } from './assess';
import { knowledgeSchema, routeSchema } from './contracts';
import { queryAcquisition } from './query';

const assess = (gear: Record<string, unknown>, knowledge = acquisitionKnowledge, asOf = '2026-11-05') =>
  assessAcquisition({ model: Object.assign(createMainModel(), gear) }, 'LATAM', { asOf }, knowledge);
const part = (result: ReturnType<typeof assess>, aspect: string, itemId?: number) =>
  result.diagnostics.find(d => d.aspect === aspect && (itemId == null || d.itemId === itemId))!;

describe('assessAcquisition evidence facets (real catalog)', () => {
  it('Temporal Circlet: Insignia 5 and 10 get their own routes, chances and event period', () => {
    const level5 = part(assess({ headUpper: 19482, headUpperEnchant1: 29075 }), 'enchant');
    const level10 = part(assess({ headUpper: 19482, headUpperEnchant1: 29080 }), 'enchant');
    expect(level5.routes.map(r => r.id)).toContain('temporal-evolution-5-v1');
    expect(level5.routes.map(r => r.id)).not.toContain('temporal-evolution-10-v1');
    expect(level10.routes.map(r => r.id)).toContain('temporal-evolution-10-v1');
    // Level 10 has the +17 exchange, bounded by the event, plus the normal 1% evolution step.
    expect(level10.routes.map(r => r.id)).toContain('temporal-exchange-17-v1');
    expect(level10.evidence).toMatchObject({ documentedRoute: true, availability: 'confirmed', chance: 'known', exceptional: true });
    expect(level5.routes.map(r => r.id)).toContain('temporal-exchange-14-v1');
    expect(level10.evidence.sources.length).toBeGreaterThan(0);
    expect(level10.evidence.confidence).toBeTruthy();
  });

  it('Temporal Circlet after the event: only the normal route stays confirmed, expired exchange is kept as history', () => {
    const d = part(assess({ headUpper: 19482, headUpperEnchant1: 29080 }), 'enchant');
    expect(d.routes.find(r => r.id === 'temporal-exchange-17-v1')?.availability).toBe('expired');
    const expiredOnly = assess({ headUpper: 19482, headUpperEnchant1: 29080 },
      { ...acquisitionKnowledge, routes: acquisitionKnowledge.routes.filter(r => r.id === 'temporal-exchange-17-v1') });
    expect(part(expiredOnly, 'enchant').evidence).toMatchObject({ documentedRoute: true, availability: 'expired_only' });
    expect(part(expiredOnly, 'enchant').status).toBe('expired_routes');
  });

  it('Dim Glacier weapon with an advanced grade enchant: cost documented, odds unknown, never invented', () => {
    const result = assess({ weapon: 500054, weaponEnchant1: 311453 });
    const d = part(result, 'enchant', 311453);
    expect(d.routes.length).toBeGreaterThan(0);
    expect(d.evidence).toMatchObject({ documentedRoute: true, availability: 'confirmed', chance: 'unknown', insufficient: true });
    expect(d.status).not.toBe('obtainable');
    const lvl5 = d.routes.find(r => r.target.enchantIds.includes(311453) && r.method === 'enchant')!;
    expect(lvl5.steps[0].success).toBeNull();
    expect(lvl5.steps[0].materials.length).toBeGreaterThan(0);
    expect(d.evidence.unknowns.length).toBeGreaterThan(0);
  });

  it('Gemstone shadow set: item routes are reported per piece and the set effect carries its engine coverage', () => {
    const result = assess({ shadowArmor: 24675, shadowBoot: 24676, shadowArmorRefine: 9, shadowBootRefine: 9 });
    expect(result.diagnostics.filter(d => d.aspect === 'item').map(d => d.itemId)).toEqual([24675, 24676]);
    expect(result.effects.length).toBeGreaterThan(0);
    expect(result.effects.every(e => e.sourceDetails.length > 0 && ['represented', 'missing', 'partial'].includes(e.engineCoverage))).toBe(true);
    expect(assess({ shadowArmor: 24675, shadowBoot: 24676, shadowArmorRefine: 1, shadowBootRefine: 1 }).effects).toHaveLength(0);
  });

  it('item with a known drop chance exposes the exact fraction and a documented-but-unconfirmed LATAM status', () => {
    const base = acquisitionKnowledge.routes.find(r => r.method === 'drop' && r.drop?.probability && r.drop.probability.denominator > 1)!;
    const route = routeSchema.parse({ ...base, id: 'test-drop-weapon', importKey: undefined, unknowns: [], target: { ...base.target, itemIds: [560026] } });
    const knowledge = knowledgeSchema.parse({ ...acquisitionKnowledge, routes: [...acquisitionKnowledge.routes, route] });
    const d = part(assess({ weapon: 560026 }, knowledge), 'item', 560026);
    expect(d.routes.find(r => r.id === 'test-drop-weapon')?.drop?.probability).toEqual(base.drop!.probability);
    expect(d.evidence).toMatchObject({ documentedRoute: true, availability: 'unconfirmed', chance: 'known', insufficient: false });
    expect(d.status).toBe('insufficient_information');
    expect(d.reason).toContain('não é prova de obtenção nem de impossibilidade');
  });

  it('item with no route or odds is insufficient information, not impossible', () => {
    const d = part(assess({ weapon: 560026 }), 'item', 560026);
    expect(d.routes).toEqual([]);
    expect(d.status).toBe('insufficient_information');
    expect(d.evidence).toMatchObject({ documentedRoute: false, availability: 'none', chance: 'none', insufficient: true, confidence: null });
    expect(d.reason).toContain('ausência de regra não demonstra impossibilidade');
  });

  it('a drop with a null chance stays unknown rather than becoming 0% or 100%', () => {
    const unknown = acquisitionKnowledge.routes.find(r => r.method === 'drop' && r.drop && r.drop.probability == null)!;
    expect(unknown).toBeTruthy();
    const item = unknown.target.itemIds[0];
    expect(queryAcquisition({ server: 'LATAM', asOf: '2026-11-05', itemId: item }).find(r => r.id === unknown.id)?.drop?.probability).toBeNull();
  });

  it('Phase 4: a card imported from RagnarokDB has a documented drop but no confirmed LATAM availability', () => {
    const d = part(assess({ headUpper: 400000, headUpperCard: 4636 }), 'item', 4636);
    expect(d.routes.some(r => r.method === 'drop')).toBe(true);
    expect(d.evidence).toMatchObject({ documentedRoute: true, availability: 'unconfirmed', chance: 'known' });
    expect(d.status).toBe('insufficient_information');
  });

  it('Phase 4: gear absent from every source stays "no information", never impossible', () => {
    const d = part(assess({ weapon: 560026 }), 'item', 560026);
    expect(d.evidence).toMatchObject({ documentedRoute: false, insufficient: true });
    expect(d.reason).toContain('ausência de regra não demonstra impossibilidade');
  });

  it('Phase 4.1: Automatron module on gear slot 2 has a documented but unconfirmed, insufficient route', () => {
    const d = part(assess({ armor: 450127, armorEnchant2: 310082 }), 'enchant', 310082);
    expect(d.routes.map(r => r.id)).toContain('automatron-enchant-310082-position-2-v1');
    expect(d.evidence).toMatchObject({ documentedRoute: true, availability: 'unconfirmed', insufficient: true });
    expect(d.status).not.toBe('obtainable');
  });

  it('Phase 4.1: the same Automatron module in another slot position is not claimed', () => {
    const d = part(assess({ armor: 450127, armorEnchant3: 310082 }), 'enchant', 310082);
    expect(d.routes.map(r => r.id)).not.toContain('automatron-enchant-310082-position-2-v1');
  });

  it('Phase 4.1: the six previously refused cards have a drop route from the client monster list', () => {
    for (const card of [4392, 4393, 4582, 4608, 4609, 300076]) {
      const drops = acquisitionKnowledge.routes.filter(r => r.method === 'drop' && r.target.itemIds.includes(card));
      expect(drops.length, String(card)).toBeGreaterThan(0);
      expect(drops.every(r => r.review === 'unreviewed'), String(card)).toBe(true);
    }
  });

  it('indexed lookups return exactly what a full scan would', () => {
    const itemId = 19482;
    const scan = acquisitionKnowledge.routes.filter(r => r.target.itemIds.includes(itemId) || r.target.enchantIds.includes(itemId)).map(r => r.id);
    const indexed = queryAcquisition({ server: 'LATAM', asOf: '2026-11-05', itemId }).map(r => r.id);
    expect(indexed.every(id => scan.includes(id))).toBe(true);
    expect(indexed.length).toBeGreaterThan(0);
  });
});
