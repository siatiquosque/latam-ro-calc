# POC — otimização guiada por IA e MCP

05/11/2026. Uma demonstração de engenharia com agente real nesta sessão, não um ensaio independente de vários agentes. O agente conhece o histórico do projeto; isso limita alegações de descoberta inédita e generalização.

## Protocolo congelado

- Snapshot persistente de `jor-ab02.json#builds.original`, originalmente `5hTy6pd`. As tentativas atuais de resolver o slug como token e no encurtador falharam. Não foi substituído por `gearOnlyStart` ou por uma referência com outra habilidade.
- Inquisidor, nível 236/50, `Explosion Blaster==5` (5244), fórmula `current`, atributos/passivas/buffs/consumíveis originais. Oleum Sanctum ativo e Abrasivo 14536 proibidos; MVP `none`, grau máximo C. Meta: dois golpes em **cada** 21544, 21545, 21542, 21601 e 21539.
- Todos os braços partiram do mesmo snapshot e dataset local `0.1.211-beta`. Procs off; nenhum efeito temporário selecionado. Novos testes de refino ficaram até +12, sem aumentar o grau além de C. Poucas substituições foram uma preferência, não uma restrição dura.
- Não foram exigidas travas de campos neste protocolo. As travas de Insígnia/Cordão do estudo anterior não foram implicitamente transportadas para esta POC; esses resultados exigem novo teste se tais travas forem adicionadas.
- Margem mínima solicitada: zero. A margem é medida e comparada; não foi inventada uma exigência de 10% depois de ver os resultados.
- Tetos reais: 200 e 1.000. Uma unidade observada é uma entrada em `solveController.solveSkill`, incluindo o solve inicial e recálculos de rotação. O spy síncrono recusa nova entrada sem saldo. Dez chamadas ficam separadas para reprodução final de patch e link. Cache hit não custa chamada de motor.
- O runner usa MCP SDK e `InMemoryTransport`, sem rede na comparação; tool arguments/results, hipótese, bytes, CPU e tempo de processo são persistidos. A usa a operação Optimize comum ao MCP/UI; B usa ferramentas MCP e verificação independente comum; C usa descoberta MCP e o mesmo Optimize em slots/candidatos limitados.

Arquivos: [fixture](../benchmarks/ai-guided-poc/fixture.json), [hashes e proveniência](../benchmarks/ai-guided-poc/code-provenance.json), [pedidos do agente](../benchmarks/ai-guided-poc/requests), [resumo](../benchmarks/ai-guided-poc/summary.json), [melhor patch e share](../benchmarks/ai-guided-poc/best-build.json), [gráfico e link para abrir a build](../benchmarks/ai-guided-poc/comparison.html).

## Desenho dos braços e sensibilidade

**A:** Greedy sem restrição artificial de candidatos, mesmo GoalSpec/ConstraintSpec, teto total incluindo triagem, complementos e julgamento final. A comparação principal usa `maxSolves=10.000`, padrão da aplicação. `maxEngineCalls` recebe o saldo após a reserva externa comum.

**B:** o agente consultou contexto, habilidade, estágios executados, monstros, buscas filtradas, detalhes e sinergias; escreveu hipóteses, recebeu lotes de métricas e escolheu as próximas consultas. Não chamou Optimize/scan/optimize_slot. Os quatro lotes exploratórios tinham 7, 9, 10 e 7 variantes. As propostas e suas rejeições estão no journal, incluindo alternativas ruins.

**C:** o agente indicou slots e listas curtas, inicialmente arma/armadura/bota e, na faixa maior, capa, topo, acessórios e baixo; o Greedy explorou esse subconjunto com complementos e par armadura/bota. Não recebeu como ponto inicial a solução vencedora de B. A comparação principal alinha o planejamento legado `maxSolves` ao teto da faixa. As consultas de descoberta foram repetidas e cobradas em C.

O primeiro harness fixou esforço legado em 100.000. Como `maxSolves` também regula esforço, essa configuração foi preservada como sensibilidade; foram executados adicionalmente A com planejamento alinhado ao teto e C com padrão 10.000. Todos os casos estão nos artefatos, sem apagar resultados desfavoráveis. Não houve algoritmo novo ou mudança de ordem/candidate generator para recuperar DPS.

## Resultado principal

