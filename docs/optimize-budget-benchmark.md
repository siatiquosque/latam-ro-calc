# Optimize — benchmark do orçamento de avaliações

Investigação de orçamento, desempenho e qualidade da busca atual (Greedy). Nenhum algoritmo novo, nenhuma
mudança no Candidate Generator, nas fórmulas ou no catálogo, nenhuma mudança no MCP público. As tabelas da seção 4
são geradas dos artefatos por `tools/optimize-budget-report.mjs`; nada foi digitado à mão.

## 1. Mapa do orçamento (código real: `operations/optimize.ts#searchBuild`)

**Unidade do teto (`solves`).** Uma avaliação que o cache não tinha: uma build contra o primeiro alvo, via
`evaluationCache().misses` (+1 da avaliação-base). Cache hit não conta. Chamadas ao motor (`solveWithInput`) são
contadas à parte (`engineCallCount`): com um alvo e procs desligados, uma avaliação = uma chamada; alvos extras ou
procs médios somam chamadas sem somar orçamento. O ledger separa quatro grandezas e nunca as mistura: avaliações
únicas (misses), avaliações sem cache (baseline e relatórios), cache hits e chamadas ao motor. Candidatos *considerados*
(`coverage.candidates`) são outra coisa e não entram em nenhuma delas.

**Fluxo** (fase do ledger entre colchetes):

1. Avaliação-base (sem cache) [baseline].
2. Screening: cada item elegível medido sozinho, com orçamento próprio de 35% do teto da busca, repartido por slot, com o saldo repassado [discovery].
3. Rodada de ajuste das peças já usadas (round −1; para em 75% do teto da busca) e rodadas de troca (`rounds`). Por slot: medir
   os movimentos nus [discovery]; busca rápida e completa de cartas/encantamentos nos melhores [search]; o melhor entra se ganhar > 0,1%. O esforço por slot
   (`quickEffort`, `fullEffort`, `discoveryCap`) é calculado a partir do que resta do teto da busca: **o teto não só corta, ele regula o esforço**.
4. Pares citados pelo usuário [search].
5. Passada final de soquetes ("polish"): cada campo de carta/encantamento da build final contra todas as opções legais [socket].
   - `legacy`: teto de busca = teto pedido; a passada não é contada no teto (limite próprio de tempo: `max(25 s, 50% de maxSearchMs)`, fatia por campo).
   - `unified`: teto de busca = `floor(teto × (1 − reserva))`, reserva padrão 15%; a passada para no teto total, então herda também o saldo da busca.
6. Verificações de nível (`levelCheck`, dentro do teto) e relatórios finais (perfis, dummies, procs, alvos; fora do teto) [levelCheck, report].

Limites por tempo: `maxSearchMs` (45 s no servidor) para a busca, e a fatia por campo da passada. O benchmark levanta esses limites
(6 h) para que só o teto de avaliações pare a busca; assim a execução é determinística. Em produção, a 45 s o Legacy não chega
a ~21 mil avaliações (nesta máquina ≈ 4 ms cada, 85–100 s).

Incumbente: único; só troca quando uma passada acha > 0,1%. Resultado parcial é sempre uma build válida (o incumbente) com `stopped`.

**Instrumentação** (`instrument: true`, interna, fora do schema do MCP; sem ela o resultado é idêntico — testado):
`budgetReport` com `totalEngineCalls`, `uniqueEvaluations`, `uncachedEvaluations`, `cacheHits`, `discoveryEvaluations`,
`searchEvaluations`, `socketEvaluations`, `finalVerificationEvaluations`, `stoppedReason`, `wallClockMs`, `bestScoreByPhase`, `phases`,
`budgeted` (`inCap`, `socketOutsideCap`, `effective`, `unused`) e `socket` (disponível/usado, campos). `socketReserve` (0–0,9, padrão 0,15) é
o parâmetro experimental da reserva; o padrão não mudou.

## 2. Configuração exata

- Harness: `mcp/src/engine/optimize-budget.bench.spec.ts` (`BUDGET_BENCH=1`, uma build por processo). Artefatos em
  `docs/benchmarks/optimize-budget/` (`inputs/<build>.json`: build resolvida, versões; `runs/<build>/<run>.json`: argumentos, resultado, ledger).
- Reproduzir: `$env:BUDGET_BENCH=1; $env:BUDGET_BENCH_BUILD='b1'; npx vitest run mcp/src/engine/optimize-budget.bench.spec.ts`; depois `node tools/optimize-budget-report.mjs`.
- Builds: `b1`, `b2`, `weak` de `bench-builds.json`; `inq` = `inquisitor-fogueira-optimization.json` (suposição: a fixture do A/B anterior; todas são a mesma classe, 4262, nível 236). Nenhuma fixture ausente.
- Comum a todas as execuções: alvo Betelgeuse 20994, `objective: dps`, `refine: 12`, `maxGrade: A`, `procMode: off`, mesmos defaults de `rounds`/`candidatesPerSlot`/`combos`/`complements`, sem restrições extras, mesmo motor/catálogo.
- Execuções: Legacy 20.000; Unified 15% em 400/1.000/2.000/4.000; repetição de 2.000; reservas 10/15/20/30/40% em 8.000 e 20.000;
  Unified com o custo efetivo do Legacy (cenário B); reinício 2×10.000 (a 2ª busca parte da build da 1ª; resultado = melhor das duas, sem somar); busca larga (`candidatesPerSlot: 40`, `rounds: 4`, 20.000);
  controle: Unified com teto de busca 16.000/18.000/20.000/22.000.
