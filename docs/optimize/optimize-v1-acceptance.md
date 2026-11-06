# Optimize V1: aceite de produção

Data: 2026-11-06. Motor `0.1.221-beta`. Estado medido: árvore de trabalho com as alterações locais ainda não commitadas (Acquisition, paridade da UI, este aceite).

## Veredito: NOT READY (revisado em 2026-11-06)

O veredito anterior (READY WITH LIMITATIONS) foi retirado. A revisão achou três bloqueios que os testes não cobriam. As seções abaixo guardam as medições, com as correções indicadas em "Correções a este documento".

1. **O servidor da VPS não sobe com a árvore de trabalho atual.** `dist/vps/server.mjs` morre ao iniciar com `TypeError: Class2 is not a constructor`. O `import()` dinâmico de `operations/acquisition` (`mcp/src/tools/acquisition.ts:19`, `mcp/src/tools/optimize.ts:239`) faz o esbuild, sem `splitting`, tornar o zod preguiçoso, e o SDK do MCP o usa antes da inicialização. A mesma compilação a partir de HEAD sobe. Compilar com `splitting: true` também sobe, mas `tools/package-vps.mjs` empacota só `server.mjs`. Nenhum teste inicia esse bundle.
2. **A busca recomenda encantamentos que o validador diz não existirem no LATAM.** As 5 builds do benchmark saem com `ITEM_NOT_AVAILABLE_LATAM` (S. Vitality 5Lv, S. Magic Power 5Lv, Star Cluster of Strength 5Lv), e as entradas não tinham esses itens. Cartas filtram `latam` em `engine/complements.ts`; encantamentos não (`socketOptions` e `complementChoices`). `evaluate_variants` no modo padrão (`strict`) recusa a build que o próprio `optimize_build` devolveu. O código é o de HEAD, então isso já está em produção (0.1.221-beta).
3. **Memória e concorrência na VPS.** Medido com o bundle de HEAD (Windows, Node 22, não Linux e Node 24): 1 `optimize_build` com padrões atinge 602 MB de RSS e 3 simultâneos, 801 MB, contra `max_memory_restart: '512M'` em processo único. `/healthz` piora para 3,1 s com 1 busca e 8,6 s com 3. `/mcp` é público e não há limite de buscas simultâneas. Leitura da VPS em 2026-11-06: 2 núcleos, 917 MB de RAM, 197 MB livres, 475 MB de swap em uso. O `laro-calc` estava com 157 MB, e os 20 reinícios do PM2 coincidem com implantações, sem nenhum por limite de memória nem OOM. O risco continua, mas ainda não apareceu em produção. A decisão sobre limitar a uma busca por vez depende da medição descrita em [plan-backlog.md](plan-backlog.md).

## Critérios (de `optimize-roadmap-status.md`, fase 2.5) e evidências

| Critério | Evidência | Estado |
|---|---|---|
| UI e MCP aplicam o mesmo contrato de meta e restrição | A UI valida com `goalSpecSchema` e `constraintSpecSchema` no worker (`build-analysis.worker.ts`) e chama o mesmo `optimizeBuild`. `e2e/optimize-goals.spec.ts` (4 testes) prova que `goal`, `constraints`, até 5 alvos com peso e `lock` chegam ao núcleo como no MCP | OK |
| Múltiplos alvos julgados individualmente | `Feasibility` mostra veredito por alvo; `feasibility.spec.ts` | OK |
| Nenhum finalista viola restrição rígida | `judgeFeasibility` e `goal-search.spec.ts` (suíte completa verde) | OK |
| Buscas antigas de DPS mantêm resultado compatível | Sem `goal`/`constraints` o pedido não leva nenhum dos dois (e2e); modo `legacy` segue o padrão | OK, ver piso `weak` |
| Resultado explica por que aceitou/rejeitou | `feasibility {baseline, final, search}` exibido na UI | OK |
| `feasible@budget` do fixture `jor_ab02` | Bench existente (`docs/optimize/optimize-goal-search.md`); não reexecutado nesta etapa | Sem regressão no código (busca inalterada desde 6d3dd604, 1 linha) |
| Travas por campo / `lock` | UI envia `lock` = slots desmarcados; testado em e2e | OK |

## Paridade da UI (prioridade 1)

Já havia na UI: objetivo, alvo, slots, candidatos. Faltavam e foram adicionados em "Metas, alvos e restrições (avançado)": alvos adicionais com peso (até 5, duplicata recusada), `maxHitsToKill`, margem, crítico e HIT mínimos, política de MVP, refino máximo, efeitos proibidos, consumíveis (máximo, permitidos, proibidos), buffs externos, redistribuição de atributos, e o veredito de viabilidade. Textos em PT-BR, ES e EN. Nenhuma regra foi duplicada: a UI só monta o pedido e o núcleo julga.

Verificado: `tsc` limpo nos 4 projetos, `e2e/build-improvements.spec.ts`, `e2e/optimize-goals.spec.ts` e `e2e/acquisition-panel.spec.ts` (18 de 18), e o orçamento de inicialização.

