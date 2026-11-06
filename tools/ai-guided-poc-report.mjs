import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'docs/benchmarks/ai-guided-poc';
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const fixture = read('fixture.json');
const files = experiment => readdirSync(join(root, experiment)).filter(file => file.endsWith('.json')).map(file => read(`${experiment}/${file}`));
const primary = ['weapon', 'shield', 'armor', 'garment', 'boot', 'headUpper', 'headMiddle', 'headLower', 'accLeft', 'accRight',
  'shadowWeapon', 'shadowArmor', 'shadowShield', 'shadowBoot', 'shadowEarring', 'shadowPendant'];
const n = (value, places = 2) => Number(value.toFixed(places));
const baseline = read('B/B13-baseline.json').rows[0];
const initialDps = baseline.readings.reduce((sum, x) => sum + x.metrics.dps, 0) / 5;
const summarize = (arm, cap, batches, verification, patch, share, finalVerdict, stoppedBy) => {
  const readings = verification.readings, report = finalVerdict ?? verification.feasibility;
  const calls = batches.reduce((sum, x) => sum + x.calls, 0);
  if (calls > cap) throw new Error(`${arm}/${cap}: ${calls} > ${cap}`);
  const rows = batches.flatMap(x => x.rows);
  if (rows.some(x => x.isError)) throw new Error(`${arm}/${cap}: a tool failed`);
  const dps = readings.reduce((sum, x) => sum + x.metrics.dps, 0) / 5;
  const pieces = primary.filter(key => key in (patch.gear ?? {}) && (patch.gear[key] ?? null) !== (fixture.build.preset[key] ?? null));
  const phases = {};
  for (const row of rows) for (const [phase, value] of Object.entries(row.result?.budgetUsage?.phases ?? {})) phases[phase] = (phases[phase] ?? 0) + value.engineCalls;
  phases.metadata = rows.filter(x => ['get_build_context', 'explain_damage'].includes(x.tool)).reduce((sum, x) => sum + x.calls, 0);
  phases.hypotheses = rows.filter(x => x.tool === 'evaluate_variants' && !x.args.goal).reduce((sum, x) => sum + x.calls, 0);
  phases.publicFinalVerification = rows.filter(x => x.tool === 'evaluate_variants' && x.args.goal).reduce((sum, x) => sum + x.calls, 0);
  phases.independentVerification = rows.filter(x => x.tool === 'independent-final-verification').reduce((sum, x) => sum + x.calls, 0);
  const coreCalls = Object.values(phases).reduce((a, b) => a + b, 0);
  if (coreCalls !== calls) throw new Error(`${arm}/${cap}: phase ledger disagrees with observed calls`);
  const cacheHits = rows.reduce((sum, row) => sum + (row.result?.budgetUsage?.cacheHits ?? row.result?.evaluations?.cacheHits ?? 0), 0);
  const mcpRows = rows.filter(x => x.wallMs !== undefined);
  const verified = report.targets.filter(x => x.status === 'feasible');
  const reliability = report.kill?.reliability ?? 'not-applicable';
  return { arm, cap, calls, mcpCalls: mcpRows.length, optimizeJobs: rows.filter(x => x.tool === 'optimize_build-core').length,
    cacheHits, phases,
    measuredProcessWallMs: n(batches.reduce((sum, x) => sum + x.wallMs, 0)),
    measuredProcessCpuMs: n(batches.reduce((sum, x) => sum + x.cpu.user + x.cpu.system, 0) / 1000),
    requestBytes: mcpRows.reduce((sum, x) => sum + x.requestBytes, 0), responseBytes: mcpRows.reduce((sum, x) => sum + x.responseBytes, 0),
    providerTokens: null, modelLatencyMs: null, modelCost: null,
    initialDps, finalDps: dps, gainPct: n((dps / initialDps - 1) * 100),
    goalsMet: verified.length, guaranteedTargets: verified.filter(x => x.kill?.reliability === 'guaranteed').length,
    reliability, status: report.status, constraintsMet: report.violations.length === 0,
    worstMargin: n(Math.min(...readings.map(x => x.metrics.min * 2 / x.hp - 1)), 6),
    piecesChanged: pieces, fieldsChanged: verification.changes.length, patch, share, readings, feasibility: report, stoppedBy };
};