- Repetibilidade: **a busca é determinística** (sem fonte de aleatoriedade), então repetições seriam idênticas e não são evidência de robustez. Foi repetida uma execução por build (seção 4.9): idêntica. Não há cinco repetições; o que existe é variação do *parâmetro* (reservas, tetos), não do caminho. Tempos vêm de execuções com 4 processos em paralelo: servem para ordem de grandeza.

## 3. Respostas às perguntas

- **O Unified alcança resultado equivalente com o mesmo orçamento efetivo?** Depende de como "igual" é definido, e isso é o achado central. Com o *mesmo teto de busca* do Legacy (20.000; total 23.530 com a reserva de 15%), o Unified **reproduz o Legacy exatamente** nas quatro builds (mesmo DPS antes da passada, mesmo DPS final, mesmo custo efetivo: seção 4.11). Com o *mesmo custo total* (cenário B, 20.051–21.660), igualou o Legacy em b1, b2 e weak, mas ficou 27,6% abaixo em inq: o teto de busca (85% do total) fica menor que o 20.000 do Legacy e o caminho muda.
- **Quanto do Legacy vem da passada de soquetes?** +7,3% (b2) a +45,2% (inq) sobre o DPS anterior à passada; custo de 2.614–3.289 avaliações fora do teto. Mas a maior parte do ganho total vem da busca (seção 4.3): a troca de peças rende +85% a +537% sobre o ajuste inicial e a passada +7% a +45% sobre isso.
- **Diferenças de seleção além do orçamento?** O controle mostra que não há diferença de código de seleção entre os modos: com o mesmo teto de busca o resultado é bit a bit o mesmo. Há, porém, **dependência do teto como parâmetro de esforço**, não monotônica (abaixo).
- **Contribuição de cada fase:** seção 4.3 (ajuste das peças usadas, +131% a +487% sobre a base; busca; passada).
- **Regressão com orçamento equivalente?** Sim, em dois sentidos: (i) o Unified 20.000 padrão fica 19–27% abaixo do Legacy em b1, weak e inq por receber teto de busca 17.000 em vez de 20.000; (ii) o controle com teto maior que o do Legacy (22.000) *piora* b1 (−5,3%) e inq (−6,4%) apesar do DPS pré-passada maior: a passada de soquetes tem caminho próprio sensível ao ponto de partida.

## 4. Resultados (gerados)

<!-- results:start -->
<!-- Gerado por tools/optimize-budget-report.mjs a partir de docs/benchmarks/optimize-budget; não edite à mão. -->
Versões: app 0.1.210-beta, git 1d7348ed (+ alterações locais), manifesto de dados 992b605642586318, Node v22.9.0. Alvo Betelgeuse (20994), objetivo dps, +12/A, procs desligados.

#### 1. Custo real do Legacy (nominal 20.000) e peso da passada de soquetes

| build | DPS base | DPS antes da passada | DPS final | ganho da passada | avaliações no teto | passada fora do teto | custo efetivo | tempo | campos de soquete | parada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 0,576 | 3,737 | 5,299 | +41,82% | 18.365 | 3.289 | 21.654 | 89,9 s | 66/33 | completed |
| b2 | 0,243 | 1,454 | 1,561 | +7,35% | 17.437 | 2.614 | 20.051 | 84,5 s | 60/30 | completed |
| weak | 0,109 | 4,062 | 5,288 | +30,18% | 18.170 | 3.177 | 21.347 | 84,8 s | 62/31 | completed |
| inq | 0,159 | 1,048 | 1,522 | +45,23% | 18.371 | 3.289 | 21.660 | 89,6 s | 66/33 | completed |

#### 2. Orçamento nominal (A) e efetivo equivalente (B)

| build | Legacy 20.000 (DPS) | Legacy custo efetivo | Unified 20.000 (DPS) | Unified custo | Unified = custo efetivo do Legacy (DPS) | Unified/Legacy A | Unified/Legacy B |
|---|---:|---:|---:|---:|---:|---:|---:|
| b1 | 5,299 | 21.654 | 3,847 | 19.676 | 5,299 (teto 21.654) | -27,4% | +0,0% |
| b2 | 1,561 | 20.051 | 1,561 | 18.147 | 1,561 (teto 20.051) | +0,0% | +0,0% |
| weak | 5,288 | 21.347 | 4,284 | 18.451 | 5,288 (teto 21.347) | -19,0% | +0,0% |
| inq | 1,522 | 21.660 | 1,102 | 19.425 | 1,102 (teto 21.660) | -27,6% | -27,6% |

#### 3. Ganho por fase (DPS ao fim de cada fase, acumulado sobre o DPS base)

