import { decodeReplay } from 'rrfparser';
import { describe, expect, it } from 'vitest';
import { Inquisitor } from 'src/app/jobs/Inquisitor';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { makeBuffGate } from 'src/app/replay/skill-status.map';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { resolveBuild } from './build-input';
import { solve } from './solve';

/**
 * Inquistor_teste2.rrf, LATAM 31/10/2026, 236/50, weaponless throughout.
 * The fixture has player names/AID anonymized. Gear and traits come from the
 * importer; learned levels plus recorder-owned EFSTs select the class buffs.
 * Missing Mantra/Dragão/Chakra/Fúria import mappings explained the discrepancy;
 * no damage formula change was needed. Spheres are reconstructed as 15, not
 * auto-imported: the learned tree alone cannot establish their current count.
 * Auréola das Chamas is selected for the final rotation, not imported from the
 * union of statuses: this replay switches between mutually exclusive auras.
 * Boot VIT +225 is independently confirmed by COUPLESTATUS and HP packets.
 */
const dataset = loadDatasetFromDisk();
const replay = decodeReplay(loadReplayFixture('inq-buffed-weaponless.rrf'));
const imported = replayToModel(replay, dataset.items);
const learned = new Map(replay.learnedSkills);
const cls = new Inquisitor();
const gate = makeBuffGate(imported.activeStatuses);
const level = (name: string) => learned.get(SKILL_ID_BY_NAME[name]) ?? 0;
const passive = Object.fromEntries(cls.passiveSkills.map(s => [s.name, level(s.name)]));
const active = {
  ...Object.fromEntries(cls.activeSkills.filter(s => gate(s.name)).map(s => [s.name, level(s.name)])),
  'Total Spirit': 15,
  'Third Exor Flame': 5,
};
const damage = replay.damage.filter(d => d.source === replay.sessionInfo.aid);

function simulate(skill: string, proc = false) {
  const build = resolveBuild({ preset: { ...imported.model }, atkSkill: skill, skills: { passive, active } }, dataset);
  const calc = solve(build, dataset, dataset.monsters['21077']);
  if (!proc) return calc;
  const boots = calc.chanceList.find(c => c.itemId === 470073);
  expect(boots).toBeDefined();
  return solve(build, dataset, dataset.monsters['21077'], [boots!.name]);
}

describe('Inquisitor buffed weaponless replay — exact status and damage', () => {
  it('retains all 43 recorder-owned packets covered by this validation', () => {
    expect([5244, 5245, 5248, 5252].map(id => damage.filter(d => d.skillId === id).length))
      .toEqual([31, 4, 4, 4]);
  });

  it('keeps sphere mastery out of the Alt+Q ATK while retaining its damage', () => {
    const withSpheres = simulate('First Brand==5').getTotalSummary();
    const build = resolveBuild({
      preset: { ...imported.model }, atkSkill: 'First Brand==5',
      skills: { passive, active: { ...active, 'Total Spirit': 0 } },
    }, dataset);
    const withoutSpheres = solve(build, dataset, dataset.monsters['21077']).getTotalSummary();
    const displayedAtk = (s: typeof withSpheres) => s.calc.totalEquipAtk + s.calc.totalMasteryAtk;
    expect(displayedAtk(withSpheres)).toBe(600);
    expect(displayedAtk(withoutSpheres)).toBe(600);
    expect(withSpheres.calc.totalHideMasteryAtk - withoutSpheres.calc.totalHideMasteryAtk).toBe(45);
    expect(withSpheres.calc.totalHideMasteryAtk).toBe(75); // 45 spheres + 30 Iron Hand.
    expect(withSpheres.dmg.skillMaxDamage).toBe(1456849);
    expect(withoutSpheres.dmg.skillMaxDamage).toBe(1443515);
  });

  it('reproduces the reported Mão Explosiva discrepancy exactly when spheres are zero', () => {
    const build = resolveBuild({
      preset: { ...imported.model }, atkSkill: 'Explosion Blaster==5',
      skills: { passive, active: { ...active, 'Total Spirit': 0 } },
    }, dataset);
    const noSpheres = solve(build, dataset, dataset.monsters['21077']).getTotalSummary();
    expect(noSpheres.dmg.skillMinDamageNoCri).toBe(2067302);
    expect(noSpheres.dmg.skillMaxDamage).toBe(3494556);
    const recorded = simulate('Explosion Blaster==5').getTotalSummary();
    expect(recorded.dmg.skillMinDamageNoCri).toBe(2086581);
    expect(recorded.dmg.skillMaxDamage).toBe(3527256);
  });

  it('reproduces the initial server status window and all six attributes', () => {
    const calc = simulate('Explosion Blaster==5');
    const total = calc.getTotalSummary();
    const status = (calc as any).dmgCalculator.status;
    const recorded = (id: number) => Number(replay.paramChanges.find(p => p.type === id && p.time === 1875)!.value);
    expect(total.calc.maxHp).toBe(recorded(6));
    expect(total.calc.maxSp).toBe(recorded(8));
    expect(total.calc.totalCri).toBe(recorded(52));
    expect(total.calc.totalStatusAtk).toBe(recorded(41));
    expect(total.calc.totalEquipAtk).toBe(recorded(42));
    expect(total.dmg.pAtk).toBe(recorded(225));
    for (const [id, stat] of [[13, 'Str'], [14, 'Agi'], [15, 'Vit'], [16, 'Int'], [17, 'Dex'], [18, 'Luk']] as const) {
      const entry = replay.coupleStatus.find(p => p.statusId === id && p.time === 1875)!;
      expect(status[`total${stat}`]).toBe(entry.base + entry.plus);
    }
  });

  it.each([
    [5244, 'Explosion Blaster==5', 2086581, 3527256],
    [5245, 'First Brand==5', 1456849, 1456849],
    [5248, 'Second Flame==5', 3487137, 3487137],
  ] as const)('reproduces every packet of skill %i exactly', (id, skill, plain, critical) => {
    const summary = simulate(skill).getTotalSummary().dmg;
    const packets = damage.filter(d => d.skillId === id);
    expect(packets.length).toBeGreaterThan(0);
    const min = summary.skillCanCri ? summary.skillMinDamageNoCri : summary.skillMinDamage;
    expect(min).toBe(plain);
    expect(summary.skillMaxDamage).toBe(critical);
    for (const packet of packets) {
      // This server sends skill criticals with rawAction 5 too, so use the
      // two distinct integer outcomes rather than the unreliable hitType.
      expect([min, summary.skillMaxDamage]).toContain(packet.damage);
      expect(packet.skillLevel).toBe(5);
    }
  });

  it('reproduces all four Fogueira packets with the boot proc timeline', () => {
    const base = simulate('Third Flame Bomb==5').getTotalSummary();
    const proc = simulate('Third Flame Bomb==5', true).getTotalSummary();
    expect(base.calc.maxHp).toBe(214791);
    expect(proc.calc.maxHp).toBe(410380);
    expect(base.dmg.skillMaxDamage).toBe(10499184);
    expect(proc.dmg.effectedSkillDamageMax).toBe(19173383);
    const packets = damage.filter(d => d.skillId === 5252);
    expect(packets).toHaveLength(4);
    for (const packet of packets) {
      const procced = (packet.time >= 41190 && packet.time < 51149)
        || (packet.time >= 53185 && packet.time < 63187);
      const perHit = procced ? proc.dmg.effectedSkillDamageMax : base.dmg.skillMaxDamage;
      expect(packet.hits).toBe(3);
      expect(packet.damage).toBe(perHit * packet.hits);
    }
  });
});
