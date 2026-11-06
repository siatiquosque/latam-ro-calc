// Boots the VPS bundle and records idle/peak RSS and /healthz latency under 1 and 3 concurrent optimize_build calls. Windows only (tasklist).
// Usage: node --experimental-sqlite tools/mcp-load-probe.mjs [path/to/server.mjs]; writes .tmp/vps-load.json.
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const port = 8799, base = `http://127.0.0.1:${port}`;
const srv = spawn(process.execPath, ['--experimental-sqlite', process.argv[2] ?? 'dist/vps/server.mjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', PUBLIC_APP_ORIGIN: base, ALLOWED_HOSTS: '127.0.0.1', LINKS_DB: '.tmp/load-links.sqlite', SITE_ROOT: '.tmp/web-out', OG_ORIGIN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const rss = () => { try { const l = execSync(`tasklist /FI "PID eq ${srv.pid}" /FO CSV /NH`).toString(); return Math.round(Number(l.split('","')[4].replace(/[^\d]/g, '')) / 1024); } catch { return 0; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await wait(250); }
const fx = JSON.parse(readFileSync('mcp/src/engine/__tests__/fixtures/inquisitor-fogueira-optimization.json', 'utf8'));
const rpc = (name, args, id) => fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
const opt = async id => { const t = Date.now(); try { const r = await rpc('optimize_build', { build: { preset: fx.preset, ...(fx.customItems ? { customItems: fx.customItems } : {}) }, target: { monsterId: 20994 }, objective: 'dps' }, id); const body = await r.text(); return { status: r.status, s: (Date.now() - t) / 1000, ok: /finalDps|"final|final\\"/.test(body), bytes: body.length }; } catch (e) { return { err: String(e.cause ?? e).slice(0, 80), s: (Date.now() - t) / 1000 }; } };
const phase = async (n) => { let stop = false, peak = 0, worst = 0, pings = 0, fails = 0;
  const m = (async () => { while (!stop) { peak = Math.max(peak, rss()); await wait(1000); } })();
  const h = (async () => { while (!stop) { const t = Date.now(); try { await fetch(base + '/healthz', { signal: AbortSignal.timeout(30000) }); } catch { fails++; } worst = Math.max(worst, Date.now() - t); pings++; await wait(300); } })();
  const runs = await Promise.all(Array.from({ length: n }, (_, i) => opt(n * 10 + i))); stop = true; await m; await h;
  return { n, runs, peakRssMB: peak, worstHealthMs: worst, pings, healthFails: fails }; };
const out = { idleMB: rss() };
await rpc('list_classes', {}, 1).then(r => r.text()); out.warmMB = rss();
out.one = await phase(1); out.three = await phase(3); out.endMB = rss();
srv.kill(); writeFileSync('.tmp/vps-load.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); console.log(log.slice(-300)); process.exit(0);
