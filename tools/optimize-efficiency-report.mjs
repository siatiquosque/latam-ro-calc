#!/usr/bin/env node
/**
 * Tables of docs/optimize/optimize-budget-efficiency.md, computed from the artifacts of the budget benchmark (b1 and inq). Nothing is typed by hand.
 *   node tools/optimize-efficiency-report.mjs            prints Markdown
 *   node tools/optimize-efficiency-report.mjs --write    rewrites the block of docs/optimize/optimize-budget-efficiency.md
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/benchmarks/optimize-budget';
const BUILDS = ['b1', 'inq', 'b2', 'weak'];
const read = (build, id) => { const path = `${DIR}/runs/${build}/${id}.json`; return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined; };
const m = (value) => (value / 1e6).toFixed(3);
const pct = (value, ref) => `${((value / ref - 1) * 100).toFixed(1)}%`;
const out = [];
const print = (line = '') => out.push(line);
const table = (head, rows) => { print(`| ${head.join(' | ')} |`); print(`|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`); for (const row of rows) print(`| ${row.join(' | ')} |`); print(); };

for (const build of BUILDS) {
  const legacy = read(build, 'legacy-20000');
  if (!legacy) continue;
  const ref = legacy.result.finalDps;
  print(`#### ${build}: Legacy 20000 = ${m(ref)} M (custo efetivo ${legacy.result.budgetReport.budgeted.effective})`);
  print();

  const deep = !!read(build, 'decoupled-8000-e20000');
  if (deep) {
  // Q1: effort coupled to the cap against planned from 20000.
  const rows = [];
  for (const total of [2000, 4000, 8000, 12000, 16000, 20000, 23530]) {
    const coupled = read(build, total === 23530 ? 'unified-walk20000-r15' : `unified-${total}-r15`);
    const decoupled = read(build, `decoupled-${total}-e20000`);
    const cell = (run) => run ? `${m(run.result.finalDps)} (${pct(run.result.finalDps, ref)})` : '—';
    rows.push([total, cell(coupled), cell(decoupled), decoupled ? m(decoupled.result.budgetReport.bestScoreByPhase.search) : '—']);
  }
  print('Esforço acoplado ao teto (padrão) contra esforço planejado de 20000, mesmo teto total (DPS em milhões, entre parênteses a diferença para o Legacy 20000):');
  print();
  table(['teto total', 'acoplado', 'desacoplado (E=20000)', 'desacoplado antes dos soquetes'], rows);

  // Isolation of the two roles.
  const iso = [['legacy-20000', 'Legacy'], ['trail-unified-20000-r15', 'teto 17000, esforço 17000 (acoplado)'], ['decoupled-20000-e20000', 'teto 17000, esforço 20000'],
    ['decoupled-23530-e17000', 'teto 20000, esforço 17000'], ['decoupled-23530-e20000', 'teto 20000, esforço 20000']]
    .map(([id, label]) => { const run = read(build, id); return run ? [label, m(run.result.finalDps), pct(run.result.finalDps, ref), run.result.budgetReport.budgeted.effective, m(run.result.budgetReport.bestScoreByPhase.search)] : undefined; }).filter(Boolean);
  print('Separação dos dois papéis do teto:');
  print();
  table(['execução', 'DPS final', 'vs Legacy', 'custo efetivo', 'antes dos soquetes'], iso);

  // Where the coupled and the Legacy trails part.
  const a = read(build, 'legacy-20000')?.result.trail, b = read(build, 'trail-unified-20000-r15')?.result.trail;
  if (a && b) {
    const key = (step) => JSON.stringify([step.slot, step.to, step.kind]);
    let at = 0;
    while (at < a.length && at < b.length && key(a[at]) === key(b[at])) at++;
    print(`Trilhas: ${a.length} passos no Legacy e ${b.length} no acoplado de 17000; idênticas nos ${at} primeiros.${at < Math.min(a.length, b.length) ? ` Divergem no passo ${at + 1}: Legacy \`${JSON.stringify(a[at].to)}\` (${a[at].slot}, ${a[at].gainPct}%), acoplado \`${JSON.stringify(b[at].to)}\` (${b[at].slot}, ${b[at].gainPct}%).` : ''}`);
    print();
  }

  const planRows = [6000, 10000, 14000, 17000, 20000, 24000].map((plan) => { const run = read(build, `plan-e${plan}`); if (!run) return undefined; const br = run.result.budgetReport; return [plan, m(run.result.finalDps), pct(run.result.finalDps, ref), br.budgeted.effective, m(br.bestScoreByPhase.search), br.socket.used, `${((run.result.finalDps / ref) / (br.budgeted.effective / legacy.result.budgetReport.budgeted.effective) * 100).toFixed(0)}`]; }).filter(Boolean);
  if (planRows.length) { print('Qualidade pelo esforço planejado sozinho (sem teto: a busca termina por conta própria; custo = o que o plano precisa):'); print(); table(['esforço E', 'DPS final', 'vs Legacy', 'custo efetivo', 'antes dos soquetes', 'avaliações nos soquetes', 'qualidade por custo (Legacy = 100)'], planRows); }
  }

  // Q2: the socket pass, field by field.
  const full = read(build, 'decoupled-23530-e20000') ?? legacy;
  const log = full.result.budgetReport.socketLog;
  if (log?.length) {
    const half = log.length / 2;
    const passes = [log.slice(0, Math.ceil(half)), log.slice(Math.ceil(half))];
    const rowsPass = passes.map((pass, index) => {
      const tried = pass.reduce((sum, row) => sum + row.tried, 0);
      const won = pass.filter((row) => row.gainPct);
      const gain = won.reduce((total, row) => total * (1 + row.gainPct / 100), 1) - 1;
      return [index + 1, pass.length, tried, won.length, `${(gain * 100).toFixed(1)}%`];
    });
    print(`Passada de soquetes de ${build} (Unified com esforço 20000, custo total na passada ${full.result.budgetReport.socket.used}):`);
    print();
    table(['passada', 'campos', 'avaliações', 'campos com ganho', 'ganho composto'], rowsPass);
    const winners = log.filter((row) => row.gainPct && row.winnerRank !== null);
    const placement = winners.map((row) => `${row.slot}.${row.field}: posição ${row.winnerRank + 1} de ${row.candidates} (+${row.gainPct}%)`);
    print(`Campos com troca aceita (posição do vencedor na ordenação por relevância): ${placement.join('; ') || 'nenhum'}.`);
    print();
    const ordered = [...log].filter((row) => row.gainPct).sort((x, y) => y.gainPct - x.gainPct);
    const wasted = log.filter((row) => !row.gainPct).reduce((sum, row) => sum + row.tried, 0);
    print(`Avaliações em campos sem ganho: ${wasted} de ${log.reduce((sum, row) => sum + row.tried, 0)}. Maior ganho isolado: ${ordered[0] ? `${ordered[0].slot}.${ordered[0].field} +${ordered[0].gainPct}%` : '—'}.`);
    print();
  }

  if (deep) {
  // Q4: the anytime curve of one full run, and a plateau rule.
  const points = full.result.budgetReport.checkpoints;
  if (points?.length) {
    const finalValue = full.result.finalDps;
    const at = (limit) => points.filter((point) => point.spent <= limit).reduce((best, point) => Math.max(best, point.value), full.result.baselineDps);
    print(`Melhor build completa até cada orçamento (uma só execução, esforço 20000; checkpoints dos passos aceitos), ${build}:`);
    print();
    table(['avaliações', 'melhor DPS', '% do final'], [1000, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000].map((limit) => [limit, m(at(limit)), `${((at(limit) / finalValue) * 100).toFixed(1)}%`]));
    for (const window of [1000, 2000, 3000]) {
      for (const threshold of [0.01, 0.02]) {
        // Looks back only: stop at the first moment, after the first improvement, when the last `window` evaluations brought less than `threshold`.
        let stop = points.at(-1).spent;
        for (let spent = points[0].spent + window; spent <= points.at(-1).spent; spent += 250) { if (at(spent) / at(spent - window) - 1 < threshold) { stop = spent; break; } }
        print(`- Parada por platô (janela ${window}, ganho < ${threshold * 100}%): para em ${stop} avaliações, com ${((at(stop) / finalValue) * 100).toFixed(1)}% do DPS final desta execução.`);
      }
    }
    print();
  }
  }
}

// Second socket pass: every field against only the pieces the first pass touched.
const recheck = [];
for (const [build, plan] of [['b1', 10000], ['b1', 14000], ['b1', 20000], ['inq', 20000], ['b2', 20000], ['weak', 20000]]) {
  const full = read(build, `plan-e${plan}`) ?? read(build, 'decoupled-23530-e20000'), touched = read(build, `touched-e${plan}`);
  if (!full || !touched) continue;
  const f = full.result.budgetReport, g = touched.result.budgetReport;
  recheck.push([build, plan, m(full.result.finalDps), f.budgeted.effective, f.socket.used, m(touched.result.finalDps), g.budgeted.effective, g.socket.used, pct(touched.result.finalDps, full.result.finalDps), f.budgeted.effective - g.budgeted.effective]);
}
if (recheck.length) {
  print('#### Segunda passada de soquetes: todos os campos contra só as peças que a primeira passada alterou');
  print();
  table(['build', 'esforço E', 'DPS (todos)', 'custo (todos)', 'soquetes (todos)', 'DPS (tocados)', 'custo (tocados)', 'soquetes (tocados)', 'DPS tocados vs todos', 'avaliações poupadas'], recheck);
}
const body = out.join('\n');
if (process.argv.includes('--write')) {
  const doc = 'docs/optimize/optimize-budget-efficiency.md';
  const text = readFileSync(doc, 'utf8').replace(/<!-- efficiency:start -->[\s\S]*<!-- efficiency:end -->/, () => `<!-- efficiency:start -->\n${body}\n<!-- efficiency:end -->`);
  writeFileSync(doc, text);
} else console.log(body);
