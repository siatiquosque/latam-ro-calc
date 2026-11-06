import { describe, expect, it } from 'vitest';
import { createMainModel } from 'src/app/utils';
import { acquisitionKnowledge as kb } from './catalog';
import { assessAcquisition } from './assess';
import { effectiveRoutes } from './contracts';
import { queryAcquisition } from './query';

const assess = (gear: Record<string, unknown>) =>
  assessAcquisition({ model: Object.assign(createMainModel(), gear) }, 'LATAM', { asOf: '2026-11-05' }, kb);

describe('Phase 4.1 catalog invariants', () => {
  const browiki = kb.routes.filter(r => r.sources.some(s => s.startsWith('browiki-')));

  it('has unique route and source ids, and every revision points at an existing predecessor', () => {
    expect(new Set(kb.routes.map(r => r.id)).size).toBe(kb.routes.length);
    expect(new Set(kb.sources.map(s => s.id)).size).toBe(kb.sources.length);
    const ids = new Set(kb.routes.map(r => r.id));
    expect(kb.routes.filter(r => r.supersedes && !ids.has(r.supersedes))).toEqual([]);
    const keys = effectiveRoutes(kb).map(r => r.importKey).filter(Boolean);
    expect(new Set(keys).size, 'one effective route per import key').toBe(keys.length);
  });

  it('every bROWiki route carries a registered, hashed source and never claims LATAM availability', () => {
    expect(browiki.length).toBeGreaterThan(600);
    for (const r of browiki) {
      expect(r.period.known, r.id).toBe(false);
      expect(r.unknowns.length, r.id).toBeGreaterThan(0);
      for (const id of r.sources) expect(kb.sources.find(s => s.id === id)?.sha256, `${r.id}:${id}`).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('Automódulos, H- included, share one exchange route and no output carries an invented chance', () => {
    const exchanges = kb.routes.filter(r => r.method === 'exchange' && r.family === 'automatron' && r.id.includes('module-exchange'));
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].outputs.length).toBe(98);
    expect(exchanges[0].outputs.every(o => o.chance === null)).toBe(true);
    expect(exchanges[0].outputSelection).toBe('one');
  });

  it('an H- module is applicable only on the Colete and records its class association', () => {
    const route = kb.routes.find(r => r.id === 'automatron-enchant-310127-position-1-v1')!;
    expect(route.target.itemIds).toEqual([450127, 450128]);
    expect(route.requirements.some(q => q.description.includes('Cavaleiros Rúnicos'))).toBe(true);
    const d = assess({ armor: 450127, armorEnchant1: 310127 }).diagnostics.find(x => x.aspect === 'enchant' && x.itemId === 310127)!;
    expect(d.evidence).toMatchObject({ documentedRoute: true, availability: 'unconfirmed', insufficient: true });
    const shield = assess({ shield: 460157, shieldEnchant1: 310127 }).diagnostics.find(x => x.aspect === 'enchant' && x.itemId === 310127);
    expect(shield?.routes ?? []).toEqual([]);
  });

  it('card 300076 keeps one effective route that adds RagnaPlace without promoting its status', () => {
    const routes = queryAcquisition({ server: 'LATAM', asOf: '2026-11-05', itemId: 300076 }).filter(r => r.method === 'drop');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ review: 'unreviewed', availability: 'unknown', drop: { monsterId: 20639, probability: { numerator: 1, denominator: 10000 } } });
    expect(routes[0].sources.some(s => s.startsWith('ragnaplace-'))).toBe(true);
    expect(routes[0].sources.length).toBe(2);
  });
});
