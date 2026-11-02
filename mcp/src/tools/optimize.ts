/** MCP schemas and JSON envelopes only; calculations and searches live in build-analysis. */

import { z } from 'zod';
import { ProcMode } from 'src/app/build-analysis/engine/proc';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { BuildInput, compactBuildSchema, stringMap } from '../engine/build-input';
import { DEFAULT_METRICS, Metric, METRICS, Profile } from '../engine/metrics';
import { Shortener } from '../engine/share';
import { BuildPatch, compactPatchSchema } from '../engine/variants';
import { targetSchema } from './calculate';
import { json, registerJsonTool } from './helpers';
import { createOptimizationOperations, requireSchema } from 'src/app/build-analysis/operations/optimize';

const metricEnum = z.enum(METRICS);

const variantSchema = z.object({
  label: z.string().min(1).max(80).describe('Nome curto para reconhecer a variante na resposta.'),
  patch: compactPatchSchema.describe('Só o que muda em relação à build base. Mapas (gear, stats, skills, options) mesclam por chave.'),
});

export function registerOptimizationTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  const operations = createOptimizationOperations(dataset, config, shortener);
  registerJsonTool<{
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    variants: { label: string; patch: BuildPatch }[];
    excludeMvpCards?: boolean;
    metrics?: Metric[];
    require?: z.infer<typeof requireSchema>[];
    sortBy?: Metric;
    limit?: number;
  }>(server, 'evaluate_variants', {
    title: 'Avaliar variantes de uma build',
    description:
      'USE para testar hipóteses que você já tem (dezenas de trocas de uma vez, em uma chamada). NÃO use para descobrir candidatos: para isso `scan_slot` ou `optimize_build`. ' +
      'Resolve de uma vez várias variações de uma mesma build (trocar peça, carta, encantamento, buff, atributo, habilidade) e devolve as métricas de cada uma, ordenadas. ' +
      'Cada variante é só o que muda: `patch` tem o mesmo formato dos overrides de `build` e mescla por chave sobre a base. ' +
      '`require` descarta quem não cumpre um piso ou teto (ex.: hp mínimo). `rotationDps` usa a `rotation` da build. ' +
      `Máximo de ${config.limits.maxVariants} variantes por chamada.`,
    inputSchema: {
      procHitsPerSecond: z.number().min(0.1).max(30).optional(),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('Procs desligados, sempre ativos ou média estimada por chance/duração. optimize_build usa average por padrão; efeitos desconhecidos não são assumidos ativos.'),

      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional().describe('Efeitos de proc a ativar em todas as variantes (veja `availableEffects` de `calculate`).'),
      variants: z.array(variantSchema).min(1),
      excludeMvpCards: z.boolean().optional().describe('Variante que traz carta de MVP (que a build ainda não usa) volta em `errors` com MVP_CARD_EXCLUDED, sem número.'),
      metrics: z.array(metricEnum).optional().describe(`O que devolver. Padrão: ${DEFAULT_METRICS.join(', ')}.`),
      require: z.array(requireSchema).optional(),
      sortBy: metricEnum.optional().describe('Métrica de ordenação (maior primeiro). Padrão: dps.'),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
  }, (args) => operations.evaluateVariants(args).then(json));


  registerJsonTool<{
    includePatches?: boolean;
    excludeMvpCards?: boolean;
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    build: BuildInput;
    slot: string;
    target?: TargetArg;
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    base?: 'current' | 'tuned';
    query?: string;
    limit?: number;
    topSockets?: number;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    maxSolves?: number;
  }>(server, 'scan_slot', {
    title: 'Varrer um slot inteiro',
    description:
      'USE para achar a peça improvável de um slot ou conferir se algo fora do óbvio vence. NÃO use para montar a build inteira (`optimize_build`) nem para comparar poucos ids (`optimize_slot`). ' +
      'Mede, com o motor real, TODOS os itens do LATAM que a classe e o nível podem usar naquele slot (centenas, em segundos), sem filtrar por palavra-chave: ' +
      'serve para achar a peça improvável que nenhuma busca por bônus traria. O resto da build fica como está no link. ' +
      '`base: "tuned"` (padrão) compara contra a peça atual já com os melhores cartas, encantamentos e rolagens; `"current"` compara contra ela como veio. ' +
      'Os `topSockets` melhores da varredura nua recebem a busca de cartas, encantamentos e rolagens catalogadas e o ranking final usa esses valores. ' +
      'Cada linha traz os parceiros de conjunto (outros slots) para testar em `evaluate_variants`. Refino e grau seguem o padrão ideal (+12, A) ou os tetos passados.',
    inputSchema: {
      procHitsPerSecond: z.number().min(0.1).max(30).optional(),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('Procs desligados, sempre ativos ou média estimada por chance/duração. optimize_build usa average por padrão; efeitos desconhecidos não são assumidos ativos.'),

      build: compactBuildSchema,
      slot: z.string().describe('Slot a varrer, ex.: "weapon", "armor", "boot", "accLeft", "headMiddle".'),
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: o do `profile`.'),
      profile: z.enum(['sustained', 'burst']).optional().describe('`sustained` (padrão) ou `burst`; veja `optimize_build`.'),
      base: z.enum(['current', 'tuned']).optional().default('tuned'),
      query: z.string().optional().describe('Restringe a varredura a itens cujo nome contém o texto.'),
      limit: z.number().int().min(1).max(40).optional().default(15),
      topSockets: z.number().int().min(0).max(25).optional().default(12).describe('Quantos dos melhores recebem a busca de soquetes e rolagens. 0 = só a varredura nua.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino testado. Padrão +12.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Grau testado. Padrão A.'),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
      includePatches: z.boolean().optional().describe('Inclui o patch exato de cada linha para testar a sugestão sem reconstruir os soquetes. Padrão false.'),
      excludeMvpCards: z.boolean().optional().describe('Não sugere carta que cai de MVP nos soquetes.'),
    },
  }, (args) => operations.scanSlot(args).then(json));

  registerJsonTool<{
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    parts?: ('stages' | 'contributions' | 'warnings' | 'refine' | 'upgrades')[];
    metric?: 'dps' | 'max' | 'rotationDps';
    maxContributions?: number;
  }>(server, 'explain_damage', {
    title: 'Explicar o dano de uma build',
    description:
      'USE para entender uma build antes de mexer nela: onde está o dano, o que cada peça vale, o que o número não conta e, com `upgrades`, onde investir refino, grau ou encantamento. NÃO use para buscar trocas. ' +
      'Mostra de onde vem o dano: `stages` são as etapas da fórmula com o valor depois de cada uma; `contributions` diz quanto a métrica cai se cada peça, carta, buff, passiva ou consumível sair ' +
      '(retirar uma peça também desfaz os conjuntos e combos dela); `warnings` aponta efeitos que o número não conta — itens com script vazio e procs não ativados, com o ganho de ativá-los.',
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      parts: z.array(z.enum(['stages', 'contributions', 'warnings', 'refine', 'upgrades'])).optional().describe('Padrão: stages, contributions e warnings. `upgrades` ordena o que vale mais investir: refino, grau, nível de cada encantamento e encantar um soquete vazio. `refine` mostra o ganho de +1 e +2 refinos em cada peça (custo: uma conta por peça e nível).'),
      metric: z.enum(['dps', 'max', 'rotationDps']).optional().describe('Em que medir as contribuições. Padrão: dps.'),
      maxContributions: z.number().int().min(1).max(100).optional().default(25),
    },
  }, (args) => operations.explainDamage(args).then(json));

  registerJsonTool<{
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    equipmentMode?: 'current' | 'replace';
    build: BuildInput;
    target?: TargetArg;
    targets?: { monsterId: number; weight?: number }[];
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    slots?: string[];
    lock?: string[];
    exclude?: number[];
    excludeMvpCards?: boolean;
    candidates?: Record<string, number[]>;
    combos?: boolean;
    pairs?: string[][];
    countProcs?: boolean;

    levelChecks?: boolean;
    detail?: boolean;
    complements?: boolean;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    candidatesPerSlot?: number;
    rounds?: number;
    maxSolves?: number;
    require?: z.infer<typeof requireSchema>[];
  }>(server, 'optimize_build', {
    title: 'Procurar uma build melhor',
    description:
      'USE para uma busca automática dentro dos limites da situação (peças, cartas, encantamentos, rolagens, refino e grau). É opcional: consulte dados e teste hipóteses com `evaluate_variants` quando isso responder melhor ao pedido. NÃO use para um slot só com candidatos conhecidos (`optimize_slot`), nem para varrer tudo de um slot (`scan_slot`), nem para atributos (`optimize_stats`). ' +
      'Percorre os slots de equipamento trocando a peça que mais melhora a métrica e repete até nada melhorar (subida de encosta). ' +
      'Testa equipamentos e seus complementos legais: cartas por categoria, encantamentos por posição e bônus aleatórios de catálogos regionais. ' +
      'Com `combos` (padrão) também testa trocas de **duas peças juntas** quando o script de uma cita a outra (conjuntos), que uma troca isolada não enxerga. ' +
      '`targets` mede contra vários monstros com peso (ex.: um Médio e um Grande: a penalidade de tamanho só aparece no Grande); `candidates` fixa os itens a testar num slot; ' +
      '`lock` trava slots, `exclude` proíbe itens, `require` impõe pisos (ex.: hp mínimo). Devolve o caminho das trocas com o ganho de cada uma e um `patch` pronto para `evaluate_variants`. ' +
      '`pairs` testa dois slots trocados juntos mesmo sem conjunto que os ligue. `procs` na resposta mostra o ganho de cada proc ainda não contado (passe-o em `effects` para a busca contá-lo). '
      + 'Busca heurística limitada pelo orçamento, sem garantia global. Pools aleatórios desconhecidos não são inventados. Confira a cobertura e o orçamento retornados.',
    inputSchema: {
      equipmentMode: z.enum(['current', 'replace']).optional().describe('current mantém peças, refino e grau e ajusta só complementos. replace (padrão) procura substituições e upgrades.'),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('Procs desligados, sempre ativos ou média estimada por chance/duração. optimize_build usa average por padrão; efeitos desconhecidos não são assumidos ativos.'),

      build: compactBuildSchema,
      target: targetSchema,
      targets: z.array(z.object({ monsterId: z.number().int(), weight: z.number().positive().optional() })).min(1).max(5).optional()
        .describe('Alvos com peso (padrão 1). Vale para max, min e dps; as demais métricas não dependem do alvo.'),
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: o do `profile`.'),
      profile: z.enum(['sustained', 'burst']).optional().describe('Que tipo de build buscar. `sustained` (padrão): o ciclo da rotação em regime, onde ASPD, conjuração e pós-conjuração contam (`rotationDps`, ou `dps` sem rotação). `burst`: a abertura da rotação com as recargas livres (`burstDps`, ou `avgHit` sem rotação). A resposta traz os dois perfis para a build base e a final.'),
      slots: z.array(z.string()).optional().describe('Slots a percorrer. Padrão: equipamentos e peças sombrias.'),
      lock: z.array(z.string()).optional().describe('Slots que não mudam.'),
      exclude: z.array(z.number().int()).optional().describe('Ids de itens que não podem entrar.'),
      excludeMvpCards: z.boolean().optional().describe('Não recomenda carta que cai de MVP (por carta, não pelo alvo). Uma carta de MVP que você já usa é mantida e sai em `alerts`.'),
      candidates: stringMap(z.array(z.number().int()).max(60)).optional().describe('Itens a testar por slot, no lugar da seleção automática. Ex.: { "boot": [470069, 470115, 470094] }.'),
      combos: z.boolean().optional().default(true).describe('Testar também trocas de duas peças ligadas por um conjunto.'),
      pairs: z.array(z.array(z.string()).length(2)).max(6).optional().describe('Pares de slots a trocar juntos mesmo sem conjunto que os ligue, ex.: [["garment","boot"]]. Testa os melhores candidatos de cada slot em todas as combinações, depois da busca normal.'),
      detail: z.boolean().optional().default(false).describe('Resposta completa: contexto do alvo, candidatos por slot (ids), alternativas que perderam, as notas que explicam cada bloco e o resumo da busca de complementos (centenas de tokens a mais). O padrão traz só os números, o caminho e os `alerts`.'),
      levelChecks: z.boolean().optional().default(true).describe('Para as peças que mudaram, compara a nova com a atual no refino e grau que você tem hoje e também nos ideais (`levelCheck`): mostra a peça que só vence evoluída, ou que vence agora e perde depois. false economiza cálculos.'),
      procHitsPerSecond: z.number().min(0.1).max(30).optional().describe('Ataques por segundo para estimar a média dos procs (cada ataque rola a chance). Sem isso, mostra 1, 3 e 5 por segundo; mais alvos atingidos por habilidade em área contam como mais ataques.'),
      countProcs: z.boolean().optional().describe('Conta, em cada build testada, todos os procs que ela oferece (inclusive os de peças recém-trocadas), em vez de só os de `effects`. Dobra o custo dos cálculos de builds com procs.'),
      complements: z.boolean().optional().default(true).describe('Buscar também cartas, encantamentos e rolagens catalogadas. false preserva a busca somente de peças.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino das peças testadas (inclusive as que a build já usa). Padrão: +12, o teto alcançável (acima disso é endgame alto); informe um valor, até +20, para mudar.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Teto de grau. Padrão: grau A, o ideal, nas peças que aceitam grau (inclusive as que a build já usa). Informe só para limitar: então testa sem grau e todos os graus até o teto, e a build base também deve respeitá-lo.'),
      candidatesPerSlot: z.number().int().min(1).max(60).optional().default(12),
      rounds: z.number().int().min(1).max(4).optional().default(2),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
      require: z.array(requireSchema).optional(),
    },
  }, (args) => operations.optimizeBuild(args).then(json));

  registerJsonTool<{ itemId: number; query?: string; limit?: number; detail?: boolean }>(server, 'slot_options', {
    title: 'O que uma peça aceita',
    description:
      'USE antes de montar variantes à mão, para não chutar ids. ' +
      'Para um item equipável, lista os encantamentos que cada soquete aceita (com id e nome) e diz qual categoria de cartas procurar em `search_items`. ' +
      'Evita chutar ids ao montar variantes. Use `query` para filtrar os encantamentos pelo nome.',
    inputSchema: {
      itemId: z.number().int(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(40),
      detail: z.boolean().optional().default(false).describe('Devolve os pools brutos do rAthena e do catálogo (milhares de tokens); o padrão é um resumo.'),
    },
  }, (args) => operations.slotOptions(args).then(json));
}

export { requireSchema, evaluate, itemLabel, deltaPct, meets, roundMetrics } from 'src/app/build-analysis/operations/optimize';
type TargetArg = z.infer<typeof targetSchema>;
