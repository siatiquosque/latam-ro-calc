# Optimize V1 — experimento de exploração progressiva

## Método

O controle executa o Greedy com o gerador, complementos, combos e polish existentes. O experimental faz uma sondagem curta por slot e depois ordena o aprofundamento pelo ganho observado em relação ao incumbente daquela sondagem. Os dois partem dos mesmos estados e usam as mesmas restrições, candidato, cache e motor; procs desligados. A estratégia experimental é interna e não é o padrão.

A unidade de comparação é chamada efetiva ao motor: inclui todos os alvos da avaliação agregada e das leituras individuais, e cache hits não custam novas chamadas. O teto da tabela inclui também as chamadas do relatório e as verificações finais de base e resultado. Um valor fixo, igual nos dois braços de cada fixture, é reservado para esses custos; o saldo não é reutilizado. Assim a comparação tem teto total igual, mas pode deixar parte do teto ociosa. A métrica histórica `solves` do caminho público atual continua contando cache misses de avaliações agregadas como uma unidade, embora estas executem vários alvos; ela não é diretamente comparável a este teto real.

O conjunto contém Jor restrito e não restrito (estado `gear-only`, não o link original sem ajuste de atributos), Meister `weak`, Meister com arma e escudo travados, Magus usando o equipamento de `b1` com arma e classe mágicas, e o caso composto de Jor limitado à armadura atual e à referência. O Magus não é uma build mágica real completa, tampouco uma referência conhecida. O caso composto restringe artificialmente os slots para investigar o movimento; não demonstra que a meta possa ser atingida apenas com a armadura. Os resultados anteriores à reserva total estão em `docs/benchmarks/optimize-progressive/ab-search-only.json` e não são usados para a decisão.

## Correções independentes identificadas

- A margem do primeiro alvo era calculada com `min` agregado entre alvos. A leitura da meta agora usa cada alvo individualmente; o teste de regressão mede uma distância real de 0,6215 onde a busca anteriormente informava 0,6075.
- Um encantamento da armadura sombria (312655) estava no pool da peça 24872, mas não no LATAM segundo o validador. O gerador e o polish passam a respeitar a mesma disponibilidade. Antes da correção, a progressiva chegou a devolver uma build inválida.
- `optimize_slot` e `scan_slot` aceitam as restrições existentes e filtram travas de peça, campo e respectivos complementos. Uma trava de peça ainda permite alterar cartas e encantos; uma trava de soquete também fixa a peça que o comporta. Travas de slot e campos sem restrição mantêm seus significados.
- Armadura 450206 e encantos 311164/311100: a peça original não aceita o primeiro encanto; a peça de referência o aceita e `searchComplements` o oferece e avalia sobre o patch da nova peça. No experimento limitado à armadura, os dois braços aceitam a armadura e os dois encantos juntos no teto total de 2.000 chamadas. O `candidateAudit` histórico `notLegalOnTheAnswerPiece` só descreve a peça da resposta final e não prova que o movimento não foi tentado em peça intermediária.

## A/B com teto total

Cada linha mostra viabilidade ou pior distância restante (menor é melhor), DPS médio em milhões, slots com movimentos medidos, candidatos distintos na auditoria (`triados/pool/avaliados`), primeira solução viável em chamadas do motor durante a busca, chamadas totais incluindo relatório e verificação final, peças trocadas, campos de equipamento alterados e tempo. `—` indica que não houve solução viável; distância 0 indica meta cumprida. A auditoria de listas fornecidas pelo chamador é parcial; no caso composto os candidatos foram fixados pelo teste. Os arquivos JSON preservam estados, patches, log por slot, status por alvo e referências.

