import { decodeReplay } from 'rrfparser';
import { describe, expect, it } from 'vitest';
import { Cardinal } from 'src/app/jobs/Cardinal';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { resolveBuild } from './build-input';
import { solve } from './solve';

/**
 * Cardeal 235/50 naked, Fidus Animus 10, SPL 100 / CON 40 — LATAM 03/11/2026, `current` formulas.
 * The two recordings carry no initial status packets, so the stats are fixed here (they came from an
 * earlier recording of the same character, whose Adoramus/Arbitrium packets are identical to these).
 *
 * What the packets established:
 * - Fidus Animus' "dano mágico Sagrado" scales the ATQM, ahead of the skill ratio (`matk_element_holy`),
 *   not the `m_my_element_*` stage after it: that ordering missed every holy packet by 0.065%.
 * - The target's element table (Holy vs Undead 1 = ×1.25, Neutral vs Ghost 1 = ×0.9) lands after the soft
 *   MDEF is taken off; only the debuff/amplifier part stays on the ATQM.
 * - Race changes nothing: Demônio, Anjo and Morto-Vivo dummies return the same Arbitrium packets.
 */
const dataset = loadDatasetFromDisk();
const preset = {
  skillFormulaVersion: 'current', class: 4256, level: 235, jobLevel: 50, sex: 1,
  str: 1, agi: 120, vit: 120, int: 120, dex: 12, luk: 113, spl: 100, con: 40,
};
const adoramus = decodeReplay(loadReplayFixture('cd-adoramus-judex-dummies.rrf'));
const arbitrium = decodeReplay(loadReplayFixture('cd-arbitrium-dummies.rrf'));
const cardinal = new Cardinal();
const learned = new Map(adoramus.learnedSkills);
const passive = Object.fromEntries(cardinal.passiveSkills.map(s => [s.name, learned.get(SKILL_ID_BY_NAME[s.name]) ?? 0]));

const simulate = (skill: string, monsterId: number) => {
  const build = resolveBuild({ preset: { ...preset }, atkSkill: skill, skills: { passive, active: {} } }, dataset);
  return solve(build, dataset, dataset.monsters[String(monsterId)]).getTotalSummary().dmg;
};
const packets = (replay: typeof adoramus, skillId: number) => replay.damage
  .filter(d => d.source === replay.sessionInfo.aid && d.skillId === skillId && d.damage > 0)
  .map(d => ({ view: replay.entities.get(d.target)!.view, damage: d.damage }));

describe('Cardinal holy damage — Adoramus, Judex and Arbitrium replays, exact', () => {
  it('Judex Lv10 and Adoramus Lv10 holy on the Ghost dummy', () => {
    expect(packets(adoramus, 2038).map(p => p.damage)).toEqual(Array(4).fill(32544));
    expect(simulate('Judex==10', 21085).skillMinDamage).toBe(32544);
    expect(simulate('Adoramus==10', 21085).skillMinDamage).toBe(91170);
  });

  it('Adoramus holy follows the element table of each dummy', () => {
    const seen = packets(adoramus, 2040).filter(p => p.view === 21086);
    expect(seen.map(p => p.damage)).toEqual([113960, 113960, 113960]);
    expect(simulate('Adoramus==10', 21086).skillMinDamage).toBe(113960);
  });

  it('Adoramus In Ancilla turns Neutral: no Fidus bonus, Neutral vs Ghost 1 = ×0.9', () => {
    const ghost = packets(adoramus, 2040).filter(p => p.view === 21085).map(p => p.damage);
    expect(ghost).toEqual([91170, 91170, 91170, 71390, 71390, 71390]);
    expect(simulate('[Improved] Adoramus Ancilla==10', 21085).skillMinDamage).toBe(71390);
  });

  it.each([
    [21085, 382871, 464298], // Ghost 1 — also Fantasma/Demônio/Anjo/Morto-Vivo races, all identical
    [21073, 382871, 464298],
    [21075, 382871, 464298],
    [21076, 382871, 464298],
    [21086, 478588, 580372], // Undead 1: Holy ×1.25
    [21084, 478588, 580372], // Dark 1: Holy ×1.25
  ])('Arbitrium Lv10 on dummy %i reproduces both packets', (view, first, second) => {
    expect(packets(arbitrium, 5273).filter(p => p.view === view).map(p => p.damage)).toEqual(Array(3).fill(first));
    expect(packets(arbitrium, 5274).filter(p => p.view === view).map(p => p.damage)).toEqual(Array(3).fill(second));
    const dmg = simulate('Arbitrium==10', view);
    expect(dmg.skillMinDamage).toBe(first);
    expect(dmg.skillMinDamage2).toBe(second);
  });
});
