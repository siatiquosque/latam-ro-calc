# Optimize V1 — matriz de aceite

Critérios estabelecidos antes dos benchmarks desta etapa (04/11/2026):

1. **Legalidade e reprodução:** cada resultado aplicável e seu link devem reproduzir as métricas e respeitar as restrições explícitas, os itens LATAM e as travas. Uma entrada inválida ou sem saldo para verificar deve receber erro explícito, não uma recomendação não verificada.
2. **Metas:** avaliar cada alvo separadamente, conservar uma solução viável já encontrada e distinguir viabilidade de confiabilidade. O teste fechado de meta impossível deve demonstrar o espaço enumerado e não confundir orçamento esgotado com impossibilidade.
3. **Sem meta:** DPS final não pode ser inferior ao inicial além de 0,1% de tolerância numérica; deve haver ganho útil superior a 1% em pelo menos duas builds equipadas, com troca não trivial de equipamento ou soquete. Em cada cenário comparável, o Greedy não deve perder mais de 5% do DPS do baseline atual sob condições de custo e deadline equivalentes. Ausência de baseline comparável será marcada como não verificada, sem inventar referência.
4. **Orçamento:** nenhum contrato anunciado como rígido pode ser ultrapassado por avaliações de alvos, procs, polish, verificação ou relatórios. O resultado deve distinguir unidade legada, chamadas reais ao motor, cache hits, verificações obrigatórias, orçamento solicitado e motivo de parada; saldo insuficiente deve ser explícito. Cache miss agregado não é chamada única de motor.
5. **Deadline:** medir tempo de parede de ponta a ponta sob limites reais da UI e MCP, repetindo somente cenários de tempo/deadline; a interrupção deve devolver a melhor build completa verificada. A busca e relatório devem terminar dentro do deadline anunciado, com tolerância limitada à avaliação em andamento e às verificações finais obrigatórias explicitadas; timeout extra independente do polish não satisfaz o critério.
6. **Cobertura mínima:** Jor restrito, Meister, Meister com conjuntos, Magus real equipado; modos meta multi-alvo e DPS geral. Ausência de referência ou evidência impede declarar o respectivo caso aprovado.
7. **Integração e qualidade:** contratos de UI/MCP, patch/link e respostas sem GoalSpec reproduzíveis; golden, testes direcionados, typecheck e suíte completa registrados. Falha pré-existente comprovada é limitação explicitada, não suíte verde.

Vereditos: READY exige todos os critérios; READY WITH LIMITATIONS exige integridade, orçamento e deadline aprovados, com lacunas não críticas explícitas; qualquer falha de integridade, teto rígido ou deadline, ou ausência de evidência essencial, implica NOT READY.
## Resultados por fixture e orçamento legado

Execuções com limites MCP de 45 s, procs desligados, 300 e 800 cache misses anunciados. Em cada caso, a busca, o polish, o relatório e o julgamento final foram medidos até o retorno; `chamadas` inclui todos os alvos. Os benchmarks de 300 e de 800 tiveram cargas diferentes, portanto o tempo é observação, não comparação controlada de desempenho. Os artefatos registram as leituras por alvo, patches e links.

