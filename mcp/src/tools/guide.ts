/**
 * `guide`: the how-to the server instructions cannot carry. The instructions are paid in every conversation, so they stay short and
 * point here; a topic costs tokens only when an agent asks for it. Keep each topic to the decisions (which tool, which arguments,
 * how to read the answer), not a restatement of the tool descriptions.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { json, registerJsonTool } from './helpers';

export const GUIDE_TOPICS: Record<string, { title: string; text: string }> = {
  consultoria: {
    title: 'Roteiro para melhorar uma build conversando',
    text:
      '1) `validate_build` no link: corrija o que for erro antes de medir e leia `unknowns`. 2) `explain_damage` (e `get_skill`) para ver o que a habilidade escala e o que mais pesa na fórmula. ' +
      '3) Busque candidatos com `search_items`: slot, classId, `bonus`/`skill`/`synergy`, `maxLevel`, `excludeMvpCards` se a pessoa não quer carta de MVP, `withBonuses` para ler o que cada um faz. `get_item` traz `partners` (conjuntos e combos) e `slot_options` os encantamentos. ' +
      '4) Teste em lote com `evaluate_variants` (patches independentes; mantenha refino e grau da peça atual quando a pergunta for "no mesmo nível"; conjunto = as peças juntas na mesma variante). ' +
      '5) Confirme o vencedor com `explain_damage` e em outro alvo (normal e chefe, Médio e Grande). 6) Diga o que foi testado: é a melhor entre as testadas, não a melhor possível; não some ganhos de variantes isoladas.',
  },
  'pesquisar-sinergias': {
    title: 'Pesquisar e testar combinações para uma habilidade',
    text: 'Use get_skill com classId e skill (nome pt-BR, interno ou id): leia descrição, tempos e scaling. Para Fogueira Espiritual, HP máximo entra na fórmula: pesquise HP/HP%/VIT. ' +
      'search_items com classId, skill e synergy:true encontra bônus diretos e dependências documentadas; slot aceita equipamentos, enchant, headCard, weaponCard etc. ' +
      'get_item traz descrição e bônus de cada candidato; slot_options informa os encantamentos e seus limites. Teste hipóteses completas com evaluate_variants, incluindo procMode:average e procHitsPerSecond quando fizer sentido. ' +
      'Não precisa chamar optimize_build. Dependências não documentadas são desconhecidas, não prova de ausência de efeito. Observe nível mínimo: Nebulosa requer 240.',
  },
  fluxo: {
    title: 'Por onde começar',
    text:
      '1) Se a pessoa colou um link, use-o em `build.share`; senão monte a build (list_classes → list_skills → search_items). ' +
      '2) `calculate` dá o número base e é a referência dos campos de `build`. 3) `explain_damage` mostra de onde vem o dano e o que ele não conta. ' +
      '4) Para auditar: `validate_build`. Para melhorar: `optimize_build` (build inteira), `scan_slot` (achar a peça improvável de um slot), `optimize_slot` (poucos candidatos conhecidos), ' +
      '`evaluate_variants` (hipóteses suas, em lote), `optimize_stats` (atributos). 5) Devolva sempre o `share` do resultado. ' +
      'Antes de otimizar, entenda a situação e os limites; escolha o alvo (`ler-resposta`/`alvos`) e o objetivo (`perfil`). A busca automática é opcional; a calculadora oferece a mesma busca sem IA no botão Encontrar melhorias.',
  },
  'melhorar-build': {
    title: 'Melhorar uma build',
    text:
      'Defina alvo, perfil, peças a manter e patamar de refino/grau. Consulte `get_item`, `slot_options` e `list_skills`; use `evaluate_variants` para suas hipóteses. ' +
      'Quando uma busca automática ajudar, chame `optimize_build` com esses limites e o link. Por padrão ele ajusta primeiro a peça que a build já usa (cartas, encantamentos, rolagens catalogadas), depois troca peças, ' +
      'cartas e encantamentos, e testa tudo com refino +12 e grau A: para uma evolução parcial informe `refine`, `maxGrade`, `slots`/`lock`, `candidates` e `exclude`. Não classifique early/mid/endgame por dano: preço e obtenção não são conhecidos. Passe `targets` com um monstro normal e um chefe ' +
      '(e Médio e Grande) se a build serve para os dois. Se `stopped` aparecer, restrinja `slots`, fixe `candidates` ou suba `maxSolves`. ' +
      'Depois: `explain_damage` com `parts: ["upgrades"]` ordena onde investir refino, grau e nível de encantamento; `optimize_stats` redistribui atributos. ' +
      'A poção de ASPD vem em `aspdPotionCheck`. `levelCheck` diz se uma peça nova só vence evoluída. Itens com bônus aleatório sem pool confirmado ficam fora da busca de rolagens: `uncatalogued_pools` lista quais.',
  },
  'comparar-pecas': {
    title: 'Comparar peças ou builds',
    text:
      'Poucos ids conhecidos de um slot: `optimize_slot` (cada candidato entra com os melhores soquetes; `complements: false` compara peças nuas). ' +
      'Hipóteses variadas (trocar peça + carta + buff): `evaluate_variants`, até dezenas por chamada; use `slot_options` antes para não chutar ids de encantamento. ' +
      'Builds inteiras distintas: `compare_builds`. Máscaras que ocupam Meio e Baixo disputam os dois slots: compare-as com o par separado, não só no Meio.',
  },
  'achar-peca-improvavel': {
    title: 'Achar a peça que ninguém esperava',
    text:
      '`scan_slot` mede com o motor todos os itens do LATAM que a classe usa no slot, sem filtro por palavra-chave. Compara contra a peça atual afinada (`base: "tuned"`). ' +
      'Os `topSockets` melhores recebem a busca de soquetes e rolagens. Cada linha traz `partners`: parceiros de conjunto em outros slots, que só valem testados juntos ' +
      '(`evaluate_variants` com as duas trocas, ou `optimize_build` com `pairs`). Repita por slot; use `query` para restringir (ex.: "Soqueira"). ' +
      'Confirme o vencedor com `explain_damage` antes de recomendar.',
  },
  alvos: {
    title: 'Escolher o alvo',
    text:
      'O alvo padrão (Dummy - Neutro, id 21077) não tem DEF, DEFM, TEN nem TENM: penetração e redução de TEN valem zero nele e o dano parece maior do que é. ' +
      'Prefira um chefe real (`search_monsters`) ou os dummies com defesa: 9000001 normal médio, 9000002 chefe médio (defesa média), 9000003 normal grande, ' +
      '9000004 chefe grande (defesa alta). Se o alvo ficar sem defesa, `defendedCheck` repete o resultado em dois dummies. ' +
      'Chefe e normal diferem (bônus e penetração por classe) e Médio e Grande diferem (penalidade de tamanho da arma): passe `targets` com mais de um e leia `perTarget`.',
  },
  perfil: {
    title: 'Build de burst ou de DPS sustentado',
    text:
      '`profile` vale para `optimize_build` e `scan_slot`. `profile: "sustained"` (padrão) julga o ciclo da rotação em regime (`rotationDps`; `dps` sem rotação): ASPD, conjuração variável e fixa, pós-conjuração e recarga contam. ' +
      '`profile: "burst"` julga a abertura da rotação com as recargas livres (`burstDps`; `avgHit` sem rotação). `profiles` na resposta mostra os dois para a base e a final. ' +
      '`max` é o golpe máximo e ignora crítico e acerto: evite como objetivo. Passe a `rotation` da pessoa para os dois perfis fazerem sentido.',
  },
  'proc-ou-estavel': {
    title: 'Proc ou peça estável',
    text:
      'O DPS com proc é medido com ele ligado o tempo todo. Em `optimize_build`, `procs[].average` traz a chance, a duração, o tempo ativo e o ganho médio por 1, 3 e 5 ataques por segundo ' +
      '(`procHitsPerSecond` fixa um valor; habilidade em área e mapa cheio contam como mais ataques). Chance baixa com duração curta rende bem menos que o ganho ligado. ' +
      'Use procMode:off, active ou average. optimize_build usa average por padrão; effects sempre representa efeitos explicitamente ligados. A média usa chance/duração conhecidas, ataques regulares e até três procs independentes; consulte procContext para o que ficou fora e os números sem procs adicionais. Não trate o pico como dano garantido.',
  },
  'ler-resposta': {
    title: 'Como ler a resposta de optimize_build',
    text:
      '`changes`: o que pôr onde, em palavras (peça, refino, grau, soquetes, rolagens). `gainByKind`: quanto do ganho é `ajuste` da peça atual, `refinoGrau` (subir o que você já usa até +12/A) e `troca` de peça: leia este antes de prometer "+100%". `steps`: o caminho, cada passo com seu `kind`. `patch`/`share`: a build final (`share` para reabrir ou continuar). Toda peça sugerida já é do LATAM (o que não é fica fora). ' +
      '`profiles`: sustentado e burst. `perTarget`: resultado em cada alvo. `levelCheck`: por peça trocada, o ganho no refino/grau de hoje (`now`) e nos ideais (`evolved`) e o `verdict`. ' +
      '`alerts`: o que muda a leitura (alvo sem defesa, classe do alvo, penalidade de tamanho, ACERTO/ASPD, rolagens fora do catálogo). ' +
      '`unconfirmedRolls`: rolagens vindas do rAthena (kRO), não confirmadas no LATAM. `detail: true` traz o contexto do alvo, candidatos, alternativas e as notas de cada bloco.',
  },
  tank: {
    title: 'Builds de tank',
    text:
      'O MCP ainda não calcula dano recebido nem HP efetivo (está no backlog). O que dá hoje: `optimize_build` com `objective: "hp"` e `require` para pisos (por exemplo `def`, `mdef`, `flee`), ' +
      'e `explain_damage`/`slot_options` para ler o que cada peça traz. Diga à pessoa que a sobrevivência contra um ataque específico não é medida.',
  },
};

export function registerGuideTool(server: McpServer): void {
  registerJsonTool<{ topic?: string }>(server, 'guide', {
    title: 'Guia de uso',
    description:
      'USE quando não souber qual ferramenta chamar, como escolher o alvo ou como ler uma resposta. Sem `topic` devolve o índice; com `topic` devolve a receita. ' +
      `Tópicos: ${Object.keys(GUIDE_TOPICS).join(', ')}.`,
    inputSchema: { topic: z.enum(Object.keys(GUIDE_TOPICS) as [string, ...string[]]).optional() },
  }, ({ topic }) => {
    if (!topic) {
      return json({
        topics: Object.fromEntries(Object.entries(GUIDE_TOPICS).map(([key, entry]) => [key, entry.title])),
        hint: 'Chame de novo com `topic`.',
        limits: { maxSolves: config.limits.maxSolves, maxSearchMs: config.limits.maxSearchMs },
      });
    }

    return json(GUIDE_TOPICS[topic]);
  });
}
