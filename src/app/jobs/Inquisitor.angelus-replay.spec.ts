import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
import { JobBuffs } from 'src/app/constants/job-buffs';
import { Calculator } from 'src/app/core/calculator';
import { CalculatorController } from 'src/app/core/calculator-controller';
import { parseOptionScripts } from 'src/app/core/option-scripts';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { BUFF_EFST } from 'src/app/replay/replay-buffs';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { Inquisitor } from './Inquisitor';

/**
 * `inq-angelus-1-10.rrf` — the Inquisidor of inq-mao-explosiva-crit.rrf, **bare** (every item taken off
 * in the first 16 s, no other buff), receiving Angelus at every level from 1 to 10 in turn. The server
 * reports HP máx. after each cast: 90.061 base, then 90.111, 90.161 … 90.561 — +50 per level, flat.
 * The client text agrees ("HP máx. +50" per level, DEF +5% per level from the VIT part).
 *
 * The engine puts the HP in its flat pool, so the HP% bonuses scale it: with Dragão Ascendente and
 * Chakra do Vigor (+14%) the other recording sees +570, which is 500 x 1,14.
 *
 * Not modelled: the soft DEF the same recording shows rising by floor(VIT x level / 40).
 */

const items = JSON.parse(readFileSync('src/assets/demo/data/item.json', 'utf8'));
const monsters = JSON.parse(readFileSync('src/assets/demo/data/monster.json', 'utf8'));
const hpSpTable = JSON.parse(readFileSync('src/assets/demo/data/hp_sp_table.json', 'utf8'));

const replay: any = decodeReplay(loadReplayFixture('inq-angelus-1-10.rrf'));
const aid = replay.sessionInfo.aid;
const ANGELUS_SKILL = 33;
const BARE_AT = 17_000;

function modelBare() {
  const inv = new Map<number, any>([...(replay.initialInventory ?? [])].map(([k, r]: any) => [k, { ...r, cards: [...r.cards] }]));
  for (const e of replay.equipChanges ?? []) {
    if (e.time > BARE_AT) break;
    const rec = inv.get(e.slot) ?? { slot: e.slot, qty: 1, options: [] };
    inv.set(e.slot, { ...rec, itemId: e.itemId, equipped: e.equipped ? e.location : 0 });
  }
  return replayToModel({ ...replay, initialInventory: inv }, items).model as any;
}

function maxHp(angelusLevel: number): number {
  const m = modelBare();
  const cls: any = new Inquisitor();
  const b = cls.getJobBonusStatus(m.jobLevel);
  Object.assign(m, {
    jobStr: b.str, jobAgi: b.agi, jobVit: b.vit, jobInt: b.int, jobDex: b.dex, jobLuk: b.luk,
    jobPow: b.pow, jobSta: b.sta, jobWis: b.wis, jobSpl: b.spl, jobCon: b.con, jobCrt: b.crt,
  }, { pow: 100, sta: 0, wis: 0, spl: 0, con: 43, crt: 0 });
  const learned: Record<number, number> = {};
  for (const [id, lv] of replay.learnedSkills) learned[id] = lv;
  const passiveIds = cls.passiveSkills.map((p: any) => { const id = SKILL_ID_BY_NAME[p.name]; return id ? learned[id] ?? 0 : 0; });
  const { equipAtks, masteryAtks, activeSkillNames, learnedSkillMap } = cls
    .setLearnSkills({ activeSkillIds: cls.activeSkills.map(() => 0), passiveSkillIds: passiveIds }).getSkillBonusAndName();
  const buffEquips: Record<string, any> = {};
  const def = JobBuffs.find((d) => d.name === 'Angelus')!;
  if (angelusLevel) buffEquips['Angelus'] = def.dropdown.find((d: any) => d.value === angelusLevel)!.bonus;
  m.selectedAtkSkill = 'Explosion Blaster==5';
  const calc = new Calculator().setMasterItems(items).setHpSpTable(hpSpTable).setClass(cls);
  calc.loadItemFromModel(m);
  new CalculatorController().runChain(calc, {
    monster: monsters['21077'], equipAtks, masteryAtks, buffEquips, buffMasterys: {}, consumeData: [], aspdPotion: undefined,
    extraOptionScripts: parseOptionScripts((m.rawOptionTxts ?? []).filter(Boolean)),
    activeSkillNames, learnedSkillMap, selectedAtkSkill: 'Explosion Blaster==5', selectedChances: [], usedHpL: false,
  } as any);
  return (calc.getTotalSummary() as any).calc.maxHp as number;
}

/** HP máx. the server reported right after each Angelus cast, by level. */
function recordedHp(level: number): number {
  const casts = (replay.skillUses ?? []).filter((s: any) => s.source === aid && s.skillId === ANGELUS_SKILL);
  const cast = casts.find((s: any) => s.skillLevel === level);
  const after = (replay.paramChanges ?? []).filter((p: any) => p.type === 6 && p.time >= cast.time && p.time < cast.time + 500);
  return Number(after[after.length - 1].value);
}

describe('Angelus — HP máx. de 1 a 10, no Inquisidor sem equipamento', () => {
  it('imports the EFST 9 as an Angelus buff', () => {
    expect(BUFF_EFST[9].name).toBe('Angelus');
  });

  it('adds +50 HP per level, exactly as the server reports', () => {
    const base = maxHp(0);
    // Preserve the observed pre-VIT HP (39.157), without truncating its
    // normalization by 1.25 on import (docs/hp-sp.md).
    expect(base).toBe(90_061);
    for (let level = 1; level <= 10; level++) {
      expect(maxHp(level), `Nv ${level}`).toBe(recordedHp(level));
    }
  });
});
