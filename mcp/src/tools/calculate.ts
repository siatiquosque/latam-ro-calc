/** MCP schemas and JSON envelopes only; calculations and searches live in build-analysis. */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { SLOT_TAGS } from '../data/slot-classifier';
import { BuildInput, buildInputSchema, compactBuildSchema, stringMap } from '../engine/build-input';
import { Shortener } from '../engine/share';
import { json, registerJsonTool } from './helpers';
import { createCalculationOperations, targetSchema } from 'src/app/build-analysis/operations/calculate';
import { createBuildContext } from 'src/app/build-analysis/operations/context';
import { validateBuild, ValidateConstraints } from 'src/app/build-analysis/engine/validate';
import { loadSkillTree, skillTreeLoaded } from 'src/app/build-analysis/engine/skill-tree';

export const normalizeShare = (input: BuildInput, shortener?: Shortener) => createBuildContext(config, shortener).normalizeShare(input);

export const resolveTarget = (dataset: Dataset, monsterId?: number) => createBuildContext(config).resolveTarget(dataset, monsterId);

export function registerCalculationTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  const operations = createCalculationOperations(dataset, config, shortener);
  registerJsonTool<{ build: BuildInput; target?: TargetArg; effects?: string[]; include?: ('bonuses' | 'tables')[] }>(
    server,
    'calculate',
    {
      title: 'Calcular dano',
      description:
        'USE para o dano de uma build (e como referência dos campos de `build`, que as outras ferramentas aceitam do mesmo jeito). Calcula o dano de uma build contra um alvo, com o mesmo motor do simulador web. Devolve dano da habilidade, dano básico, DPS, atributos finais, tempos de conjuração e um link para abrir a build no simulador.',
      inputSchema: {
        build: buildInputSchema,
        target: targetSchema,
        effects: z.array(z.string()).optional().describe('Efeitos de proc a ativar (veja `availableEffects` de uma chamada anterior).'),
        include: z.array(z.enum(['bonuses', 'tables'])).optional().describe('Seções pesadas opcionais.'),
      },
    },
    (args) => operations.calculate(args).then(json),
  );

  registerJsonTool<{ build: BuildInput; constraints?: ValidateConstraints }>(server, 'validate_build', {
    title: 'Validar build',
    description:
      'USE antes de confiar no dano de uma build ou de uma sugestão: confere classe, nível, slot, encaixes de carta, encantamentos, refino e o que o calculador não consegue medir. NÃO conserta nem ranqueia. ' +
      'Devolve `valid`, `errors` e `warnings` (cada um com `code`, `path`, `itemId`), `unknowns` (o que não foi checado) e as versões. `constraints.excludeMvpCards` torna carta de MVP um erro; `latamOnly` e `requireCalculableItems` valem true por padrão.',
    inputSchema: {
      build: compactBuildSchema,
      constraints: z.object({
        excludeMvpCards: z.boolean().optional().describe('Carta que cai de MVP vira erro MVP_CARD_EXCLUDED. A classificação é pela carta, não pelo alvo.'),
        latamOnly: z.boolean().optional(),
        requireCalculableItems: z.boolean().optional(),
      }).optional(),
    },
  }, async ({ build, constraints }) => { await loadSkillTree();
    // The same resolver as every other tool: a short link (/l/<slug>) is followed to the real share before it is read.
    return json(validateBuild(await normalizeShare(build, shortener), dataset, constraints, skillTreeLoaded())); });

  registerJsonTool<{ build: BuildInput; monsterIds: number[] }>(server, 'damage_table', {
    title: 'Dano contra vários monstros',
    description: `USE para ver como uma build rende em vários monstros de uma vez. Calcula a mesma build contra até ${config.limits.maxTableMonsters} monstros.`,
    inputSchema: {
      build: compactBuildSchema,
      monsterIds: z.array(z.number().int()).min(1).max(config.limits.maxTableMonsters),
    },
  }, (args) => operations.damageTable(args).then(json));

  registerJsonTool<{ builds: BuildInput[]; target?: TargetArg; labels?: string[] }>(server, 'compare_builds', {
    title: 'Comparar builds',
    description: `USE para escolher entre builds prontas e distintas. Resolve de 2 a ${config.limits.maxCompareBuilds} builds contra o mesmo alvo e ordena por DPS.`,
    inputSchema: {
      builds: z.array(compactBuildSchema).min(2).max(config.limits.maxCompareBuilds),
      target: targetSchema,
      labels: z.array(z.string()).optional().describe('Nomes para identificar cada build no resultado.'),
    },
  }, (args) => operations.compareBuilds(args).then(json));

  registerJsonTool<{
    build: BuildInput;
    slot: string;
    candidates?: number[];
    slotTag?: (typeof SLOT_TAGS)[number];
    query?: string;
    target?: TargetArg;
    limit?: number;
    complements?: boolean;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
  }>(server, 'optimize_slot', {
    title: 'Otimizar um slot',
    description:
      `USE quando já há poucos candidatos conhecidos para um slot (até ${config.limits.maxOptimizeCandidates}). NÃO use para descobrir candidatos (\`scan_slot\`) nem para a build inteira (\`optimize_build\`). Testa candidatos para um slot e ordena pelo ganho de DPS. No máximo ${config.limits.maxOptimizeCandidates} candidatos por chamada. ` +
      'Cada candidato entra com os melhores cartas e encantamentos que ele aceita (`complements`, padrão), porque duas peças com o mesmo ATQ diferem em soquetes e encantamentos; ' +
      'os cartas e encantamentos da peça antiga que a nova não comporta são retirados. `withoutSockets` mostra o DPS da peça nua. Só itens do LATAM entram; os demais vão em `skippedNotInLatam`. ' +
      'O link devolvido já vem com a comparação armada (peça atual → peça sugerida), então o jogador abre o simulador e vê a diferença.',
    inputSchema: {
      build: compactBuildSchema,
      slot: z.string().describe('Campo do equipamento a variar, ex.: "weapon", "armor", "boot", "accLeft".'),
      candidates: z.array(z.number().int()).max(config.limits.maxOptimizeCandidates).optional().describe('Ids a testar. Sem isso, busca pelo `slotTag`.'),
      slotTag: z.enum(SLOT_TAGS).optional().describe('Categoria para buscar candidatos automaticamente.'),
      query: z.string().optional().describe('Filtra os candidatos automáticos por nome.'),
      target: targetSchema,
      limit: z.number().int().min(1).max(20).optional().default(10),
      complements: z.boolean().optional().default(true).describe('Buscar também cartas e encantamentos de cada candidato. false compara só as peças nuas.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino de cada candidato (e da peça atual, para medir o que subir o refino vale). Padrão: +12, o teto alcançável (acima disso é endgame alto); informe um valor, até +20, para mudar.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Grau de cada candidato que aceita grau (e da peça atual). Padrão: A, o ideal; informe só para limitar.'),
    },
  }, (args) => operations.optimizeSlot(args).then(json));
}

