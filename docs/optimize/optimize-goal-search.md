# Busca orientada por metas no Greedy: Jor_ab02 (`feasible@budget`)

Dados: `docs/benchmarks/optimize-goal/feasible-at-budget.json` (gerado por
`$env:GOAL_BENCH=1; npx vitest run mcp/src/engine/goal-feasible.bench.spec.ts`). Orçamentos pequenos (300, 800, 2000); nenhuma
busca de 20 mil avaliações. Nada aqui prova que uma meta seja impossível.

## Fixture

`mcp/src/engine/__tests__/fixtures/jor-ab02.json`: snapshots locais (preset bruto de `parse_share_link`) dos quatro links
(`5hTy6pd` original, `L7P7qcS` grau C, `GIPObNf` Armadura Invernal, `0TdaENM` sem grau na arma) e os monstros 21544, 21545, 21542,
21601, 21539. Os testes não leem URLs. `jor-ab02.spec.ts` confere: o original abate em 3/4/3/3/3 golpes e as três soluções em 2/2/2/2/2
(dois pontos cruzados com o MCP: grau C no 21544 = 2, original no 21545 = 4).

As soluções mudam atributos (VIT 120→100, SOR 63→105, e na última INT/DES), nível de Fé Poderosa e consumáveis, que o Greedy não
altera. Por isso há dois inícios, sem tocar o original:

| início | estado | uso |
|---|---|---|
| `gear-only` | equipamentos do original + atributos, habilidade e consumáveis da solução grau C (diferença registrada e testada: só `vit`, `luk`, `activeSkillMap`, `activeSkills`, `consumables`) | o Greedy consegue chegar às soluções com os movimentos que tem |
| `original` | o link original, sem alterar nada | cenário completo: a meta pode ficar fora do alcance de movimentos de equipamento; é medido, não exigido |

## Metas

- `hits2`: 2 golpes em cada um dos 5 monstros. O original a cumpre com poucos movimentos; **não discrimina** (≤ 300 avaliações).
- `hits2-margin10`: 2 golpes com 10% de folga (`margin: 0.1`). Original, grau C e sem grau não a cumprem em todos os monstros; a
  Armadura Invernal cumpre (prova de existência no espaço, com `maxGrade C`, `maxRefine 12`, sem violar constraints).

## Resultado (`hits2-margin10`)

`primeira` = avaliações contadas (as do orçamento) / avaliações únicas reais, até a primeira solução viável.

| início | escopo | orçamento | viável | primeira (contadas / únicas) | melhor distância (se não viável) |
|---|---|---:|:-:|---|---|
| gear-only | 5 monstros | 300 | sim | 180 / 267 | |
| gear-only | 5 monstros | 800 | sim | 289 / 320 | |
| gear-only | 5 monstros | 2000 | sim | 619 / 634 | |
| gear-only | cada monstro | 300 | sim (5/5) | 100–180 | |
| gear-only | cada monstro | 800 | sim (5/5) | 245–281 | |
| original | 5 monstros | 300 | **não** | | 0,031 |
| original | 5 monstros | 800 | sim | 500 / 723 | |
| original | 5 monstros | 2000 | sim | 684 / 715 | |
| original | 21545 | 300 | **não** | | 0,031 |
| original | demais monstros | 300 | sim (4/5) | 100–300 | |
| original | cada monstro | 800 | sim (5/5) | 245–368 | |

Leitura:

- **Orçamento insuficiente**, não falha de descoberta nem restrição do espaço: os dois casos inviáveis (original, 5 monstros e
  21545 @300, distância 0,031) são cumpridos com 800. O espaço de equipamentos do original contém solução viável.
- **Restrição do espaço**: as soluções de referência também mexem em atributos e consumáveis, mas a meta testada foi alcançada só com
  equipamentos; não houve caso em que a meta ficasse fora do alcance dos movimentos autorizados. Uma meta mais dura (ex.: 1 golpe)
  seria restrição do espaço (as referências chegam a ~26 M de dano contra 41–49 M de HP), mas isso não foi medido nesta rodada.
- **Falha de descoberta**: nenhuma observada com o espaço e os orçamentos usados.
- A "primeira viável" cresce com o orçamento (180, 289, 619): o plano unificado escala os tetos de descoberta com o orçamento, então a
  trajetória muda; é cobertura do plano, não ordem fixa da busca. Não é uma curva monótona de qualidade.

## Custo das avaliações dos alvos adicionais (medido, sem refatorar o orçamento)

Para a meta com N alvos, cada candidato aceito ou comparado lê os outros N−1 monstros. Essas leituras são avaliações reais do motor, mas
ficam fora de `solves` (a unidade do orçamento é "uma avaliação contra o primeiro alvo"). Medido em 5 monstros
(`feasibility.search.evaluations`):

| orçamento | contadas (`solves`) | alvos adicionais | únicas reais | real / contado |
|---:|---:|---:|---:|---:|
| 300 | 300 | 188 | 504 | 1,68× |
| 800 | 800 | 400 | 1216 | 1,52× |
| 2000 | 2000 | 1052 | 3068 | 1,53× |

O custo real fica em ~1,5–1,7× o orçamento com 5 alvos, e 1,03× com um alvo (as ~8 restantes são verificação final). Decisão: manter
`solves` como está (comparabilidade com os benchmarks anteriores) e reportar os dois números em `feasibility.search.evaluations`
(`counted`, `otherTargets`, `unique`); `firstFeasible` traz `evaluations` e `unique`. Uma reforma do orçamento só se justificaria se o
tempo de parede passar a ser o limite.

## Refinamento de soquetes orientado só por DPS

Investigado. No estado inviável final de `original/5 monstros/300`, varri os 26 campos de soquete e comparei o melhor candidato por DPS
com o melhor pela ordem da meta: em 4 dos 26 campos (`headUpperEnchant3`, `bootEnchant2`, `accLeftEnchant1`, `accRightEnchant2`) o
candidato de maior DPS não aproxima da meta (em `headUpperEnchant3` até afasta, 0,0333 contra 0,0310) enquanto outro aproxima (até
0,0136). Ou seja, o cego existe no nível do campo.

Porém **não se confirmou perda fim a fim**: com 300 avaliações o polish alcança 1 de 26 campos (limite de orçamento), e quando recebe
orçamento (700), o estágio de ajuste das peças, que já aceita pela meta, fecha a distância antes. Testei trocar a escolha do vencedor do
campo pela ordem da meta: o resultado não mudou e o polish passou a custar 4 a 8× mais avaliações únicas (150 contra 34; 771 contra 95),
fora do orçamento. Revertido. Não há regressão a adicionar enquanto não existir um caso em que só o polish decida. Mantidos: o contador
`socketFieldsRefusedByGoal` (0 em todas as rodadas acima) e a limitação documentada.

## Veredito

Os testes de comportamento (`goal-search.spec.ts`, `jor-ab02.spec.ts`) e os golden estão verdes; a meta é cumprida pelo Greedy com os
orçamentos medidos em todos os monstros, no início `gear-only` e a partir do original. Limitações em aberto: polish ranqueia por DPS;
custo real dos alvos extras ~1,5× fora de `solves`; um único jogo de monstros e uma única classe (Inquisidor).