| Fixture | Modo | maxSolves | Inicial → final (DPS M) | Estado / confiabilidade | Chamadas reais | Cache hits / misses | Tempo (s) | Parada |
| --- | --- | ---: | ---: | --- | ---: | --- | ---: | --- |
| jor-restricted | goal | 300 | 23.305 → 58.207 | feasible / guaranteed | 10827 | 101 / 2427 | 35.46 | search-budget |
| jor-restricted | general | 300 | 23.305 → 60.854 | feasible | 11232 | 58 / 2252 | 34.13 | search-budget |
| meister | goal | 300 | 10.863 → 65.949 | infeasible | 10755 | 70 / 2909 | 34.21 | search-budget |
| meister | general | 300 | 10.863 → 69.665 | feasible | 10155 | 75 / 2543 | 35.54 | search-budget |
| meister-sets | goal | 300 | 10.863 → 29.856 | infeasible | 8314 | 54 / 2244 | 30.88 | search-budget |
| meister-sets | general | 300 | 10.863 → 29.856 | feasible | 8239 | 65 / 2064 | 31.51 | search-budget |
| magus-replay | goal | 300 | 7.376 → 29.237 | infeasible | 3038 | 60 / 3031 | 13.76 | search-budget |
| magus-replay | general | 300 | 7.376 → 29.421 | feasible | 3038 | 60 / 3031 | 12.87 | search-budget |
| jor-restricted | goal | 800 | 23.305 → 60.854 | feasible / guaranteed | 11067 | 150 / 2599 | 39.62 | search-budget |
| jor-restricted | general | 800 | 23.305 → 62.291 | feasible | 11287 | 196 / 2263 | 38.05 | search-budget |
| meister | goal | 800 | 10.863 → 93.375 | feasible / guaranteed | 11563 | 138 / 3222 | 35.71 | search-budget |
| meister | general | 800 | 10.863 → 111.243 | feasible | 11103 | 177 / 2779 | 35.30 | search-budget |
| meister-sets | goal | 800 | 10.863 → 32.555 | infeasible | 10430 | 129 / 2880 | 28.18 | search-budget |
| meister-sets | general | 800 | 10.863 → 83.566 | feasible | 9543 | 180 / 2389 | 32.17 | search-budget |
| magus-replay | goal | 800 | 7.376 → 51.038 | infeasible | 3637 | 137 / 3630 | 14.10 | search-budget |
| magus-replay | general | 800 | 7.376 → 51.085 | feasible | 3637 | 137 / 3630 | 12.38 | search-budget |

O status `infeasible` aqui significa que o resultado encontrado não cumpre a meta; com `search-budget` não é prova de impossibilidade. O teste de espaço fechado usa `slots: []`, `complements: false` e sem pares: só a build inicial existe no espaço, não cumpre 1 golpe no alvo 21545 e termina `completed`, com modelo final idêntico. Em Jor, o teste específico também combina política de MVP, grau C, refino +12, consumível proibido e campos travados.

O Magus provém de `mg-pazzolino-field-arrow.rrf`: 19 itens, nenhum item/carta/opção ignorado, FEI 100, STA 39, SAB 39 e passivas lidas dos níveis gravados. Usa a mesma configuração de ativas do teste que valida os pacotes e a versão de fórmula pré-rebalanceamento daquela gravação. É uma build real equipada, mas não uma referência de solução ótima nem prova de paridade com o balanceamento atual.

## Tempo medido por fase

São segundos gastos dentro das chamadas instrumentadas de avaliação, incluindo resolução/cache; não somam todo o tempo de parede (geração de candidatos, agendamento e serialização ficam fora). `feasibility` é o julgamento independente final. Os arquivos JSON contêm chamadas, hits, misses e tempos por fase.

| Fixture (800) | Modo | Baseline | Triagem | Busca | Polish | Relatório | Viabilidade | Parede |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jor-restricted | goal | 0.05 | 5.42 | 3.53 | 27.10 | 0.12 | 0.03 | 39.62 |
| jor-restricted | general | 0.01 | 5.66 | 6.02 | 21.96 | 0.11 | 0.03 | 38.05 |
| meister | goal | 0.01 | 3.62 | 2.92 | 24.11 | 0.08 | 0.02 | 35.71 |
| meister | general | 0.01 | 3.86 | 4.39 | 22.51 | 0.08 | 0.02 | 35.30 |
| meister-sets | goal | 0.01 | 2.84 | 2.62 | 19.00 | 0.09 | 0.02 | 28.18 |
| meister-sets | general | 0.01 | 4.62 | 4.55 | 18.64 | 0.09 | 0.02 | 32.17 |
| magus-replay | goal | 0.01 | 1.29 | 1.41 | 9.24 | 0.06 | 0.01 | 14.10 |
| magus-replay | general | 0.00 | 1.15 | 1.20 | 8.03 | 0.05 | 0.01 | 12.38 |

