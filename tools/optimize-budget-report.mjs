#!/usr/bin/env node
// Builds the result tables of docs/optimize/optimize-budget-benchmark.md from the artifacts written by
// mcp/src/engine/optimize-budget.bench.spec.ts. The numbers are never typed by hand: run this after the benchmark and it rewrites
// the block between the two markers of the report (or prints it with --stdout).
//   node tools/optimize-budget-report.mjs [--stdout] [dir=docs/benchmarks/optimize-budget]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const stdout = args.includes('--stdout');
const dir = args.find((arg) => !arg.startsWith('--')) ?? 'docs/benchmarks/optimize-budget';
const REPORT = 'docs/optimize/optimize-budget-benchmark.md';
const BUILDS = ['b1', 'b2', 'weak', 'inq'];
const RESERVES = [10, 15, 20, 30, 40];

const runs = {};
for (const build of BUILDS) {
  const folder = join(dir, 'runs', build);
  if (!existsSync(folder)) continue;
  runs[build] = Object.fromEntries(readdirSync(folder).filter((f) => f.endsWith('.json')).map((f) => { const r = JSON.parse(readFileSync(join(folder, f), 'utf8')); return [r.runId, r]; }));
}
const present = BUILDS.filter((b) => runs[b]);
const missing = BUILDS.filter((b) => !runs[b]);

const m = (n, d = 3) => (n === undefined || n === null ? '–' : (n / 1e6).toFixed(d).replace('.', ','));
const p = (n, d = 1) => (n === undefined || n === null || !Number.isFinite(n) ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(d).replace('.', ',')}%`);
const int = (n) => (n === undefined || n === null ? '–' : Math.round(n).toLocaleString('pt-BR'));
const sec = (ms) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
const gain = (a, b) => (b ? (a / b - 1) * 100 : undefined);
const get = (build, id) => runs[build]?.[id]?.result;
const rep = (r) => r?.budgetReport;
const lines = [];
const out = (text = '') => lines.push(text);
const table = (head, rows) => { out(`| ${head.join(' | ')} |`); out(`|${head.map((_, i) => (i === 0 ? '---' : '---:')).join('|')}|`); for (const row of rows) out(`| ${row.join(' | ')} |`); out(); };
const effOf = (build) => get(build, 'legacy-20000') && rep(get(build, 'legacy-20000')).budgeted.effective;
const effId = (build) => Object.keys(runs[build] ?? {}).find((id) => id.startsWith('unified-effective-'));

out('<!-- Gerado por tools/optimize-budget-report.mjs a partir de docs/benchmarks/optimize-budget; não edite à mão. -->');
if (missing.length) out(`> Builds sem artefatos: ${missing.join(', ')}.\n`);
const first = runs[present[0]] && Object.values(runs[present[0]])[0];
if (first) out(`Versões: app ${first.versions.app}, git ${first.versions.gitHead}${first.versions.gitDirty ? ' (+ alterações locais)' : ''}, manifesto de dados ${first.versions.dataManifestSha}, Node ${first.versions.node}. Alvo Betelgeuse (20994), objetivo dps, +12/A, procs desligados.\n`);

// 1. Legacy: the real cost and the share of the socket pass.
out('#### 1. Custo real do Legacy (nominal 20.000) e peso da passada de soquetes\n');
table(['build', 'DPS base', 'DPS antes da passada', 'DPS final', 'ganho da passada', 'avaliações no teto', 'passada fora do teto', 'custo efetivo', 'tempo', 'campos de soquete', 'parada'],
  present.flatMap((b) => { const r = get(b, 'legacy-20000'); if (!r) return []; const g = rep(r); const pre = g.bestScoreByPhase.search;
    return [[b, m(r.baselineDps), m(pre), m(r.finalDps), p(gain(r.finalDps, pre), 2), int(g.budgeted.inCap), int(g.budgeted.socketOutsideCap), int(g.budgeted.effective), sec(runs[b]['legacy-20000'].wallMs), `${g.socket.fields}/${g.socket.totalFields}`, g.stoppedReason]]; }));

// 2. Scenario A (nominal) and B (equal effective budget).
out('#### 2. Orçamento nominal (A) e efetivo equivalente (B)\n');
table(['build', 'Legacy 20.000 (DPS)', 'Legacy custo efetivo', 'Unified 20.000 (DPS)', 'Unified custo', 'Unified = custo efetivo do Legacy (DPS)', 'Unified/Legacy A', 'Unified/Legacy B'],
  present.flatMap((b) => { const l = get(b, 'legacy-20000'); const u = get(b, 'unified-20000-r15'); const e = get(b, effId(b)); if (!l || !u) return [];
    return [[b, m(l.finalDps), int(rep(l).budgeted.effective), m(u.finalDps), int(rep(u).budgeted.effective), e ? `${m(e.finalDps)} (teto ${int(rep(e).requested)})` : '–', p(gain(u.finalDps, l.finalDps)), e ? p(gain(e.finalDps, l.finalDps)) : '–']]; }));

// 3. Where the gain comes from, phase by phase (Unified 15%, 20.000 and Legacy).
out('#### 3. Ganho por fase (DPS ao fim de cada fase, acumulado sobre o DPS base)\n');
const phaseRows = [];
for (const b of present) for (const id of ['legacy-20000', 'unified-20000-r15']) {
  const r = get(b, id); if (!r) continue; const s = rep(r).bestScoreByPhase;
  const step = (a, c) => p(gain(s[c], s[a]), 1);
  phaseRows.push([b, id, m(s.baseline), `${m(s.tuning)} (${step('baseline', 'tuning')})`, `${m(s.search)} (${step('tuning', 'search')})`, `${m(s.socket)} (${step('search', 'socket')})`, p(gain(s.final, s.baseline), 1)]);
}
table(['build', 'execução', 'base', 'ajuste das peças usadas', 'busca (troca de peças)', 'passada final de soquetes', 'total'], phaseRows);

// 4. Reserve experiment.
for (const budget of [8000, 20000]) {
  out(`#### 4. Reserva de soquetes — teto de ${int(budget)} avaliações\n`);
  table(['build', 'reserva', 'DPS final', 'antes da passada', 'ganho da passada', 'teto da busca', 'soquetes: disponível → usado', 'campos', 'não consumidas', 'cache hits', 'tempo', 'parada'],
    present.flatMap((b) => RESERVES.flatMap((r) => { const run = get(b, `unified-${budget}-r${r}`); if (!run) return []; const g = rep(run); const s = g.bestScoreByPhase;
      return [[b, `${r}%`, m(run.finalDps), m(s.search), p(gain(run.finalDps, s.search), 2), int(g.searchBudget), `${int(g.socket.availableAtStart)} → ${int(g.socket.used)}`, `${g.socket.fields}/${g.socket.totalFields}`, int(g.budgeted.unused), int(g.cacheHits), sec(runs[b][`unified-${budget}-r${r}`].wallMs), g.stoppedReason]]; })));
  out('Melhor reserva por build (DPS final) e diferença para os 15%:\n');
  table(['build', 'melhor reserva', 'DPS', 'DPS com 15%', 'diferença', 'pior reserva', 'diferença pior↔melhor'],
    present.flatMap((b) => { const rows = RESERVES.map((r) => [r, get(b, `unified-${budget}-r${r}`)]).filter(([, x]) => x); if (rows.length < 2) return [];
      const best = rows.reduce((a, c) => (c[1].finalDps > a[1].finalDps ? c : a)); const worst = rows.reduce((a, c) => (c[1].finalDps < a[1].finalDps ? c : a)); const base = get(b, `unified-${budget}-r15`);
      return [[b, `${best[0]}%`, m(best[1].finalDps), m(base?.finalDps), p(gain(best[1].finalDps, base?.finalDps), 2), `${worst[0]}%`, p(gain(best[1].finalDps, worst[1].finalDps), 2)]]; }));
}