| build | execução | base | ajuste das peças usadas | busca (troca de peças) | passada final de soquetes | total |
|---|---:|---:|---:|---:|---:|---:|
| b1 | legacy-20000 | 0,576 | 1,330 (+130,8%) | 3,737 (+180,9%) | 5,299 (+41,8%) | +819,5% |
| b1 | unified-20000-r15 | 0,576 | 1,330 (+130,8%) | 3,154 (+137,1%) | 3,847 (+22,0%) | +567,5% |
| b2 | legacy-20000 | 0,243 | 0,787 (+223,6%) | 1,454 (+84,8%) | 1,561 (+7,3%) | +541,9% |
| b2 | unified-20000-r15 | 0,243 | 0,787 (+223,6%) | 1,454 (+84,8%) | 1,561 (+7,3%) | +541,9% |
| weak | legacy-20000 | 0,109 | 0,637 (+487,1%) | 4,062 (+537,4%) | 5,288 (+30,2%) | +4771,6% |
| weak | unified-20000-r15 | 0,109 | 0,637 (+487,1%) | 3,345 (+424,8%) | 4,284 (+28,1%) | +3846,8% |
| inq | legacy-20000 | 0,159 | 0,379 (+138,7%) | 1,048 (+176,4%) | 1,522 (+45,2%) | +858,2% |
| inq | unified-20000-r15 | 0,159 | 0,379 (+138,7%) | 0,882 (+132,7%) | 1,102 (+24,9%) | +593,9% |

#### 4. Reserva de soquetes — teto de 8.000 avaliações

| build | reserva | DPS final | antes da passada | ganho da passada | teto da busca | soquetes: disponível → usado | campos | não consumidas | cache hits | tempo | parada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 10% | 3,030 | 3,030 | +0,00% | 7.200 | 800 → 800 | 7/28 | 0 | 1.334 | 30,3 s | search-budget |
| b1 | 15% | 3,174 | 3,014 | +5,32% | 6.800 | 1.348 → 1.348 | 15/28 | 0 | 1.269 | 37,6 s | total-budget |
| b1 | 20% | 3,097 | 2,883 | +7,45% | 6.400 | 1.770 → 1.770 | 26/25 | 0 | 1.058 | 41,8 s | total-budget |
| b1 | 30% | 3,124 | 2,835 | +10,20% | 5.600 | 2.484 → 2.484 | 34/27 | 0 | 1.054 | 39,2 s | total-budget |
| b1 | 40% | 3,115 | 2,530 | +23,10% | 4.800 | 3.263 → 3.263 | 45/29 | 0 | 899 | 39,7 s | total-budget |
| b2 | 10% | 1,252 | 1,243 | +0,77% | 7.200 | 988 → 988 | 9/34 | 0 | 1.324 | 30,7 s | total-budget |
| b2 | 15% | 1,251 | 1,242 | +0,77% | 6.800 | 1.373 → 1.373 | 15/34 | 0 | 1.211 | 36,0 s | total-budget |
| b2 | 20% | 1,309 | 1,238 | +5,68% | 6.400 | 1.752 → 1.752 | 20/34 | 0 | 1.122 | 42,5 s | total-budget |
| b2 | 30% | 1,524 | 1,076 | +41,58% | 5.600 | 2.400 → 2.400 | 33/31 | 0 | 944 | 36,8 s | search-budget |
| b2 | 40% | 1,561 | 1,055 | +48,01% | 4.800 | 3.265 → 3.265 | 43/31 | 0 | 816 | 37,4 s | total-budget |
| weak | 10% | 3,026 | 2,824 | +7,13% | 7.200 | 800 → 800 | 15/29 | 0 | 1.417 | 28,8 s | search-budget |
| weak | 15% | 3,076 | 2,810 | +9,48% | 6.800 | 1.238 → 1.238 | 30/29 | 0 | 1.341 | 31,6 s | total-budget |
| weak | 20% | 3,171 | 2,735 | +15,92% | 6.400 | 1.635 → 1.635 | 39/29 | 0 | 1.266 | 39,4 s | total-budget |
| weak | 30% | 3,128 | 2,792 | +12,03% | 5.600 | 2.413 → 2.335 | 58/29 | 0 | 1.185 | 36,7 s | total-budget |
| weak | 40% | 3,548 | 2,486 | +42,73% | 4.800 | 3.203 → 2.744 | 62/31 | 0 | 1.060 | 35,9 s | total-budget |
| inq | 10% | 0,904 | 0,732 | +23,61% | 7.200 | 800 → 800 | 14/28 | 0 | 1.318 | 29,8 s | search-budget |
| inq | 15% | 0,913 | 0,853 | +7,02% | 6.800 | 1.200 → 1.200 | 11/28 | 0 | 1.174 | 37,2 s | search-budget |
| inq | 20% | 0,895 | 0,811 | +10,35% | 6.400 | 1.719 → 1.719 | 28/27 | 0 | 1.188 | 41,6 s | total-budget |
| inq | 30% | 0,883 | 0,799 | +10,48% | 5.600 | 2.489 → 2.489 | 34/27 | 0 | 1.042 | 38,4 s | total-budget |
| inq | 40% | 0,918 | 0,677 | +35,68% | 4.800 | 3.200 → 2.440 | 58/29 | 77 | 1.157 | 37,9 s | search-budget |

Melhor reserva por build (DPS final) e diferença para os 15%:

| build | melhor reserva | DPS | DPS com 15% | diferença | pior reserva | diferença pior↔melhor |
|---|---:|---:|---:|---:|---:|---:|
| b1 | 15% | 3,174 | 3,174 | +0,00% | 10% | +4,76% |
| b2 | 40% | 1,561 | 1,251 | +24,76% | 15% | +24,76% |
| weak | 40% | 3,548 | 3,076 | +15,33% | 10% | +17,27% |
| inq | 40% | 0,918 | 0,913 | +0,64% | 30% | +4,02% |

