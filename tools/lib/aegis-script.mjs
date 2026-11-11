// Evaluator for the client's equip script (RagnarokDB `aegisScript`, `event OnStartEquip:`).
//
// Reads the script the way the client does — variables, if/elseif/else, integer maths, the refine
// and grade of the worn piece, and the context the script may ask for (partner piece, base stats,
// level, skills, job, weapon class) — and reports what it grants as [key, value] pairs in the
// calculator's own key vocabulary. Calls the calculator has no key for come back as `extra`
// ({ fn, statics, nums }) so tools/build-item-script-extra.mjs can store them.
//
// Pure: no file access. Skill ids for AddDamage_SKID are given through setSkillIds().
// Method and sources: docs/script-audit.md.

let skillIds = {};
export const setSkillIds = (map) => {
  skillIds = map;
};

const VAR = { ATTPOWER: 'atk', ATTMPOWER: 'matk', PATKAMOUNT: 'pAtk', SMATKAMOUNT: 'sMatk', ATKPERCENT: 'atkPercent', MAGICATKPERCENT: 'matkPercent', MAXHPAMOUNT: 'hp', MAXHPPERCENT: 'hpPercent', MAXSPAMOUNT: 'sp', MAXSPPERCENT: 'spPercent', CRITICALSUCCESSVALUE: 'cri', PLUSASPDPERCENT: 'aspdPercent', PLUSASPD: 'aspd', HITSUCCESSVALUE: 'hit', AVOIDSUCCESSVALUE: 'flee', STRAMOUNT: 'str', AGIAMOUNT: 'agi', VITAMOUNT: 'vit', INTAMOUNT: 'int', DEXAMOUNT: 'dex', LUKAMOUNT: 'luk', POWAMOUNT: 'pow', STAAMOUNT: 'sta', WISAMOUNT: 'wis', SPLAMOUNT: 'spl', CONAMOUNT: 'con', CRTAMOUNT: 'crt', RESAMOUNT: 'res', MRESAMOUNT: 'mres', HEAL_PLUS: 'hPlus', CRITICAL_RATE: 'cRate' };
const IGNORE_VAR = new Set(['ITEMDEFPOWER', 'MDEFPOWER', 'HP', 'SP', 'JOB', 'CLEVEL', 'JOBLEVEL', 'SPACCELERATION', 'HPACCELERATION', 'PLUSAVOIDSUCCESSVALUE']);
const RACE = { Nothing: 'formless', Animal: 'brute', HumanPlayer: 'player_human', DoramPlayer: 'player_doram', Formless: 'formless', Undead: 'undead', Brute: 'brute', Plant: 'plant', Insect: 'insect', Fish: 'fish', Demon: 'demon', Human: 'demihuman', Demihuman: 'demihuman', Angel: 'angel', Dragon: 'dragon', All: 'all' };
const ELEM = { Darkness: 'dark', Nothing: 'neutral', Saint: 'holy', Ground: 'earth', Telekinesis: 'ghost' };
const ELE = (p) => { const n = p.replace('PROPERTY_', ''); return ELEM[n] ?? n.toLowerCase(); };
const fold = (o) => { const r = { ...o }; for (const pre of ['p_size_', 'm_size_']) { const ks = ['s', 'm', 'l'].map((x) => pre + x); if (ks.every((k) => k in r) && ks.every((k) => r[k] === r[ks[0]])) { r[pre + 'all'] = (r[pre + 'all'] ?? 0) + r[ks[0]]; ks.forEach((k) => delete r[k]); } } for (const pre of ['p_race_', 'm_race_', 'subrace_', 'p_pene_race_', 'm_pene_race_']) { const rs = ['formless', 'undead', 'brute', 'plant', 'insect', 'fish', 'demon', 'demihuman', 'angel', 'dragon'].map((x) => pre + x); if (rs.every((k) => k in r) && rs.every((k) => r[k] === r[rs[0]])) { r[pre + 'all'] = (r[pre + 'all'] ?? 0) + r[rs[0]]; rs.forEach((k) => delete r[k]); } } for (const pre of ['m_my_element_', 'p_element_', 'm_element_', 'subele_']) { /* all-element fold */ const els = ['neutral', 'water', 'earth', 'fire', 'wind', 'poison', 'holy', 'dark', 'ghost', 'undead'].map((x) => pre + x); if (els.every((k) => k in r) && els.every((k) => r[k] === r[els[0]])) { r[pre + 'all'] = (r[pre + 'all'] ?? 0) + r[els[0]]; els.forEach((k) => delete r[k]); } } return r; };
const SIZE = { Small: 's', Medium: 'm', Large: 'l' };
const IGNORABLE = new Set(['ShowEffect', 'Condition', 'SetAutoSpell2', 'SetAutoSpell2_MLEATKED', 'SetAutoSpell', 'SetAutoWeapon', 'AddState_MLEATK', 'AddState_RANGEATK', 'AddState_MLEAttacked', 'EnableSkill', 'AddParamTime', 'SetEquipTempValue', 'SubSFCTEquipAmount', 'AddHealValue', 'AddStateTolerace', 'SetBuff', 'AddGuideAttack', 'AddEXPPercent_KillRace', 'AddGetItem_Kill', 'AddDamage_Name', 'AddMDamage_Name', 'SubDamage_Name', 'SubMDamage_Name', 'AddSkillSP', 'SubSkillDelay', 'SubSPconsumption', 'AddSPconsumption', 'AddHealPercent_ITEM', 'return', 'SubSkillSP']);

