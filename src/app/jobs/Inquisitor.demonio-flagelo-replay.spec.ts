import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
import { Calculator } from 'src/app/core/calculator';
import { CalculatorController } from 'src/app/core/calculator-controller';
import { parseOptionScripts } from 'src/app/core/option-scripts';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { Inquisitor } from './Inquisitor';

/**
 * `inq-demonio-flagelo.rrf` — the same Inquisidor 236/50 as inq-mao-explosiva-crit.rrf (nick and AID
 * scrubbed), with no buffs at all and only a weapon on: Garra Primordial-LT +11 for the first 25 s,
 * then a Maça do Éden III with cards. Técnica da Mão Explosiva Nv5 on the Humano and on the Demônio
 * dummy with each weapon. The file carries no traits (single map), so they are typed in.
 *
 * What it settled: **Flagelo do Mal is not +3 per level.** The Humano packets reproduce to the unit
 * with either weapon, and the Demônio is +5,4% over it with the mace and +6,4% with the knuckle —
 * about +148 ATQ, which is level x (base level / 20 + 3) = 10 x 14,8, the rAthena formula,
 * against the client table's +30. It holds with both weapons, so Caminhos da Fé Lv6 ("apenas com
 * Soqueira") is not what the Inquisidor spec had been blaming for the Demônio's 4–6%.
 */

const items = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const monsters = JSON.parse(readFileSync('src/assets/demo/data/monster.json', 'utf8'));
const hpSpTable = JSON.parse(readFileSync('src/assets/demo/data/hp_sp_table.json', 'utf8'));

const replay: any = decodeReplay(loadReplayFixture('inq-demonio-flagelo.rrf'));
const aid = replay.sessionInfo.aid;
const BLASTER = 5244;
const HUMAN = '21070';
const DEMON = '21073';
/** The weapon changes at 25,6 s: Garra Primordial-LT before, Maça do Éden III after. */
const KNUCKLE = { at: 10_000, from: 0, to: 25_000 };
const MACE = { at: 30_000, from: 26_000, to: 45_000 };

const mobView = new Map<number, string>();
for (const e of replay.entities.values()) if (e.kind === 'mob') mobView.set(e.aid, String(e.view));

function modelAt(untilMs: number) {
  const inv = new Map<number, any>([...(replay.initialInventory ?? [])].map(([k, r]: any) => [k, { ...r, cards: [...r.cards] }]));
  for (const e of replay.equipChanges ?? []) {
    if (e.time > untilMs) break;
    const rec = inv.get(e.slot) ?? { slot: e.slot, qty: 1, options: [] };
    inv.set(e.slot, {
      ...rec, itemId: e.itemId, refine: e.refine, grade: e.grade, cards: [...(e.cards ?? [])],
      options: e.options?.length ? e.options : rec.options ?? [], equipped: e.equipped ? e.location : 0,
    });
  }
  return replayToModel({ ...replay, initialInventory: inv }, items).model as any;
}

function crit(weapon: { at: number }, dummy: string, passiveOverride: Record<string, number> = {}): number {
  const m = modelAt(weapon.at);
  const cls: any = new Inquisitor();
  const b = cls.getJobBonusStatus(m.jobLevel);
  Object.assign(m, {
    jobStr: b.str, jobAgi: b.agi, jobVit: b.vit, jobInt: b.int, jobDex: b.dex, jobLuk: b.luk,
    jobPow: b.pow, jobSta: b.sta, jobWis: b.wis, jobSpl: b.spl, jobCon: b.con, jobCrt: b.crt,
  }, { pow: 100, sta: 0, wis: 0, spl: 0, con: 43, crt: 0 });
  const learned: Record<number, number> = {};
  for (const [id, lv] of replay.learnedSkills) learned[id] = lv;
  const passiveIds = cls.passiveSkills.map((p: any) => {
    if (p.name in passiveOverride) return passiveOverride[p.name];
    const id = SKILL_ID_BY_NAME[p.name];
    return id ? learned[id] ?? 0 : 0;
  });
  const { equipAtks, masteryAtks, activeSkillNames, learnedSkillMap } = cls
    .setLearnSkills({ activeSkillIds: cls.activeSkills.map(() => 0), passiveSkillIds: passiveIds }).getSkillBonusAndName();
  m.selectedAtkSkill = 'Explosion Blaster==5';
  const calc = new Calculator().setMasterItems(items).setHpSpTable(hpSpTable).setClass(cls);
  calc.loadItemFromModel(m);
  new CalculatorController().runChain(calc, {
    monster: monsters[dummy], equipAtks, masteryAtks, buffEquips: {}, buffMasterys: {}, consumeData: [], aspdPotion: undefined,
    extraOptionScripts: parseOptionScripts((m.rawOptionTxts ?? []).filter(Boolean)),
    activeSkillNames, learnedSkillMap, selectedAtkSkill: 'Explosion Blaster==5', selectedChances: [], usedHpL: false,
  } as any);
  return (calc as any).damageSummary.skillMaxDamage as number;
}

/** The critical is the largest value the recorder hit that dummy with inside the window. */
function recordedCrit(weapon: { from: number; to: number }, dummy: string): number {
  return Math.max(...(replay.damage ?? [])
    .filter((d: any) => d.source === aid && d.skillId === BLASTER && mobView.get(d.target) === dummy && d.time >= weapon.from && d.time < weapon.to)
    .map((d: any) => d.damage as number));
}

describe('Inquisidor — Flagelo do Mal contra o Demônio, com a Garra e com a Maça', () => {
  // A critical uses the weapon's maximum ATQ, so it is one number: the engine reproduces all four
  // to the unit (2.653.075 / 2.823.687 with the knuckle, 1.426.648 / 1.504.193 with the mace).
  it('reproduces the critical on the Humano dummy with both weapons, to the unit', () => {
    expect(crit(KNUCKLE, HUMAN)).toBe(recordedCrit(KNUCKLE, HUMAN));
    expect(crit(MACE, HUMAN)).toBe(recordedCrit(MACE, HUMAN));
  });

  it('reproduces the critical on the Demônio dummy with both weapons, to the unit', () => {
    expect(crit(KNUCKLE, DEMON)).toBe(recordedCrit(KNUCKLE, DEMON));
    expect(crit(MACE, DEMON)).toBe(recordedCrit(MACE, DEMON));
  });

  it('keeps the Demônio over the Humano by the recorded margin, with the mace too', () => {
    const margin = (w: typeof KNUCKLE) => crit(w, DEMON) / crit(w, HUMAN);
    const recorded = (w: typeof KNUCKLE) => recordedCrit(w, DEMON) / recordedCrit(w, HUMAN);
    expect(margin(KNUCKLE)).toBeCloseTo(recorded(KNUCKLE), 3);
    expect(margin(MACE)).toBeCloseTo(recorded(MACE), 3);
    expect(recorded(MACE)).toBeGreaterThan(1.05);
  });

  it('is the passive that makes the difference: Lv0 falls well short on the Demônio', () => {
    expect(crit(MACE, DEMON, { 'Demon Bane': 0 })).toBeLessThan(recordedCrit(MACE, DEMON) * 0.96);
  });
});