#### 4. Reserva de soquetes — teto de 20.000 avaliações

| build | reserva | DPS final | antes da passada | ganho da passada | teto da busca | soquetes: disponível → usado | campos | não consumidas | cache hits | tempo | parada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 10% | 3,847 | 3,154 | +21,97% | 18.000 | 3.808 → 3.401 | 56/28 | 0 | 2.854 | 97,8 s | total-budget |
| b1 | 15% | 3,847 | 3,154 | +21,97% | 17.000 | 4.449 → 3.401 | 56/28 | 324 | 2.885 | 99,6 s | completed |
| b1 | 20% | 3,847 | 3,021 | +27,32% | 16.000 | 5.148 → 3.420 | 56/28 | 1.004 | 2.850 | 98,0 s | completed |
| b1 | 30% | 3,469 | 2,886 | +20,19% | 14.000 | 6.534 → 3.473 | 58/29 | 2.361 | 2.729 | 88,6 s | completed |
| b1 | 40% | 3,165 | 2,993 | +5,75% | 12.000 | 8.104 → 3.415 | 54/27 | 3.987 | 2.444 | 79,7 s | completed |
| b2 | 10% | 1,561 | 1,454 | +7,35% | 18.000 | 4.353 → 2.620 | 60/30 | 1.213 | 3.955 | 89,8 s | completed |
| b2 | 15% | 1,561 | 1,454 | +7,35% | 17.000 | 4.995 → 2.622 | 60/30 | 1.853 | 3.940 | 87,0 s | completed |
| b2 | 20% | 1,561 | 1,445 | +8,04% | 16.000 | 5.726 → 3.593 | 60/30 | 1.613 | 2.915 | 92,0 s | completed |
| b2 | 30% | 1,559 | 1,331 | +17,17% | 14.000 | 7.069 → 3.503 | 54/27 | 3.106 | 2.873 | 83,6 s | completed |
| b2 | 40% | 1,559 | 1,278 | +22,07% | 12.000 | 8.495 → 3.625 | 54/27 | 4.410 | 2.602 | 74,5 s | completed |
| weak | 10% | 5,288 | 3,781 | +39,88% | 18.000 | 4.102 → 3.177 | 62/31 | 1 | 3.103 | 89,9 s | completed |
| weak | 15% | 4,284 | 3,345 | +28,09% | 17.000 | 4.926 → 2.453 | 62/31 | 1.549 | 3.036 | 82,0 s | completed |
| weak | 20% | 4,067 | 3,345 | +21,57% | 16.000 | 5.571 → 2.434 | 62/31 | 2.213 | 3.048 | 84,7 s | completed |
| weak | 30% | 3,583 | 3,208 | +11,68% | 14.000 | 6.853 → 2.374 | 64/32 | 3.555 | 2.987 | 76,4 s | completed |
| weak | 40% | 3,583 | 3,110 | +15,20% | 12.000 | 8.306 → 2.383 | 64/32 | 5.023 | 2.919 | 68,6 s | completed |
| inq | 10% | 1,102 | 0,882 | +24,91% | 18.000 | 4.004 → 3.401 | 56/28 | 0 | 2.916 | 96,7 s | total-budget |
| inq | 15% | 1,102 | 0,882 | +24,91% | 17.000 | 4.700 → 3.401 | 56/28 | 575 | 2.932 | 96,4 s | completed |
| inq | 20% | 1,102 | 0,846 | +30,22% | 16.000 | 5.380 → 3.420 | 56/28 | 1.236 | 2.897 | 96,5 s | completed |
| inq | 30% | 0,986 | 0,805 | +22,55% | 14.000 | 6.733 → 3.378 | 54/27 | 2.655 | 2.986 | 86,9 s | completed |
| inq | 40% | 0,900 | 0,836 | +7,67% | 12.000 | 8.230 → 3.340 | 54/27 | 4.188 | 2.691 | 77,2 s | completed |

Melhor reserva por build (DPS final) e diferença para os 15%:

| build | melhor reserva | DPS | DPS com 15% | diferença | pior reserva | diferença pior↔melhor |
|---|---:|---:|---:|---:|---:|---:|
| b1 | 10% | 3,847 | 3,847 | +0,00% | 40% | +21,53% |
| b2 | 10% | 1,561 | 1,561 | +0,00% | 30% | +0,09% |
| weak | 10% | 5,288 | 4,284 | +23,43% | 30% | +47,58% |
| inq | 10% | 1,102 | 1,102 | +0,00% | 40% | +22,48% |

#### 5. Mesmo teto de 20.000: Greedy, dois reinícios (2×10.000) e busca larga

| build | A: Greedy 20.000 | B: reinício (melhor das duas) | B: 1ª busca 10.000 | B: 2ª busca 10.000 | B: avaliações (1ª+2ª) | C: busca larga | C: avaliações | B/A | C/A |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 3,847 | 3,165 | 3,066 | 3,165 | 10.000+8.429 | 2,907 | 20.000 | -17,7% | -24,4% |
| b2 | 1,561 | 1,541 | 1,313 | 1,541 | 10.000+8.093 | 1,637 | 17.200 | -1,3% | +4,9% |
| weak | 4,284 | 4,098 | 3,421 | 4,098 | 10.000+10.000 | 4,254 | 18.467 | -4,3% | -0,7% |
| inq | 1,102 | 0,835 | 0,741 | 0,835 | 10.000+10.000 | 0,823 | 17.992 | -24,2% | -25,3% |

