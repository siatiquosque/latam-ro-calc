# Optimize: otimização direcionada do Greedy

Continuação de [optimize-budget-efficiency.md](optimize-budget-efficiency.md). Duas perguntas: (1) é seguro promover `socketRecheck: 'touched'`? (2) qual dos três esforços por slot causa a trajetória não monotônica? Nenhum padrão foi alterado.

Unidade, alvo e condições como nos relatórios anteriores (Betelgeuse 20994, refino 12, grau A, sem procs, tempo suspenso, busca determinística). Tabelas geradas por `node tools/optimize-targeted-report.mjs` a partir de `docs/benchmarks/optimize-budget/`.

## Resumo

| | Resultado |
|---|---|
| `touched` é seguro? | **Não.** Perdeu −0,72% num caso adversarial real; em 8 outros casos foi idêntico. Fica experimental. |
| Alternativa simples | `near`: peças não tocadas são re-verificadas só contra os 5 melhores candidatos medidos na 1ª passada. DPS idêntico em 13 de 13 casos (9 buscas reais, 1 busca real física, 3 estados adversariais), 151 a 1407 avaliações a menos (0,8% a 11%). |
| Causa da trajetória | **Só `fullEffort`.** `quickEffort` e `discoveryCap` não participam: resultado idêntico ao de 17000 quando planejados de 20000. |
| Menos avaliações com a mesma qualidade, além do `near` | **Não encontrei.** Estabilizar o `fullEffort` dá estabilidade, não economia. |

## 1. Segurança de `socketRecheck`

### 1.1 Teste adversarial

Fixture: o build b1 com **cada campo de carta sorteado** (sementes fixas, cartas legais), equipamento mantido (`equipmentMode: current`) e esforço planejado mínimo (300), de modo que o ajuste do que está vestido não conserte o estado antes da passada de soquetes. Os três modos partem do mesmo estado. Repetido em b2 (outro conjunto de cartas) e Windhawk (classe física com arco; vestida por uma primeira busca determinística de 4000 avaliações).

Resultado (tabela 4.1): em **b1, `touched` fica −0,72% abaixo de `all`**. A 2ª passada completa melhora `headMiddle.headMiddleCard` (+0,73%) depois que o elmo superior mudou; como o slot do elmo do meio não foi alterado na 1ª passada, `touched` não o re-verifica. É dependência entre peças diferentes, que o índice de sinergias não representa (o elmo do meio não é parceiro de conjunto do superior). `near` recupera o mesmo valor que `all`. Em b2 e Windhawk os três modos coincidem.

Limite honesto: as cinco sementes de cada build convergem para o **mesmo** estado final (a 1ª passada reescolhe o melhor de cada campo, apagando o sorteio), então são três casos distintos, não quinze. Um deles é divergente.

### 1.2 A alternativa

Não implementei análise de dependências. `near` usa o princípio de que uma mudança em outra peça só pode reordenar o que já estava perto do topo: na 1ª passada guarda, por campo, os 5 melhores candidatos medidos; na 2ª, as peças tocadas são re-verificadas por inteiro e as demais só contra esses 5. Peças tocadas e campos sem registro caem no comportamento completo. Custo: ~5 avaliações por campo em vez de ~50 a 300.

Limite do princípio: um candidato fora dos 5 melhores da 1ª passada que passe a vencer por efeito de outra peça não seria encontrado. Nos 13 casos não ocorreu (o vencedor da 2ª passada estava entre os 5).

### 1.3 Economia (tabela 4.2)

Avaliações a menos em buscas reais (esforço planejado 10000 a 24000): b1 648 a 1407, inq 515 a 648, b2 151, weak 615; build física Windhawk 1334 (de 12056, 11%). Tempo: medido a sós em b1 (E=20000), 93,7 s para 89,2 s (−4,8%); na build física 47,8 s para 43,0 s (−10%). As demais linhas rodaram em paralelo e o tempo delas é ruído; a contagem de avaliações é a medida confiável. Equivale a cerca de 4,3 ms por avaliação.

## 2. Causa da trajetória não monotônica

