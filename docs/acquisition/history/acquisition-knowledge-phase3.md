# Conhecimento de obtenção — Fase 3

Entrega local de 05/11/2026. Avaliação de obtenção por configuração, exposta primeiro no MCP. Nenhuma fórmula, ranking, algoritmo ou catálogo mecânico foi alterado; nenhum dado da Fase 1/2 foi reescrito (`data/acquisition/` não mudou).

## 1. Contratos reutilizados

| Contrato | Papel na Fase 3 |
| --- | --- |
| `AcquisitionKnowledge` / `AcquisitionRoute` (`acquisition/contracts.ts`) | Única fonte de rotas, passos, chances, falhas, período, revisão, confiança e fontes. Nenhum campo novo. |
| `effectiveRoutes` | Mesma política de revisões/histórico; agora calculado uma vez por catálogo (índice). |
| `queryAcquisition` / `routeAvailability` | Mesma semântica (`active`, `expired`, `future`, `unknown`); passou a usar índice por item/encanto/monstro. |
| `assessAcquisition` (Fase 1) | Mantido, com os mesmos `status`. Acrescentou `evidence` por diagnóstico. |
| `validateBuild` | Dono da **validade mecânica**; a operação apenas a compõe. |
| `resolveBuild`, `normalizeShare`, `registerJsonTool` | Entrada de build, links curtos e envelope MCP, como nas outras ferramentas. |

## 2. Serviço compartilhado

`src/app/build-analysis/acquisition/assess.ts` — cada diagnóstico (item, carta, encanto, refino, grau, opções aleatórias) ganha `evidence` com facetas independentes:

| Faceta | Valores | Observação |
| --- | --- | --- |
| mecanicamente válido | `valid` / `invalid` | Nível da build (`validateBuild`), nunca misturado com obtenção. `assessAcquisition` sozinho continua `not_assessed`. |
| `documentedRoute` | boolean | Há ao menos uma rota efetiva para o alvo. |
| `availability` | `confirmed` · `unconfirmed` · `expired_only` · `future_only` · `none` | `confirmed` = rota LATAM revisada, período conhecido e ativo. Genérica/não revisada é `unconfirmed`. |
| `chance` | `certain` · `known` · `unknown` · `none` | Vem só dos números da rota. Número ausente é `unknown`, nunca 0% nem 100%. |
| `exceptional` | boolean | Alguma rota é limitada por período (evento, troca). |
| `insufficient` | boolean | Sem rota, ou a melhor rota ainda tem `unknowns`/chance desconhecida. |
| `confidence`, `review`, `sources` | da melhor rota considerada | Registra a fonte e a confiança de cada conclusão. |

`status` (Fase 1) foi preservado. Só mudou o texto de `reason` quando há rota documentada sem disponibilidade LATAM confirmada (“não é prova de obtenção nem de impossibilidade”). Ausência de rota continua `insufficient_information`; não há score de dificuldade, custo, preço ou tempo.

`src/app/build-analysis/operations/acquisition.ts` — `createAcquisitionOperations(...).assess({ itemId | monsterId | builds, asOf, owned, requireGuaranteed })`, o ponto único para MCP, navegador e Optimize:

- `itemId` / `monsterId`: rotas diretas (até 5, ordenadas por disponibilidade; `omittedRoutes` conta o resto).
- `builds` (1–10): valida, resolve, avalia. Retorna por build `mechanical`, `summary`, `documented[]` (componentes com rota, cada um com `routes` por ID), `undocumented[]` (IDs de itens/encantos sem rota), `undocumentedByAspect`, `effects`. A tabela de rotas, `sources` (url, versão, data, licença) e `names` ficam uma vez no topo.

## 3. Casos reais (dados atuais, `asOf 2026-11-05`)

Cobertos por `acquisition/assess-cases.spec.ts` e `mcp/src/tools/acquisition.spec.ts`.

