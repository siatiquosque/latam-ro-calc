import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
import { JobBuffs } from 'src/app/constants/job-buffs';
import { Calculator } from 'src/app/core/calculator';
import { CalculatorController } from 'src/app/core/calculator-controller';
import { parseOptionScripts } from 'src/app/core/option-scripts';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { Inquisitor } from './Inquisitor';

/**
 * `inq-mao-explosiva-crit.rrf` — Inquisidor 236/50 (nick, AID and the other players seen scrubbed) on tra_fild, 31/10/2026,
 * recorded **after** the 28/10/2026 patch, so it is the first post-patch measurement of
 * this class. Traits come from the file itself (POD 100, CON 43).
 *
 * The recorder starts with no equipment at all, which makes the first windows the best
 * kind of evidence: no weapon roll, so every hit of a skill prints the same number.
 * Then it buffs up (Mantra da Força 137 s; Dragão Ascendente + Fúria Interior 185 s; Chakra do
 * Vigor Nv2 247 s), equips the full set (417–442 s) and, at 502 s, swaps to a critical build.
 * All packets are on the same dummy (21077). Levels: Mão Explosiva, Estigma, Chamas Secundárias
 * and Fogueira Espiritual all Nv5, Bênção 10, Aumentar Agilidade 10.
 *
 * What the file settled:
 *
 *  - The **`current` formulas** (the 02/06/2022 rebalance, now the LATAM baseline) fit all four
 *    skills; `pre-rebalance` is off by a factor of ~3 on the same packets. This is the first
 *    packet-level confirmation of the 28/10/2026 patch.
 *  - **Técnica da Mão Explosiva crits.** The client says so ("Tem chance do ataque ser crítico.
 *    A chance é igual ao CRIT do usuário") and so does the server: the same hit prints
 *    949.704 or 1.348.579, exactly x1,42. The 2022 patch had it as `canCri: false`, which made
 *    the engine 3,2x low on the critical build (36,4M per hit against 11,3M).
 *  - **Mantra da Força Nv5 is +30 ATQ**, not +35: the client table is 5 + 5/level and the status
 *    window reads ATQ Equip. 30 with nothing else on.
 *
 *  - **The 0,15% left on the bare-handed windows was FOR.** ZC_COUPLESTATUS reads FOR 120 +10 at
 *    job level 50; the job table said +9. One point of FOR is one point of Status ATQ, which is
 *    two ATQ after the doubling (engine 779, window 780). Rows 50 and up now say 10; the rows
 *    below 50 have no measurement and are left alone.
 *  - **Fogueira Espiritual prints 186–191M at 487–491 s**, 1,8x the 102–106M of the same state a
 *    few seconds earlier, because HP máx. went from 222.200 to 421.313 for ten seconds (the ratio
 *    carries 20% of it). That is the Bota Desconhecida VIT's refine +11 proc: VIT +225 for 10 s
 *    (175 + 25 Grau D + 25 Grau C). The engine already offers it as a chance; with it selected
 *    Fogueira lands on the recorded packet.
 *  - Bare-handed states match the measured packets; the final critical build
 *    has an exact check below.
 *    Remaining geared/range comparisons allow 0,02%; passing them is not proof
 *    that every integer or every equipment state is exact.
 */

const items = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const monsters = JSON.parse(readFileSync('src/assets/demo/data/monster.json', 'utf8'));
const hpSpTable = JSON.parse(readFileSync('src/assets/demo/data/hp_sp_table.json', 'utf8'));

const replay: any = decodeReplay(loadReplayFixture('inq-mao-explosiva-crit.rrf'));
const aid = replay.sessionInfo.aid;
const DUMMY = '21077';

const BLASTER = 5244, BRAND = 5245, FLAME = 5248, BOMB = 5252;
const SKILLS: Record<number, string> = {
  [BLASTER]: 'Explosion Blaster==5', [BRAND]: 'First Brand==5', [FLAME]: 'Second Flame==5', [BOMB]: 'Third Flame Bomb==5',
};