Universo de candidatos (busca larga muda o conjunto avaliado): candidatos medidos/disponíveis na busca e itens avaliados no screening.

| build | Greedy: candidatos | Greedy: screening (testados) | Larga: candidatos | Larga: screening (testados) |
|---|---:|---:|---:|---:|
| b1 | 676/684 | 1.658 | 1.431/1.689 | 1.658 |
| b2 | 705/715 | 1.277 | 1.374/1.621 | 1.277 |
| weak | 674/679 | 1.664 | 1.451/1.674 | 1.664 |
| inq | 672/680 | 1.658 | 1.428/1.668 | 1.658 |

#### 6. Qualidade por orçamento (Unified, reserva 15%) e marcos

| build | 400 | 1.000 | 2.000 | 4.000 | 8.000 | 20.000 | Legacy efetivo | melhor conhecido |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 0,81 (400) | 1,17 (1.000) | 1,15 (2.000) | 1,44 (4.000) | 3,17 (8.000) | 3,85 (19.676) | 5,30 (21.654) | 5,30 |
| b2 | 0,52 (400) | 0,72 (1.000) | 0,82 (2.000) | 1,03 (4.000) | 1,25 (8.000) | 1,56 (18.147) | 1,56 (20.051) | 1,64 |
| weak | 0,37 (400) | 0,89 (1.000) | 1,43 (2.000) | 1,82 (4.000) | 3,08 (8.000) | 4,28 (18.451) | 5,29 (21.347) | 5,29 |
| inq | 0,22 (400) | 0,32 (1.000) | 0,34 (2.000) | 0,44 (4.000) | 0,91 (8.000) | 1,10 (19.425) | 1,52 (21.660) | 1,52 |

Menor teto da curva (Unified 15%) que atinge cada fração do melhor DPS conhecido do build:

| build | 50% | 75% | 90% | 95% | 100% do Unified 20.000 |
|---|---:|---:|---:|---:|---:|
| b1 | 8.000 | > 20.000 | > 20.000 | > 20.000 | 20.000 |
| b2 | 2.000 | 8.000 | 20.000 | 20.000 | 20.000 |
| weak | 8.000 | 20.000 | > 20.000 | > 20.000 | 20.000 |
| inq | 8.000 | > 20.000 | > 20.000 | > 20.000 | 20.000 |

Melhor resultado conhecido (qualquer estratégia) com cada teto nominal:

| build | 8.000 | 20.000 |
|---|---:|---:|
| b1 | 3,174 (unified-8000-r15) | 5,299 (legacy-20000) |
| b2 | 1,561 (unified-8000-r40) | 1,637 (wide-20000-r15) |
| weak | 3,548 (unified-8000-r40) | 5,288 (legacy-20000) |
| inq | 0,918 (unified-8000-r40) | 1,522 (legacy-20000) |

#### 7. Tabela consolidada (por build)

**b1**

| Métrica | Legacy | Unified 15% | Melhor reserva (10%) | Reinício 2×10.000 | Busca larga |
|---|---:|---:|---:|---:|---:|
| DPS final | 5,299 | 3,847 | 3,847 | 3,165 | 2,907 |
| Avaliações reais | 21.654 | 19.676 | 20.000 | 18.429 | 20.000 |
| Tempo | 89,9 s | 99,6 s | 97,8 s | 94,3 s | 99,4 s |
| Ganho sobre a base | +819,5% | +567,5% | +567,5% | +3,2% | +404,3% |
| Ganho sobre Unified 15% | +37,76% | +0,00% | +0,00% | -17,71% | -24,44% |
| Cobertura | 675/684; soquetes 33/33 | 676/684; soquetes 28/28 | 675/684; soquetes 28/28 | 569/686; soquetes 27/27 | 1.431/1.689; soquetes 26/26 |
| Resultado válido | sim | sim | sim | sim | sim |

**b2**

| Métrica | Legacy | Unified 15% | Melhor reserva (10%) | Reinício 2×10.000 | Busca larga |
|---|---:|---:|---:|---:|---:|
| DPS final | 1,561 | 1,561 | 1,561 | 1,541 | 1,637 |
| Avaliações reais | 20.051 | 18.147 | 18.787 | 18.093 | 17.200 |
| Tempo | 84,5 s | 87,0 s | 89,8 s | 88,8 s | 83,2 s |
| Ganho sobre a base | +541,9% | +541,9% | +541,9% | +17,3% | +573,4% |
| Ganho sobre Unified 15% | +0,00% | +0,00% | +0,00% | -1,26% | +4,90% |
| Cobertura | 705/715; soquetes 30/30 | 705/715; soquetes 30/30 | 705/715; soquetes 30/30 | 619/719; soquetes 34/34 | 1.374/1.621; soquetes 27/27 |
| Resultado válido | sim | sim | sim | sim | sim |

**weak**