## Limites de produção e deadline

Padrões locais do código: MCP 45 s / 10.000 `maxSolves`; UI 60 s / 10.000, procs médios e 3 acertos/s. O MCP aceita sobrescrita por `MAX_SEARCH_MS` e `MAX_SOLVES`; a configuração do serviço publicado não foi consultada, portanto seus valores e latência reais permanecem não verificados. Medições concorrentes, portanto sob carga: MCP (Meister, quatro alvos) 45,20 s e 13.178 chamadas, parado por tempo; UI (Jor, um alvo) 60,17 s e 14.315 chamadas, parado por tempo. Links e patches reproduziram o DPS. O MCP recebeu `constraints: {}` e alvos explícitos; a UI simulada usou o core e parâmetros do worker, com um alvo e sem GoalSpec. A carga não é uma referência de latência isolada. Para a mesma fixture Meister com conjuntos, meta e `maxSolves` 800, duas execuções em condições de carga distintas levaram 28,18 s e 34,51 s; ambas retornaram o mesmo resultado e permaneceram inviáveis.

Dois limites de UI de 5 s, concorrentes, retornaram em 5,34 s (procs off) e 5,48 s (média), com parada por tempo, resultado inicial legal e link/patch reproduzíveis. Em uma busca restrita à arma, o prazo retornou uma build melhorada já encontrada: 23,30M → 31,74M, em 5,21 s, com link e patch reproduzíveis. A sobrecarga após o deadline inclui relatórios e julgamento, e não tem teto rígido. Antes da correção, com deadline de 1 ms o polish executou 2.653 chamadas extras; o teste agora exige zero chamadas de polish depois de vencido o prazo.

O deadline é cooperativo e não cancela uma avaliação em andamento nem limita estritamente o relatório final. O botão de cancelar da UI termina o worker, portanto descarta o incumbente: não satisfaz a entrega de parcial ao cancelar. A UI ainda não oferece GoalSpec nem travas por campo; aceita até dois alvos, enquanto o MCP aceita cinco. Paridade de contrato entre interfaces permanece pendente.

## Contabilidade e decisão técnica

`maxSolves` mantém o contrato legado de cache misses da busca. É um orçamento de planejamento e parada, não uma garantia rígida nem mesmo para todos os misses: com objetivo de rotação, o melhor finalista do proxy pode ser avaliado após o limite. Em `legacy`, polish tem orçamento próprio; avaliações agregadas e procs podem fazer várias chamadas, e relatórios e verificações ficam fora. `budgetUsage` informa o valor solicitado/efetivo, contagem debitada, cache hits/misses, avaliações sem cache, fases, chamadas reais, chamadas do julgamento de viabilidade e motivo; `hardTotalLimit: false` explicita que não existe teto total. `budgetReport.phaseEngineMs` é instrumentação de benchmark. O texto do MCP e a UI deixam de apresentar `maxSolves` como teto global.

Para um teto real, propor um orçamento por job compartilhado e injetado no avaliador, debitado em cada chamada de motor inclusive alvos e estados de proc, com reserva explícita para verificações e tratamento de leitura incompleta. Não usar contador global mutável como controle: jobs podem intercalar após `await`. Introduzir um parâmetro novo, por exemplo `maxEngineCalls`, mantendo `maxSolves` legado, e recusar o pedido se o mínimo obrigatório não couber. Para cancelamento parcial, o worker precisa de checkpoints verificados e protocolo cooperativo; terminar o worker não pode devolvê-los. Essas mudanças são arquiteturais e não foram implementadas nesta etapa.

## Qualidade e veredito preliminar