Registro por decisão de slot (`slotLog`, só com `instrument`) de b1 e inq com esforço planejado de 17000 contra 20000, 47 decisões cada.

- `quickEffort` vale 8 em todas as decisões das duas execuções (saturado no teto do código) e `discoveryCap` (200 a 460) nunca é menor que o número de movimentos do slot (no máximo 122): **os dois não limitam nada**.
- `fullEffort` difere em 47 de 47 decisões (por exemplo 145 contra 176 na arma).
- Isolamento (tabela 4.3): com tudo planejado de 17000 e só `quickEffort` ou só `discoveryCap` de 20000, o resultado é **idêntico** ao de 17000 (3,847 M em b1; 1,102 M em inq). Com só `fullEffort` de 20000, sobe para 5,021 M e 1,442 M (o restante da diferença vem de outras partes do plano, a triagem e o ajuste do que está vestido, que não foram isoladas aqui).

### Primeiro ponto de divergência

- **Primeiro valor diferente**: rodada 0, slot arma. O melhor movimento é o mesmo nas duas execuções, mas o valor refinado difere (−0,39% em b1, −0,41% em inq): a busca de soquetes dos finalistas usa 145 contra 176 cálculos.
- **Primeira escolha diferente**: rodada 0, slot `headLower`. Com 17000 a peça é aceita (+1,3%); com 20000 não, porque o valor da build antes do slot já incluía o ganho. Dali em diante os estados acumulados diferem e o slot da armadura aceita um movimento diferente (só a armadura, contra o combo Armadura+Bota Invernal).

### Mecanismo

`searchComplements` (busca de soquetes de um movimento) é uma beam de largura 3 sobre os campos em ordem; o orçamento de cada etapa é proporcional ao número de escolhas do campo (`perStage`). Com orçamento menor que o total de escolhas (a arma tem centenas de cartas), os campos finais são truncados e o valor do movimento depende do orçamento de forma irregular. O esforço dos finalistas vem de `fullEffort = cota/3`, e a cota é função do teto de planejamento. Logo, o valor medido de um candidato, o ranking dos finalistas, qual peça é aceita e a ordem do Greedy variam com o teto. É a classe "a ordem de exploração modificou o caminho".

### Curva com profundidade fixa

Fixando `fullEffort` (resto planejado de 20000; tabela 4.4): b1 3,469 / 3,847 / 5,021 / 5,299 / 5,299 M para 100 / 150 / 200 / 300 / 500; inq 0,986 / 1,102 / 1,424 / 1,522 / 1,522 M. Ou seja, o DPS é **monotônico e saturante** na profundidade, e o "20000 funciona melhor" é só onde a cota cruza a saturação (cerca de 300) nos slots que contam; os resultados anteriores de 3,469, 3,847 e 5,021 são os degraus de 100, 150 e 200.

### O que isso não rende

Profundidade 300 com plano 14000 reproduz o melhor resultado (5,299 e 1,522 M), mas custa 23383 e 22889 avaliações contra 21654 e 21660 do plano 20000; com plano 10000 a triagem mede só 384 de 684 candidatos e perde 18%. Ou seja, a estabilidade custa cerca de 6% a 17% mais avaliações e **não é uma economia**.

## 3. Proposta (não implementada)

1. **Parada por estagnação dentro de `searchComplements`**: de 300 para 500 de profundidade, +2,9 mil avaliações sem ganho de DPS; a beam poderia encerrar quando duas etapas seguidas não melhoram o topo. Reduziria o custo da profundidade que estabiliza o resultado, sem depender do teto. Exige alterar a busca de complementos; fica como próxima tarefa com A/B próprio.
2. Se for desejado resultado independente do teto, usar profundidade fixa por slot (`fullFixed`, experimental) com a parada acima, e não a cota derivada do plano.

## 4. Resultados (gerados)

<!-- targeted:start -->
#### Sockets perturbados (cada campo de carta sorteado; equipamento mantido; os dois modos partem do mesmo estado)