## Benchmark final (prioridade 2)

Alvo 20994, objetivo DPS, refino +12, grau A, procs desligados. `maxEngineCalls` não existe como parâmetro; "mesmo custo total" foi medido assim: a variante A (padrão legado, 20000 buscas) define o total de chamadas reais ao calculador (`engineCallCount`); a variante B (`budgetMode: 'unified'`) recebe esse total como teto. Mesmo prazo (600 s, nunca atingido). Dados brutos em `docs/benchmarks/optimize-acceptance/*.json`. Meister e Magus partem de uma build vestida por uma busca curta.

| Build | A legado: DPS final (Δ%) | Chamadas | B unificado, mesmo custo: DPS final (Δ%) | Chamadas |
|---|---|---|---|---|
| Inquisidor (fixture fogueira) | 1.521.759 (+856%) | 21.176 | 1.101.986 (+592%) | 19.297 |
| b1 | 5.299.221 (+820%) | 21.003 | 3.846.810 (+567%) | 19.256 |
| weak | 5.288.316 (+4772%) | 20.747 | 4.066.545 (+3646%) | 18.276 |
| Meister (Axe Stomp) | 866.811 (+18,1%) | 19.401 | 784.281 (+6,9%) | 16.032 |
| Magus equipado (Crimson Rock) | 170.831 (+0,94%) | 14.259 | 170.831 (+0,94%) | 10.756 |

Leitura: a 20000 buscas o legado vence o unificado em todas as builds com ganho a achar, por 9% a 28%. O padrão enviado (legado) está certo e o unificado não deve virar padrão. Magus não muda entre variantes: +0,94% é o teto que a busca encontra para essa build (ver backlog).

**Padrões da UI** (10000 buscas, procs em média, prazo de 60 s do formulário), medidos com o prazo aplicado: Inquisidor 937.805 em 68 s, Meister 800.570 em 66 s, b1 2.798.526 em 68 s, weak 3.338.113 em 66 s, Magus 170.831 em 44 s. O prazo é respeitado (±8 s de passo final) e o aviso de resultado parcial aparece (`stopped`). Uma primeira rodada mostrou 233 s para o Inquisidor porque o bench aplicava 600 s; era erro do bench, corrigido em `optimize-acceptance.bench.spec.ts`. Consequência real: no padrão da UI a busca para por tempo com cerca de 4000 das 10000 buscas e entrega bem menos que o legado de 20000 (Inquisidor 937k contra 1,52M; as bases também diferem por causa de procs em média). O jogador compensa aumentando o tempo no formulário.

**Ratchet de qualidade** (`optimize-quality.bench.spec.ts`, pisos de `optimize-golden.json`, tolerância 2%): b1 e b2 passam. `weak` mede 5.210.892 contra piso 5.403.123 (−3,6%; o limite é 5.295.060). Corrigi o bench, que falhava em todas as builds com `ITEM_NOT_AVAILABLE_LATAM` porque o `evaluate_variants` era estrito (agora `validationMode: 'hypothetical'`, como em `tools.spec.ts`). O código de busca não mudou desde o piso (6d3dd604 → HEAD: uma linha em `optimize.ts`), mas o piso foi gravado com o motor `0.1.210-beta` e o merge do upstream 0.1.203–0.1.221 mudou dados e cálculo (a própria build `weak` carrega encantamentos que o motor atual marca como ainda inexistentes no LATAM). A queda é atribuída ao motor, não à busca, mas **não foi provada** (faltou rodar o motor antigo). Não baixei o piso: regravá-lo é decisão do dono.

## Limites do Cloudflare (prioridade 3)

`wrangler deploy --dry-run` (wrangler 4.145.0, data de compatibilidade 2026-08-23): 5546 KiB descompactado em 12 módulos, 727 KiB com gzip. O limite atual do Worker é 64 MiB descompactado: uso de cerca de 8%.

Limites consultados na documentação do Cloudflare (via busca, não via conta): Free = 10 ms de CPU por requisição; Pago = 30 s por padrão, configurável até 5 min; memória de 128 MB por isolate; inicialização de até 1 s. `wrangler.jsonc` declara `limits.cpu_ms: 30000`, valor que **só vale em plano Pago**. Um `optimize_build` de até 45 s de relógio (`maxSearchMs` padrão) consome CPU na mesma ordem, então:

- No plano Free, `optimize_build` e `scan_slot` não cabem (10 ms), e a implantação com `cpu_ms: 30000` pode ser recusada.
- No plano Pago, 30 s de CPU cobrem o padrão de 45 s de relógio apenas se a CPU ficar abaixo de 30 s; o limite estoura antes do prazo em buscas longas.
- **O plano da conta não foi verificado** (não consultei a conta). Não houve implantação real. Isso é a condição de implantação do veredito.
- A memória não foi medida no runtime do Worker; no Node o pico do bench não foi capturado. Risco aberto, backlog.

## Cinco testes que falharam sob carga (prioridade 4)