<!-- ai-poc-results:start -->
| Braço | Teto | Chamadas reais | MCP | DPS médio M | Alvos ≤2 | Garantidos | Margem pior | Peças / campos | Processo (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| A | 200 | 200 | 0 | 18.217 | 0/5 | 0/5 | -33.48% | 0 / 0 | 1.013 |
| B | 200 | 177 | 37 | 35.376 | 5/5 | 0/5 | 8.59% | 3 / 18 | 2.789 |
| C | 200 | 200 | 8 | 23.74 | 2/5 | 0/5 | -13.33% | 0 / 2 | 1.232 |
| A | 1000 | 1000 | 0 | 18.217 | 0/5 | 0/5 | -33.48% | 0 / 0 | 3.509 |
| B | 1000 | 252 | 45 | 37.161 | 5/5 | 5/5 | 0.83% | 4 / 24 | 3.994 |
| C | 1000 | 1000 | 10 | 39.246 | 5/5 | 0/5 | 21.53% | 0 / 15 | 3.425 |

<!-- ai-poc-results:end -->

“Garantido” significa dentro do modelo, dataset e condições congeladas. A habilidade crítica usa o ramo crítico do cálculo; a precisão de ataques normais não o bloqueia quando o crítico efetivo é certo. Efeitos temporários não assegurados continuam condicionais. Isso não é garantia absoluta de comportamento do servidor.

O melhor B substitui armadura, capa e bota, preenche o baixo, usa uma carta de topo e uma de acessório diferentes, muda encantos/refino/grau e usa `cri:10` no pool catalogado do Manto Temporal SOR. São quatro slots de peças e 24 campos de modelo alterados; não equivale a “quatro cliques” nem a uma solução barata. A alternativa da faixa 200 preserva menos alterações, mas depende de críticos. Outras alternativas verificadas permanecem no journal.

A solução de B/1.000 tem margem mínima de apenas **0,83%**, contra Dolocaris de Dois Olhos. Cumpre a meta pedida, mas não uma margem hipotética de 10%. Não demonstra ótimo global nem robustez a mudanças de dados.

### Sensibilidade preservada

| Experimento | Teto real | Esforço legado | Chamadas | Alvos ≤2 | Garantidos | DPS médio M |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A200 | 200 | 100000 | 200 | 0/5 | 0/5 | 18.217 |
| AD200 | 200 | 10000 | 200 | 0/5 | 0/5 | 18.217 |
| AM200 | 200 | 200 | 200 | 0/5 | 0/5 | 18.217 |
| C200 | 200 | 100000 | 200 | 0/5 | 0/5 | 18.217 |
| CD200 | 200 | 10000 | 200 | 0/5 | 0/5 | 18.217 |
| CM200 | 200 | 200 | 200 | 2/5 | 0/5 | 23.74 |
| A1000 | 1000 | 100000 | 1000 | 0/5 | 0/5 | 18.217 |
| AD1000 | 1000 | 10000 | 1000 | 0/5 | 0/5 | 18.217 |
| AM1000 | 1000 | 1000 | 1000 | 0/5 | 0/5 | 18.217 |
| C1000 | 1000 | 100000 | 1000 | 0/5 | 0/5 | 18.217 |
| CD1000 | 1000 | 10000 | 1000 | 0/5 | 0/5 | 18.217 |
| CM1000 | 1000 | 1000 | 1000 | 5/5 | 0/5 | 39.246 |

AD: padrão 10.000; AM: planejamento alinhado; A: inicial 100.000. CM: híbrido alinhado; CD: híbrido padrão; C: híbrido inicial 100.000. A referência principal e as variantes exploratórias são explicitamente distintas.

## Custo e interpretação

Os tempos da tabela somam apenas o processo instrumentado — validação, ferramentas, busca, verificação — e excluem raciocínio do modelo, arranque do Vitest/shell e desenvolvimento. CPU é CPU do processo, incluindo GC/threads; não é somente CPU aritmética do motor. Não foi simulada latência ou preço do modelo.

B na faixa 200: 37 chamadas de ferramentas, 139.200 bytes de respostas, 177 chamadas reais. B na faixa 1.000: 45 ferramentas, 181.209 bytes de respostas, 252 chamadas reais, cerca de 6,23 s de CPU de processo e 3,99 s de tempo de processo. Tokens, latência isolada do modelo e custo monetário são **desconhecidos**. A sessão interativa incluiu leitura de código e preparação do experimento; não é uma medida de latência de um produto pronto.

O teto B/200 inclui B01–B13, a reprodução do link dessa solução e sua confirmação pública com GoalSpec. Essas duas confirmações ocorreram depois, mas a solução já estava fixada em B11, antes das consultas da faixa maior. B/1.000 inclui todo o journal B, inclusive alternativas, baseline, correções de julgamento e verificações repetidas. Não se deram avaliações gratuitas a B.

As fases e cache estão no `summary.json`. B/1.000: 2 chamadas para contexto/estágios, 185 para hipóteses, 20 para julgamentos públicos finais e 45 para verificações independentes. A repetição da baseline em lotes diferentes é custo real, não cache hit. Não há medições independentes de estabilidade do agente; replay confirma reprodução da sequência fixa, não que outra execução de IA descobrirá o mesmo caminho.

## Achados que o resultado sustenta

- O agente encontrou uma **combinação** que não foi retornada pelo automático nos tetos testados. Isso não prova que os IDs estejam ausentes do gerador: A pode não ter chegado aos movimentos e C pode ter gasto o saldo em complementos antes de aceitar a primeira melhoria.
- O caso mediu uma vantagem de seletividade/qualidade de B. Não mediu superioridade universal, latência fim a fim nem vantagem econômica.
- C com planejamento alinhado ao teto atingiu 5/5 metas em 1.000 chamadas, sem substituir peças principais, com 15 campos alterados e margem crítica mínima de 21,53%; depende de críticos e não fornece cinco garantias de abate. É uma alternativa relevante a B, com menos contexto MCP, ainda sem prova de custo total de IA. Indicar IDs promissores e manter esforço 10.000/100.000 não produziu a mesma melhoria.
- A armadura sem os encantos foi pior. A descrição isolada de um item, o maior DPS isolado e o descarte por ganho individual não são suficientes para resolver dependências.
- O agente também errou consultas/hipóteses: chave `crit` em vez de `cri`, busca conjunta sem resultados e expectativa sobre Drosera. As respostas e o motor permitiram corrigir o rumo. Não se atribuiu o custo desses erros ao automático.

## Reproduzir e verificar

Os artefatos existentes nunca são sobrescritos pelo runner. Para repetir do zero, use uma cópia de trabalho e mova explicitamente os diretórios de resultados preservando `requests`, `fixture.json` e os originais para comparação. Não apague automaticamente a evidência.

```powershell
$env:AI_POC='1'
$env:POC_BATCH='B01-discover' # nome do JSON em requests, sem extensão
npx vitest run mcp/src/engine/ai-guided-poc.bench.spec.ts --pool=threads --maxWorkers=1
# Execute os lotes na ordem descrita no journal; seleções já congeladas constituem replay, não novo agente.
node tools/ai-guided-poc-report.mjs
npx vitest run mcp/src/engine/ai-guided-poc.spec.ts mcp/src/engine/optimize-ready-audit.spec.ts --pool=threads --maxWorkers=2
```

Verificações registradas: testes de artefatos reproduzem patch/link pelo motor, mantêm as restrições e conferem teto/ledger; regressões de crítico/precisão e conflitos; typecheck e oito fluxos Playwright. O defeito inicial do runner em uma asserção de linha de verificação foi corrigido; as leituras já gravadas permaneceram intactas e foram conferidas por testes posteriores.

O benchmark amplo Legacy/Unified do pedido anterior foi interrompido pela mudança de direção, preservando as linhas concluídas em `benchmarks/optimize-ready-audit`. Ele não foi usado como prova de READY, nem como resultado desta POC.


## Evidências de validação desta POC

- Rodada de regressões: 116 casos em 8 arquivos passaram (`ai-poc-final-tests.log`), cobrindo orçamento, cache, conflitos, viabilidade, serviço e contrato MCP.
- Após a advertência de scaling: 24 casos em 3 arquivos passaram (`ai-poc-metadata-tests.log`), incluindo a reprodução dos artefatos; há sobreposição entre rodadas, não são 140 testes únicos.
- Typecheck completo passou (`ai-poc-final-types.log`); Playwright passou 8/8 (`ai-poc-ui.log`). O teste de teto da UI foi alinhado ao mínimo conservador com rotações cobradas; o teste de orçamento insuficiente continua confirmando que nenhum worker inicia sem saldo.
- Golden e suíte completa não foram repetidos nesta POC; as execuções históricas não são apresentadas como prova do estado final. Não há recomendação de release.
