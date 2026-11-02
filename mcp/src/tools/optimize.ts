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
import { createSynergyOperations, FindSynergiesArgs } from 'src/app/build-analysis/operations/synergies';

const metricEnum = z.enum(METRICS);

const variantSchema = z.object({
  label: z.string().min(1).max(80).describe('Nome curto para reconhecer a variante na resposta.'),
  patch: compactPatchSchema.describe('Só o que muda em relação à build base. Mapas (gear, stats, skills, options) mesclam por chave.'),
});

export function registerOptimizationTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  const operations = createOptimizationOperations(dataset, config, shortener);
  const synergies = createSynergyOperations(dataset, config, shortener);
  registerJsonTool<FindSynergiesArgs>(server, 'find_synergies', {
    title: 'Consultar requisitos de conjuntos',
    description: 'Consulta conjuntos: allOf/anyOf e expressão original. equipmentRequirementsMet só confere equipamentos. includePatches gera patches legais e verifica ativação no motor. Confirme o ganho em evaluate_variants.',
    inputSchema: {
      build: compactBuildSchema.optional(),
      itemIds: z.array(z.number().int().positive()).min(1).max(30).optional().describe('Itens de interesse; inclui referências inversas e itens da build.'),
      bonusKeys: z.array(z.string()).min(1).max(30).optional().describe('Filtrar pelas chaves mecânicas informadas.'),
      limit: z.number().int().min(1).max(30).optional(),
      offset: z.number().int().min(0).optional(),
      includePatches: z.boolean().optional().describe('Requer build. Busca limitada, sem upgrades implícitos.'),
      target: targetSchema,
      lock: z.array(z.string()).optional().describe('Slots preservados nos patches.'),
      exclude: z.array(z.number().int()).optional().describe('IDs proibidos nos patches.'),
      mvpPolicy: z.enum(['allow', 'exclude-new', 'none']).optional().describe('Política de MVP dos patches; padrão allow.'),
      allowChanges: z.array(z.enum(['refine', 'grade', 'stats', 'skills'])).optional().describe('Autoriza estas mudanças adicionais nos patches. Padrão: só equipamentos/soquetes.'),
      maxRefine: z.number().int().min(0).max(20).optional(),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional(),
    },
  }, args => synergies.findSynergies(args).then(json));
  registerJsonTool<{
    procMode?: ProcMode;
    procHitsPerSecond?: number;
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    variants: { label: string; patch: BuildPatch }[];
    targets?: { monsterId: number }[];
    validationMode?: 'strict' | 'hypothetical';
    excludeMvpCards?: boolean;
    metrics?: Metric[];
    require?: z.infer<typeof requireSchema>[];
    sortBy?: Metric;
    limit?: number;
  }>(server, 'evaluate_variants', {
    title: 'Avaliar variantes de uma build',
    description:
      'Testa hipóteses em lote: peças, cartas, enchants, buffs, atributos e skills. patch mescla overrides de build por chave. Retorna métricas ordenadas e links dos três primeiros. ' +
      'Padrão: só variantes legais; validationMode:hypothetical permite hipóteses explícitas. require impõe pisos/tetos; rotationDps lê rotation. Para descobrir candidatos: search_items, find_synergies ou scan_slot. ' +
      `Máximo de ${config.limits.maxVariants} variantes por chamada.`,
    inputSchema: {
      procHitsPerSecond: z.number().min(0.1).max(30).optional(),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('off: desligados; active: ativos; average: média por chance/duração. Optimize usa average; demais buscas off. Desconhecidos não são assumidos ativos.'),

      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional().describe('Efeitos de proc a ativar em todas as variantes (veja `availableEffects` de `calculate`).'),
      variants: z.array(variantSchema).min(1),
      targets: z.array(z.object({ monsterId: z.number().int() })).min(1).max(5).optional().describe('Substitui target. Retorna perTarget; ordena pelo primeiro (rankingTarget), sem agregar DPS. require vale em todos.'),
      validationMode: z.enum(['strict', 'hypothetical']).optional().describe('strict (padrão): só variantes legais. hypothetical: permite erros herdados e excesso de pontos, com status hypothetical e avisos. Novos erros estruturais são recusados.'),
      excludeMvpCards: z.boolean().optional().describe('strict recusa qualquer MVP; hypothetical tolera apenas as herdadas. Retorna MVP_CARD_EXCLUDED para variantes recusadas.'),
      metrics: z.array(metricEnum).optional().describe(`O que devolver. Padrão: ${DEFAULT_METRICS.join(', ')}.`),
      require: z.array(requireSchema).optional(),
      sortBy: metricEnum.optional().describe('Métrica de ordenação (maior primeiro, exceto hitsToKill: menor primeiro). Padrão: dps.'),
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
      'Explora itens LATAM de um slot, legais para classe/nível, sem filtro prévio por bônus. Para poucos IDs use optimize_slot; para a build inteira, optimize_build. ' +
      'Mede peças nuas e ajusta soquetes/rolagens nos topSockets melhores. base:tuned compara com a peça atual ajustada; current preserva como veio. Refino/grau usam +12/A ou os limites pedidos. ' +
      'partners indica conjuntos para testar juntos em evaluate_variants. includePatches devolve as configurações medidas. Busca limitada por tempo e avaliações: confira stopped.',
    inputSchema: {
      procHitsPerSecond: z.number().min(0.1).max(30).optional(),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('off: desligados; active: ativos; average: média por chance/duração. Optimize usa average; demais buscas off. Desconhecidos não são assumidos ativos.'),

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
    parts?: ('stages' | 'contributions' | 'warnings' | 'refine' | 'upgrades' | 'crit')[];
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
      parts: z.array(z.enum(['stages', 'contributions', 'warnings', 'refine', 'upgrades', 'crit'])).optional().describe('Padrão: stages, contributions, warnings e crit (chance efetiva de crítico da habilidade contra o alvo, com cada termo). `upgrades` ordena o que vale mais investir: refino, grau, nível de cada encantamento e encantar um soquete vazio. `refine` mostra o ganho de +1 e +2 refinos em cada peça (custo: uma conta por peça e nível).'),
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
    strictMvp?: boolean;
    mvpPolicy?: 'allow' | 'exclude-new' | 'none';
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
      'Busca automática de equipamentos pelo mesmo core da UI: subida de encosta, complementos legais e pares de peças. Não redistribui atributos (optimize_stats). ' +
      'combos testa pares citados nos scripts; pairs permite outros pares. targets usa pesos; candidates fixa opções; lock/exclude/require impõem restrições. Retorna caminho, ganhos e patch para evaluate_variants. ' +
      'procs mostra efeitos ainda não contados; effects ativa os indicados. Heurística limitada, sem garantia global; confira coverage e stopped. Pools desconhecidos não são inventados. Para hipóteses pontuais use evaluate_variants; para um slot use optimize_slot ou scan_slot.',
    inputSchema: {
      equipmentMode: z.enum(['current', 'replace']).optional().describe('current mantém peças, refino e grau e ajusta só complementos. replace (padrão) procura substituições e upgrades.'),
      procMode: z.enum(['off', 'active', 'average']).optional().describe('off: desligados; active: ativos; average: média por chance/duração. Optimize usa average; demais buscas off. Desconhecidos não são assumidos ativos.'),

      build: compactBuildSchema,
      target: targetSchema,
      targets: z.array(z.object({ monsterId: z.number().int(), weight: z.number().positive().optional() })).min(1).max(5).optional()
        .describe('Alvos com peso (padrão 1). Vale para max, min e dps; as demais métricas não dependem do alvo.'),
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: o do `profile`.'),
      profile: z.enum(['sustained', 'burst']).optional().describe('sustained (padrão): rotationDps, ou dps sem rotação. burst: abertura com recargas livres (burstDps), ou avgHit sem rotação. Retorna os dois perfis.'),
      slots: z.array(z.string()).optional().describe('Slots a percorrer. Padrão: equipamentos e peças sombrias.'),
      lock: z.array(z.string()).optional().describe('Slots que não mudam.'),
      exclude: z.array(z.number().int()).optional().describe('Ids de itens que não podem entrar.'),
      excludeMvpCards: z.boolean().optional().describe('Não recomenda carta que cai de MVP (por carta, não pelo alvo). Uma carta de MVP que você já usa é mantida e sai em `alerts`.'),
      mvpPolicy: z.enum(['allow', 'exclude-new', 'none']).optional().describe('allow permite MVP; exclude-new mantém as existentes; none remove todas. Prevalece sobre as flags legadas; ausente, preserva seu comportamento.'),
      strictMvp: z.boolean().optional().describe('Legado de mvpPolicy:none: remove MVP existentes, busca soquetes sem MVP e retorna mvpFree. Falha se uma carta estiver em peça travada.'),
      candidates: stringMap(z.array(z.number().int()).max(60)).optional().describe('Itens a testar por slot, no lugar da seleção automática. Ex.: { "boot": [470069, 470115, 470094] }.'),
      combos: z.boolean().optional().default(true).describe('Testar também trocas de duas peças ligadas por um conjunto.'),
      pairs: z.array(z.array(z.string()).length(2)).max(6).optional().describe('Pares de slots a trocar juntos mesmo sem conjunto que os ligue, ex.: [["garment","boot"]]. Testa os melhores candidatos de cada slot em todas as combinações, depois da busca normal.'),
      detail: z.boolean().optional().default(false).describe('Inclui contexto do alvo, IDs candidatos, alternativas, notas e resumo de complementos. Padrão: números, caminho e alerts.'),
      levelChecks: z.boolean().optional().default(true).describe('Compara peças trocadas no refino/grau atual e nos ideais (levelCheck). false economiza avaliações.'),
      procHitsPerSecond: z.number().min(0.1).max(30).optional().describe('Ataques por segundo para estimar a média dos procs (cada ataque rola a chance). Sem isso, mostra 1, 3 e 5 por segundo; mais alvos atingidos por habilidade em área contam como mais ataques.'),
      countProcs: z.boolean().optional().describe('Inclui procs de todas as peças testadas além de effects. Aumenta o custo. Prefira procMode explícito.'),
      complements: z.boolean().optional().default(true).describe('Buscar também cartas, encantamentos e rolagens catalogadas. false preserva a busca somente de peças.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino testado, inclusive nas peças atuais. Padrão +12; sombrios respeitam +10.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Teto de grau, padrão A. Se informado, testa sem grau e até o teto; a build inicial também deve respeitá-lo.'),
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
