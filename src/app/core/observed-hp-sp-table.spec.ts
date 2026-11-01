import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HpSpCalculator } from './hp-sp-calculator';
import { HpSpTable } from 'src/app/models/hp-sp-table.model';

const table: HpSpTable = JSON.parse(readFileSync('src/assets/demo/data/hp_sp_table.json', 'utf8'));
const observations = ['fourth', 'expanded'].flatMap(group => {
  const [header, ...rows] = readFileSync(`data/hp-sp/taiwan-${group}.csv`, 'utf8')
    .trim().split(/\r?\n/).map(line => line.split(','));
  return header.slice(1).filter((_, i) => i % 2 === 0).map((column, index) => ({
    className: column.split('.')[0], expanded: group === 'expanded',
    levels: rows.map(row => ({ level: +row[0], hp: +row[index * 2 + 1], sp: +row[index * 2 + 2] })),
  }));
});

function simulate(className: string, expanded: boolean, level: number, vit = 0, int = 0,
  hp = 0, hpPercent = 0) {
  return new HpSpCalculator().setHpSpTable(table)
    .setClass({ className, isExpandedClass: expanded } as any)
    .setAllInfo({ model: { level }, status: { totalVit: vit, totalInt: int },
      totalBonus: { hp, hpPercent, sp: 0, spPercent: 0 }, equipmentBonus: {} } as any)
    .calculate().getTotalSummary();
}

describe('Taiwan observed HP/SP — source values before VIT/INT (docs/hp-sp.md)', () => {
  it.each(observations)('$className reproduces all 50 published HP/SP pairs at zero VIT/INT', observation => {
    expect(observation.levels.map(row => row.level)).toEqual(Array.from({ length: 50 }, (_, i) => i + 201));
    for (const row of observation.levels) {
      expect(simulate(observation.className, observation.expanded, row.level), `level ${row.level}`)
        .toEqual({ maxHp: row.hp, maxSp: row.sp });
    }
  });

  it('Trouvere shares every observed Troubadour HP/SP value', () => {
    for (const row of observations.find(o => o.className === 'Troubadour')!.levels) {
      expect(simulate('Trouvere', false, row.level)).toEqual({ maxHp: row.hp, maxSp: row.sp });
    }
  });

  it.each([
    [126, 0, 0, 88494], [130, 0, 0, 90061],
    [130, 0, 10, 99067], [130, 0, 14, 102669],
    [130, 500, 0, 90561], [126, 500, 0, 88994],
  ])('Inquisitor 236: VIT %i, flat HP %i, HP%% %i gives recorded HP %i', (vit, flat, percent, expected) => {
    expect(simulate('Inquisitor', false, 236, vit, 0, flat, percent).maxHp).toBe(expected);
  });

  it('keeps the two observed ninja curves distinct', () => {
    expect(simulate('Shinkiro', true, 240)).toEqual({ maxHp: 36817, maxSp: 1924 });
    expect(simulate('Shiranui', true, 240)).toEqual({ maxHp: 35344, maxSp: 1889 });
  });
});
