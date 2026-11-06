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

## Resultado (`hits2-margin10`) — contagem anterior, mantido como estava

> Tabela da primeira rodada, quando as leituras dos alvos adicionais **não** entravam no orçamento. Não foi reescrita; os números
> com a contagem corrigida estão em "Contagem corrigida e variante restrita", abaixo. O arquivo `feasible-at-budget.json` é dessa rodada.

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

## Custo das avaliações dos alvos adicionais — diagnóstico da contagem anterior

Para a meta com N alvos, cada candidato aceito ou comparado lê os outros N−1 monstros. Essas leituras são avaliações reais do motor, mas
ficam fora de `solves` (a unidade do orçamento é "uma avaliação contra o primeiro alvo"). Medido em 5 monstros
(`feasibility.search.evaluations`):

| orçamento | contadas (`solves`) | alvos adicionais | únicas reais | real / contado |
|---:|---:|---:|---:|---:|
| 300 | 300 | 188 | 504 | 1,68× |
| 800 | 800 | 400 | 1216 | 1,52× |
| 2000 | 2000 | 1052 | 3068 | 1,53× |

O custo real ficava em ~1,5–1,7× o orçamento com 5 alvos. **Corrigido** na seção seguinte: as leituras agora gastam o orçamento.

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

## Contagem corrigida e variante restrita (04/11/2026)

### O que mudou na contagem

- `spent()` = 1 + avaliações novas − as do polish; agora **inclui as leituras dos outros alvos** (antes só o primeiro). O orçamento unificado
  (`floor(solicitado × (1 − reserva))` com complementos) continua sendo o limite de cada fase.
- **Orçamento esgotado:** quando a fase não tem mais saldo, o candidato **não** ganha leituras novas: fica sem julgamento (`skippedForBudget`),
  não pode vencer, e o limite não é excedido. As leituras do **baseline** são obrigatórias (o ponto de partida precisa ser julgado).
- **Fora do orçamento, registrado à parte:** `afterSearch` (relatórios depois da busca: ~17) e `finalChecks` (julgamento independente da
  base e da resposta, `2 × alvos` execuções, obrigatório). `unique` é o total real de avaliações.
- `feasibility.search.evaluations = { counted, otherTargets, skippedForBudget, afterSearch, unique, finalChecks }`. Com a contagem
  corrigida, `unique − afterSearch = counted − 1` e o custo real fica em ~1,01–1,09× o orçamento (os ~26 restantes são relatório e
  verificação final), contra 1,5–1,7× antes. Com um alvo nada muda (`otherTargets: 0`, `skippedForBudget: 0`).
- Sem `GoalSpec`/constraints o caminho não mudou (golden e `optimize-budget` verdes).

### Auditoria da fixture

O benchmark original (**`math`**: `maxGrade C`, `maxRefine 12`) **não** aplicava MVP, Abrasivo, Oleum nem travas; foi mantido como
benchmark matemático e ganhou a variante **`scenario`**, que aplica as restrições do estudo e audita cada resposta:

| regra do estudo | como é aplicada | verificada em |
|---|---|---|
| `mvpPolicy: none` (sem carta MVP) | `constraints.mvpPolicy` | `audit` (`MVP_CARD_EXCLUDED`) |
| grau máximo C | `maxGrade: 'C'` | `audit` (`GRADE_ABOVE_MAX`) |
| Abrasivo (14536) e Casaco Pirata (480174) fora | `unavailableIds` | `audit` |
| Oleum Sanctum desligado | `forbiddenEffects` | `audit` (`FORBIDDEN_EFFECT_ACTIVE`) |
| Insígnia do Talento 5 (`headUpperEnchant1`) e Cordão do Inquisidor (sem encantos novos) | `lockedSlots: ['headUpper','accRight']` | `audit` (`FIELD_LOCK`) |

Controles negativos em `jor-ab02.spec.ts` provam que a auditoria acusa cada tipo de quebra. Resultado: **`scenario`: auditoria vazia em
todas as respostas**; **`math`: 2 violações a partir de 800 e 5 em 2000** (esperado: é o benchmark sem as regras). Consumíveis, atributos
e buffs ficam fora do espaço do Greedy: as respostas não os alteram, e o `gear-only` já os traz da solução de referência.

