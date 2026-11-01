/**
 * What an agent is expected to do with typical requests. Each scenario is a thing a player asks, the tool that answers it best,
 * and a call that runs. Three things are checked without a model in the loop:
 *   - the call runs and answers (the arguments an agent would build from the schema are valid),
 *   - the `guide` topic for the request names that tool (the how-to and the expectation cannot drift apart),
 *   - the guide only mentions tools that exist.
 * The same table is the corpus for a real evaluation: give an agent `ask` and only the server instructions, then compare the
 * tool and arguments it picks with `tool` and `args`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { GUIDE_TOPICS } from './guide';

const dataset = loadDatasetFromDisk();
let client: Client;

const build = {
  class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', rotation: ['Third Flame Bomb==5', 'Third Punish==5'],
  gear: { weapon: 560032, weaponRefine: 8, weaponGrade: 'D' },
  stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 },
};

interface Scenario { ask: string; tool: string; topic: string; args: Record<string, unknown> }

export const SCENARIOS: Scenario[] = [
  { ask: 'Quanto dano essa build causa?', tool: 'calculate', topic: 'fluxo', args: { build } },
  { ask: 'De onde vem o dano da minha build e o que o número não conta?', tool: 'explain_damage', topic: 'fluxo', args: { build } },
  { ask: 'Melhore minha build inteira.', tool: 'optimize_build', topic: 'melhorar-build', args: { build, slots: ['boot'], candidates: { boot: [470069] }, maxSolves: 80 } },
  { ask: 'Onde vale mais investir refino, grau ou encantamento?', tool: 'explain_damage', topic: 'melhorar-build', args: { build, parts: ['upgrades'] } },
  { ask: 'Qual dessas três botas é melhor para mim?', tool: 'optimize_slot', topic: 'comparar-pecas', args: { build, slot: 'boot', candidates: [470069, 470077, 470094] } },
  { ask: 'Tem alguma arma fora do óbvio que renda mais?', tool: 'scan_slot', topic: 'achar-peca-improvavel', args: { build, slot: 'weapon', query: 'Soqueira', topSockets: 3 } },
  { ask: 'Teste trocar a arma e depois o cartão junto com um buff.', tool: 'evaluate_variants', topic: 'comparar-pecas', args: { build, variants: [{ label: 'vil', patch: { gear: { weapon: 560037 } } }] } },
  { ask: 'Compare estas duas builds.', tool: 'compare_builds', topic: 'comparar-pecas', args: { builds: [build, { ...build, gear: { weapon: 560037, weaponRefine: 8 } }] } },
  { ask: 'Como distribuo meus pontos de atributo?', tool: 'optimize_stats', topic: 'fluxo', args: { build, maxSolves: 60 } },
  { ask: 'Quero uma build de burst, não de spam.', tool: 'optimize_build', topic: 'perfil', args: { build, profile: 'burst', slots: ['boot'], candidates: { boot: [470069] }, maxSolves: 60 } },
  { ask: 'Vale a pena a bota com proc de 5%?', tool: 'optimize_build', topic: 'proc-ou-estavel', args: { build, slots: ['boot'], candidates: { boot: [470073] }, maxSolves: 60 } },
  { ask: 'Que encantamentos essa arma aceita?', tool: 'slot_options', topic: 'comparar-pecas', args: { itemId: 560037 } },
  { ask: 'Quais itens ainda não têm pool de rolagens confirmado?', tool: 'uncatalogued_pools', topic: 'melhorar-build', args: { limit: 3 } },
];

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'scenarios', version: '1.0.0' });
  await Promise.all([createMcpServer(dataset).connect(serverTransport), client.connect(clientTransport)]);
});

describe('scenarios an agent is expected to handle', () => {
  it.each(SCENARIOS.map((scenario) => [scenario.ask, scenario] as const))('%s', async (_ask, scenario) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain(scenario.tool);

    const result: any = await client.callTool({ name: scenario.tool, arguments: scenario.args });
    expect(result.isError, result.content?.[0]?.text?.slice(0, 200)).toBeFalsy();

    // The guide topic for this kind of request has to send the agent to the tool the scenario expects.
    expect(GUIDE_TOPICS[scenario.topic].text, `${scenario.topic} should mention ${scenario.tool}`).toContain(`\`${scenario.tool}\``);
  }, 60_000);

  it('only mentions tools that exist in the guide', async () => {
    const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
    const mentioned = Object.values(GUIDE_TOPICS).flatMap((topic) => [...topic.text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]));
    expect(mentioned.length).toBeGreaterThan(5);
    expect(mentioned.filter((name) => !names.has(name))).toEqual([]);
  });

  it('serves the index and each topic', async () => {
    const index: any = await client.callTool({ name: 'guide', arguments: {} });
    const topics = JSON.parse(index.content[0].text).topics;
    expect(Object.keys(topics).sort()).toEqual(Object.keys(GUIDE_TOPICS).sort());
    const one: any = await client.callTool({ name: 'guide', arguments: { topic: 'alvos' } });
    expect(JSON.parse(one.content[0].text).text).toMatch(/9000002/);
  });
});
