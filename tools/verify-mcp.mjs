#!/usr/bin/env node
/** Deployment smoke test for the cross-Worker path that health/tools-list cannot cover. */
import assert from 'node:assert/strict';

const base = process.env.MCP_BASE_URL || 'https://laro-calc.siatiquosque.com.br';
let id = 0;

async function call(name, args) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
  const rpc = await response.json();
  assert.ok(!rpc.error, `${name}: ${JSON.stringify(rpc.error)}`);
  const result = JSON.parse(rpc.result.content[0].text);
  assert.ok(!rpc.result.isError, `${name}: ${JSON.stringify(result)}`);
  return result;
}

const shared = await call('share_link', {
  build: { class: 4261, level: 230, jobLevel: 47, stats: { int: 133, spl: 100, vit: 120 }, atkSkill: 'Poison Burst==5' },
  short: true,
});
assert.equal(new URL(shared.url).origin, 'https://short.latam-tools.com.br', 'Shortener returned the long-link fallback');
const parsed = await call('parse_share_link', { share: shared.url });
assert.equal(parsed.build.class, 4261);
assert.equal(parsed.build.level, 230);
const calculated = await call('calculate', { build: { share: shared.url }, target: { monsterId: 21077 } });
assert.equal(calculated.damage.skill.max, 68309);
console.log('MCP short-link creation, parsing and calculation passed.');