const summaries = [];
const sensitivity = [];
function automatic(arm, cap, exp) {
  const batches = files(exp);
  const job = read(`${exp}/${exp}-${arm === 'A' ? 'automatic' : 'local'}.json`).rows.find(row => row.tool === 'optimize_build-core');
  const verifications = read(`${exp}/${exp}-verify.json`).rows;
  const verification = verifications[0], link = verifications[1] ?? read(`${exp}/${exp}-link.json`).rows[0];
  if (JSON.stringify(verification.readings) !== JSON.stringify(link.readings)) throw new Error(`${exp}: patch/link diverged`);
  return { ...summarize(arm, cap, batches, verification, job.result.patch, job.result.share, undefined, job.result.budgetUsage.stoppedBy),
    experiment: exp, legacyEffort: job.args.maxSolves };
}
for (const cap of [200, 1000]) {
  for (const arm of ['A', 'C']) {
    summaries.push(automatic(arm, cap, `${arm === 'A' ? 'AD' : 'CM'}${cap}`));
  }
  for (const [arm, tag] of [['A', 'A'], ['A', 'AM'], ['C', 'C'], ['C', 'CD']]) sensitivity.push(automatic(arm, cap, `${tag}${cap}`));
  const bFiles = files('B').filter(batch => cap === 1000 || /^B0\d-|^B1[0-3]-|^B200-link$|^B-public-verdict-200$/.test(batch.batchName));
  const ver = read(`B/${cap === 200 ? 'B11-selected-200' : 'B19-corrected-verdict'}.json`).rows[0];
  const publicResult = read(`B/B-public-verdict-${cap}.json`).rows[0].result.results[0];
  const link = read(`B/B${cap}-link.json`).rows[0];
  if (JSON.stringify(ver.readings) !== JSON.stringify(link.readings)) throw new Error(`B${cap}: patch/link diverged`);
  summaries.push(summarize('B', cap, bFiles, ver, ver.patch, publicResult.share, publicResult.feasibility,
    cap === 200 ? 'agent checkpoint: damage goal met, conditional' : 'agent stop: all modeled goals and reliability verified'));
}
summaries.sort((a, b) => a.cap - b.cap || a.arm.localeCompare(b.arm));
writeFileSync(join(root, 'summary.json'), JSON.stringify({ fixture: fixture.versions, assumptions: {
  aiMetrics: 'Provider tokens, isolated model latency and price unavailable. Process measurements exclude model reasoning, shell/test startup and development.',
  b200Prefix: 'B01-B13 plus its deferred link verification and public GoalSpec verification. Selection was fixed in B11, before B14.',
  b1000: 'Includes every B transcript, even alternative verifications and the post-fix repeated verdicts.',
  historicalJudgement: 'B17/B18 and B1000-link predate the certain-critical accuracy classification correction; readings are unchanged. B19/B20 and public MCP judgement verify the correction.',
  agentSampling: 'One live development-session agent, aware of project history. Journal replay is deterministic and is not an independent agent trial.',
}, summaries, sensitivity }, null, 2));
const table = ['| Braço | Teto | Chamadas reais | MCP | DPS médio M | Alvos ≤2 | Garantidos | Margem pior | Peças / campos | Processo (s) |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
  ...summaries.map(x => `| ${x.arm} | ${x.cap} | ${x.calls} | ${x.mcpCalls} | ${n(x.finalDps / 1e6, 3)} | ${x.goalsMet}/5 | ${x.guaranteedTargets}/5 | ${n(x.worstMargin * 100, 2)}% | ${x.piecesChanged.length} / ${x.fieldsChanged} | ${n(x.measuredProcessWallMs / 1000, 3)} |`)];
writeFileSync(join(root, 'results.md'), table.join('\n') + '\n');
const sensitivityTable = ['| Experimento | Teto real | Esforço legado | Chamadas | Alvos ≤2 | Garantidos | DPS médio M |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...[...summaries.filter(x => x.arm !== 'B'), ...sensitivity].sort((a, b) => a.cap - b.cap || a.experiment.localeCompare(b.experiment))
    .map(x => `| ${x.experiment} | ${x.cap} | ${x.legacyEffort} | ${x.calls} | ${x.goalsMet}/5 | ${x.guaranteedTargets}/5 | ${n(x.finalDps / 1e6, 3)} |`)];
writeFileSync(join(root, 'sensitivity.md'), sensitivityTable.join('\n') + '\n');
const best = summaries.find(x => x.arm === 'B' && x.cap === 1000);
writeFileSync(join(root, 'best-build.json'), JSON.stringify(best, null, 2));
const colors = { A: 'var(--chart-1)', B: 'var(--chart-2)', C: 'var(--chart-3)' };
const bars = summaries.map(x => `<div class="row"><span>${x.arm} · teto ${x.cap}</span><div class="track"><div class="bar" style="width:${x.calls / 10}%;background:${colors[x.arm]}"></div></div><b>${x.calls}</b><span>${x.goalsMet}/5 · ${x.guaranteedTargets}/5</span></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><title>POC IA + MCP</title><style>body{margin:0;color:var(--foreground);font:15px var(--font-sans)}h1{font-size:25px;margin:0 0 8px}.muted{color:var(--muted-foreground)}section{margin:24px 0}.row{display:grid;grid-template-columns:100px minmax(0,1fr) 42px 90px;gap:8px;align-items:center;margin:17px 0}.track{background:var(--secondary);height:22px;border-radius:5px}.bar{height:100%;border-radius:5px}a{color:var(--primary)}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid var(--border);padding:10px}small{color:var(--muted-foreground)}</style><h1>Uma fixture: conhecimento seletivo versus busca automática</h1><p class="muted">A: Greedy padrão · B: agente + MCP · C: subconjunto indicado pelo agente + Greedy</p><section><h2>Chamadas reais ao motor</h2><p class="muted">À direita: alvos com meta de dano / alvos com abate garantido dentro do modelo</p>${bars}</section><p><a href="${best.share}" target="_blank" rel="noopener">Abrir a build B verificada no simulador</a></p><p>Melhor B: ${best.goalsMet}/5 alvos, ${best.guaranteedTargets}/5 garantidos no modelo, margem mínima ${n(best.worstMargin * 100, 2)}%.</p><small>Uma sessão de agente. Tokens, preço e latência isolada do modelo indisponíveis. Não demonstra superioridade econômica ou generalização. O link público pode executar outra versão; os números reproduzidos pertencem ao dataset local congelado.</small>`;
writeFileSync(join(root, 'comparison.html'), html);
console.log(table.join('\n'));
