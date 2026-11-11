#!/usr/bin/env node
// Text vs DB: the pt-BR description the game shows (ragassets latam-items.json) against what the engine applies.
//
//   node tools/audit/text-vs-db.mjs --dump <engine-dump.json> --raw <ragassets raw dir> --out <result.json> [--ids <ids.json>]
//
// Parses the description lines into bonuses, evaluates them per refine/grade and compares with the engine dump.
// Items without a pt-BR description are not read here (previews: see docs/script-audit.md, "Fontes").
// Method and classification: docs/script-audit.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));
const DATA = new URL('../../src/assets/demo/data/', import.meta.url);
const L = J(new URL('latam-items.json', DATA));
const items = J(new URL('item.json', DATA));
const skills = IS_MAIN ? J(arg('--raw') + '/skills.json') : [];

// skill name (pt-BR) -> ids (names may repeat)
const skillByName = new Map();
for (const s of skills) { const n = String(s.name).trim().toLowerCase(); if (!skillByName.has(n)) skillByName.set(n, []); skillByName.get(n).push(s.id); }
const skillIds = (names) => { // "A] e [B" style list already split
  const out = []; for (const n of names) { if (n.trim().startsWith('#')) { out.push(Number(n.trim().slice(1))); continue; } const ids = skillByName.get(n.trim().toLowerCase()); if (!ids) return null; out.push(ids.length === 1 ? ids[0] : ids); } return out;
};