export function registerBridgeTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  const operations = createCalculationOperations(dataset, config, shortener);
  registerJsonTool<{ share: string; raw?: boolean }>(server, 'parse_share_link', {
    title: 'Ler link do simulador',
    description:
      'Lê um link de simulação (URL completa, encurtada, fragmento antigo #/?b=… ou token) e devolve a build resolvida: classe, níveis, atributos, cada peça equipada com refino/cartas/encantes, habilidades, buffs, consumíveis e a comparação, se o link levar uma. Não calcula dano — para isso passe o mesmo link em `calculate`.',
    inputSchema: { share: z.string(), raw: z.boolean().optional().describe('Inclui `buildInput`, o preset bruto (cerca de 5 KB). Raramente útil: as ferramentas aceitam o próprio `share`.') },
  }, (args) => operations.parseShareLink(args).then(json));

  registerJsonTool<{ build: BuildInput; compare?: { slots: string[]; gear: Record<string, any> }; short?: boolean }>(server, 'share_link', {
    title: 'Gerar link do simulador',
    // The short form of a link is stored by the shortener (same input, same link): the only thing here that writes.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description: 'Transforma uma build em um link que abre o simulador web já preenchido. Opcionalmente com uma comparação armada e/ou encurtado.',
    inputSchema: {
      build: compactBuildSchema,
      compare: z
        .object({
          slots: z.array(z.string()).min(1).describe('Slots a comparar, ex.: ["weapon"].'),
          gear: stringMap(z.union([z.number().int(), z.string(), z.null()])).describe('Peças alternativas, mesmo formato de `build.gear`.'),
        })
        .optional()
        .describe('Abre o simulador na visão atual → simulado.'),
      short: z.boolean().optional().default(false).describe('Encurtar se houver um serviço configurado; caso contrário mantém o link completo.'),
    },
  }, (args) => operations.shareLink(args).then(json));

  registerJsonTool<{ id: number }>(server, 'item_description', {
    title: 'Descrição do item',
    description: 'Só a descrição pt-BR de um item, sem os campos estruturais. Útil quando a pergunta é "o que essa peça faz?".',
    inputSchema: { id: z.number().int() },
  }, (args) => operations.itemDescription(args).then(json));
}

export { targetSchema } from 'src/app/build-analysis/operations/calculate';
type TargetArg = z.infer<typeof targetSchema>;