| Caso | Resultado |
| --- | --- |
| Diadema Temporal + Insígnia 5 (29075) | `temporal-evolution-5-v1`, Lágrimas e `temporal-exchange-14-v1`; `availability: confirmed`, `chance: known`, `exceptional: true`, status `difficult`. Não lista a rota do nível 10. |
| Diadema Temporal + Insígnia 10 (29080) | `temporal-evolution-10-v1` ativa (chances de 50% a 1% por etapa, com regressão de nível) e `temporal-exchange-17-v1` **expirada** (fim 12/10/2026). Remover a rota ativa deixa `expired_only` / `expired_routes`, sem concluir impossibilidade. Posse declarada → `owned`. |
| Arma Vis Invernal + encanto de Grau 5 (500054 + 311453) | Custos em materiais documentados; `chance: unknown`, `insufficient: true`; sucesso e falha permanecem `null`. Drops da arma vêm de relações genéricas não revisadas → `unconfirmed`. |
| Sombrio de Pedras Preciosas (24675–24678) | Rotas do combinador (`truegem-combine-v2`: seis materiais, quatro resultados de peso desconhecido) e da caixa por peça; efeitos de conjunto só quando a soma de refinos atinge o mínimo, com `engineCoverage`. |
| Item com drop de chance conhecida | Material 25864: fração exata da fonte (ex.: 1/10), `availability: unknown`, `review: unreviewed`, confiança baixa. Para um equipamento equipado (rota sintética no teste): `chance: known`, `availability: unconfirmed`, status `insufficient_information`. |
| Item sem rota (560026) | `documentedRoute: false`, `availability: none`, `chance: none`, `insufficient: true`, “ausência de regra não demonstra impossibilidade”. |

Uma taxa `null` continua `null` (teste dedicado); nenhuma probabilidade é criada.

## 4. Integração MCP

Ferramenta `get_acquisition` (`mcp/src/tools/acquisition.ts`, carregada de forma preguiçosa):

```jsonc
get_acquisition({ itemId: 25864 })                      // como obter um item/encanto/material
get_acquisition({ monsterId: 20572 })                   // drops documentados do monstro
get_acquisition({ builds: [{ share }, { share }] })     // finalistas do optimize_build, sem refazer a busca
```

Entrada: `itemId` **ou** `monsterId` **ou** `builds` (1–10), mais `asOf`. A operação também aceita `owned` e `requireGuaranteed`, mas eles não são anunciados no MCP para manter a lista de ferramentas pequena.

Controle de tokens: no máximo 5 rotas por componente; componentes sem rota viram contagem + lista de IDs (refino, grau e opções aleatórias nunca ganham uma linha por peça); fontes, nomes e rotas aparecem uma única vez por resposta. Medido: consulta de item ≈ 4 KB; uma build ≈ 4–7,5 KB com rotas; amostra de 30 builds ≈ 1,8 KB/build.

Mudanças de superfície: o orçamento de `tool surface` em `tools.spec.ts` subiu de 49 000 para 50 500 caracteres (a nova ferramenta consome ≈ 1,5 mil; a lista soma 50 437, quase sem folga — a próxima ferramenta exigirá enxugar descrições). O catálogo (≈ 0,5 MB minificado) fica em um chunk separado do Worker (`acquisition-*.js`), avaliado só quando `get_acquisition` é chamada. `guide` ganhou o passo 6.

## 5. Custo para o Optimize

Nada mudou no Optimize. Os finalistas são avaliados depois, a partir dos `share`.

| Medida | Valor |
| --- | --- |
| Parse + validação Zod do catálogo (314 rotas) | ≈ 10 ms, uma vez |
| `effectiveRoutes` (antes repetido a cada consulta, O(n²)) | ≈ 1,7 ms, uma vez por catálogo (cache em `WeakMap`) |
| Primeira avaliação (monta índices) | ≈ 4 ms |
| Avaliação de uma build com índice | ≈ 0,17 ms |
| `get_acquisition` com 10 builds, via MCP (inclui validação e resolução) | 20–90 ms |
| `optimize_build` na mesma amostra (`maxSolves` 2000) | 16–22 s |

Custo da análise ≲ 0,5% do da busca; fica fora do loop de avaliação. Não há cache por build: o índice por item já elimina o varrimento, e uma avaliação custa menos que o resolver da build. Ponto para a próxima fase se a UI chamar com frequência: cachear por (revisão do catálogo, `asOf`, hash dos IDs equipados).

## 6. Cobertura das recomendações

O bench da fase 3 (removido em 2026-11-06; o substituto é `mcp/src/engine/acquisition-phase4.bench.spec.ts`) gerava `.tmp/acquisition-phase3/audit.json`. Amostra fixa: as 3 builds de `bench-builds.json` (Inquisidor 236) com a build original e o `optimize_build` (`maxSolves` 2000, alvo 20994), mais as 8 melhores peças de `scan_slot` em `weapon`, `headUpper` e `armor` na b1 — **30 configurações**, `asOf 2026-11-05`.