const GRADE = { D: 1, C: 2, B: 3, A: 4 };
const num = (s) => { s = String(s); if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, '')); return Number(s.replace(',', '.')); };
const N = '([+-]?\\d+(?:[.,]\\d+)?)';
// each: [regex, (m, refineMul) => [[key, value]...] | null]
const STAT = { FOR: 'str', AGI: 'agi', VIT: 'vit', INT: 'int', DES: 'dex', SOR: 'luk', POD: 'pow', SAB: 'wis', FEI: 'spl', CON: 'con', CRV: 'crt', STA: 'sta' };
const LEX = [];
const add = (re, fn) => LEX.push([re, fn]);
add(new RegExp(`^ATQ ${N}$`), (m) => [['atk', num(m[1])]]);
add(new RegExp(`^ATQM ${N}$`), (m) => [['matk', num(m[1])]]);
add(new RegExp(`^ATQ e ATQM ${N}$`), (m) => [['atk', num(m[1])], ['matk', num(m[1])]]);
add(new RegExp(`^P\\.ATQ ${N}$`), (m) => [['pAtk', num(m[1])]]);
add(new RegExp(`^S\\.ATQM ${N}$`), (m) => [['sMatk', num(m[1])]]);
add(new RegExp(`^Dano físico não crítico ${N}%$`), (m) => [['nonCriticalDamage', num(m[1])]]);
add(new RegExp(`^Dano físico à distância ${N}%( adicional)?$`), (m) => [['range', num(m[1])]]);
add(new RegExp(`^Dano físico corpo a corpo ${N}%( adicional)?$`), (m) => [['melee', num(m[1])]]);
add(new RegExp(`^Dano físico ${N}%( adicional)?$`), (m) => [['atkPercent', num(m[1])]]);
add(new RegExp(`^Dano mágico ${N}%( adicional)?$`), (m) => [['matkPercent', num(m[1])]]);
add(new RegExp(`^Dano físico e mágico ${N}%( adicional)?$`), (m) => [['atkPercent', num(m[1])], ['matkPercent', num(m[1])]]);
add(new RegExp(`^Dano crítico ${N}%$`), (m) => [['criDmg', num(m[1])]]);
add(new RegExp(`^Conjuração variável ${N}%( adicional)?$`), (m) => [['vct', -num(m[1])]]);
add(new RegExp(`^Pós-conjuração ${N}%( adicional)?$`), (m) => [['acd', -num(m[1])]]);
add(new RegExp(`^Velocidade de ataque ${N}%$`), (m) => [['aspdPercent', num(m[1])]]);
add(new RegExp(`^Velocidade de ataque ${N}$`), (m) => [['aspd', num(m[1])]]);
add(new RegExp(`^HP máx\\. ${N}$`), (m) => [['hp', num(m[1])]]);
add(new RegExp(`^HP máx\\. ${N}%$`), (m) => [['hpPercent', num(m[1])]]);
add(new RegExp(`^SP máx\\. ${N}$`), (m) => [['sp', num(m[1])]]);
add(new RegExp(`^SP máx\\. ${N}%$`), (m) => [['spPercent', num(m[1])]]);
add(new RegExp(`^HP e SP máx\\. ${N}%$`), (m) => [['hpPercent', num(m[1])], ['spPercent', num(m[1])]]);
add(new RegExp(`^HP e SP máx\\. ${N}$`), (m) => [['hp', num(m[1])], ['sp', num(m[1])]]);
add(new RegExp(`^CRÍT ${N}$`), (m) => [['cri', num(m[1])]]);
add(new RegExp(`^Esquiva ${N}$`), (m) => [['flee', num(m[1])]]);
add(new RegExp(`^Precisão ${N}$`), (m) => [['hit', num(m[1])]]);
add(new RegExp(`^T\\.CRIT ${N}$`), (m) => [['cRate', num(m[1])]]);
add(new RegExp(`^TEN ${N}$`), (m) => [['res', num(m[1])]]);
add(new RegExp(`^TENM ${N}$`), (m) => [['mres', num(m[1])]]);
add(new RegExp(`^C\\.Mais ${N}$`), (m) => [['hplus', num(m[1])]]);
add(new RegExp(`^(FOR|AGI|VIT|INT|DES|SOR|POD|SAB|FEI|CON|CRV|STA) ${N}$`), (m) => [[STAT[m[1]], num(m[2])]]);
add(new RegExp(`^Conjuração fixa ${N} segundos?$`), (m) => [['fct', /^[+-]/.test(m[1]) ? -num(m[1]) : Math.abs(num(m[1]))]]);
add(new RegExp(`^Recarga de \\[(.+?)\\] ${N} segundos?$`), (m) => { const ids = skillIds([m[1]]); return ids && ids.map((id) => [Array.isArray(id) ? id.map((x) => 'cd__' + x) : 'cd__' + id, -num(m[2])]); });
// per-skill cast time ("-" = reduction; db stores reductions as positive numbers)
const SKL = String.raw`((?:\[[^\]]+\](?:, | e | )?)+)`;
const skillRule = (word, unit, prefix) => add(new RegExp('^' + word + ' de ' + SKL + ' ' + N + unit + '( adicional)?$', 'i'), (m) => {
  const names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]); const ids = skillIds(names);
  return ids && ids.map((id) => [Array.isArray(id) ? id.map((x) => prefix + x) : prefix + id, -num(m[2])]);
});
skillRule('Conjuração variável', '%', 'vct__');
skillRule('Conjuração variável', ' segundos?', 'fix_vct__');
skillRule('Conjuração fixa', '%', 'fctPercent__');
skillRule('Conjuração fixa', ' segundos?', 'fct__');
add(new RegExp('^Conjuração fixa ' + N + '%( adicional)?$', 'i'), (m) => [['fctPercent', -num(m[1])]]);
add(new RegExp(`^Precisão perfeita ${N}$`), (m) => [['perfectHit', num(m[1])]]);
add(new RegExp(`^Esquiva [Pp]erfeita ${N}$`), (m) => [['perfectDodge', num(m[1])]]);
add(new RegExp(String.raw`^Dano de ${SKL} adicional ${N}%$`), (m) => {
  const names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]); const ids = skillIds(names);
  return ids && ids.map((id) => [Array.isArray(id) ? id.map(String) : String(id), num(m[2])]);
});
// resistance by size
const SZ = { pequeno: 's', médio: 'm', grande: 'l' };
add(new RegExp('^Resistência a todos os [Tt]amanhos ' + N + '%( adicional)?$'), (m) => [['subsize_all', num(m[1])]]);
add(new RegExp('^Resistência (?:a oponentes de tamanho|ao tamanho) ((?:Pequeno|Médio|Grande)(?:(?:, | e )(?:Pequeno|Médio|Grande))*) ' + N + '%( adicional)?$'), (m) => m[1].split(/, | e /).map((s) => ['subsize_' + SZ[s.toLowerCase()], num(m[2])]));
// size penalty flags and procs
add(/^Anula a penalidade de [Tt]amanho( da arma)?$/, () => [['ignore_size_penalty', 1]]);
add(new RegExp('^Ao realizar ataques físicos, ' + N + '% de chance de \[Anular a penalidade de [Tt]amanho( da arma)?\] por ' + N + ' segundos?$'), (m) => [['chance__ignore_size_penalty', num(m[1])]]);
// "Dano de [A] e [B] ..." / "Dano de [A], [B] e [C]"
add(new RegExp(`^Dano de ((?:\\[[^\\]]+\\](?:, | e | )?)+) ${N}%( adicional)?$`), (m) => {
  const names = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]); const ids = skillIds(names);
  return ids && ids.map((id) => [Array.isArray(id) ? id.map(String) : String(id), num(m[2])]);
});