// 5. Same total: greedy, restart, wide.
out('#### 5. Mesmo teto de 20.000: Greedy, dois reinícios (2×10.000) e busca larga\n');
table(['build', 'A: Greedy 20.000', 'B: reinício (melhor das duas)', 'B: 1ª busca 10.000', 'B: 2ª busca 10.000', 'B: avaliações (1ª+2ª)', 'C: busca larga', 'C: avaliações', 'B/A', 'C/A'],
  present.flatMap((b) => { const a = get(b, 'unified-20000-r15'); const r = get(b, 'restart-2x10000-r15'); const w = get(b, 'wide-20000-r15'); if (!a) return [];
    return [[b, m(a.finalDps), r ? m(r.finalDps) : '–', r ? m(r.restart.first.finalDps) : '–', r ? m(r.restart.second.finalDps) : '–', r ? `${int(r.restart.first.solves)}+${int(r.restart.second.solves)}` : '–', w ? m(w.finalDps) : '–', w ? int(w.solves) : '–', r ? p(gain(r.finalDps, a.finalDps)) : '–', w ? p(gain(w.finalDps, a.finalDps)) : '–']]; }));
out('Universo de candidatos (busca larga muda o conjunto avaliado): candidatos medidos/disponíveis na busca e itens avaliados no screening.\n');
table(['build', 'Greedy: candidatos', 'Greedy: screening (testados)', 'Larga: candidatos', 'Larga: screening (testados)'],
  present.flatMap((b) => { const a = get(b, 'unified-20000-r15'); const w = get(b, 'wide-20000-r15'); if (!a || !w) return [];
    const scr = (r) => Object.values(r.screening ?? {}).reduce((s, x) => s + x.tested, 0);
    return [[b, `${int(a.coverage.candidates.measured)}/${int(a.coverage.candidates.available)}`, int(scr(a)), `${int(w.coverage.candidates.measured)}/${int(w.coverage.candidates.available)}`, int(scr(w))]]; }));