class Unsup extends Error {}
function tok(s) { s = s.replace(/\bthen\s*$/i, '').replace(/\band\b/gi, '&').replace(/\bor\b/gi, '|').replace(/\bnot\b/gi, '!'); const t = []; const re = /\s+|get\s*\[[^\]]*\]|"[^"]*"|[A-Za-z_]\w*(?:'\w+)+|\[[^\]]*\]|\d+\.\d+|\d+|\w+|=>|=<|<=|>=|==|!=|[-+*\/%<>=!&|(),]/gy; let m; while (re.lastIndex < s.length && (m = re.exec(s))) { if (!/^\s/.test(m[0])) t.push(m[0]); } if (re.lastIndex < s.length) throw new Unsup('tok:' + s.slice(re.lastIndex, re.lastIndex + 12)); return t; }
function expr(toks, env, vars, start = 0, partial = false) {
  let p = start;
  const peek = () => toks[p], next = () => toks[p++];
  function prim() {
    const t = next(); if (t === undefined) throw new Unsup('eof');
    if (t === '(') { const v = or(); if (next() !== ')') throw new Unsup('paren'); return v; }
    if (t === '-') return -prim();
    if (t === '!') return prim() ? 0 : 1;
    if (/^\d/.test(t)) return Number(t);
    if (t === 'GetRefineLevel' || t === 'GetEquipGradeLevel') { const loc = next(); const mm = /^\[\s*(\w+)\s*\]$/.exec(loc ?? ''); if (!mm) throw new Unsup(t + loc); const L = mm[1] === 'GetLocation' || mm[1] === 'LOCATION_' + env.self ? null : mm[1]; if (L === null) return t === 'GetRefineLevel' ? env.r : env.g; env.used.add(L); const c = env.comp?.[L] ?? { r: 0, g: 0 }; return t === 'GetRefineLevel' ? c.r : c.g; }
    if (/^get\s*\[/.test(t)) { const v = t.replace(/^get\s*\[/, '').slice(0, -1).trim(); env.used.add(v); const c = env.ctx ?? {}; if (v === 'VAR_CLEVEL') return c.level ?? 200; if (v === 'VAR_JOBLEVEL') return c.jobLevel ?? 60; if (v === 'VAR_JOB') return c.job ?? 'NONE'; const sm = /^VAR_STANDARD_(\w+)$/.exec(v); if (sm) return c.stat?.[sm[1]] ?? 1; throw new Unsup('get:' + v); }
    if (t === 'GetSkillLevel') { const a = next(); env.used.add('skill:' + a); return env.ctx?.skill?.[a.replace(/[\[\]\s]/g, '')] ?? 0; }
    if (t === 'IsPremiumPcCafe') { env.used.add('premium'); return env.ctx?.premium ?? 0; }
    if (t === 'GetPureJob') { env.used.add('job'); return env.ctx?.job ?? 'NONE'; }
    if (/^"/.test(t)) return t;
    if (t === 'GetPetRelationship') { env.used.add('pet'); return env.ctx?.pet ?? 0; }
    if (t === 'GetMapName') { env.used.add('map'); return 'NONE'; }
    if (t === 'GetWeaponClass') { next(); env.used.add('wclass'); return env.ctx?.wclass ?? 'NONE'; }
    if (t === 'GetEquipWeaponLv') { next(); env.used.add('wlv'); return env.ctx?.wlv ?? 1; }
    if (t === 'GetEquipArmorLv') { next(); env.used.add('alv'); return env.ctx?.alv ?? 1; }
    if (/^[a-z]\w*$/.test(t) && !(t in vars) && t !== 'get') return 0;
    if (t === 'GetEquipTempValue') { next(); return env.temp?.[0] ?? 0; }
    if (/^[A-Z][A-Z0-9_]+$/.test(t) && !(t in vars)) return t;
    if (t in vars) return vars[t];
    throw new Unsup('id:' + t);
  }
  function mul() { let v = prim(); while (['*', '/', '%'].includes(peek())) { const o = next(), b = prim(); v = o === '*' ? v * b : o === '/' ? Math.trunc(v / b) : v % b; } return v; }
  function add() { let v = mul(); while (['+', '-'].includes(peek())) { const o = next(), b = mul(); v = o === '+' ? v + b : v - b; } return v; }
  function cmp() { let v = add(); while (['>', '<', '>=', '=>', '<=', '=<', '==', '!='].includes(peek())) { const o = next(), b = add(); v = +(o === '>' ? v > b : o === '<' ? v < b : o === '>=' || o === '=>' ? v >= b : o === '<=' || o === '=<' ? v <= b : o === '==' ? v === b : v !== b); } return v; }
  function and() { let v = cmp(); while (peek() === '&') { next(); const b = cmp(); v = +(v && b); } return v; }
  function or() { let v = and(); while (peek() === '|') { next(); const b = and(); v = +(v || b); } return v; }
  const v = or(); if (partial) return [v, p]; if (p < toks.length) throw new Unsup('trail:' + toks[p]); return v;
}

export function evalAegis(text, env) {
  const body = text.split(/^event OnFinishEquip/m)[0].split(/^event OnStartEquip:/m)[1];
  if (body === undefined) throw new Unsup('noEquipEvent');
  const lines = body.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
  const bon = []; const unmapped = new Set(); const vars = {};
  const stack = []; // {taken, active}
  const on = () => stack.every((s) => s.active);
  for (const l of lines) {
    const w = l.split(/\s+/)[0];
    if (w === 'return') break;
    if (w === 'if') { const c = on() ? expr(tok(l.slice(2)), env, vars) : 0; stack.push({ taken: !!c, active: !!c, parent: on() }); continue; }
    if (w === 'elseif') { const s = stack[stack.length - 1]; const par = stack.slice(0, -1).every((x) => x.active); if (s.taken || !par) { s.active = false; } else { const c = expr(tok(l.slice(6)), env, vars); s.active = !!c; s.taken = !!c; } continue; }
    if (w === 'else') { const s = stack[stack.length - 1]; const par = stack.slice(0, -1).every((x) => x.active); s.active = par && !s.taken; s.taken = true; continue; }
    if (w === 'endif') { stack.pop(); continue; }
    if (!on()) continue;
    if (w === 'var') { const mm0 = /^var\s+(\w+(?:\s*,\s*\w+)+)\s*=\s*(.*)$/.exec(l); if (mm0) { const ns = mm0[1].split(',').map((x) => x.trim()), vs = mm0[2].split(','); ns.forEach((n, i) => { vars[n] = vs.length === ns.length ? expr(tok(vs[i]), env, vars) : 0; }); continue; } const m = /^var\s+(\w+)\s*=\s*(.*)$/.exec(l); if (!m) { const m2 = /^var\s+(\w+)\s*$/.exec(l); if (m2) { vars[m2[1]] = 0; continue; } throw new Unsup('var:' + l.slice(0, 30)); } vars[m[1]] = expr(tok(m[2]), env, vars); continue; }
    if (w === 'SetEquipTempValue') { const mm1 = /^SetEquipTempValue\s+(\d+)\s+(.*)$/.exec(l); if (mm1) { (env.temp ??= {})[mm1[1]] = expr(tok(mm1[2]), env, vars); continue; } }
    if (/^\w+\s*=[^=]/.test(l)) { const m = /^(\w+)\s*=\s*(.*)$/.exec(l); vars[m[1]] = expr(tok(m[2]), env, vars); continue; }
    if (w === 'case' || w === 'moveto' || w === 'break' || w === 'dialog' || w === 'switch') throw new Unsup('flow:' + w);
    // call: name arg arg ...; args are simple tokens or parenthesised/arith expressions at the end
    const m = /^(\w+)\s*(.*)$/.exec(l); if (!m) throw new Unsup('line:' + l.slice(0, 12)); const name = m[1]; const rest = m[2];
    const num = (s) => expr(tok(s.replace(/\s+(MELEE|RANGE|MAGIC|ALL)\s*$/i, '')), env, vars);
    try {
      if (name === 'AddExtParam' || name === 'SubExtParam') {
        const mm = /^User\s+VAR_(\w+)\s+(.+)$/.exec(rest); if (!mm) throw new Unsup('ExtParam');
        if (IGNORE_VAR.has(mm[1])) continue;
        const k = VAR[mm[1]]; if (!k) { unmapped.add('VAR_' + mm[1]); continue; }
        bon.push([k, (name[0] === 'S' ? -1 : 1) * num(mm[2]) / (k === 'cri' ? 10 : 1)]); continue;
      }
      let mm;
      if ((mm = /^Target\s+(\w+)\s+(.+)$/.exec(rest)) && name === 'AddDamage_SKID') { const id = skillIds[mm[1]]; if (!id) { unmapped.add('skill:' + mm[1]); continue; } bon.push([String(id), num(mm[2])]); continue; }
      if (name === 'AddMeleeAttackDamage' && (mm = /^Target\s+(.+)$/.exec(rest))) { bon.push(['melee', num(mm[1])]); continue; }
      if (name === 'AddRangeAttackDamage' && (mm = /^Target\s+(.+)$/.exec(rest))) { bon.push(['range', num(mm[1])]); continue; }
      if ((name === 'AddDamage_Size' || name === 'AddMDamage_Size') && (mm = /^Target\s+(\w+)\s+(.+)$/.exec(rest)) && mm[1] in SIZE) { bon.push([(name === 'AddDamage_Size' ? 'p_size_' : 'm_size_') + SIZE[mm[1]], num(mm[2])]); continue; }
      if ((name === 'RaceAddDamage' || name === 'AddMdamage_Race') && (mm = /^RACE_(\w+)\s+(.+)$/.exec(rest)) && mm[1] in RACE) { bon.push([(name === 'RaceAddDamage' ? 'p_race_' : 'm_race_') + RACE[mm[1]], num(mm[2])]); continue; }
      if ((name === 'AddDamage_Property' || name === 'AddMDamage_Property') && (mm = /^Target\s+(PROPERTY_\w+)\s+(.+)$/.exec(rest))) { bon.push([(name === 'AddDamage_Property' ? 'p_element_' : 'm_element_') + ELE(mm[1]), num(mm[2])]); continue; }
      if (name === 'AddSkillMDamage' && (mm = /^(PROPERTY_\w+)\s+(.+)$/.exec(rest))) { bon.push(['m_my_element_' + ELE(mm[1]), num(mm[2])]); continue; }
      if (name === 'AddRaceTolerace' && (mm = /^RACE_(\w+)\s+(.+)$/.exec(rest)) && mm[1] in RACE) { bon.push(['subrace_' + RACE[mm[1]], num(mm[2])]); continue; }
      if ((name === 'AddAttrTolerace' || name === 'SubAttrTolerace') && (mm = /^PROPERTY_(\w+)\s+(.+)$/.exec(rest))) { bon.push(['subele_' + ELE('PROPERTY_' + mm[1]), (name[0] === 'S' ? -1 : 1) * num(mm[2])]); continue; }
      if ((name === 'SetIgnoreDefRace_Percent' || name === 'SetIgnoreMdefRace') && (mm = /^RACE_(\w+)\s+(.+)$/.exec(rest)) && mm[1] in RACE) { bon.push([(name === 'SetIgnoreDefRace_Percent' ? 'p_pene_race_' : 'm_pene_race_') + RACE[mm[1]], num(mm[2])]); continue; }
      if (name === 'SubSpellCastTime') { bon.push(['vct', num(rest)]); continue; }
      if (name === 'SubSpellDelay') { bon.push(['acd', num(rest)]); continue; }
      if (name === 'AddDamage_CRI' && (mm = /^Target\s+(.+)$/.exec(rest))) { bon.push(['criDmg', num(mm[1])]); continue; }
      if (name === 'SetIgnoreDefRace_Percent' && (mm = /^RACE_All\s+(.+)$/.exec(rest))) { bon.push(['p_pene_race_all', num(mm[1])]); continue; }
      if (name === 'SetIgnoreMdefRace' && (mm = /^RACE_All\s+(.+)$/.exec(rest))) { bon.push(['m_pene_race_all', num(mm[1])]); continue; }
      if (name === 'ClassAddDamage' && (mm = /^([01])\s+Target\s+(.+)$/.exec(rest))) { bon.push(['p_class_' + (mm[1] === '0' ? 'normal' : 'boss'), num(mm[2])]); continue; }
    } catch (e) { if (e instanceof Unsup) throw e; throw e; }
    if (!IGNORABLE.has(name)) unmapped.add(name);
    if (env.extra && !['ShowEffect', 'Condition', 'SetEquipTempValue'].includes(name)) {
      try {
        const tk = tok(rest); const statics = []; const nums = []; let q = 0;
        while (q < tk.length) {
          const t = tk[q];
          if ((/^[A-Za-z_][\w']*$/.test(t) || /^"/.test(t)) && !(t in vars) && !/^(GetPetRelationship|GetMapName|GetRefineLevel|GetEquipGradeLevel|GetSkillLevel|IsPremiumPcCafe|GetPureJob|GetEquipTempValue|GetWeaponClass|GetEquipWeaponLv|GetEquipArmorLv)$/.test(t)) { statics.push(t); q++; continue; }
          if (tk[q] === ',') { q++; continue; }
          const [v, np] = expr(tk, env, vars, q, true); nums.push(v); q = np;
        }
        env.extra.push({ fn: name, statics, nums });
      } catch (e) { if (!(e instanceof Unsup)) throw e; env.extraFail?.add(name + ':' + e.message); }
    }
  }
  return { bon, unmapped: [...unmapped] };
}



export { fold, Unsup };
