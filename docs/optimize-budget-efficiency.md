# Optimize: avaliações necessárias para a mesma qualidade

Continuação de [optimize-budget-benchmark.md](optimize-budget-benchmark.md). Aquele relatório mostrou que Unified e Legacy são equivalentes com o mesmo teto efetivo de busca. Este mede **como gastar menos avaliações para chegar a uma solução equivalente**, sem Beam Search, VNS nem mudança no Candidate Generator.

Separação: **1. Diagnóstico** (o que o código faz e onde as avaliações vão), **2. Experimentos pequenos** (b1 e inq primeiro; b2 e weak só onde havia pergunta de generalidade), **3. Decisão e implementação**. O comportamento padrão **não mudou**.

Unidade: "avaliação" = *solve* que o cache não tinha (uma build contra o primeiro alvo). Alvo Betelgeuse (20994), refino 12, grau A, sem procs, limite de tempo suspenso (a busca é determinística). Tempo real: cerca de 4,3 ms por avaliação nesta máquina, com quatro processos em paralelo; use como ordem de grandeza.

## 1. Diagnóstico

### 1.1 Por que `maxSolves` muda a trajetória

O teto tem **dois papéis** em `searchBuild` (`optimize.ts`):

1. **Parar**: `outOfBudget()` interrompe a busca quando `spent() >= budget`.
2. **Planejar o esforço**: a mesma variável `budget` entra em quatro contas.
   - Triagem: `discoveryBudget = 0,35 × budget`, que decide quantos candidatos cada slot mede cru.
   - Ajuste do que está vestido: só vai até `0,75 × budget`.
   - Cota por slot: `share = (budget − gasto) / slots restantes`.
   - Esforço derivado da cota: `quickEffort`, `fullEffort` (= cota/3, limitado pela cobertura do slot) e `discoveryCap` (= cota/2).

Para separar os papéis, foi acrescentado o parâmetro interno `effortBudget` (fora do schema do MCP; sem ele vale o teto, como sempre). Resultados em b1 e inq (tabelas na seção 4):

- **O teto sozinho só trunca.** Teto de busca 17000 com esforço planejado de 20000 custa 20000 avaliações e fica a −1,3% (b1) e −1,5% (inq) do Legacy, que custa 21654 e 21660. O contrário, teto 20000 com esforço de 17000, reproduz exatamente o resultado acoplado de 17000 (−27,4% e −27,6%): a busca termina por conta própria antes do teto.
- **É o esforço planejado que muda o caminho**, não o teto. Triagem, cobertura e ajuste do que está vestido são os mesmos em E=14000, 17000, 20000 e 24000 (675 a 676 de 684 candidatos medidos; mesmo DPS após o ajuste, 1,330 M em b1). A trilha de passos aceitos diverge **no meio da caminhada**: com E=20000 o slot da armadura aceita o combo Armadura+Bota Invernal (+7,68%), e depois a arma e o elmo superior são trocados; com E=17000 aceita só a armadura (+4,92%) e a arma nunca é trocada.
- **A resposta ao esforço não é monotônica.** DPS final de b1 com E = 6k, 10k, 14k, 17k, 20k, 24k: 3,10; 3,17; 3,47; 3,85; **5,30**; 5,02 (inq tem o mesmo desenho: 0,90; 0,90; 0,99; 1,10; **1,52**; 1,42). E=20000 é um bom caminho, não um patamar que o orçamento "libera". Mais esforço não garante mais qualidade com este Greedy.
- **O DPS vem tarde**: a melhor build completa até 14000 avaliações vale 63% do final (b1) e 62% (inq); 83% e 81% aos 18000. O salto final vem em grande parte da passada de soquetes, que depende de qual peça terminou na caminhada (seção 1.2).

Conclusão do item 1: desacoplar é possível e **preserva resultados** (o resultado de um teto menor é um prefixo exato da execução maior, verificado em teste), mas **não melhora a qualidade**. Com o esforço fixo em 20000, tetos pequenos pioram (b1 em 2000: −87,6% contra −78,3% acoplado; em 8000: −56,9% contra −40,1%), porque a caminhada gasta fundo nos primeiros slots. O desacoplamento serve à reprodutibilidade e aos checkpoints, não à economia.