| Métrica | Legacy | Unified 15% | Melhor reserva (10%) | Reinício 2×10.000 | Busca larga |
|---|---:|---:|---:|---:|---:|
| DPS final | 5,288 | 4,284 | 5,288 | 4,098 | 4,254 |
| Avaliações reais | 21.347 | 18.451 | 19.999 | 20.000 | 18.467 |
| Tempo | 84,8 s | 82,0 s | 89,9 s | 96,5 s | 87,9 s |
| Ganho sobre a base | +4771,6% | +3846,8% | +4771,6% | +19,8% | +3818,6% |
| Ganho sobre Unified 15% | +23,43% | +0,00% | +23,43% | -4,34% | -0,71% |
| Cobertura | 673/679; soquetes 31/31 | 674/679; soquetes 31/31 | 673/679; soquetes 31/31 | 648/759; soquetes 32/32 | 1.451/1.674; soquetes 32/32 |
| Resultado válido | sim | sim | sim | sim | sim |

**inq**

| Métrica | Legacy | Unified 15% | Melhor reserva (10%) | Reinício 2×10.000 | Busca larga |
|---|---:|---:|---:|---:|---:|
| DPS final | 1,522 | 1,102 | 1,102 | 0,835 | 0,823 |
| Avaliações reais | 21.660 | 19.425 | 20.000 | 20.000 | 17.992 |
| Tempo | 89,6 s | 96,4 s | 96,7 s | 99,4 s | 88,2 s |
| Ganho sobre a base | +858,2% | +593,9% | +593,9% | +12,8% | +418,0% |
| Ganho sobre Unified 15% | +38,09% | +0,00% | +0,00% | -24,18% | -25,34% |
| Cobertura | 671/680; soquetes 33/33 | 672/680; soquetes 28/28 | 671/680; soquetes 28/28 | 600/684; soquetes 28/28 | 1.428/1.668; soquetes 26/26 |
| Resultado válido | sim | sim | sim | sim | sim |

#### 8. Regressões individuais (≥ 2% abaixo do Unified 15% de 20.000 ou do Legacy)

| build | execução | contra | diferença | DPS | DPS de referência |
|---|---:|---:|---:|---:|---:|
| b1 | unified-20000-r10 | Legacy | -27,41% | 3,847 | 5,299 |
| b1 | unified-20000-r20 | Legacy | -27,41% | 3,847 | 5,299 |
| b1 | unified-20000-r30 | Unified 15% | -9,81% | 3,469 | 3,847 |
| b1 | unified-20000-r30 | Legacy | -34,53% | 3,469 | 5,299 |
| b1 | unified-20000-r40 | Unified 15% | -17,71% | 3,165 | 3,847 |
| b1 | unified-20000-r40 | Legacy | -40,27% | 3,165 | 5,299 |
| b1 | unified-walk18000-r15 | Legacy | -27,41% | 3,847 | 5,299 |
| b1 | unified-walk22000-r15 | Legacy | -5,25% | 5,021 | 5,299 |
| b1 | wide-20000-r15 | Unified 15% | -24,44% | 2,907 | 3,847 |
| b1 | wide-20000-r15 | Legacy | -45,15% | 2,907 | 5,299 |
| weak | unified-20000-r20 | Unified 15% | -5,09% | 4,067 | 4,284 |
| weak | unified-20000-r20 | Legacy | -23,10% | 4,067 | 5,288 |
| weak | unified-20000-r30 | Unified 15% | -16,36% | 3,583 | 4,284 |
| weak | unified-20000-r30 | Legacy | -32,24% | 3,583 | 5,288 |
| weak | unified-20000-r40 | Unified 15% | -16,36% | 3,583 | 4,284 |
| weak | unified-20000-r40 | Legacy | -32,24% | 3,583 | 5,288 |
| weak | wide-20000-r15 | Legacy | -19,56% | 4,254 | 5,288 |
| inq | unified-20000-r10 | Legacy | -27,58% | 1,102 | 1,522 |
| inq | unified-20000-r20 | Legacy | -27,58% | 1,102 | 1,522 |
| inq | unified-20000-r30 | Unified 15% | -10,53% | 0,986 | 1,102 |
| inq | unified-20000-r30 | Legacy | -35,21% | 0,986 | 1,522 |
| inq | unified-20000-r40 | Unified 15% | -18,36% | 0,900 | 1,102 |
| inq | unified-20000-r40 | Legacy | -40,88% | 0,900 | 1,522 |
| inq | unified-effective-21660-r15 | Legacy | -27,58% | 1,102 | 1,522 |
| inq | unified-walk18000-r15 | Legacy | -27,58% | 1,102 | 1,522 |
| inq | unified-walk22000-r15 | Legacy | -6,43% | 1,424 | 1,522 |
| inq | wide-20000-r15 | Unified 15% | -25,34% | 0,823 | 1,102 |
| inq | wide-20000-r15 | Legacy | -45,93% | 0,823 | 1,522 |

#### 9. Determinismo

| build | unified-2000-r15 | repetição | mesma build (link) | mesmo DPS | mesmas avaliações |
|---|---:|---:|---:|---:|---:|
| b1 | 1,152 | 1,152 | sim | sim | sim |
| b2 | 0,822 | 0,822 | sim | sim | sim |
| weak | 1,434 | 1,434 | sim | sim | sim |
| inq | 0,341 | 0,341 | sim | sim | sim |

#### 10. Contabilidade do orçamento (Unified 20.000, reserva 15%)