/** The build as it stood at `untilMs`: the initial snapshot with the equip events folded on. */
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

const MANTRA = { 'Powerful Faith': 5 };
const DRAGON = { ...MANTRA, 'Rising Dragon': 10, 'Vigor Explosion': 5 };
const GEARED = { ...DRAGON, 'Gentle Touch - Alive': 2 };
const PARTY = { Clementia: 10, Cantocandidus: 10 };

function sim(t: number, skill: string, actives: Record<string, number>, spheres: number, buffs: Record<string, number> = {}, chances: string[] = []) {
  const m = modelAt(t);
  const cls: any = new Inquisitor();
  const b = cls.getJobBonusStatus(m.jobLevel);
  Object.assign(m, {
    jobStr: b.str, jobAgi: b.agi, jobVit: b.vit, jobInt: b.int, jobDex: b.dex, jobLuk: b.luk,
    jobPow: b.pow, jobSta: b.sta, jobWis: b.wis, jobSpl: b.spl, jobCon: b.con, jobCrt: b.crt,
  });
  const learned: Record<number, number> = {};
  for (const [id, lv] of replay.learnedSkills) learned[id] = lv;
  const passiveIds = cls.passiveSkills.map((p: any) => { const id = SKILL_ID_BY_NAME[p.name]; return id ? learned[id] ?? 0 : 0; });
  const on: Record<string, number> = { ...actives, 'Total Spirit': spheres };
  const activeIds = cls.activeSkills.map((a: any) => on[a.name] ?? 0);
  const { equipAtks, masteryAtks, activeSkillNames, learnedSkillMap } = cls
    .setLearnSkills({ activeSkillIds: activeIds, passiveSkillIds: passiveIds }).getSkillBonusAndName();
  const buffEquips: Record<string, any> = {};
  const buffMasterys: Record<string, any> = {};
  for (const def of JobBuffs) {
    const v = buffs[def.name];
    if (!v) continue;
    (def.isMasteryAtk ? buffMasterys : buffEquips)[def.name] = def.dropdown.find((d: any) => d.value === v)!.bonus;
  }
  m.selectedAtkSkill = skill;
  const calc = new Calculator().setMasterItems(items).setHpSpTable(hpSpTable).setClass(cls);
  calc.loadItemFromModel(m);
  new CalculatorController().runChain(calc, {
    monster: monsters[DUMMY], equipAtks, masteryAtks, buffEquips, buffMasterys, consumeData: [], aspdPotion: undefined,
    extraOptionScripts: parseOptionScripts((m.rawOptionTxts ?? []).filter(Boolean)),
    activeSkillNames, learnedSkillMap, selectedAtkSkill: skill, selectedChances: chances, usedHpL: false,
  } as any);
  const ds: any = (calc as any).damageSummary;
  const tot: any = calc.getTotalSummary();
  return {
    canCri: ds.skillCanCri as boolean, hits: ds.skillTotalHit as number,
    max: ds.skillMaxDamage as number,
    effMin: ds.effectedSkillDamageMin as number, effMax: ds.effectedSkillDamageMax as number,
    ncMin: ds.skillMinDamageNoCri as number, ncMax: ds.skillMaxDamageNoCri as number,
    atkEquip: ((tot.weapon?.baseWeaponAtk ?? 0) + (tot.weapon?.refineBonus ?? 0) + tot.calc.totalEquipAtk) as number,
  };
}

/** Distinct damage values the recorder dealt with one skill inside a time window. */
function packets(skillId: number, from: number, to: number): number[] {
  return [...new Set<number>((replay.damage ?? [])
    .filter((d: any) => d.source === aid && d.skillId === skillId && d.time >= from && d.time < to)
    .map((d: any) => d.damage))].sort((x, y) => x - y);
}