### 1.2 Passada de soquetes

Custo de uma passada = soma dos candidatos legais de cada campo da build final (b1: 1718 candidatos em 33 campos; 1689 avaliações após o cache). Isso é **calculável antes de gastar**, a partir da build em que a passada começa; não é um número fixo de 2,4–3,6 mil.

Medido em b1, inq, b2 e weak (esforço 20000):

| | b1 | inq | b2 | weak |
|---|---:|---:|---:|---:|
| avaliações da 1ª passada | 1689 | 1689 | 1863 | 1628 |
| avaliações da 2ª passada | 1689 | 1689 | 1863 | 1628 |
| campos com ganho na 1ª | 7 | 8 | 2 | 6 |
| ganho composto da 1ª | 41,8% | 45,2% | 7,3% | 30,2% |
| ganho da 2ª | 0 | 0 | 0 | 0 |

- **A 2ª passada custa metade da fase e não rendeu nada nas quatro builds.** Entre as 32 execuções com registro por campo, só 2 (b1 com E=10000 e 14000) tiveram ganho na 2ª passada, de +0,13% e +0,22%, sempre em `headUpperCard`, depois de o encantamento do mesmo elmo mudar.
- **O ganho é concentrado em poucos campos baratos.** Os encantamentos têm de 3 a 19 candidatos e carregam a maior parte do ganho: `weaponEnchant1` +17,9% com 9 candidatos (b1 e inq), `bootEnchant2` +6,4%/+6,8%, `accRightEnchant3` +5,5%. Campos de carta têm de 99 a 300 candidatos e rendem de +0,4% a +2,0%, com uma exceção: `weaponCard2` em b2 (+6,9%).
- **Não dá para cortar a lista de candidatos pela ordenação.** O vencedor aparece na posição 52 de 140 (elmo), 149 de 300 (arma de b2), 40 de 300 (arma de weak). A ordenação por relevância é só uma heurística.
- **Alocação orientada por potencial** fica então assim: pagar a 1ª passada inteira (o custo é conhecido e o ganho dominante), e na 2ª só re-verificar peças que a 1ª alterou. Reservar uma fração do teto não captura isso; reservar o **custo calculado da 1ª passada** captura.

### 1.3 Candidatos e avaliações redundantes

- **Cache**: na fase de busca, 15% das tentativas já são hits (b1: 2573 hits contra 14719 avaliações); o cache já remove esse trabalho do orçamento.
- **Candidatos intercambiáveis nos soquetes**: com assinatura conservadora (mesmo script, mesma posição de composição, sem parceiro de conjunto e sem ser citado por `EQUIP`/`EQUIP_ID` de outro item), só **143 de 1718** (8%) são equivalentes a outro. Deduplicar economizaria no máximo cerca de 140 avaliações por passada. Pouco; não vale mexer na lista.
- **Maior redundância real**: a 2ª passada (49% da fase de soquetes).
- Não eliminei candidato por "efeito zero" (cartas que escalam com HP, por exemplo, são invisíveis à pontuação por chaves) nem toquei o Candidate Generator.

### 1.4 Busca progressiva

- Já existe o que um checkpoint precisa: a busca é determinística e cada passo aceito é uma build completa e válida. O relatório de orçamento passou a registrar `checkpoints` (avaliações gastas, fase, DPS de cada build aceita): "o melhor resultado completo até cada orçamento".
- Com esforço planejado fixo, o resultado até o orçamento B é o prefixo da execução maior (teste automatizado), então um checkpoint é reproduzível.
- **Critério de parada por platô não é seguro aqui.** A curva é em degraus e tardia: regra "ganho < 1% nas últimas 1000 avaliações" para em 4788 avaliações com 27% do DPS final (b1); com janela de 2000, em 14288 com 63%. Só janela de 3000 (cerca de 19200 avaliações) chega ao final, sem economia relevante. Parar por platô deixaria na mesa os degraus tardios.
- **Parada orientada à meta** é o critério que faz sentido (`require`/`maxHitsToKill` do `GoalSpec` já definem quando a build "serve"): parar na primeira build completa que cumpre a meta quando o jogador pediu só viabilidade. Não foi medida aqui (não há fixture com meta alcançável cedo); fica como proposta, sem implementação.