| build | chamadas ao motor | avaliações únicas | sem cache | cache hits | descoberta | busca | soquetes | verificação/relatório | teto usado | parada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 19.690 | 19.684 | 6 | 2.885 | 2.881 | 12.669 | 3.401 | 738 | 19.676/20.000 | completed |
| b2 | 18.161 | 18.155 | 6 | 3.940 | 2.528 | 12.476 | 2.622 | 534 | 18.147/20.000 | completed |
| weak | 18.465 | 18.459 | 6 | 3.036 | 2.864 | 12.209 | 2.453 | 938 | 18.451/20.000 | completed |
| inq | 19.439 | 19.433 | 6 | 2.932 | 2.869 | 12.430 | 3.401 | 738 | 19.425/20.000 | completed |

#### 11. Controle: teto da busca do Unified igual ao do Legacy


| build | execução | teto da busca | teto total | DPS antes da passada | DPS final | custo efetivo | final vs Legacy | parada |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | legacy-20000 | 20.000 (sem reserva) | sem teto global | 3,737 | 5,299 | 21.654 | – | completed |
| b1 | unified-walk16000-r15 | 16.000 | 18.824 | 3,021 | 3,847 | 18.824 | -27,41% | total-budget |
| b1 | unified-walk18000-r15 | 18.000 | 21.177 | 3,154 | 3,847 | 20.317 | -27,41% | completed |
| b1 | unified-walk20000-r15 | 20.000 | 23.530 | 3,737 | 5,299 | 21.654 | +0,00% | completed |
| b1 | unified-walk22000-r15 | 22.000 | 25.883 | 4,030 | 5,021 | 22.890 | -5,25% | completed |
| b2 | legacy-20000 | 20.000 (sem reserva) | sem teto global | 1,454 | 1,561 | 20.051 | – | completed |
| b2 | unified-walk16000-r15 | 16.000 | 18.824 | 1,445 | 1,561 | 18.387 | +0,00% | completed |
| b2 | unified-walk18000-r15 | 18.000 | 21.177 | 1,454 | 1,561 | 18.787 | +0,00% | completed |
| b2 | unified-walk20000-r15 | 20.000 | 23.530 | 1,454 | 1,561 | 20.051 | +0,00% | completed |
| b2 | unified-walk22000-r15 | 22.000 | 25.883 | 1,454 | 1,561 | 21.346 | +0,00% | completed |
| weak | legacy-20000 | 20.000 (sem reserva) | sem teto global | 4,062 | 5,288 | 21.347 | – | completed |
| weak | unified-walk16000-r15 | 16.000 | 18.824 | 3,345 | 4,067 | 17.787 | -23,10% | completed |
| weak | unified-walk18000-r15 | 18.000 | 21.177 | 3,781 | 5,288 | 19.999 | +0,00% | completed |
| weak | unified-walk20000-r15 | 20.000 | 23.530 | 4,062 | 5,288 | 21.347 | +0,00% | completed |
| weak | unified-walk22000-r15 | 22.000 | 25.883 | 4,530 | 5,288 | 22.633 | +0,00% | completed |
| inq | legacy-20000 | 20.000 (sem reserva) | sem teto global | 1,048 | 1,522 | 21.660 | – | completed |
| inq | unified-walk16000-r15 | 16.000 | 18.824 | 0,846 | 1,102 | 18.764 | -27,58% | completed |
| inq | unified-walk18000-r15 | 18.000 | 21.177 | 0,882 | 1,102 | 20.121 | -27,58% | completed |
| inq | unified-walk20000-r15 | 20.000 | 23.530 | 1,048 | 1,522 | 21.660 | +0,00% | completed |
| inq | unified-walk22000-r15 | 22.000 | 25.883 | 1,192 | 1,424 | 22.594 | -6,43% | completed |

<!-- results:end -->

## 5. Análise

**Orçamento nominal × real.** O Legacy 20.000 custa 20.051–21.660 avaliações únicas (+0,3% a +8,3%), 2.614–3.289 delas na passada que o teto não vê.
O Unified 20.000 gasta 18.147–19.676: a busca converge antes do teto e as avaliações restantes não são consumidas (campo `unused`; a reserva não é reaproveitada pela busca, só a busca pela passada).

**Por que o Unified perdia no A/B anterior.** Não é o Greedy nem o incumbente: o teto de busca de 17.000 (15% reservados) é menor que o que o caminho do Legacy usa (≈ 18.000–18.400 na busca) e muda o esforço por slot,
e a busca converge sozinha em outro ótimo local (stopped `completed`, sem esgotar o teto). Com teto de busca 20.000 o resultado é idêntico. Em b2 não há diferença em nenhum teto ≥ 16.000.

**Reserva de soquetes.** Nenhuma porcentagem domina.
- Em 8.000, a busca é truncada e a passada rende muito: reservas maiores ganham em 3 de 4 builds (40%: b2 +24,8%, weak +15,3%, inq +0,6% sobre 15%; b1 é melhor em 15%). A reserva é toda consumida.
- Em 20.000, a passada completa precisa de ≈ 2.400–3.600 avaliações (absolutas) e sobra reserva (324–5.000 não consumidas), enquanto a busca precisa de ≈ 18.000: 10% foi igual ou melhor que 15% em todas; 30–40% foram 10–18% piores em b1, weak e inq (b2 ficou igual).
- Ou seja, as duas fases têm necessidade aproximadamente absoluta, não proporcional ao teto, e o ponto certo em 20.000 (≈ 10% ou menos) é diferente do de 8.000 (≥ 40%). Resultados entre reservas vizinhas variam de forma não monotônica (weak, 20.000: 10% → 5,29; 15% → 4,28), o que indica sensibilidade do caminho ao teto, não só custo.
- Não se demonstrou uma reserva fixa melhor que 15% em geral. Uma regra baseada em necessidade (reservar o que a passada consome, não uma fração) é hipótese; não foi implementada nem testada.