**Limitação:** a trava do motor é por **slot inteiro**, não por campo. Travar `headUpper` e `accRight` é mais estreito que o estudo
(que só fixa a Insígnia e os encantos do Cordão); o resto desses slots (refino, carta) também fica parado. A auditoria confere o campo exato.

### Resultado com a contagem corrigida (`hits2-margin10`, 5 monstros, `scenario`)

`primeira` = avaliações contadas / únicas até a primeira solução viável. Todas com `damageFeasible: true`.

| início | orçamento | viável | primeira (contadas / únicas) | confiabilidade do abate | custo real / orçamento |
|---|---:|:-:|---|---|---:|
| gear-only | 300 | sim | 247 / 246 | condicional | 1,09× |
| gear-only | 800 | sim | 299 / 298 | condicional | 1,03× |
| gear-only | 2000 | sim | 657 / 656 | garantido | 1,01× |
| original | 300 | **não** (distância 0,083 / total 0,137) | | | 1,09× |
| original | 800 | sim | 608 / 607 | condicional | 1,03× |
| original | 2000 | sim | 996 / 995 | condicional | 1,01× |

Por monstro (scenario, 300/800): viável em todos os 10 casos de cada início, primeira entre 93 e 439. `math` e `scenario` coincidem
no que é viável (os mesmos dois casos inviáveis a 300): as regras do estudo não custaram viabilidade nesta meta. Na variante `hits2`
(meta sem folga) o `scenario` é viável a 300 nos dois inícios.

**`damageFeasible` ≠ confiabilidade:** a resposta mata em 2 golpes com o dano mínimo (`damageFeasible`), mas, sem piso de crítico/precisão
pedido, a confiabilidade é `conditional`; só a de 2000 a partir do `gear-only` e a Armadura Invernal de referência são `guaranteed`.

### Patch das soluções (gear-only, 300, scenario — a menor)

Arma Garra Primordial-LT +11→+12 e grau C; Traje do Lobo Cinzento +11→+12; Manto Temporal AGI +8→+12; Bota Temporal SOR →
Bota Primordial-LT +4→+12 grau C (encantos vazios); Escudo Sombrio Mega Repente +9→+10. Sem carta MVP, sem Abrasivo/Casaco Pirata, sem
Oleum, sem mexer em Insígnia/Cordão. O `original` a 800 acrescenta Escudo Ilusión B → Coelho Macabro-LT +12 grau C com Variação Física 1,
Coleira de Espinhos (headLower) e Orbe Lupino (FOR 2 no anel, Bárbaro 2 no traje). Patches completos de cada linha:
`docs/benchmarks/optimize-goal/feasible-at-budget-counted.json`.

### Regressões de generalização (`goal-generalization.spec.ts`, orçamentos ≤ 600)

- **Classe mágica (Magus, Crimson Rock) e segunda física (Windhawk, Crescive Bolt):** meta de farm de 5 golpes no Mímico do Vazio é
  inviável no início e cumprida com 300 avaliações em ambas.
- **Inviável por restrição explícita:** com todos os slots principais travados, 0 passos, `stoppedBy: 'completed'` (a busca acabou, não
  faltou orçamento), distância > 0, sem violações; o controle sem trava é viável.
- **O pior monstro decide:** Magus contra 3 monstros em ≤ 8 golpes; com 300 só o Mímico fica de fora (`worstTarget` = Mímico,
  `stoppedBy: 'search-budget'`), com 600 os três são cumpridos e a primeira viável custa mais que a do Mímico sozinho.
- **Alvos adicionais custam orçamento** (`goal-search.spec.ts`): leituras gastam saldo, nada além de `counted ≤ orçamento`, `search.feasible`
  coincide com o julgamento final, `finalChecks = 2 × alvos`. O teste do alvo secundário passou de 600 para 1500: a primeira viável agora
  custa 716 contadas (com 900 ainda faltam 2,7%), é efeito de contagem, não degradação.

## Veredito

Os testes de comportamento e os golden estão verdes; a meta é cumprida dentro das regras do estudo (auditoria vazia) a partir do
`gear-only` com 300 e do original com 800. Limitações em aberto: polish ranqueia por DPS; trava só por slot inteiro; um único jogo de
monstros de farm real (Inquisidor) mais duas classes só com builds nuas; `reliability` costuma ser `conditional`; sem Beam/VNS.