## 2. Experimento pequeno (implementado atrás de flag interna)

`socketRecheck: 'touched'` (padrão `'all'`, fora do schema do MCP): a 2ª passada re-verifica apenas as peças cujos soquetes a 1ª passada alterou. Resultado em seis execuções (tabela na seção 4): **DPS idêntico nas seis**, 171 a 1488 avaliações a menos (de 0,9% a 10,5% do custo efetivo), ou cerca de 1 a 6 s. A de b1 com E=10000, em que a 2ª passada completa achou +0,13%, também ficou idêntica, porque o elmo teve o encantamento alterado na 1ª passada e, portanto, entrou na re-verificação.

## 3. Decisão

1. **Nenhum padrão alterado.** `legacy` continua o padrão; `effortBudget` e `socketRecheck` são experimentais, internos, fora do contrato público, e o resultado padrão é idêntico (teste).
2. **Desacoplar o esforço do teto não entra como mudança de qualidade.** A evidência mostra que ele só dá reprodutibilidade/checkpoints, e piora tetos pequenos. Se a reprodutibilidade por orçamento for desejada, a forma segura é quantizar o esforço em faixas (por exemplo 2000, 4000, 8000, 16000, 20000) e tratar tetos intermediários como prefixos: ainda **não testado**, depende de decisão do produto.
3. **[Superado por [optimize-targeted-greedy.md](optimize-targeted-greedy.md): `touched` perdeu −0,72% num caso adversarial; a alternativa é `near`.]** Candidato a virar padrão, mediante sua aprovação: `socketRecheck: 'touched'`. Ganho medido sem perda de DPS, risco baixo e localizado. Ressalvas: quatro builds de uma classe, sem fixture adversária. Antes de promover, validar em builds de outras classes e armas com muitos campos.
4. **Reserva por necessidade absoluta**: com o custo da 1ª passada calculável, o orçamento do Unified poderia reservar esse número em vez de 15% fixo. Não implementado: o ganho dessa troca não foi medido, e o resultado do Greedy é sensível ao caminho (1.1).
5. **Fora do escopo e sem evidência para agora:** Beam Search, VNS, filtros de candidatos, mudanças no gerador. A maior parte da variância de qualidade vem da trajetória (caminho sensível ao esforço), não de avaliações redundantes.

## 4. Resultados (gerados)

Gerado por `node tools/optimize-efficiency-report.mjs` a partir de `docs/benchmarks/optimize-budget/runs/`. Execuções: `decoupled-*`, `plan-e*`, `touched-e*`, `trail-*` (via `optimize-budget.bench.spec.ts`) e `redundancy.json` (via `optimize-redundancy.bench.spec.ts`).

<!-- efficiency:start -->
#### b1: Legacy 20000 = 5.299 M (custo efetivo 21654)

Esforço acoplado ao teto (padrão) contra esforço planejado de 20000, mesmo teto total (DPS em milhões, entre parênteses a diferença para o Legacy 20000):

| teto total | acoplado | desacoplado (E=20000) | desacoplado antes dos soquetes |
|---|---:|---:|---:|
| 2000 | 1.152 (-78.3%) | 0.659 (-87.6%) | 0.650 |
| 4000 | 1.437 (-72.9%) | 1.439 (-72.8%) | 1.439 |
| 8000 | 3.174 (-40.1%) | 2.285 (-56.9%) | 2.117 |
| 12000 | — | 3.346 (-36.9%) | 2.790 |
| 16000 | — | 4.436 (-16.3%) | 3.331 |
| 20000 | 3.847 (-27.4%) | 5.230 (-1.3%) | 3.678 |
| 23530 | 5.299 (0.0%) | 5.299 (0.0%) | 3.737 |

Separação dos dois papéis do teto:

| execução | DPS final | vs Legacy | custo efetivo | antes dos soquetes |
|---|---:|---:|---:|---:|
| Legacy | 5.299 | 0.0% | 21654 | 3.737 |
| teto 17000, esforço 17000 (acoplado) | 3.847 | -27.4% | 19676 | 3.154 |
| teto 17000, esforço 20000 | 5.230 | -1.3% | 20000 | 3.678 |
| teto 20000, esforço 17000 | 3.847 | -27.4% | 19676 | 3.154 |
| teto 20000, esforço 20000 | 5.299 | 0.0% | 21654 | 3.737 |

