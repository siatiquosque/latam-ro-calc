#!/usr/bin/env node
/**
 * Tables of docs/optimize-targeted-greedy.md, computed from the artifacts (nothing typed by hand).
 *   node tools/optimize-targeted-report.mjs            prints Markdown
 *   node tools/optimize-targeted-report.mjs --write    rewrites the block of the document
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/benchmarks/optimize-budget';
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined);
const run = (build, id) => read(`${DIR}/runs/${build}/${id}.json`)?.result;
const m = (value) => (value / 1e6).toFixed(3);
const pct = (value, ref) => `${((value / ref - 1) * 100).toFixed(2)}%`;
const out = [];
const print = (line = '') => out.push(line);
const table = (head, rows) => { print(`| ${head.join(' | ')} |`); print(`|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`); for (const row of rows) print(`| ${row.join(' | ')} |`); print(); };

// 1. Perturbed sockets: the three modes from the same state.
print('#### Sockets perturbados (cada campo de carta sorteado; equipamento mantido; os dois modos partem do mesmo estado)');
print();
const rows = [];
for (const name of ['b1', 'b2', 'wh']) {
  const file = read(`${DIR}/recheck/${name}.json`);
  if (!file) continue;
  const distinct = new Set(file.rows.map((row) => row.all.finalDps)).size;
  const row = file.rows[0];
  rows.push([name, file.rows.length, distinct, m(row.all.finalDps), row.all.unique, row.all.secondPassGains, `${m(row.touched.finalDps)} (${row.dpsDiffPct.toFixed(2)}%)`, row.savedEvaluations, `${m(row.near.finalDps)} (${row.nearDiffPct.toFixed(2)}%)`, row.nearSaved, `${row.all.secondPassChanged.join('; ') || '—'}`]);
}
table(['build', 'sementes', 'estados finais distintos', 'DPS all', 'avaliações all', 'ganhos na 2ª passada (all)', 'DPS touched', 'poupadas', 'DPS near', 'poupadas', 'campos que a 2ª passada alterou (all)'], rows);

// 2. Real searches: the three modes at the same effort plan.
print('#### Buscas reais: all contra touched contra near (mesmo esforço planejado, mesmo estado inicial)');
print();
const real = [];
for (const [build, plan] of [['b1', 10000], ['b1', 14000], ['b1', 17000], ['b1', 20000], ['b1', 24000], ['inq', 20000], ['inq', 24000], ['b2', 20000], ['weak', 20000]]) {
  const all = run(build, `plan-e${plan}`) ?? (plan === 20000 ? run(build, 'decoupled-23530-e20000') : undefined);
  const touched = run(build, `touched-e${plan}`), near = run(build, `near-e${plan}`);
  if (!all || !(touched || near)) continue;
  const cost = (r) => r?.budgetReport.budgeted.effective;
  const wall = (r) => r?.budgetReport.wallClockMs;
  real.push([build, plan, m(all.finalDps), cost(all), touched ? `${pct(touched.finalDps, all.finalDps)} / ${cost(all) - cost(touched)}` : '—', near ? `${pct(near.finalDps, all.finalDps)} / ${cost(all) - cost(near)}` : '—', near ? `${(wall(all) / 1000).toFixed(1)} → ${(wall(near) / 1000).toFixed(1)} s` : '—']);
}
table(['build', 'esforço E', 'DPS all', 'avaliações all', 'touched: Δ DPS / avaliações poupadas', 'near: Δ DPS / avaliações poupadas', 'tempo all → near'], real);
print('Tempos: só a linha de b1 com E=20000 foi medida a sós (um processo); as demais rodaram com até seis processos em paralelo e o tempo delas é ruído. A economia confiável é a contagem de avaliações.');
print();
const whReal = read(`${DIR}/recheck/wh-real.json`)?.real;
if (whReal?.all && whReal?.near) {
  print('Busca completa de uma build física (Windhawk, arco; equipamento substituível; esforço 12000), um processo por vez:');
  print();
  table(['modo', 'DPS final', 'avaliações', 'avaliações nos soquetes', 'tempo'], [['all', whReal.all.finalDps, whReal.all.unique, whReal.all.socket, `${(whReal.all.wallMs / 1000).toFixed(1)} s`], ['near', `${whReal.near.finalDps} (${pct(whReal.near.finalDps, whReal.all.finalDps)})`, whReal.near.unique, whReal.near.socket, `${(whReal.near.wallMs / 1000).toFixed(1)} s`]]);
}

// 3. First divergence and the mixes.
for (const build of ['b1', 'inq']) {
  const a = run(build, 'slots-e17000')?.budgetReport.slotLog, b = run(build, 'slots-e20000')?.budgetReport.slotLog;
  if (!a || !b) continue;
  const fields = ['quick', 'full', 'discoveryCap', 'moves', 'discovered', 'selected', 'best', 'bestValue', 'before', 'accepted'];
  const differs = (i, key) => JSON.stringify(a[i][key]) !== JSON.stringify(b[i][key]);
  const firstValue = a.findIndex((_, i) => differs(i, 'bestValue'));
  const firstChoice = a.findIndex((_, i) => differs(i, 'best') || differs(i, 'accepted'));
  const point = (i) => `rodada ${a[i].round}, slot \`${a[i].slot}\`: esforço completo ${a[i].full} contra ${b[i].full}, melhor movimento ${a[i].best === b[i].best ? 'o mesmo' : 'diferente'}, valor ${Math.round(a[i].bestValue)} contra ${Math.round(b[i].bestValue)} (${pct(a[i].bestValue, b[i].bestValue)}), aceito ${a[i].accepted} contra ${b[i].accepted}`;
  const inert = (key) => a.every((_, i) => key === 'discoveryCap' ? (a[i].discoveryCap === null || a[i].discoveryCap >= a[i].moves) && (b[i].discoveryCap === null || b[i].discoveryCap >= b[i].moves) : a[i][key] === b[i][key]);
  print(`#### Primeira divergência, ${build}: esforço 17000 contra 20000 (${a.length} decisões por slot)`);
  print();
  print(`- Primeiro valor diferente: ${firstValue >= 0 ? point(firstValue) : 'nenhum'}.`);
  print(`- Primeira escolha diferente: ${firstChoice >= 0 ? point(firstChoice) : 'nenhuma'}.`);
  print(`- \`quickEffort\` igual em todas as decisões: ${a.every((_, i) => a[i].quick === b[i].quick)}. \`discoveryCap\` nunca menor que o número de movimentos do slot (não limita): ${inert('discoveryCap')}. \`fullEffort\` diferente em ${a.filter((_, i) => differs(i, 'full')).length} de ${a.length}.`);
  print();
}
const mixes = [];
for (const build of ['b1', 'inq']) {
  const ref = run(build, 'plan-e20000')?.finalDps;
  for (const [id, label] of [['plan-e17000', 'tudo planejado de 17000'], ['mix-e17000-quick20000', '17000, quickEffort de 20000'], ['mix-e17000-discoveryCap20000', '17000, discoveryCap de 20000'], ['mix-e17000-full20000', '17000, fullEffort de 20000'], ['plan-e20000', 'tudo planejado de 20000']]) {
    const r = run(build, id);
    if (r) mixes.push([build, label, m(r.finalDps), pct(r.finalDps, ref), r.budgetReport.budgeted.effective]);
  }
}
if (mixes.length) { print('#### Isolamento: um esforço por vez'); print(); table(['build', 'configuração', 'DPS final', 'vs tudo-20000', 'avaliações'], mixes); }

// 4. Fixed depth of the finalists' socket search.
const fixed = [];
for (const build of ['b1', 'inq']) {
  const ref = run(build, 'plan-e20000');
  for (const depth of [100, 150, 200, 300, 500]) {
    const r = run(build, `fixed-full${depth}`);
    if (r && ref) fixed.push([build, depth, m(r.finalDps), pct(r.finalDps, ref.finalDps), r.budgetReport.budgeted.effective, r.budgetReport.budgeted.effective - ref.budgetReport.budgeted.effective]);
  }
}
if (fixed.length) { print('#### Profundidade fixa da busca de soquetes dos finalistas (resto planejado de 20000)'); print(); table(['build', 'esforço completo fixo', 'DPS final', 'vs plano 20000', 'avaliações', 'Δ avaliações'], fixed); }

// 5. Last validation of near: same state before the second pass.
const validation = readdirSync(`${DIR}/recheck`).filter((file) => file.startsWith('validation-')).sort().flatMap((file) => read(`${DIR}/recheck/${file}`).rows).filter((row) => row.all);
if (validation.length) {
  print('#### Validação final do near: a segunda passada a partir do mesmo estado');
  print();
  print('Os dois modos são idênticos até a 2ª passada (o relatório registra valor e avaliações únicas nesse ponto; "mesmo estado" confere os dois). A comparação abaixo isola o efeito do `socketRecheck`.');
  print();
  const cell = (r) => `${r.secondPass ? r.secondPass.evaluations : '—'} aval. / ${r.secondPass ? (r.secondPass.ms / 1000).toFixed(1) : '—'} s`;
  table(['cenário', 'mesmo estado', 'DPS antes da 2ª passada', 'DPS final all', 'DPS final near', 'Δ DPS', 'avaliações únicas all → near', '2ª passada all', '2ª passada near', 'campos alterados na 2ª passada (all): posição na 1ª passada'],
    validation.map((row) => [row.label, row.sameState, row.all.secondPass ? Math.round(row.all.secondPass.startedWith) : '—', Math.round(row.all.finalDps), Math.round(row.near.finalDps), `${row.dpsDiffPct.toFixed(2)}%`, `${row.all.unique} → ${row.near.unique}`, cell(row.all), cell(row.near), row.all.secondPassChanges.map((c) => `${c.field} +${c.gainPct}% (#${c.firstPassRank || 'incumbente'}/${c.candidates})`).join('; ') || '—']));
  const ranks = validation.flatMap((row) => row.all.secondPassChanges.map((c) => c.firstPassRank)).filter((r) => r !== null);
  print(`Campos que a 2ª passada completa alterou em todos os cenários: ${ranks.length}; pior posição que o vencedor ocupava na 1ª passada: ${ranks.length ? Math.max(...ranks) : '—'}; vencedores fora dos 5 primeiros: ${ranks.filter((r) => r > 5).length}.`);
  print();
}

const body = out.join('\n');
if (process.argv.includes('--write')) {
  const doc = 'docs/optimize-targeted-greedy.md';
  writeFileSync(doc, readFileSync(doc, 'utf8').replace(/<!-- targeted:start -->[\s\S]*<!-- targeted:end -->/, () => `<!-- targeted:start -->\n${body}\n<!-- targeted:end -->`));
} else console.log(body);
