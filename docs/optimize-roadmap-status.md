# Optimize e MCP — inventário do roadmap

Inspeção em 02/11/2026 do código e das alterações locais existentes. Presença de
código não significa aceite validado. Roadmap de referência: `roadmap_optimize_mcp_laro.md`.

## Arquitetura real

- Motor: `src/app/core`, `jobs` e `build-analysis/engine/solve.ts`.
- Dados e índices: `build-analysis/data`.
- Operações comuns à UI e MCP: `build-analysis/operations`.
- Transporte MCP: `mcp/src/tools`; execução da UI: worker de build-analysis.
- Parceiros de conjuntos: `engine/item-partners.ts`, índice bidirecional de
  referências de scripts, sem representação completa das condições AND/OR.
- Busca atual: `operations/optimize.ts`, hill climbing com pares, complementos,
  procs e passada final de soquetes. Cache de métricas local à busca.
- Atributos: `operations/optimize-stats.ts`; metadados: `engine/skill-info.ts`.

## Estado por fase

| Fase | Evidência existente | Pendências para aceite |
| --- | --- | --- |
| 0 | Fixtures resolvidas, golden de qualidade, correções locais de links, patches, contadores, crítico e MVP estrito | Validar regressões; baseline identificado e preservado; versões de dados/regras nos benchmarks; cobertura física/mágica e conjuntos 3+ |
| 1 | Avaliação comum a operações de equipamentos, cache por busca, métricas de cobertura | Unificar também atributos; chave canônica versionada; orçamento rígido incluindo finalização; deduplicação batch; retorno parcial uniforme |
| 2 | Referências de parceiros nos dois sentidos | Condições AND/OR, rastreabilidade, movimentos completos, cobertura regional e testes 3+ |
| 3 | Seleção por chaves relevantes, habilidade, pools e parceiros | Diversidade explícita e evidências por candidato; A/B isolado do gerador |
| 4 | Sem Beam Search identificado | Implementar apenas se benchmark justificar |
| 5 | Trocas de pares de conjuntos e pares explícitos | Conjuntos completos, controle de vizinhanças/estagnação; provar ganho além dos pares atuais |
| 6 | Perfis sustentado/burst, múltiplos alvos, HP mínimo e UI de limites | Agregação normalizada, alternância gear/stats opt-in, Pareto; farm requer objetivo minimizado corretamente |
| 7 | MCP fino, get_skill, crítico, variantes e Optimize compartilhado | find_synergies sobre condições reais; variantes multi-alvo; medir custo de resposta |
| 8 | Benchmark opt-in com três builds e pisos de qualidade | A/B em orçamentos iguais, ótimo exaustivo de subconjuntos, versões, memória, estabilidade e rollout |
| 9 | Pesquisa opcional | Não iniciar sem evidência das fases anteriores |

## Decisões e ordem de execução

1. Validar as correções P0 existentes antes de alterar a busca.
2. Adicionar `mvpPolicy` ao core e schema MCP: política explícita prevalece;
   ausência mantém `strictMvp` e `excludeMvpCards` compatíveis. `none` reutiliza
   a remoção estrita existente; `exclude-new` preserva MVP já equipada.
3. Resolver orçamento: hoje a passada final usa tempo próprio e cálculos fora
   do teto principal. Não afirmar Quality@budget comparável enquanto isso persistir.
4. Registrar baseline e versões de motor/dados/regras, com inputs fixos.
5. Compartilhar avaliador/cache por job, preservando isolamento do motor mutável.
6. Extrair condições reconhecidas, marcando condições não suportadas como desconhecidas;
   testar movimentos completos na busca atual antes de exigir Beam e VNS.
7. Decidir algoritmos adicionais por qualidade/custo medidos; não mudar o padrão antes do gate.

Não congelar bugs de legalidade no baseline: comparar estratégias com o mesmo
motor e as mesmas restrições. Não criar cache global nem duplicar fórmulas no MCP.
Não houve commit, push ou publicação nesta execução.

## Verificação executada

Suíte direcionada: **5 arquivos, 25 testes passando** (120,51 s):
`short-link-tools`, `crit-exposure`, `scan-slot-patches`, `mvp-cards` e
`optimize-polish`. Inclui política explícita `none` com remoção de MVP já
equipada, compatibilidade do modo estrito legado, patches de scan reproduzíveis,
links curtos, crítico e contadores não negativos. Isso não valida teto rígido
de avaliações, benchmark A/B, typecheck ou o aceite completo da Fase 0.