Qualidade pelo esforço planejado sozinho (sem teto: a busca termina por conta própria; custo = o que o plano precisa):

| esforço E | DPS final | vs Legacy | custo efetivo | antes dos soquetes | avaliações nos soquetes | qualidade por custo (Legacy = 100) |
|---|---:|---:|---:|---:|---:|---:|
| 6000 | 3.097 | -41.6% | 9784 | 2.883 | 3272 | 129 |
| 10000 | 3.165 | -40.3% | 14144 | 2.948 | 3416 | 91 |
| 14000 | 3.469 | -34.5% | 17639 | 2.886 | 3473 | 80 |
| 17000 | 3.847 | -27.4% | 19676 | 3.154 | 3401 | 80 |
| 20000 | 5.299 | 0.0% | 21654 | 3.737 | 3289 | 100 |
| 24000 | 5.021 | -5.3% | 24145 | 4.429 | 3228 | 85 |

Passada de soquetes de b1 (Unified com esforço 20000, custo total na passada 3289):

| passada | campos | avaliações | campos com ganho | ganho composto |
|---|---:|---:|---:|---:|
| 1 | 33 | 1689 | 7 | 41.8% |
| 2 | 33 | 1689 | 0 | 0.0% |

Campos com troca aceita (posição do vencedor na ordenação por relevância): weapon.weaponEnchant1: posição 4 de 9 (+17.85%); headUpper.headUpperCard: posição 52 de 140 (+0.89%); headUpper.headUpperEnchant1: posição 1 de 3 (+2.83%); boot.bootEnchant2: posição 2 de 14 (+6.41%); boot.bootEnchant3: posição 11 de 14 (+1.35%); accRight.accRightEnchant2: posição 14 de 19 (+1.91%); accRight.accRightEnchant3: posição 4 de 9 (+5.54%).

Avaliações em campos sem ganho: 3170 de 3378. Maior ganho isolado: weapon.weaponEnchant1 +17.85%.

Melhor build completa até cada orçamento (uma só execução, esforço 20000; checkpoints dos passos aceitos), b1:

| avaliações | melhor DPS | % do final |
|---|---:|---:|
| 1000 | 0.576 | 10.9% |
| 2000 | 0.576 | 10.9% |
| 4000 | 1.439 | 27.2% |
| 6000 | 1.966 | 37.1% |
| 8000 | 2.117 | 39.9% |
| 10000 | 2.790 | 52.7% |
| 12000 | 3.064 | 57.8% |
| 14000 | 3.331 | 62.9% |
| 16000 | 3.427 | 64.7% |
| 18000 | 4.404 | 83.1% |
| 20000 | 5.299 | 100.0% |

- Parada por platô (janela 1000, ganho < 1%): para em 4788 avaliações, com 27.2% do DPS final desta execução.
- Parada por platô (janela 1000, ganho < 2%): para em 4788 avaliações, com 27.2% do DPS final desta execução.
- Parada por platô (janela 2000, ganho < 1%): para em 14288 avaliações, com 62.9% do DPS final desta execução.
- Parada por platô (janela 2000, ganho < 2%): para em 14288 avaliações, com 62.9% do DPS final desta execução.
- Parada por platô (janela 3000, ganho < 1%): para em 19228 avaliações, com 100.0% do DPS final desta execução.
- Parada por platô (janela 3000, ganho < 2%): para em 19228 avaliações, com 100.0% do DPS final desta execução.

#### inq: Legacy 20000 = 1.522 M (custo efetivo 21660)

Esforço acoplado ao teto (padrão) contra esforço planejado de 20000, mesmo teto total (DPS em milhões, entre parênteses a diferença para o Legacy 20000):

| teto total | acoplado | desacoplado (E=20000) | desacoplado antes dos soquetes |
|---|---:|---:|---:|
| 2000 | 0.341 (-77.6%) | 0.183 (-88.0%) | 0.180 |
| 4000 | 0.436 (-71.3%) | 0.411 (-73.0%) | 0.411 |
| 8000 | 0.913 (-40.0%) | 0.655 (-57.0%) | 0.599 |
| 12000 | — | 0.957 (-37.1%) | 0.777 |
| 16000 | — | 1.272 (-16.4%) | 0.935 |
| 20000 | 1.102 (-27.6%) | 1.499 (-1.5%) | 1.029 |
| 23530 | 1.522 (0.0%) | 1.522 (0.0%) | 1.048 |