/** Tolerance for comparisons that are not asserted to the exact integer below. */
const TOLERANCE = 0.0002;
const near = (simulated: number, server: number) => expect(Math.abs(simulated / server - 1)).toBeLessThan(TOLERANCE);

describe('Inquisidor — Mão Explosiva, Estigma, Chamas Secundárias e Fogueira, da gravação nua à build crítica', () => {
  it('has the Mantra da Força Nv5 at +30 ATQ, as the status window reads', () => {
    expect(sim(137_000, SKILLS[BRAND], MANTRA, 0).atkEquip).toBe(30);
  });

  it('bare-handed with Mantra: each skill equals its recorded packet, and Mão Explosiva crits', () => {
    const [from, to] = [137_000, 184_600];
    const blaster = sim(from, SKILLS[BLASTER], MANTRA, 0);
    expect(blaster.canCri).toBe(true);
    const [plain, crit] = packets(BLASTER, from, to);
    near(blaster.ncMax, plain);
    near(blaster.max, crit);
    // The server's critical is exactly x1,42; the engine reproduces the ratio.
    expect(blaster.max / blaster.ncMax).toBeCloseTo(crit / plain, 3);

    near(sim(from, SKILLS[BRAND], MANTRA, 0).max, packets(BRAND, from, to)[0]);
    near(sim(from, SKILLS[FLAME], MANTRA, 0).max, packets(FLAME, from, to)[0]);
    near(sim(from, SKILLS[BOMB], MANTRA, 0).max, packets(BOMB, from, to)[0]);
  });

  it('with Dragão Ascendente and 15 spheres, Fogueira hits three times on the new HP máx.', () => {
    const [from, to] = [184_700, 247_300];
    const bomb = sim(from, SKILLS[BOMB], DRAGON, 15);
    expect(bomb.hits).toBe(3);
    near(bomb.max * 3, packets(BOMB, from, to)[0]);
    near(sim(from, SKILLS[BRAND], DRAGON, 15).max, packets(BRAND, from, to)[0]);
  });

  it('geared, the critical Mão Explosiva lands on the recorded value and plain hits inside the roll', () => {
    const [from, to] = [452_000, 484_000];
    const r = sim(from, SKILLS[BLASTER], GEARED, 15, PARTY);
    const found = packets(BLASTER, from, to);
    const crit = found[found.length - 1];
    near(r.max, crit);
    for (const plain of found.slice(0, -1)) {
      expect(plain).toBeGreaterThanOrEqual(r.ncMin * (1 - TOLERANCE));
      expect(plain).toBeLessThanOrEqual(r.ncMax * (1 + TOLERANCE));
    }
  });

  it('the VIT boots proc (VIT +225, HP máx. 421.313) is what made Fogueira print 186–191M', () => {
    const boots = 'Unknown Vitality Boots [1]';
    const without = sim(486_000, SKILLS[BOMB], GEARED, 15, PARTY);
    const withProc = sim(486_000, SKILLS[BOMB], GEARED, 15, PARTY, [boots]);
    const [low, high] = packets(BOMB, 486_000, 492_000);
    // Three hits per packet; the weapon roll puts both packets inside the effected range.
    expect(without.effMax * 3).toBeLessThan(low);
    expect(low).toBeGreaterThanOrEqual(withProc.effMin * 3 * (1 - TOLERANCE));
    expect(high).toBeLessThanOrEqual(withProc.effMax * 3 * (1 + TOLERANCE));
  });

  it("the critical build's 36,4M per hit is the critical, not a missing multiplier", () => {
    const r = sim(503_000, SKILLS[BLASTER], GEARED, 15, PARTY);
    // The full-ignore shadow set also removes soft DEF; the former 82-point
    // residual was 50 soft DEF amplified by the critical multiplier.
    expect(r.max).toBe(packets(BLASTER, 503_000, 520_000)[0]);
  });
});