// 6. Quality by budget (curve).
out('#### 6. Qualidade por orçamento (Unified, reserva 15%) e marcos\n');
const CURVE = [400, 1000, 2000, 4000, 8000, 20000];
const bestKnown = (b) => Math.max(...Object.values(runs[b]).map((x) => x.result.finalDps));
table(['build', ...CURVE.map((n) => int(n)), 'Legacy efetivo', 'melhor conhecido'],
  present.map((b) => [b, ...CURVE.map((n) => { const r = get(b, `unified-${n}-r15`); return r ? `${m(r.finalDps, 2)} (${int(rep(r).budgeted.effective)})` : '–'; }), get(b, 'legacy-20000') ? `${m(get(b, 'legacy-20000').finalDps, 2)} (${int(effOf(b))})` : '–', m(bestKnown(b), 2)]));
out('Menor teto da curva (Unified 15%) que atinge cada fração do melhor DPS conhecido do build:\n');
table(['build', '50%', '75%', '90%', '95%', '100% do Unified 20.000'],
  present.map((b) => [b, ...[0.5, 0.75, 0.9, 0.95].map((f) => { const n = CURVE.find((x) => get(b, `unified-${x}-r15`)?.finalDps >= bestKnown(b) * f); return n ? int(n) : '> 20.000'; }),
    (() => { const target = get(b, 'unified-20000-r15')?.finalDps; const n = CURVE.find((x) => get(b, `unified-${x}-r15`)?.finalDps >= target); return n ? int(n) : '–'; })()]));
out('Melhor resultado conhecido (qualquer estratégia) com cada teto nominal:\n');
table(['build', ...[8000, 20000].map((n) => `${int(n)}`)],
  present.map((b) => [b, ...[8000, 20000].map((n) => { const cands = Object.values(runs[b]).filter((x) => x.args.maxSolves === n || (n === 20000 && x.group === 'restart')); const best = cands.reduce((a, c) => (!a || c.result.finalDps > a.result.finalDps ? c : a), null); return best ? `${m(best.result.finalDps)} (${best.runId})` : '–'; })]));

// 7. Consolidated table and regressions.
out('#### 7. Tabela consolidada (por build)\n');
const bestReserve = (b) => { const rows = RESERVES.map((r) => get(b, `unified-20000-r${r}`)).filter(Boolean); return rows.length ? rows.reduce((a, c) => (c.finalDps > a.finalDps ? c : a)) : undefined; };
const valid = (r) => (r && r.finalDps >= r.baselineDps && r.budgetReport.budgeted.inCap <= r.budgetReport.requested + 5 ? 'sim' : r ? 'não' : '–');
const cover = (r) => (r ? `${int(r.coverage.candidates.measured)}/${int(r.coverage.candidates.available)}; soquetes ${r.coverage.sockets?.checked ?? '–'}/${r.coverage.sockets?.total ?? '–'}` : '–');
for (const b of present) {
  const legacy = get(b, 'legacy-20000'); const u15 = get(b, 'unified-20000-r15'); const best = bestReserve(b); const restart = get(b, 'restart-2x10000-r15'); const wide = get(b, 'wide-20000-r15');
  const cols = [['Legacy', legacy], ['Unified 15%', u15], [`Melhor reserva (${best ? RESERVES.find((r) => get(b, `unified-20000-r${r}`) === best) : '–'}%)`, best], ['Reinício 2×10.000', restart], ['Busca larga', wide]];
  out(`**${b}**\n`);
  table(['Métrica', ...cols.map(([name]) => name)], [
    ['DPS final', ...cols.map(([, r]) => m(r?.finalDps))],
    ['Avaliações reais', ...cols.map(([name, r]) => (!r ? '–' : name === 'Reinício 2×10.000' ? int(r.restart.totalSolves) : name === 'Legacy' ? int(rep(r).budgeted.effective) : int(rep(r).budgeted.effective)))],
    ['Tempo', ...cols.map(([name]) => { const id = name === 'Legacy' ? 'legacy-20000' : name === 'Unified 15%' ? 'unified-20000-r15' : name === 'Reinício 2×10.000' ? 'restart-2x10000-r15' : name === 'Busca larga' ? 'wide-20000-r15' : `unified-20000-r${RESERVES.find((r) => get(b, `unified-20000-r${r}`) === best)}`; return sec(runs[b][id]?.wallMs); })],
    ['Ganho sobre a base', ...cols.map(([, r]) => p(gain(r?.finalDps, r?.baselineDps)))],
    ['Ganho sobre Unified 15%', ...cols.map(([, r]) => p(gain(r?.finalDps, u15?.finalDps), 2))],
    ['Cobertura', ...cols.map(([, r]) => cover(r))],
    ['Resultado válido', ...cols.map(([, r]) => valid(r))],
  ]);
}

