import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HpSpTable } from 'src/app/models/hp-sp-table.model';

const table: HpSpTable = JSON.parse(readFileSync('src/assets/demo/data/hp_sp_table.json', 'utf8'));
const row = (cls: string) => table.find(r => r.jobs[cls])!;

// Taiwan's snapshots start at 201. These estimates at 200 are deliberately
// unchanged; observed-hp-sp-table.spec.ts verifies the published 201-250 values.
describe('Expanded fourth HP/SP — legacy level-200 fallback (docs/hp-sp.md)', () => {
  it.each([
    ['SkyEmperor', 72, 6050, 3, 469],
    ['SoulAscetic', 94, 1058, 6, 400],
    ['Shinkiro', 85, 4496, 3, 474],
    ['Shiranui', 85, 4496, 3, 474],
    ['NightWatch', 66, 5603, 9, 16],
    ['HyperNovice', 38, 5584, 6, 40],
  ] as const)('%s retains its previous rAthena estimate at 200 only', (cls, hf, hi, sf, si) => {
    let hp = 35 + Math.floor(200 * hi / 100);
    let sp = 10 + Math.floor(200 * si / 100);
    for (let i = 2; i <= 200; i++) {
      hp += Math.floor(hf / 100 * i + 0.5);
      sp += Math.floor(sf / 100 * i + 0.5);
    }
    if (cls === 'HyperNovice') hp += 4000;
    if (cls === 'Shinkiro' || cls === 'Shiranui') sp -= 22;
    if (cls === 'NightWatch') sp -= 18;
    expect(row(cls).baseHp[200]).toBe(hp);
    expect(row(cls).baseSp[200]).toBe(sp);
  });

  it('retains the previous Spirit Handler extrapolation at 200 only', () => {
    expect(row('SpiritHandler').baseHp[200]).toBe(27201);
    expect(row('SpiritHandler').baseSp[200]).toBe(1171);
  });
});