**Reinício e busca larga (mesmo teto de 20.000).**
- Reinício (2×10.000, a 2ª parte da build da 1ª): pior que o Greedy de 20.000 em todas as builds (−1,3% a −24,2%) e gasta menos que o teto; reinício a partir da *mesma* build base repete o mesmo caminho determinístico (não explora), por isso o reinício testado é uma continuação. Não há evidência de benefício, e a perda vem de cada metade ter só 10.000.
- Busca larga: +4,9% só em b2 (e gastando 17.200), −0,7% a −25,3% nas outras. Ela muda o universo de candidatos (≈ 680 → ≈ 1.430 medidos; mesmo screening), então o ganho de b2 não é atribuível ao algoritmo.
- Ambos ficam muito abaixo do Legacy em b1, weak e inq (que usa 21,3–21,7 mil avaliações).

**Marcos** (seção 4.6): todas as builds ainda melhoram de 8.000 para 20.000, e o Legacy efetivo (~21,5 mil) supera o Unified 20.000 em 3 das 4.

## 6. Limitações e incertezas

- Execução única por configuração: o Greedy é determinístico, então não há variância de caminho a medir; as diferenças entre reservas/tetos refletem sensibilidade do algoritmo ao parâmetro, não ruído. Nada aqui prova superioridade geral: são quatro builds da mesma classe (Inquisidor 236, Betelgeuse).
- `inq` pode não ser a fixture exata do A/B anterior (os números de 400–20.000 do Unified coincidem com os registrados para b1, b2, weak e inq, o que sustenta a suposição).
- Tempos medidos com quatro processos em paralelo e sem limite de tempo; em produção (`maxSearchMs` 45 s) a busca para antes.
- Procs desligados e um alvo: com procs médios ou vários alvos, uma avaliação custa mais chamadas ao motor; o teto de avaliações não equivale a tempo.
- O contador de campos da passada soma duas passadas (por isso `campos` > `total` em algumas linhas). A parada `completed` significa convergência da busca e fim da passada, não otimalidade.
- Com procs ligados, a medição completa do vencedor de cada campo da passada usa uma política diferente da varredura e poderia exceder o teto em poucas unidades; não foi medido (procs desligados aqui). Com procs desligados o teto foi respeitado em todas as execuções (`inCap` ≤ pedido).
- Relatórios finais (perfis, dummies, procs) ficam fora do teto e do `solves` (≈ 530–940 avaliações, `finalVerificationEvaluations`); estão contabilizados à parte, não escondidos.

## 7. Classificação e recomendação

**Classe A — problema de orçamento**, com um aviso de sensibilidade do caminho.
Evidência: (1) mesmo teto de busca → resultado idêntico ao Legacy em 4/4 builds; (2) a diferença do A/B original é o teto de busca efetivo (17.000 contra 20.000) e a passada fora do teto; (3) reinício e busca larga não recuperam a diferença.
O aviso: o resultado não é monotônico no teto (22.000 pior que 20.000 em b1 e inq; 10% ≠ 15% em weak), então "mais orçamento" não é garantia de melhoria com o Greedy atual.

Recomendação (nenhuma aplicada; `legacy` continua o padrão):
1. **Não implementar Beam Search nem VNS agora.** A diferença conhecida é explicada pelo orçamento, e reinício/busca larga não mostraram ganho consistente (critério de > 2% e estabilidade não atendido).
2. Tratar o orçamento do Unified como alocação por necessidade (a passada precisa de ≈ 2,4–3,6 mil absolutas; a busca de ≈ 18 mil) em vez de 15% fixos: é a hipótese mais promissora (em 20.000, 10% iguala o Legacy só em b2 e weak; em b1 e inq fica −27%, como 15%; ver 4.4), mas exige um experimento próprio com mais builds de classes e perfis diferentes antes de virar padrão. Não promover `unified` a padrão enquanto o Legacy ganhar em b1/weak/inq no teto 20.000.
3. Experimento mínimo seguinte, se o Greedy passar a ser o gargalo: medir com mais builds e tetos, em `unified`, o *ponto de convergência da busca* (avaliações até estabilizar) e a variação do resultado ao perturbar o teto de busca ±10%; só uma dispersão grande no mesmo orçamento justificaria um Beam/VNS (hoje a dispersão aparece, mas só via o parâmetro de esforço, não via exploração).
4. Não há evidência para avançar ao bloco 3 como definido (fixture `jor_ab02` e Greedy com orçamento controlado dependem de reinício/busca larga com ganho > 2% consistente, que não ocorreu).

## Nota de continuidade — 05/11/2026

A matriz nova com teto real em `benchmarks/optimize-ready-audit` foi interrompida quando a prioridade passou para a POC IA/MCP. Os artefatos concluídos foram preservados; não completam a matriz nem substituem as tabelas históricas acima. A instrumentação agora também cobra recálculos de habilidades em rotações. Ver [benchmark A/B/C com fixture congelada e custos observados](ai-guided-optimization-benchmark.md). Nenhum resultado incompleto foi usado para declarar READY.