// ---- names -> engine key parts ----
const RACE = { 'amorfo': 'formless', 'morto-vivo': 'undead', 'bruto': 'brute', 'planta': 'plant', 'inseto': 'insect', 'peixe': 'fish', 'demônio': 'demon', 'humanoide': 'demihuman', 'anjo': 'angel', 'dragão': 'dragon', 'humano': null, 'doram': null };
const ELE = { 'neutro': 'neutral', 'água': 'water', 'terra': 'earth', 'fogo': 'fire', 'vento': 'wind', 'veneno': 'poison', 'sagrado': 'holy', 'sombrio': 'dark', 'fantasma': 'ghost', 'maldito': 'undead' };
const SIZE = { 'pequeno': 's', 'médio': 'm', 'grande': 'l' };
const list = (txt) => txt.split(/, | e /).map((x) => x.trim().toLowerCase());
const mapList = (txt, table) => { const o = []; for (const n of list(txt)) { if (!(n in table)) return null; if (table[n] !== null) o.push(table[n]); } return o; };
const T = '(?: e | e a | e o |, )';
// "contra" targets -> suffix keys. kind: p_ | m_
function targets(kind, tgt) {
  let m;
  tgt = tgt.toLowerCase().replace(/^oponentes (?:de |do |da |das |dos )?/, '').replace(/^(?:de |do |da |das |dos )/, '');
  if (/^(?:todos os )?tamanhos$|^todos os tamanhos$/.test(tgt)) return [kind + 'size_all'];
  if ((m = /^(?:os tamanhos|o tamanho|tamanho|tamanhos) (.+)$/.exec(tgt))) { const l = mapList(m[1], SIZE); return l && l.map((x) => kind + 'size_' + x); }
  if (/^todas as raças(?: de monstros)?$/.test(tgt)) return [kind + 'race_all'];
  if ((m = /^(?:as raças|a raça|raças|raça) (.+)$/.exec(tgt))) { const l = mapList(m[1], RACE); return l && l.map((x) => kind + 'race_' + x); }
  if (/^todas as propriedades$/.test(tgt)) return [kind + 'element_all'];
  if ((m = /^(?:as propriedades|a propriedade|propriedade|propriedades) (.+)$/.exec(tgt))) { const l = mapList(m[1], ELE); return l && l.map((x) => kind + 'element_' + x); }
  if (/^monstros normais e chefes$/.test(tgt)) return [kind + 'class_all'];
  if (/^monstros normais$/.test(tgt)) return [kind + 'class_normal'];
  if (/^monstros chefes$/.test(tgt)) return [kind + 'class_boss'];
  return null;
}
add(new RegExp(`^Dano físico e mágico contra (.+?) ${N}%$`), (m) => { const a = targets('p_', m[1]); const b = targets('m_', m[1]); return a && b && [...a, ...b].map((x) => [x, num(m[2])]); });
add(new RegExp(`^Dano (físico|mágico) contra (.+?) ${N}%$`), (m) => { const k = targets(m[1] === 'físico' ? 'p_' : 'm_', m[2]); return k && k.map((x) => [x, num(m[3])]); });
add(new RegExp(`^Dano mágico de todas as propriedades ${N}%$`), (m) => [['m_my_element_all', num(m[1])]]);
add(new RegExp(`^Dano mágico de propriedade (.+?) ${N}%$`), (m) => { const l = mapList(m[1], ELE); return l && l.map((x) => ['m_my_element_' + x, num(m[2])]); });
add(new RegExp(`^Resistência (?:a|à|as|aos) (propriedades?|raças?|tamanhos?) (.+?) ${N}%$`), (m) => {
  const t = m[1].startsWith('prop') ? [ELE, 'subele_'] : m[1].startsWith('raç') ? [RACE, 'subrace_'] : [SIZE, 'subsize_'];
  const l = mapList(m[2], t[0]); return l && l.map((x) => [t[1] + x, num(m[3])]);
});
// "Ignora [+]N% [adicional] (da|de|a) DEF[ e DEFM|M] (de|dos|das) <alvo> [adicional]" -> p_pene_* (DEF) / m_pene_* (DEFM)
add(/^Ignora \+? ?([\d.,]+)% (?:adicional )?(?:da |de |a )?(DEF e DEFM|DEFM|DEF) ?(?:de |dos |das |da |do )?(.*?)\.?$/, (m) => {
  const kinds = m[2] === 'DEF e DEFM' ? ['p_', 'm_'] : m[2] === 'DEFM' ? ['m_'] : ['p_'];
  let t = m[3].replace(/ adicional$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  t = t.replace(/^(personagens|jogadores)(, | e )/, '').replace(/humanoides/g, 'humanoide').replace(/(,| e) (personagens|jogadores|oponentes)\b/g, '').replace(/^(personagens|jogadores) e /, '').replace(/ e (personagens|jogadores)$/, '');
  const v = num(m[1]); let keys;
  if (t === '' || /^(todas as raças( de monstros)?|de todas as raças( de monstros)?)$/.test(t)) keys = ['race_all'];
  else if (/^(monstros )?normais( e chefes)?( e)?$/.test(t) || t === 'monstros normais e') keys = [/chefes/.test(t) ? 'class_all' : 'class_normal'];
  else if (/^normais(, chefes)?$/.test(t) || /^monstros normais, chefes$/.test(t)) keys = ['class_all'];
  else if (/^monstros chefes$/.test(t)) keys = ['class_boss'];
  else { const mm = /^(?:as raças|a raça|raças|raça) (.+)$/.exec(t); const l = mm && mapList(mm[1], RACE); if (!l) return null; keys = l.map((x) => 'race_' + x); }
  return kinds.flatMap((k) => keys.map((x) => [k + 'pene_' + x, v]));
});
add(/^Ignora a defesa de monstros da raça (.+?)\.?$/, (m) => { const l = mapList(m[1], RACE); return l && l.map((x) => ['p_pene_race_' + x, 100]); });
add(/^Ignora \+? ?([\d.,]+)% (?:adicional )?(?:da |de |a )?(TEN e TENM|TENM|TEN) (?:das raças|da raça) (.+?)(?: adicional)?\.?$/, (m) => {
  const l = mapList(m[3].replace(/\s+/g, ' ').toLowerCase(), RACE); if (!l) return null; const v = num(m[1]);
  const ks = m[2] === 'TEN e TENM' ? ['pene_res_race_', 'pene_mres_race_'] : m[2] === 'TENM' ? ['pene_mres_race_'] : ['pene_res_race_'];
  return ks.flatMap((k) => l.map((x) => [k + x, v]));
});
add(/^Ignora ([\d.,]+)% da (TEN e TENM|TENM|TEN) de todas as raças de monstros$/, (m) => {
  const v = num(m[1]); return m[2] === 'TEN e TENM' ? [['pene_res', v], ['pene_mres', v]] : m[2] === 'TENM' ? [['pene_mres', v]] : [['pene_res', v]];
});
add(/^TEN e TENM \+? ?([\d.,]+)\.?$/, (m) => [['res', num(m[1])], ['mres', num(m[1])]]);
add(new RegExp(`^Todos os atributos ${N}$`), (m) => [['allStatus', num(m[1])]]);
add(new RegExp(`^Esquiva perfeita ${N}$`), (m) => [['perfectDodge', num(m[1])]]);
add(new RegExp(`^Efetividade de cura ${N}%$`), (m) => [['healPower', num(m[1])]]);
const NAMEKEY = { ATQ: ['atk'], ATQM: ['matk'], 'P.ATQ': ['pAtk'], 'S.ATQM': ['sMatk'], 'CRÍT': ['cri'], Esquiva: ['flee'], Precisão: ['hit'], ...Object.fromEntries(Object.entries(STAT).map(([k, v]) => [k, [v]])) };
function multiStat(line) {
  const m = new RegExp(`^(.+?) ${N}$`).exec(line); if (!m) return null;
  const names = m[1].split(/, | e /); if (names.length < 2 || !names.every((n) => n in NAMEKEY)) return null;
  return names.flatMap((n) => NAMEKEY[n].map((k) => [k, num(m[2])]));
}

const clean = (l) => l.replace(/\^[0-9A-Fa-f]{6}/g, '').replace(/\s+/g, ' ').trim().replace(/físco/g, 'físico').replace(/\.$/, '').replace(/([+-]) (\d)/g, (x, s, d) => s + d);

// section header -> condition
function header(s) {
  let m;
  if ((m = /^A cada (\d+) refinos?:$/.exec(s))) return { t: 'every', n: Number(m[1]) };
  if (/^A cada refino:$/.test(s)) return { t: 'every', n: 1 };
  if ((m = /^A cada refino (?:do|a partir do) \+?(\d+) (?:ao|até o|até) \+?(\d+):$/.exec(s))) return { t: 'range', from: Number(m[1]), to: Number(m[2]) };
  if ((m = /^A cada refino a partir do \+?(\d+):$/.exec(s))) return { t: 'range', from: Number(m[1]), to: 99 };
  if ((m = /^Refino \+?(\d+):$/.exec(s))) return { t: 'eq', n: Number(m[1]) };
  if ((m = /^Refino \+?(\d+) ou mais:$/.exec(s))) return { t: 'ge', n: Number(m[1]) };
  if ((m = /^Grau ([DCBA]) ou mais:?$/.exec(s))) return { t: 'grade', n: GRADE[m[1]] };
  return /:$/.test(s) ? { t: 'skip', why: s } : null;
}
const PER_REFINE = /^(.*?) por refino$/;

export function parse(desc) {
  const body = desc.split(/\n(?:Tipo|Classes?|Posição|Peso|Nível da arma|Nível necessário|Defesa|Propriedade|Local):/)[0];
  const rules = []; const unparsed = []; const skipped = []; const blockRules = []; const isBlk = (k) => /^(Bloco|Efeito)/.test(k || '') || k === 'Durante a transformação:';
  let st = { refine: null, grade: null, skip: null }; let conj = false;
  for (const raw of body.split(/\r?\n/)) {
    const s = clean(raw);
    if (!s) continue;
    if (conj) { skipped.push('Conjunto'); continue; }
    if (/^-{5,}$/.test(s)) { st = { refine: null, grade: null, skip: null }; continue; }
    if (s === 'Conjunto') { conj = true; continue; }
    if (s === '[Efeito]') { st.skip = 'Efeito'; continue; }
    if (/^\[[^\]]+\]$/.test(s)) { st.skip = 'Bloco ' + s; st.refine = null; st.grade = null; continue; }
    const h = header(s);
    if (h) {
      if (st.skip) { if (isBlk(st.skip) && h.t !== 'skip') { if (h.t === 'grade') st.bgrade = h; else st.bref = h; } continue; }
      if (h.t === 'skip') { st.skip = h.why; continue; }
      if (h.t === 'grade') { st.grade = h; st.refine = null; } else st.refine = h;
      continue;
    }
    if (st.skip) {
      skipped.push(st.skip);
      if (isBlk(st.skip)) {
        let line = s.replace(/\.$/, '').replace(/ adicional$/, ''), per = false;
        const pm = PER_REFINE.exec(line); if (pm) { line = pm[1]; per = true; }
        let out = null; for (const [re, fn] of LEX) { const m = re.exec(line); if (m) { out = fn(m); break; } }
        if (!out) out = multiStat(line);
        if (out) { const conds = [st.bref, st.bgrade].filter(Boolean); if (per) conds.push({ t: 'every', n: 1 }); blockRules.push({ conds, bonus: out, src: s, block: st.skip }); }
      }
      continue;
    }
    for (const sent of s.split(/(?<!máx|nv|Nv|Nv\.|vel)\.\s+(?=[A-ZÁÉÍÓÚ\[])/)) {
      let line = sent.replace(/\.$/, '').replace(/ adicional$/, ''), per = false;
      const pm = PER_REFINE.exec(line); if (pm) { line = pm[1]; per = true; }
      let out = null;
      for (const [re, fn] of LEX) { const m = re.exec(line); if (m) { out = fn(m); break; } }
      if (!out) out = multiStat(line);
      if (!out) { unparsed.push(sent); continue; }
      const conds = [st.refine, st.grade].filter(Boolean);
      if (per) conds.push({ t: 'every', n: 1 });
      rules.push({ conds, bonus: out, src: sent });
    }
  }
  return { rules, blockRules, unparsed, skipped: [...new Set(skipped)] };
}

function evalRules(rules, r, g) {
  const sum = {};
  for (const { conds, bonus } of rules) {
    let mul = 1;
    for (const c of conds) {
      if (c.t === 'every') mul *= Math.floor(r / c.n);
      else if (c.t === 'ge') mul *= r >= c.n ? 1 : 0;
      else if (c.t === 'eq') mul *= r === c.n ? 1 : 0;
      else if (c.t === 'range') mul *= Math.max(0, Math.min(r, c.to) - c.from + 1);
      else if (c.t === 'grade') mul *= g >= c.n ? 1 : 0;
    }
    if (!mul) continue;
    for (const [k0, v] of bonus) { const k = Array.isArray(k0) ? k0.join('|') : k0; sum[k] = (sum[k] ?? 0) + v * mul; }
  }
  return sum;
}

// engine: class_all = class_normal + class_boss for normal/boss monsters
const foldClass = (o) => { if (!('class_all' in o)) return o; const r = { ...o }; const v = r.class_all; delete r.class_all; r.class_normal = (r.class_normal ?? 0) + v; r.class_boss = (r.class_boss ?? 0) + v; return r; };
const GNAME = ['', 'D', 'C', 'B', 'A'];
function condText(conds) {
  if (!conds.length) return 'Sempre (só de equipar)';
  return conds.map((c) => c.t === 'every' ? (c.n === 1 ? 'A cada refino' : `A cada ${c.n} refinos`) : c.t === 'eq' ? `Só no refino +${c.n}` : c.t === 'ge' ? `Refino +${c.n} ou mais` : c.t === 'range' ? `A cada refino do +${c.from} ao +${c.to}` : `Grau ${GNAME[c.n]} ou mais`).join(' + ');
}
const GR = { '-': 0, D: 1, C: 2, B: 3, A: 4 };
const IGN = new Set(['def', 'mdef']);
const res = {}; const unparsedShapes = {};
const only = arg('--ids') ? new Set(J(arg('--ids')).map(String)) : null;
const dump = IS_MAIN ? J(arg('--dump')) : {};
for (const id of Object.keys(dump)) {
  if (only && !only.has(id)) continue;
  const e = dump[id]; const it = items[id];
  const lat = L[id];
  if (!it || !lat || e.skip) continue;
  const { rules, blockRules, unparsed, skipped } = parse(lat.description || '');
  const domain = new Set(rules.flatMap((r) => r.bonus.flatMap((b) => (Array.isArray(b[0]) ? b[0] : [b[0]]))).flatMap((k) => (k === 'class_all' ? ['class_normal', 'class_boss'] : [k])));
  const grouped = new Set(); for (const r of rules) for (const b of r.bonus) if (Array.isArray(b[0])) b[0].forEach((x) => grouped.add(x));
  const base0 = e.rows['0|-'] ?? {}; const exp0 = evalRules(rules, 0, 0);
  const off = { atk: (base0.atk ?? 0) - (exp0.atk ?? 0), matk: (base0.matk ?? 0) - (exp0.matk ?? 0) };
  const diffs = {}; const series = {};
  for (const point of Object.keys(e.rows)) {
    const [rf, g] = point.split('|');
    const exp = foldClass(evalRules(rules, Number(rf), GR[g]));
    const dbv = foldClass(e.rows[point]);
    const keys = new Set([...Object.keys(exp), ...Object.keys(dbv).filter((k) => domain.has(k) && !IGN.has(k) && !grouped.has(k))]);
    for (const k of keys) {
      const x = exp[k] ?? 0; let y = k.includes('|') ? k.split('|').reduce((a, m) => a + (dbv[m] ?? 0), 0) : (dbv[k] ?? 0);
      if (k in off) y -= off[k];
      (series[k] ??= []).push([point, x, y]);
      if (Math.abs(x - y) > 1e-9) (diffs[k] ??= []).push({ s: `${point}: txt=${x} db=${y}`, x, y });
    }
  }
  for (const u of unparsed) { const sh = u.replace(/\[[^\]]*\]/g, '[S]').replace(/[+-]?\d+([.,]\d+)?/g, '#'); unparsedShapes[sh] = (unparsedShapes[sh] ?? 0) + 1; }
  const suspects = [];
  if (blockRules.length) { const pts = Object.keys(e.rows); for (const key of new Set(blockRules.flatMap((r) => r.bonus.map((b) => (Array.isArray(b[0]) ? b[0].join('|') : b[0]))))) { const worst = []; for (const point of pts) { const [rf, g] = point.split('|'); const base = foldClass(evalRules(rules, Number(rf), GR[g])); const blk = foldClass(evalRules(blockRules, Number(rf), GR[g])); const dbv = foldClass(e.rows[point]); const bv = blk[key] ?? 0; if (!bv) continue; const b0 = base[key] ?? 0; let y = key.includes('|') ? key.split('|').reduce((a, m) => a + (dbv[m] ?? 0), 0) : (dbv[key] ?? 0); if (key in off) y -= off[key]; if (Math.abs(y - (b0 + bv)) < 1e-9 && Math.abs(y - b0) > 1e-9) worst.push(point); } if (worst.length) suspects.push({ key, blocks: [...new Set(blockRules.filter((r) => r.bonus.some((b) => (Array.isArray(b[0]) ? b[0].join('|') : b[0]) === key)).map((r) => r.block + ' → ' + r.src))], pontos: worst.length, exemplo: worst.slice(-1)[0] }); } }
  res[id] = {
    name: it.name, pre: !!it.preRelease, domain: [...domain],
    status: Object.keys(diffs).length ? 'DIFF' : 'MATCH',
    diffs: Object.entries(diffs).map(([k, l]) => ({ key: k, points: l.length, sample: l.slice(0, 4).map((d) => d.s), dir: l.every((d) => d.y === 0) ? 'missing' : l.every((d) => d.x === 0) ? 'extra' : 'value', src: [...new Set(rules.filter((r) => r.bonus.some((b) => (Array.isArray(b[0]) ? b[0].join('|') : b[0]) === k)).map((r) => r.src))],
      series: series[k],
      rules: rules.filter((r) => r.bonus.some((b) => (Array.isArray(b[0]) ? b[0].join('|') : b[0]) === k)).map((r) => ({ cond: condText(r.conds), src: r.src, conds: r.conds, val: r.bonus.find((b) => (Array.isArray(b[0]) ? b[0].join('|') : b[0]) === k)[1] })) })),
    suspects, unparsed, skipped,
  };
}
if (IS_MAIN) writeFileSync(arg('--out'), JSON.stringify(res));
const c = {}; for (const v of Object.values(res)) c[v.status] = (c[v.status] ?? 0) + 1;
console.log(c, 'items', Object.keys(res).length);
const k = {}; for (const v of Object.values(res)) for (const d of v.diffs) k[d.key] = (k[d.key] ?? 0) + 1;
console.log('diff keys', Object.entries(k).sort((a, b) => b[1] - a[1]).slice(0, 30).map((e) => e.join(':')).join(' '));
const u = Object.entries(unparsedShapes).sort((a, b) => b[1] - a[1]);
console.log('unparsed shapes', u.length, 'lines', u.reduce((a, b) => a + b[1], 0));
