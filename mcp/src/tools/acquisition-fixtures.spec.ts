/**
 * Real `brief` outputs for the cases the UI test (e2e/acquisition-panel.spec.ts) renders through a stubbed worker reply. The spec keeps
 * the fixture honest: it fails when the service output drifts. Regenerate with UPDATE_FIXTURES=1.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createAcquisitionOperations } from 'src/app/build-analysis/operations/acquisition';
import { acquisitionKnowledge } from 'src/app/build-analysis/acquisition/catalog';

const FILE = 'e2e/fixtures/acquisition-briefs.json';
const BASE = { class: 4262, level: 236, jobLevel: 50, stats: { str: 120, agi: 50, vit: 120, int: 80, dex: 120, luk: 63, pow: 100, con: 43 }, atkSkill: 'Explosion Blaster==5' };
const gear = (g: object) => ({ ...BASE, gear: g });
const dataset = loadDatasetFromDisk();
const AS_OF = '2026-11-05';
const expiredOnly = { ...acquisitionKnowledge, routes: acquisitionKnowledge.routes.filter(r => r.id === 'temporal-exchange-17-v1') };

async function scenarios() {
  const full = createAcquisitionOperations(dataset, config);
  const expired = createAcquisitionOperations(dataset, config, undefined, expiredOnly);
  const run = (ops: typeof full, original: object, final: object) => ops.brief({ original: original as never, final: final as never, asOf: AS_OF });
  return {
    temporalExpired: await run(expired, gear({ headUpper: 19482 }), gear({ headUpper: 19482, headUpperEnchant1: 29080 })),
    temporalExactEnchant: await run(full, gear({ headUpper: 19482, headUpperEnchant1: 29075 }), gear({ headUpper: 19482, headUpperEnchant1: 29080 })),
    visUnknown: await run(full, gear({ weapon: 560026 }), gear({ weapon: 500054, weaponEnchant1: 311453 })),
    noProcedure: await run(full, gear({}), gear({ weapon: 560026 })),
    unchanged: await run(full, gear({ headUpper: 19482 }), gear({ headUpper: 19482 })),
  };
}

describe('acquisition brief UI fixtures', () => {
  it('match the current service output', async () => {
    const current = JSON.parse(JSON.stringify(await scenarios()));
    if (process.env['UPDATE_FIXTURES']) writeFileSync(FILE, JSON.stringify(current, null, 1) + '\n');
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(current);
  });
});