| build | sementes | estados finais distintos | DPS all | avaliações all | ganhos na 2ª passada (all) | DPS touched | poupadas | DPS near | poupadas | campos que a 2ª passada alterou (all) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 5 | 1 | 1.186 | 3952 | 2 | 1.178 (-0.72%) | 307 | 1.186 (0.00%) | 282 | headUpper.headUpperEnchant1 +4.67% (rank 44/53); headMiddle.headMiddleCard +0.73% (rank 64/140) |
| b2 | 5 | 1 | 0.584 | 3377 | 4 | 0.584 (0.00%) | 148 | 0.584 (0.00%) | 133 | shield.shieldEnchant2 +0.37% (rank 4/24); shield.shieldEnchant3 +1.24% (rank 3/24); headUpper.headUpperCard +1.95% (rank 19/140); headUpper.headUpperEnchant3 +0.35% (rank 18/29) |
| wh | 5 | 1 | 0.531 | 3094 | 0 | 0.531 (0.00%) | 277 | 0.531 (0.00%) | 267 | — |

#### Buscas reais: all contra touched contra near (mesmo esforço planejado, mesmo estado inicial)

| build | esforço E | DPS all | avaliações all | touched: Δ DPS / avaliações poupadas | near: Δ DPS / avaliações poupadas | tempo all → near |
|---|---:|---:|---:|---:|---:|---:|
| b1 | 10000 | 3.165 | 14144 | 0.00% / 1488 | 0.00% / 1407 | 69.3 → 76.8 s |
| b1 | 14000 | 3.469 | 17639 | 0.00% / 1285 | 0.00% / 1201 | 81.1 → 92.3 s |
| b1 | 17000 | 3.847 | 19676 | — | 0.00% / 1008 | 89.7 → 98.6 s |
| b1 | 20000 | 5.299 | 21654 | 0.00% / 722 | 0.00% / 666 | 93.7 → 89.2 s |
| b1 | 24000 | 5.021 | 24145 | — | 0.00% / 648 | 107.4 → 116.2 s |
| inq | 20000 | 1.522 | 21660 | 0.00% / 551 | 0.00% / 515 | 95.7 → 123.7 s |
| inq | 24000 | 1.424 | 23881 | — | 0.00% / 648 | 104.1 → 124.0 s |
| b2 | 20000 | 1.561 | 20051 | 0.00% / 171 | 0.00% / 151 | 101.4 → 118.5 s |
| weak | 20000 | 5.288 | 21347 | 0.00% / 671 | 0.00% / 615 | 105.1 → 116.9 s |

Tempos: só a linha de b1 com E=20000 foi medida a sós (um processo); as demais rodaram com até seis processos em paralelo e o tempo delas é ruído. A economia confiável é a contagem de avaliações.

Busca completa de uma build física (Windhawk, arco; equipamento substituível; esforço 12000), um processo por vez:

| modo | DPS final | avaliações | avaliações nos soquetes | tempo |
|---|---:|---:|---:|---:|
| all | 691185 | 12056 | 3185 | 47.8 s |
| near | 691185 (0.00%) | 10722 | 1851 | 43.0 s |

#### Primeira divergência, b1: esforço 17000 contra 20000 (47 decisões por slot)

- Primeiro valor diferente: rodada 0, slot `weapon`: esforço completo 145 contra 176, melhor movimento o mesmo, valor 1433739 contra 1439316 (-0.39%), aceito true contra true.
- Primeira escolha diferente: rodada 0, slot `headLower`: esforço completo 141 contra 172, melhor movimento o mesmo, valor 1957392 contra 1965885 (-0.43%), aceito true contra false.
- `quickEffort` igual em todas as decisões: true. `discoveryCap` nunca menor que o número de movimentos do slot (não limita): true. `fullEffort` diferente em 47 de 47.

#### Primeira divergência, inq: esforço 17000 contra 20000 (47 decisões por slot)