Separação dos dois papéis do teto:

| execução | DPS final | vs Legacy | custo efetivo | antes dos soquetes |
|---|---:|---:|---:|---:|
| Legacy | 1.522 | 0.0% | 21660 | 1.048 |
| teto 17000, esforço 17000 (acoplado) | 1.102 | -27.6% | 19425 | 0.882 |
| teto 17000, esforço 20000 | 1.499 | -1.5% | 20000 | 1.029 |
| teto 20000, esforço 17000 | 1.102 | -27.6% | 19425 | 0.882 |
| teto 20000, esforço 20000 | 1.522 | 0.0% | 21660 | 1.048 |

Qualidade pelo esforço planejado sozinho (sem teto: a busca termina por conta própria; custo = o que o plano precisa):

| esforço E | DPS final | vs Legacy | custo efetivo | antes dos soquetes | avaliações nos soquetes | qualidade por custo (Legacy = 100) |
|---|---:|---:|---:|---:|---:|---:|
| 6000 | 0.895 | -41.2% | 9927 | 0.811 | 3344 | 128 |
| 10000 | 0.900 | -40.9% | 14003 | 0.830 | 3341 | 91 |
| 14000 | 0.986 | -35.2% | 17345 | 0.805 | 3378 | 81 |
| 17000 | 1.102 | -27.6% | 19425 | 0.882 | 3401 | 81 |
| 20000 | 1.522 | 0.0% | 21660 | 1.048 | 3289 | 100 |
| 24000 | 1.424 | -6.4% | 23881 | 1.274 | 3228 | 85 |

Passada de soquetes de inq (Unified com esforço 20000, custo total na passada 3289):

| passada | campos | avaliações | campos com ganho | ganho composto |
|---|---:|---:|---:|---:|
| 1 | 33 | 1689 | 8 | 45.2% |
| 2 | 33 | 1689 | 0 | 0.0% |

Campos com troca aceita (posição do vencedor na ordenação por relevância): weapon.weaponEnchant1: posição 4 de 9 (+17.95%); shield.shieldCard: posição 21 de 99 (+1.96%); headUpper.headUpperCard: posição 52 de 140 (+0.71%); headUpper.headUpperEnchant1: posição 1 de 3 (+2.83%); boot.bootEnchant2: posição 2 de 14 (+6.79%); boot.bootEnchant3: posição 11 de 14 (+1.32%); accRight.accRightEnchant2: posição 14 de 19 (+2.1%); accRight.accRightEnchant3: posição 4 de 9 (+5.55%).

Avaliações em campos sem ganho: 3071 de 3378. Maior ganho isolado: weapon.weaponEnchant1 +17.95%.

Melhor build completa até cada orçamento (uma só execução, esforço 20000; checkpoints dos passos aceitos), inq:

| avaliações | melhor DPS | % do final |
|---|---:|---:|
| 1000 | 0.159 | 10.4% |
| 2000 | 0.159 | 10.4% |
| 4000 | 0.411 | 27.0% |
| 6000 | 0.560 | 36.8% |
| 8000 | 0.599 | 39.3% |
| 10000 | 0.777 | 51.1% |
| 12000 | 0.850 | 55.9% |
| 14000 | 0.935 | 61.5% |
| 16000 | 0.961 | 63.1% |
| 18000 | 1.236 | 81.2% |
| 20000 | 1.522 | 100.0% |

- Parada por platô (janela 1000, ganho < 1%): para em 7788 avaliações, com 39.3% do DPS final desta execução.
- Parada por platô (janela 1000, ganho < 2%): para em 7788 avaliações, com 39.3% do DPS final desta execução.
- Parada por platô (janela 2000, ganho < 1%): para em 14538 avaliações, com 61.5% do DPS final desta execução.
- Parada por platô (janela 2000, ganho < 2%): para em 14538 avaliações, com 61.5% do DPS final desta execução.
- Parada por platô (janela 3000, ganho < 1%): para em 19236 avaliações, com 100.0% do DPS final desta execução.
- Parada por platô (janela 3000, ganho < 2%): para em 19236 avaliações, com 100.0% do DPS final desta execução.