Todas as linhas gerais medidas superaram o DPS inicial em mais de 1%, e os patches e links reproduziram o resultado nas medições disponíveis. O baseline histórico do Greedy com orçamento total real não é comparável ao `maxSolves` legado com polish fora do teto; a exigência de diferença máxima de 5% continua sem prova. O conjunto restrito e o Magus não atingiram as metas testadas; não se infere impossibilidade. O Magus não tem referência independente de solução ótima.

**NOT READY.** Bloqueantes: teto total rígido ainda não existe; cancelamento da UI perde o incumbente; UI não expõe metas/travas por campo e há discrepância de número de alvos; comparação de qualidade sob custo equivalente ainda incompleta. Deadline agora é compartilhado, mas a conclusão após ele não tem teto garantido. Não há evidência para mudar de algoritmo.

## Mudanças e verificação desta etapa

- `budgetUsage` é aditivo e explicita que o limite legado não é rígido; distingue cache hits/misses, avaliações sem cache, chamadas reais por fase e verificações de viabilidade. `stoppedReasons` pode registrar orçamento e tempo simultaneamente. MCP e UI explicam o orçamento; a UI exibe chamadas reais.
- O prazo da busca é compartilhado com o polish, em vez de abrir uma janela independente de até 25 s. A avaliação em andamento e os relatórios continuam cooperativos, sem garantia rígida de tempo total.
- A opção e o rótulo `matk_element_holy` foram corrigidos com as mesmas duas alterações pontuais existentes na main (38b6a086), sem merge ou cherry-pick. Os testes específicos de busca e rótulo passaram: 77 casos.
- MCP: o teste de integração reproduz patch e link, confirma trava por campo, disponibilidade/violações e contabilidade multi-alvo. UI: cinco testes Playwright passaram; após as últimas mudanças, o caso de busca e comparação passou novamente. O resultado por timeout e os limites padrão foram medidos com o mesmo core e os parâmetros do worker; não equivalem a uma medição de rede ou de carregamento de dados do navegador.
- Regressões direcionadas de orçamento, deadline, espaço fechado e integração: sete casos passaram; importação do Magus e teste da gravação passaram. Typecheck completo passou. Golden após a correção do deadline: 3/3 passaram. Suíte completa sobre o estado final: 9.402 passaram e 23 testes opt-in foram pulados (450 arquivos passaram, 10 arquivos com opt-in ignorados). O golden foi executado separadamente.

**Não bloqueantes isolados:** a gravação mágica é pré-rebalanceamento e não estabelece referência ótima para o balanceamento atual; tempos por fase são apenas o tempo das avaliações instrumentadas, não o tempo de parede completo; o polish continua ranqueando por DPS e pode precisar de um teste fim a fim adicional. A confiabilidade é retornada separadamente quando o motor dispõe de dados; não é inferida a partir apenas de DPS ou meta de golpes.

## Orçamento por job e cancelamento cooperativo (04/11/2026)

Esta seção substitui os dois bloqueios de execução acima, mantendo as demais pendências de aceite. `maxSolves` continua legado e opcionalmente se soma `maxEngineCalls`: uma unidade é cada chamada efetiva a `solveWithInput`, antes de iniciá-la. O orçamento pertence a um job; alvos agregados, estados de proc, baseline, complementos, polish e julgamento final usam o mesmo contador. Cache hit não cobra chamada; uma avaliação interrompida não entra no cache. O contador é síncrono dentro do job, sem estado global compartilhado entre jobs.

O teto reserva previamente `2 × alvos × custoMáximoPorAlvo` para julgar baseline e resultado final: 1 chamada por alvo com procs off, até 2 em active, até 8 em average. O pedido abaixo do mínimo conservador é recusado com erro explícito. A busca não pode gastar a reserva; se não houver build completa validada, retorna erro em vez de fabricar uma. `budgetUsage` expõe limite, chamadas, hits, avaliações completas/incompletas, custo por fase, reserva e parada; `engine-budget`, `search-budget`, `time`, `cancelled` e `completed` têm sentidos distintos. Em modo rígido, relatórios opcionais com custo imprevisível são omitidos; patch, link, métricas e julgamento final permanecem. Os contratos antigos sem `maxEngineCalls` mantêm a estratégia e o orçamento legados.