| Fixture | Teto | Busca | Viável / distância | DPS (M) | Slots | Candidatos | 1ª viável | Chamadas totais | Peças / campos | Tempo (s) |
| --- | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| jor-original | 300 | Greedy | 0.0601 | 31.667 | 6 | 40/40/10 | — | 277 | 0 / 4 | 1.7 |
| jor-original | 300 | Progressiva | 0.0483 | 32.076 | 12 | 45/45/12 | — | 277 | 0 / 5 | 1.2 |
| jor-original | 800 | Greedy | sim | 37.509 | 9 | 69/69/14 | 485 | 777 | 0 / 12 | 3.2 |
| jor-original | 800 | Progressiva | 0.0161 | 33.160 | 16 | 77/77/33 | — | 777 | 1 / 7 | 3.0 |
| jor-original | 2000 | Greedy | sim | 48.419 | 9 | 140/140/25 | 975 | 1982 | 1 / 23 | 7.6 |
| jor-original | 2000 | Progressiva | sim | 41.348 | 16 | 172/172/87 | 810 | 1982 | 5 / 13 | 7.1 |
| jor-restricted | 300 | Greedy | 0.0601 | 31.667 | 6 | 38/38/10 | — | 277 | 0 / 4 | 1.2 |
| jor-restricted | 300 | Progressiva | 0.0244 | 32.870 | 16 | 47/47/17 | — | 277 | 0 / 6 | 1.3 |
| jor-restricted | 800 | Greedy | sim | 37.306 | 9 | 69/69/14 | 435 | 777 | 0 / 11 | 2.9 |
| jor-restricted | 800 | Progressiva | 0.0161 | 33.160 | 16 | 78/78/34 | — | 777 | 1 / 7 | 2.9 |
| jor-restricted | 2000 | Greedy | sim | 46.164 | 15 | 145/145/34 | 1060 | 1982 | 1 / 20 | 7.3 |
| jor-restricted | 2000 | Progressiva | sim | 41.348 | 16 | 174/174/88 | 800 | 1982 | 5 / 13 | 7.2 |
| meister | 300 | Greedy | 0.714 | 16.929 | 8 | 49/49/17 | — | 279 | 0 / 10 | 1.2 |
| meister | 300 | Progressiva | 0.6775 | 19.115 | 16 | 49/49/16 | — | 279 | 6 / 18 | 1.0 |
| meister | 800 | Greedy | 0.6096 | 23.188 | 9 | 88/88/20 | — | 776 | 0 / 16 | 2.5 |
| meister | 800 | Progressiva | 0.4067 | 29.839 | 16 | 97/97/42 | — | 776 | 8 / 24 | 2.8 |
| meister | 2000 | Greedy | 0.409 | 36.008 | 9 | 175/175/29 | — | 1976 | 1 / 25 | 6.8 |
| meister | 2000 | Progressiva | sim | 60.001 | 16 | 194/194/105 | 1296 | 1976 | 12 / 36 | 7.2 |
| magus | 300 | Greedy | 0.1188 | 0.043 | 15 | 57/57/20 | — | 279 | 0 / 3 | 1.4 |
| magus | 300 | Progressiva | sim | 0.052 | 16 | 59/59/22 | 165 | 279 | 2 / 4 | 1.3 |
| magus | 800 | Greedy | sim | 0.073 | 15 | 109/109/31 | 351 | 782 | 3 / 19 | 3.0 |
| magus | 800 | Progressiva | sim | 0.135 | 16 | 115/115/60 | 324 | 779 | 12 / 24 | 3.1 |
| magus | 2000 | Greedy | sim | 0.394 | 15 | 230/227/46 | 657 | 1979 | 3 / 29 | 7.6 |
| magus | 2000 | Progressiva | sim | 1.026 | 16 | 253/250/134 | 609 | 1982 | 15 / 36 | 7.9 |
| jor-composite | 300 | Greedy | 0.2431 | 23.305 | 1 | 1/1/1 | — | 271 | 0 / 0 | 0.9 |
| jor-composite | 300 | Progressiva | 0.2359 | 23.525 | 1 | 2/2/2 | — | 277 | 0 / 1 | 0.9 |
| jor-composite | 800 | Greedy | 0.1962 | 25.601 | 1 | 2/2/2 | — | 777 | 0 / 3 | 2.5 |
| jor-composite | 800 | Progressiva | 0.2359 | 23.525 | 1 | 2/2/2 | — | 777 | 0 / 1 | 2.7 |
| jor-composite | 2000 | Greedy | 0.1912 | 25.865 | 1 | 2/2/2 | — | 1977 | 1 / 6 | 6.8 |
| jor-composite | 2000 | Progressiva | 0.1912 | 25.865 | 1 | 2/2/2 | — | 1977 | 1 / 6 | 7.3 |
| meister-sets | 300 | Greedy | 0.8091 | 11.308 | 7 | 44/44/12 | — | 279 | 0 / 5 | 1.1 |
| meister-sets | 300 | Progressiva | 0.7103 | 17.195 | 14 | 47/47/18 | — | 279 | 6 / 16 | 1.1 |
| meister-sets | 800 | Greedy | 0.7355 | 16.110 | 7 | 83/83/20 | — | 776 | 1 / 13 | 2.8 |
| meister-sets | 800 | Progressiva | 0.4432 | 29.284 | 14 | 93/93/42 | — | 776 | 6 / 16 | 2.9 |
| meister-sets | 2000 | Greedy | 0.6986 | 18.364 | 8 | 176/176/39 | — | 1976 | 2 / 16 | 6.9 |
| meister-sets | 2000 | Progressiva | 0.2958 | 37.485 | 14 | 189/189/100 | — | 1976 | 9 / 25 | 7.3 |
| meister-sets | 4000 | Greedy | 0.6658 | 20.357 | 8 | 320/204/64 | — | 3976 | 2 / 17 | 14.2 |
| meister-sets | 4000 | Progressiva | 0.1959 | 39.747 | 14 | 352/243/179 | — | 3980 | 11 / 26 | 15.0 |

O contador de chamadas do motor não é uma contagem de builds únicas: a mesma build pode ser recalculada com métricas ou alvos diferentes. As leituras obrigatórias após a busca são contabilizadas no teto acima. `evaluations.unique` nos JSONs conta cache misses de avaliações completas, não leituras independentes por alvo.

No caso composto, rastreamento dentro de `searchComplements` com tetos de busca 230/730/1930 (teto total 300/800/2000) mostrou respectivamente: combinação completa não avaliada; avaliada e não aceita; avaliada e aceita. O movimento está no espaço de busca e é acessível; o resultado depende do orçamento e da comparação com o incumbente. O teste cobre essas três situações.