#### b2: Legacy 20000 = 1.561 M (custo efetivo 20051)

Passada de soquetes de b2 (Unified com esforço 20000, custo total na passada 2614):

| passada | campos | avaliações | campos com ganho | ganho composto |
|---|---:|---:|---:|---:|
| 1 | 30 | 1863 | 2 | 7.3% |
| 2 | 30 | 1863 | 0 | 0.0% |

Campos com troca aceita (posição do vencedor na ordenação por relevância): weapon.weaponCard2: posição 149 de 300 (+6.91%); headUpper.headUpperCard: posição 38 de 140 (+0.41%).

Avaliações em campos sem ganho: 3286 de 3726. Maior ganho isolado: weapon.weaponCard2 +6.91%.

#### weak: Legacy 20000 = 5.288 M (custo efetivo 21347)

Passada de soquetes de weak (Unified com esforço 20000, custo total na passada 3177):

| passada | campos | avaliações | campos com ganho | ganho composto |
|---|---:|---:|---:|---:|
| 1 | 31 | 1628 | 6 | 30.2% |
| 2 | 31 | 1628 | 0 | 0.0% |

Campos com troca aceita (posição do vencedor na ordenação por relevância): weapon.weaponCard1: posição 40 de 300 (+5.25%); weapon.weaponEnchant1: posição 4 de 9 (+10.81%); headUpper.headUpperEnchant1: posição 1 de 3 (+2.78%); boot.bootEnchant3: posição 11 de 14 (+1.25%); accRight.accRightEnchant2: posição 14 de 19 (+1.68%); accRight.accRightEnchant3: posição 4 de 9 (+5.5%).

Avaliações em campos sem ganho: 2902 de 3256. Maior ganho isolado: weapon.weaponEnchant1 +10.81%.

#### Segunda passada de soquetes: todos os campos contra só as peças que a primeira passada alterou

| build | esforço E | DPS (todos) | custo (todos) | soquetes (todos) | DPS (tocados) | custo (tocados) | soquetes (tocados) | DPS tocados vs todos | avaliações poupadas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| b1 | 10000 | 3.165 | 14144 | 3416 | 3.165 | 12656 | 1928 | 0.0% | 1488 |
| b1 | 14000 | 3.469 | 17639 | 3473 | 3.469 | 16354 | 2188 | 0.0% | 1285 |
| b1 | 20000 | 5.299 | 21654 | 3289 | 5.299 | 20932 | 2567 | 0.0% | 722 |
| inq | 20000 | 1.522 | 21660 | 3289 | 1.522 | 21109 | 2738 | 0.0% | 551 |
| b2 | 20000 | 1.561 | 20051 | 2614 | 1.561 | 19880 | 2443 | 0.0% | 171 |
| weak | 20000 | 5.288 | 21347 | 3177 | 5.288 | 20676 | 2506 | 0.0% | 671 |

<!-- efficiency:end -->

## 5. Limitações

- Duas builds (b1, inq) no núcleo; b2 e weak só na checagem de soquetes. Mesma classe; o inq e o b1 compartilham os mesmos itens finais (1718 candidatos de soquete idênticos).
- Execução única por configuração: a busca é determinística, repetir não prova robustez.
- A causa exata da divergência de trajetória foi localizada (esforço por slot na caminhada, passo 5 da trilha), mas não isolada numa única variável: `quickEffort`, `fullEffort` e `discoveryCap` variam juntos.
- Tempos aproximados (quatro processos em paralelo). Em produção, `maxSearchMs = 45 s` corta a busca antes de ~21 mil avaliações nesta máquina.
- A trilha do Legacy 20000 não foi regravada (artefato anterior à instrumentação); as comparações de trilha usam `plan-e20000` e `plan-e17000`, que reproduzem os resultados do Legacy e do acoplado de 17000.
- Os artefatos `decoupled-23530-e20000` de b1 e inq vieram de duas execuções concorrentes e podem não ter trilha; as tabelas usam só os números, que são idênticos.