| Pergunta | Configurações (de 30) |
| --- | --- |
| Ao menos um componente com rota verificada e completa | 21 |
| Requisitos incompletos (com rota) | 0 |
| Probabilidades desconhecidas (com rota) | 0 |
| Condição excepcional (evento/período) | 3 |
| Algum componente sem rota documentada | 30 |
| Nada documentado | 9 |
| Build mecanicamente inválida (variações de `scan_slot`) | 6 |

Por componente (soma sobre as 30 configurações):

| Aspecto | Componentes | Sem rota |
| --- | --- | --- |
| item/carta | 882 | 861 (97,6%) |
| encanto | 375 | 354 (94,4%) |
| refino | 354 | 354 (100%) |
| grau | 66 | 66 (100%) |
| opções aleatórias | 285 | 285 (100%) |

Leitura honesta: o número alto de “rota verificada” vem de um Diadema Temporal (18979/19481) e sua Insígnia, presentes nas três builds-base; a base cobre as famílias importadas, não o catálogo. As categorias “incompletas” e “probabilidade desconhecida” ficaram zeradas porque a amostra não usa Vis Invernais nem Sombrios de Pedras Preciosas (esses casos estão nos testes de §3).

## 7. Lacunas prioritárias para a Fase 4

Em ordem do que mais compromete as recomendações:

1. **Refino e grau**: 100% sem rota. Falta um registro genérico do procedimento de refino/grau LATAM (NPC, materiais, chances, quebra) a partir de `refine_db`/`enchantgrade` com revisão regional — afeta toda configuração.
2. **Encantamentos aleatórios do pool** (`M-ATQ` 310099, `S-ATQ` 29534, `S-HPMax` 29531, `B-VIT` 310084, `P-Bárbaro` 310106, `P-Geral` 310120): aparecem em quase todas as recomendações. Sem NPC/sorteio documentado; é um encantamento por NPC, não um item. Precisa de regra por posição/pool.
3. **Cartas** mais recomendadas (`Carta Guarda Quebrada` 300076, `Carta Magia Potente` 300116, `Carta Cavaleira Khalitzburg` 4609, `Carta Bungisngis` 4582): rota de drop com chance por monstro. O importador RagnarokDB já sabe fazer; só falta ampliar `import-scope.v1.json` para cartas realmente recomendadas.
4. **Equipamentos recorrentes** (`Escudo Ilusión B` 460014, `Selo de Loki` 410233, `Cordão do Inquisidor` 490181, `Turbina Automatron B` 490025): origem (drop/instância/loja) e, para o Selo de Loki, opções aleatórias.
5. **Sombrios** (`Manopla Sombria do Infinito` 24386, `Brinco/Colar Sombrio Penetrante` 24661/24662, `Malha/Greva Sombria do Mastodonte` 24679/24680): outras famílias de sombrio, além da de Pedras Preciosas.
6. **Visuais** (`[Visual] …`, `Algoz II`, `Sicário II`): irrelevantes para dano; o Optimize os recomenda por bônus. Considerar tratá-los como `exceptional` por catálogo, não como falta de dados.
7. **Opções aleatórias** (285 componentes): rota de sorteio ainda não modelada; hoje sempre `insufficient_information`.

Recomendação: começar por (1) e (2), que atingem todas as configurações; (3) e (4) são o menor esforço (mesmo pipeline). A amostra é de uma classe; repetir o audit com outras classes antes de fixar a ordem.

## Verificação

```powershell
node node_modules/vitest/vitest.mjs run src/app/build-analysis/acquisition mcp/src/tools/acquisition.spec.ts mcp/src/tools/tools.spec.ts mcp/src/engine/shared-operations.spec.ts tools/import-ragnarokdb-acquisition.spec.ts
node node_modules/typescript/bin/tsc -p worker/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.backend-tests.json --noEmit
node tools/build-worker.mjs
# bench removido em 2026-11-06: usar mcp/src/engine/acquisition-phase4.bench.spec.ts
```

Resultado em 05/11/2026: 102 testes em 8 arquivos passaram; os dois `tsc` e o build do Worker terminaram sem erro; o audit gerou 30 configurações. Não houve commit, push, deploy nem alteração na VPS.