- Primeiro valor diferente: rodada 0, slot `weapon`: esforço completo 145 contra 175, melhor movimento o mesmo, valor 409282 contra 410981 (-0.41%), aceito true contra true.
- Primeira escolha diferente: rodada 0, slot `headLower`: esforço completo 140 contra 171, melhor movimento o mesmo, valor 557429 contra 559891 (-0.44%), aceito true contra false.
- `quickEffort` igual em todas as decisões: true. `discoveryCap` nunca menor que o número de movimentos do slot (não limita): true. `fullEffort` diferente em 47 de 47.

#### Isolamento: um esforço por vez

| build | configuração | DPS final | vs tudo-20000 | avaliações |
|---|---:|---:|---:|---:|
| b1 | tudo planejado de 17000 | 3.847 | -27.41% | 19676 |
| b1 | 17000, quickEffort de 20000 | 3.847 | -27.41% | 19676 |
| b1 | 17000, discoveryCap de 20000 | 3.847 | -27.41% | 19676 |
| b1 | 17000, fullEffort de 20000 | 5.021 | -5.25% | 21432 |
| b1 | tudo planejado de 20000 | 5.299 | 0.00% | 21654 |
| inq | tudo planejado de 17000 | 1.102 | -27.58% | 19425 |
| inq | 17000, quickEffort de 20000 | 1.102 | -27.58% | 19425 |
| inq | 17000, discoveryCap de 20000 | 1.102 | -27.58% | 19425 |
| inq | 17000, fullEffort de 20000 | 1.442 | -5.26% | 21380 |
| inq | tudo planejado de 20000 | 1.522 | 0.00% | 21660 |

#### Profundidade fixa da busca de soquetes dos finalistas (resto planejado de 20000)

| build | esforço completo fixo | DPS final | vs plano 20000 | avaliações | Δ avaliações |
|---|---:|---:|---:|---:|---:|
| b1 | 100 | 3.469 | -34.53% | 17497 | -4157 |
| b1 | 150 | 3.847 | -27.41% | 20003 | -1651 |
| b1 | 200 | 5.021 | -5.25% | 22310 | 656 |
| b1 | 300 | 5.299 | 0.00% | 25332 | 3678 |
| b1 | 500 | 5.299 | 0.00% | 28227 | 6573 |
| inq | 100 | 0.986 | -35.21% | 17260 | -4400 |
| inq | 150 | 1.102 | -27.58% | 19841 | -1819 |
| inq | 200 | 1.424 | -6.43% | 22140 | 480 |
| inq | 300 | 1.522 | 0.00% | 24877 | 3217 |
| inq | 500 | 1.522 | 0.00% | 27729 | 6069 |

#### Validação final do near: a segunda passada a partir do mesmo estado

Os dois modos são idênticos até a 2ª passada (o relatório registra valor e avaliações únicas nesse ponto; "mesmo estado" confere os dois). A comparação abaixo isola o efeito do `socketRecheck`.