O worker emite checkpoints apenas depois de ler todos os alvos, conferir requisitos e validar a build. O botão de cancelar solicita parada cooperativa; o worker termina após produzir o resultado verificado. Se não responder em 2 s, o processo principal encerra o worker e usa o último checkpoint recebido. Nesse fallback, `accountingIncomplete` identifica que o número de chamadas é apenas o conhecido até o checkpoint. Se nenhum checkpoint tiver chegado, retorna erro explícito; nunca monta uma build parcial. Uma avaliação já iniciada não é interrompida no meio de uma chamada síncrona, mas não inicia a próxima chamada de alvo/proc após timeout/cancelamento. As verificações finais usam a reserva mesmo depois da parada.

A UI sem teto total também envia checkpoints: suas verificações adicionais são contadas como chamadas reais fora dos misses legados e consomem tempo. Assim, sob deadline apertado sua trajetória pode mudar, mesmo sem alterar o Greedy. Fechar a janela ou substituir uma execução ainda encerra o worker; o último checkpoint recebido permanece fora dele, mas não é exibido após fechar a janela.

Comparação reproduzível com a build Jor, dois alvos, uma arma candidata, procs off, sem complementos e mesmo teto de 33 chamadas reais ([dados](benchmarks/optimize-job-budget/comparison.json)):

| Execução | Chamadas totais | Verificação final | DPS inicial → final | Parada | Tempo observado |
| --- | ---: | ---: | ---: | --- | ---: |
| Legado | 33 | 4 | 23,764M → 30,786M | completed | 514 ms |
| Teto rígido 33 | 16 | 4 | 23,764M → 30,786M | completed | 134 ms |
| Teto 33, deadline 1 ms | 10 | 4 | 23,764M → 23,764M | time | 56 ms |
| Teto 33, cancelar após melhoria | 16 | 4 | 23,764M → 30,786M | cancelled | 88 ms |

O modo rígido omite relatórios opcionais, o que explica parte das chamadas a menos; os tempos são uma rodada pequena e sequencial, com aquecimento desigual, não um benchmark de latência. A meta permaneceu inviável nas quatro execuções; a busca não afirma impossibilidade global. Um teto menor pode reduzir qualidade porque reserva verificações e cobra alvos/procs antes não debitados, sem alterar a ordem de movimentos.

Verificação nesta etapa: 89 testes direcionados passaram em 7 arquivos; typecheck passou; Playwright passou nos 6 testes de melhorias; golden passou 3/3; suíte completa passou com 9.414 testes, 24 ignorados (452 arquivos aprovados, 11 ignorados). A comparação reproduzível também passou. Permanecem fora desta etapa: controles de GoalSpec e travas por campo na UI, paridade completa de alvos, comparação de qualidade em matriz mais ampla com custos totais equivalentes e certificação do serviço implantado. Até essa avaliação, o veredito global continua **NOT READY**; não há justificativa para Beam/VNS.

## Auditoria de paridade UI/MCP — antes da integração

| Recurso | Core / MCP | UI antes desta etapa |
| --- | --- | --- |
| DPS e perfil | objetivo/perfil | perfil disponível |
| GoalSpec, golpes e margem | validação compartilhada, até cinco alvos | ausente |
| Alvos | até cinco, avaliação individual para metas | até dois |
| Grau, refino, exclusões | ConstraintSpec e parâmetros legados | limites de busca e exclusões legadas |
| MVP, travas por slot e campo | ConstraintSpec | seleção de slots pesquisáveis, sem travas explícitas |
| Efeitos e consumíveis | validação de restrições sobre build | sem controles de restrição |
| Orçamento e cancelamento | maxEngineCalls, maxSolves, checkpoints e razões | limite e cancelamento disponíveis; detalhes incompletos |
| Viabilidade | por alvo, estado e confiabilidade separados | não apresentada |