Reproduzido: a suíte inteira (`src/app mcp/src/tools tools`, 416 workers em paralelo) falhou nos mesmos 5 testes, e os 2 arquivos passam isolados.

Causa: três testes de `optimize.spec.ts` e `tools.spec.ts` (o do prazo de 1 ms, o `levelCheck` de nova peça e o `scan_slot` de Soqueira) levam 2,5 a 3,4 s sozinhos e esbarravam no timeout padrão de 5 s do Vitest quando a máquina estava saturada. Os outros dois ("rolls an item from its rAthena pool" e "rolls the Manto Branco Físico") eram efeito colateral: o teste do prazo de 1 ms alterava `config.limits.maxSearchMs = 1` e só restaurava no `finally`; ao estourar o timeout, o teste seguinte rodava com 1 ms de busca e achava 0 opções.

Correção sem aumento global: os três testes lentos receberam o timeout explícito de 60 s que os testes vizinhos de mesmo custo já tinham (`}, 60_000);`). Resultado: 416 de 416 arquivos e 9545 de 9545 testes passam com a suíte inteira em paralelo. `mcp/src/engine` + `mcp/src/data`: 247 passam, 26 pulados (benchs opt-in).

## Smoke tests (prioridade 5)

| Fluxo | Prova | Resultado |
|---|---|---|
| UI: busca, comparação, cancelamento em celular, slots, estágios, atributos | `e2e/build-improvements.spec.ts` | 5 de 5 |
| UI: meta, alvos, restrições, trava, veredito | `e2e/optimize-goals.spec.ts` | 4 de 4 |
| Aquisição sob demanda (painel recolhido, detalhe carrega só ao abrir, falha não toca o resultado) | `e2e/acquisition-panel.spec.ts` | 9 de 9 |
| MCP: ferramentas, schema, `get_acquisition`, `optimize_build` com `acquisition` e falha | `mcp/src/tools/*.spec.ts` | verde |
| Resultado parcial por prazo (`stopped`, nunca pior que a base) | `optimize.spec.ts` "wall-clock allowance"; UI-defaults acima | verde |
| Checkpoints | `optimize-budget.spec.ts`: o relatório de orçamento registra `checkpoints` e eles são reproduzíveis entre tetos. São dados do relatório, não um mecanismo de retomada | verde |
| Worker de produção e orçamento de inicialização | `tools/build-worker.mjs`; `bw.mjs`: 2380 KB inicial (aviso em 2300 KB, erro em 2470 KB) | dentro do erro, acima do aviso |

Não houve smoke contra a VPS nem contra o Worker real.

## Correções a este documento

- **Produção é a VPS, não o Cloudflare** (`docs/deploy-vps.md`). A seção do Cloudflare continua válida como leitura de limites, mas não é condição de implantação. `/healthz` público respondeu `0.1.221-beta`.
- **Piso `weak`:** a frase de que a build carrega encantamentos inexistentes estava errada, a busca os introduz. A atribuição da queda ao motor não tem prova, e o recheck também não explica (`near` e `all` dão 5.210.892). A causa segue aberta. Os pisos só devem ser regravados depois do filtro de encantamentos, que muda os resultados.
- **`validationMode: 'hypothetical'` no ratchet foi revertido:** escondia o bloqueio 2. O ratchet volta a falhar em b1 e weak até o filtro existir.
- **Meister e Magus:** partem de builds vestidas pela própria busca, então o resultado é circular. O +0,94% do Magus não mede qualidade. Falta uma build mágica real.
- **"Resultado explica por que cada candidato foi aceito/rejeitado":** o critério não está provado. A UI mostra o veredito de viabilidade da build, não motivos por candidato.
- **`feasible@budget`:** não foi reexecutado. O estado da tabela não é evidência de aprovação.
- **Build de produção:** a verificação cobriu web e Worker, não o bundle da VPS.

## Backlog (melhorias futuras, fora do aceite)

1. Decidir se regrava o piso de `weak` (e eleva o de b1, hoje 18% abaixo do medido) com o motor atual, ou se rastreia a queda de 3,6% com o motor 0.1.210.
2. Padrão da UI: a busca de 60 s para com 38% a 59% das buscas. Avaliar um prazo padrão maior ou um aviso mais explícito de que a qualidade está limitada pelo tempo.
3. Magus ficou em +0,94% nas três variantes: investigar se é o teto real ou falta de candidatos para classe mágica.
4. Sensibilidade à fatia de tempo por campo e polimento por DPS (já descritos em `optimize-roadmap-status.md`).
5. Alvos extras custam cerca de 1,5× fora do contador `solves`.
6. Medir CPU e memória reais de `optimize_build` no Worker (ou migrar a busca longa para fora dele).
7. Fixture `jor_ab02` cobre uma classe e um conjunto de monstros; ampliar.
8. Tornar o teste do prazo de 1 ms robusto a timeout (restaurar a configuração em `afterEach`).
9. Enxugar a lista de ferramentas do MCP: o teto do teste subiu de 49.000 para 50.500 caracteres com `get_acquisition` e o parâmetro `acquisition`.