| cenário | mesmo estado | DPS antes da 2ª passada | DPS final all | DPS final near | Δ DPS | avaliações únicas all → near | 2ª passada all | 2ª passada near | campos alterados na 2ª passada (all): posição na 1ª passada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1, cartas sorteadas, equipamento mantido, esforço 300 | true | 1125297 | 1186419 | 1186419 | 0.00% | 3952 → 3670 | 1874 aval. / 6.5 s | 1592 aval. / 7.2 s | headUpper.headUpperEnchant1 +4.67% (#2/53); headMiddle.headMiddleCard +0.73% (#1/140) |
| b1, cartas sorteadas, equipamento mantido, esforço 1500 | true | 1215531 | 1215531 | 1215531 | 0.00% | 4578 → 4446 | 1672 aval. / 5.7 s | 1540 aval. / 5.3 s | — |
| b1, cartas sorteadas, equipamento mantido, esforço 4000 | true | — | 1215531 | 1215531 | 0.00% | 3740 → 3740 | — aval. / — s | — aval. / — s | — |
| b2, cartas sorteadas, equipamento mantido, esforço 300 | true | 561375 | 583581 | 583581 | 0.00% | 3377 → 3244 | 1586 aval. / 5.7 s | 1453 aval. / 4.7 s | shield.shieldEnchant2 +0.37% (#2/24); shield.shieldEnchant3 +1.24% (#3/24); headUpper.headUpperCard +1.95% (#1/140); headUpper.headUpperEnchant3 +0.35% (#5/29) |
| b2, cartas sorteadas, equipamento mantido, esforço 1500 | true | 580214 | 584485 | 584485 | 0.00% | 4165 → 3596 | 1586 aval. / 6.6 s | 1017 aval. / 3.1 s | shield.shieldEnchant1 +0.47% (#1/24); shield.shieldEnchant3 +0.26% (#1/24) |
| b2, cartas sorteadas, equipamento mantido, esforço 4000 | true | — | 581095 | 581095 | 0.00% | 2840 → 2840 | — aval. / — s | — aval. / — s | — |
| magus, cartas sorteadas, equipamento mantido, esforço 300 | true | 169245 | 169245 | 169245 | 0.00% | 3445 → 3445 | 1403 aval. / 6.3 s | 1403 aval. / 4.6 s | — |
| magus, cartas sorteadas, equipamento mantido, esforço 1500 | true | 167191 | 169245 | 169245 | 0.00% | 4531 → 4114 | 1740 aval. / 5.8 s | 1323 aval. / 4.2 s | armor.armorCard +1.23% (#1/187) |
| magus, cartas sorteadas, equipamento mantido, esforço 4000 | true | 169245 | 169245 | 169245 | 0.00% | 4683 → 4077 | 1266 aval. / 3.9 s | 660 aval. / 2.0 s | — |
| wh, cartas sorteadas, equipamento mantido, esforço 300 | true | 530589 | 530589 | 530589 | 0.00% | 3094 → 2827 | 1254 aval. / 5.8 s | 987 aval. / 4.5 s | — |
| wh, cartas sorteadas, equipamento mantido, esforço 1500 | true | 532500 | 532500 | 532500 | 0.00% | 3534 → 3269 | 885 aval. / 4.5 s | 620 aval. / 3.0 s | — |
| wh, cartas sorteadas, equipamento mantido, esforço 4000 | true | — | 532500 | 532500 | 0.00% | 3368 → 3368 | — aval. / — s | — aval. / — s | — |
| magus, busca completa (esforço 12000) | true | — | 170831 | 170831 | 0.00% | 10677 → 10677 | — aval. / — s | — aval. / — s | — |
| b1, arma com 2 cartas e 3 encantamentos, busca completa (esforço 20000) | true | 5299221 | 5299221 | 5299221 | 0.00% | 21654 → 20988 | 1602 aval. / 5.5 s | 936 aval. / 3.1 s | — |

Campos que a 2ª passada completa alterou em todos os cenários: 9; pior posição que o vencedor ocupava na 1ª passada: 5; vencedores fora dos 5 primeiros: 0.

<!-- targeted:end -->

## 9. Validação final e promoção do `near`

Pedido: comparar `near` e `all` (a) numa build mágica, (b) numa arma com várias cartas e encantamentos, (c) num caso em que um candidato classificado em sexto lugar ou pior na 1ª passada vence depois de outra alteração de equipamento. Cada par parte do **mesmo estado**: as duas execuções são idênticas até a 2ª passada (o relatório registra o valor e as avaliações únicas nesse ponto e a bancada confere que são iguais), então a diferença depois dele é só o `socketRecheck`.

- **(a) Mágica**: Magus (classe 4255, Crimson Rock), vestido por uma busca determinística de 4000 avaliações. Na busca completa a 1ª passada não alterou nada e não houve 2ª passada (as duas execuções são iguais ponta a ponta). Com cartas sorteadas e esforço 1500 a 2ª passada completa achou `armorCard` +1,23% (estava em 1º lugar na 1ª passada) e o `near` também: DPS idêntico (169245), 2ª passada de 1740 para 1323 avaliações; com esforço 4000, de 1266 para 660.
- **(b) Arma com 2 cartas e 3 encantamentos** (b1, busca completa, esforço 20000): DPS idêntico (5 299 221), 2ª passada de 1602 para 936 avaliações e de 5,5 s para 3,1 s; total de 21654 para 20988 avaliações (−3,1%).
- **(c) Adversarial**: doze estados (b1, b2, Windhawk e Magus com cartas sorteadas, três esforços cada; três deles sem 2ª passada) e uma busca dirigida. Em todos o DPS final do `near` igual ao do `all`. A 2ª passada completa alterou 9 campos; quatro deles em peças que a 1ª passada não tocou (as únicas que o `near` restringe) e **todos eram o 1º colocado da 1ª passada**; o pior ranque observado foi 5 (`headUpperEnchant3` de b2, #5 de 29), numa peça tocada, que o `near` re-verifica por inteiro. Busca dirigida de um vencedor classificado em sétimo lugar ou pior (b1 final; cada campo de carta e de encantamento contra 8 cartas/encantamentos de cada campo posterior, por avaliação direta): **nenhum campo teve o melhor candidato alterado por uma troca isolada em outro campo**. Ou seja, **não consegui produzir o caso adversarial pedido**; não há instância conhecida em que o `near` perca qualidade. A única dependência encontrada (`headMiddleCard` após mudar o elmo superior, que derruba o `touched`) tinha o vencedor em 1º lugar.

Limites: o caso exato do item (c) não foi construído, então a garantia é empírica (margem observada: ranque 1 contra o limite de 5, para peças não tocadas), não demonstrada. Proteção localizada se algum dia falhar: aumentar `NEAR_RUNNERS_UP` (cada unidade custa ~1 avaliação por campo não tocado) ou usar `socketRecheck: 'all'`.

### Promoção

`near` é o padrão (`socketRecheck = 'near'` em `searchBuild`), tanto no modo `legacy` quanto no `unified`; `all` continua disponível como referência e alternativa. Não expõe parâmetro no MCP. Teste de regressão (`optimize-budget.spec.ts`): em estado adversarial com sockets perturbados, o padrão tem DPS e avaliações iguais aos do `near`, `near` iguala o DPS do `all` com menos avaliações e `touched` nunca o supera.

## 5. Mudanças

Todas internas (fora do schema do MCP) e inativas por padrão:

- `socketRecheck: 'near'` (e `'touched'`, mantido como experimento) em `optimize.ts`, `NEAR_RUNNERS_UP = 5`.
- `effortParts` (`quick`, `full`, `discoveryCap`, `fullFixed`): planeja cada esforço de um orçamento próprio; só para diagnóstico.
- `slotLog` no `budgetReport` (por decisão de slot).
- Bench: `optimize-recheck.bench.spec.ts`, grupos `slots-*`, `mix-*`, `fixed-full*`, `near-*` em `optimize-budget.bench.spec.ts`.

## 6. Testes

`optimize-budget.spec.ts` ganhou o teste adversarial de `socketRecheck` (b1 com cartas sorteadas: `near` igual a `all` e mais barato; `touched` nunca acima). Resultados no resumo final. A promoção a padrão (seção 9) acrescentou a verificação de que o padrão equivale a `near` e a nota sobre o limite de tempo (a passada de soquetes dá uma fatia de tempo a cada campo, então contagens de avaliações só são comparáveis com o limite de tempo suspenso, como nos benchmarks e neste teste).

## 7. Decisão

- `touched`: **permanece experimental**; não deve ser promovido (−0,72% no caso adversarial).
- `near`: **sem regressão em 13 de 13 casos e 0,8% a 11% menos avaliações**; a validação final (seção 9) manteve a qualidade nos três cenários pedidos e **`near` passou a ser o padrão**, com `all` preservado como `socketRecheck: 'all'`.
- `effortParts`/`fullFixed`: diagnóstico; não promover.
- Sem Beam Search, VNS ou mudança no Candidate Generator.

## 8. Limitações

- Cinco sementes por build convergem para o mesmo estado: três casos adversariais distintos, um divergente.
- Uma única build física (Windhawk), uma classe de magia (quatro builds do mesmo Inquisitor).
- Tempos fora da linha medida a sós são ruído de paralelismo.
- A saturação da profundidade em 300 foi observada em b1 e inq; builds com pools maiores podem saturar depois.
