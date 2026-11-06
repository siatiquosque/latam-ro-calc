import { describe, expect, it } from 'vitest';
import items from '../../../assets/demo/data/item.json';
import client from '../../../assets/demo/data/latam-items.json';
import { getEnchants } from '../../constants/enchant_item/_enchant_table';
import curation from '../../../../data/acquisition/curation/reference-families.v1.json';
import rathena from '../../../../data/acquisition/rathena-glacier-experimental.v1.json';
import { acquisitionKnowledge } from './catalog';
import { knowledgeSchema } from './contracts';
import { applyCuratedKnowledge } from './import-ragnarokdb';
import { queryAcquisition } from './query';

describe('reference family evidence', () => {
  const curated = knowledgeSchema.parse(curation);
  const generic = knowledgeSchema.parse(rathena);
  it('uses existing local IDs for outputs, requirements, enchants and alternatives', () => {
    const known = new Set([...Object.keys(items), ...Object.keys(client)].map(Number));
    for (const route of curated.routes) {
      const ids = [...route.target.itemIds, ...route.target.enchantIds, ...route.requirements.flatMap(r =>
        [...(r.itemId ? [r.itemId] : []), ...(r.anyItemIds ?? []), ...(r.enchantId ? [r.enchantId] : [])]), ...(route.outputs ?? []).map(o => o.itemId)];
      expect(ids.filter(id => !known.has(id))).toEqual([]);
    }
  });
  it('keeps the ten grade costs consistent with the independently extracted rAthena table', () => {
    for (const route of curated.routes.filter(r => r.method === 'enchant')) {
      const reference = generic.routes.find(r => r.target.enchantIds[0] === route.target.enchantIds[0]);
      expect(reference, route.id).toBeTruthy();
      const materials = r => r.requirements.filter(v => v.kind === 'material').map(v => [v.itemId, v.amount]).sort((a, b) => a[0] - b[0]);
      expect(materials(route)).toEqual(materials(reference));
      expect(route.steps[0].success).toBeNull();
      expect(Object.values(route.steps[0].failure).every(v => v === null)).toBe(true);
      expect(reference.server).toBe('generic');
      expect(reference.review).toBe('unreviewed');
    }
  });
  it('keeps enchant grade progression separate from equipment grade and follows the existing pool positions', () => {
    const db = items as Record<string, { aegisName: string }>;
    for (const route of curated.routes.filter(r => r.method === 'enchant')) {
      expect(route.target.position).toBe(1);
      expect(route.target.grade).toBeNull();
      for (const itemId of route.target.itemIds) {
        expect(getEnchants(db[itemId].aegisName)[1]).toContain(db[route.target.enchantIds[0]].aegisName);
      }
    }
  });
  it('represents the previous enchant and exact materials as shared dependencies', () => {
    const kb = applyCuratedKnowledge({ schemaVersion: 1, revision: 'test', sources: [], routes: [], effects: [], enchantGroups: [] },
      { ...curated, routes: curated.routes.filter(r => !r.supersedes) }).knowledge;
    const route = queryAcquisition({ itemId: 311453, server: 'LATAM', asOf: '2026-11-05' }, kb)[0];
    expect(route.dependencies).toContain(311452);
    expect(route.requirements).toContainEqual(expect.objectContaining({ itemId: 1001036, amount: 65 }));
    expect(route.requirements).toContainEqual(expect.objectContaining({ itemId: 1001033, amount: 3 }));
  });
  it('does not promise all random extraction outputs or invent weights', () => {
    const incinerator = curated.routes.find(r => r.id === 'dim-glacier-incinerator-v1');
    expect(incinerator.requirements[0].amount).toBe(3);
    expect(incinerator.requirements[0].anyItemIds).toHaveLength(26);
    expect(incinerator.outputs).toHaveLength(10);
    expect(incinerator.outputs.every(o => o.chance === null)).toBe(true);
    expect(incinerator.outputSelection).toBe('unknown');
    const shadow = curated.routes.find(r => r.id === 'truegem-combine-v2');
    expect(shadow.requirements[1].amount).toBe(6);
    expect(shadow.requirements[1].minRefine).toBe(7);
    expect(shadow.requirements[1].anyItemIds).toHaveLength(9);
    expect(shadow.outputSelection).toBe('one');
    expect(shadow.outputs.every(o => o.chance === null)).toBe(true);
  });
  it('retains the Temporal event and legacy equipment; imported data cannot overwrite it', () => {
    const exchange = acquisitionKnowledge.routes.find(r => r.id === 'temporal-exchange-17-v1');
    expect(exchange.review).toBe('confirmed');
    expect(exchange.period.end).toBe('2026-10-12');
    expect(exchange.requirements).toContainEqual(expect.objectContaining({ itemId: 18551, minRefine: 17 }));
    expect(acquisitionKnowledge.effects.filter(e => e.id.endsWith('nogem')).every(e => e.engineCoverage === 'missing')).toBe(true);
  });
});