// 8. Regressions against Legacy and Unified 15%, one by one.
out('#### 8. Regressões individuais (≥ 2% abaixo do Unified 15% de 20.000 ou do Legacy)\n');
const reg = [];
for (const b of present) for (const r of Object.values(runs[b])) {
  if (r.group === 'curve' || r.group === 'determinism' || r.args.maxSolves < 20000) continue;
  for (const [refName, ref] of [['Unified 15%', get(b, 'unified-20000-r15')], ['Legacy', get(b, 'legacy-20000')]]) {
    if (!ref || r.runId === 'unified-20000-r15' || r.runId === 'legacy-20000') continue;
    const d = gain(r.result.finalDps, ref.finalDps); if (d !== undefined && d <= -2) reg.push([b, r.runId, refName, p(d, 2), m(r.result.finalDps), m(ref.finalDps)]);
  }
}
if (reg.length) table(['build', 'execução', 'contra', 'diferença', 'DPS', 'DPS de referência'], reg); else out('Nenhuma.\n');

// 9. Determinism.
out('#### 9. Determinismo\n');
table(['build', 'unified-2000-r15', 'repetição', 'mesma build (link)', 'mesmo DPS', 'mesmas avaliações'],
  present.flatMap((b) => { const a = get(b, 'unified-2000-r15'); const c = get(b, 'unified-2000-r15-repeat'); if (!a || !c) return [];
    return [[b, m(a.finalDps), m(c.finalDps), a.share === c.share ? 'sim' : 'NÃO', a.finalDps === c.finalDps ? 'sim' : 'NÃO', rep(a).uniqueEvaluations === rep(c).uniqueEvaluations ? 'sim' : 'NÃO']]; }));

// 10. Ledger of one run per build, to show the accounting.
out('#### 10. Contabilidade do orçamento (Unified 20.000, reserva 15%)\n');
table(['build', 'chamadas ao motor', 'avaliações únicas', 'sem cache', 'cache hits', 'descoberta', 'busca', 'soquetes', 'verificação/relatório', 'teto usado', 'parada'],
  present.flatMap((b) => { const r = get(b, 'unified-20000-r15'); if (!r) return []; const g = rep(r);
    return [[b, int(g.totalEngineCalls), int(g.uniqueEvaluations), int(g.uncachedEvaluations), int(g.cacheHits), int(g.discoveryEvaluations), int(g.searchEvaluations), int(g.socketEvaluations), int(g.finalVerificationEvaluations), `${int(g.budgeted.inCap)}/${int(g.requested)}`, g.stoppedReason]]; }));

// 11. Control: the same walk ceiling as the legacy run.
out('#### 11. Controle: teto da busca do Unified igual ao do Legacy\n\n');
table(['build', 'execução', 'teto da busca', 'teto total', 'DPS antes da passada', 'DPS final', 'custo efetivo', 'final vs Legacy', 'parada'],
  present.flatMap((b) => { const rows = []; const l = get(b, 'legacy-20000');
    if (l) rows.push([b, 'legacy-20000', '20.000 (sem reserva)', 'sem teto global', m(rep(l).bestScoreByPhase.search), m(l.finalDps), int(rep(l).budgeted.effective), '–', rep(l).stoppedReason]);
    for (const w of [16000, 18000, 20000, 22000]) { const r = get(b, `unified-walk${w}-r15`); if (!r) continue; const g = rep(r);
      rows.push([b, `unified-walk${w}-r15`, int(g.searchBudget), int(g.requested), m(g.bestScoreByPhase.search), m(r.finalDps), int(g.budgeted.effective), p(gain(r.finalDps, l?.finalDps), 2), g.stoppedReason]); }
    return rows; }));

const block = lines.join('\n');
if (stdout) { console.log(block); process.exit(0); }
const START = '<!-- results:start -->'; const END = '<!-- results:end -->';
const doc = readFileSync(REPORT, 'utf8');
const a = doc.indexOf(START); const z = doc.indexOf(END);
if (a < 0 || z < 0) { console.error(`marcadores ${START}/${END} ausentes em ${REPORT}`); process.exit(1); }
writeFileSync(REPORT, `${doc.slice(0, a + START.length)}\n${block}\n${doc.slice(z)}`);
console.log(`tabelas gravadas em ${REPORT}`);