O worker encaminha `OptimizeBuildArgs` ao mesmo core usado pelo MCP. O core valida GoalSpec e ConstraintSpec; os contratos de transporte são os mesmos. Não se devem apresentar consumíveis ou buffs como escolhidos pela busca: a restrição verifica o estado da build e a busca de equipamentos não os otimiza.

## Paridade UI/MCP — implementação e evidência

| Recurso | UI após esta etapa | Limite |
| --- | --- | --- |
| DPS e metas | Perfil, meta de golpes e margem; sem meta usa o comportamento de DPS/perfil existente | Outras regras de GoalSpec (HIT, crítico e habilidade específica) não têm controles próprios. |
| Alvos | Até cinco, com validação compartilhada contra duplicatas; julgamento individual exibido | A UI usa pesos iguais; MCP aceita pesos. |
| Restrições | Grau/refino na busca por substituição, política MVP, exclusões de candidatos, trava de slot inteiro e trava individual de peça, carta e encanto | A UI não expõe travas individuais de grau/refino nem todos os parâmetros do MCP. Exclusão legada impede novas recomendações; não equivale a `unavailableIds` aplicado a toda a build. |
| Buffs e consumíveis | Estado da build e efeitos são encaminhados ao core | Sem controles para restringi-los: a busca de equipamentos não os escolhe e não se promete que serão removidos. |
| Orçamento | `maxSolves` legado e `maxEngineCalls` opcional; mesmo mínimo conservador do core validado antes do worker | O teto rígido omite relatórios opcionais. |
| Execução e resultado | Checkpoint verificado durante a busca, cancelamento cooperativo, fallback sinalizado, custo, parada, patch e viabilidade por alvo | Contabilidade do fallback forçado é parcial; chamada síncrona já iniciada não é interrompida. |

Validação: typecheck passou; 21 testes direcionados de orçamento, travas, integração e serviço passaram; comparação semântica do contrato do worker com MCP passou para DPS sem GoalSpec e para cinco alvos com dois golpes, margem, trava de carta, MVP, grau e teto rígido (3 testes de integração no arquivo). Playwright: 8/8 passaram, incluindo orçamento insuficiente antes do worker, cinco alvos e trava de campo, cancelamento após checkpoint e fluxo legado. Os testes não cobrem todas as combinações possíveis dos contratos; em particular, os controles não oferecem a totalidade do MCP.

**NOT READY:** falta a comparação de qualidade em matriz mais ampla com custo total equivalente e a validação da configuração publicada. A UI ainda não oferece toda a superfície do MCP, conforme a tabela; decidir se os controles restantes são necessários para o escopo de produção antes de declarar paridade completa. Não há evidência nova para trocar o Greedy.

## Mudança de direção e POC MCP — 05/11/2026

A auditoria extensa de READY foi interrompida pelo pedido de POC guiada por IA. As linhas concluídas em `benchmarks/optimize-ready-audit` permanecem evidência parcial, sem conclusão de qualidade ampla. O veredito de produção continua **NOT READY**.

As reproduções desta sequência identificaram cobrança ausente em recálculos de rotação, conflitos de restrição da build original e efeitos selecionados, além de problemas no julgamento de confiabilidade. Correções e testes estão descritos na [decisão](optimization-architecture-decision.md). A POC A/B/C e sua sensibilidade não substituem os gates de produção: ver [metodologia e resultados](ai-guided-optimization-benchmark.md). O serviço público consultado é 0.1.221-beta e não anuncia `maxEngineCalls`; o ensaio local usa 0.1.211-beta com alterações locais. Não foi feito deploy.
