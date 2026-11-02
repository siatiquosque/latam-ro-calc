# Optimize e MCP — inventário do roadmap

Inspeção em 02/11/2026 do código e das alterações locais existentes. Presença de
código não significa aceite validado. Roadmap de referência: `roadmap_optimize_mcp_laro.md`.

**Premissa confirmada pelo usuário:** informações dos itens e resultados do motor
são a referência correta. Item sem script pode simplesmente não ter bônus.
A auditoria é da estrutura, da extração de informações e da busca, não uma revisão
do conteúdo do catálogo nem das fórmulas. Uma lacuna do índice não é erro do item.

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
| 1 | Avaliador/cache no engine, usados por equipamentos, variantes e atributos; chave canônica com versão/contexto; deduplicação batch e retorno parcial de atributos | Cache no scan; orçamento rígido de equipamentos incluindo finalização; retorno parcial uniforme |
| 2 | Referências de parceiros; novo índice de cláusulas com AND/OR e origem | Interpretar demais condições, produzir movimentos legais completos e integrar à busca |
| 3 | Seleção por chaves relevantes, habilidade, pools e parceiros | Diversidade explícita e evidências por candidato; A/B isolado do gerador |
| 4 | Sem Beam Search identificado | Implementar apenas se benchmark justificar |
| 5 | Trocas de pares de conjuntos e pares explícitos | Conjuntos completos, controle de vizinhanças/estagnação; provar ganho além dos pares atuais |
| 6 | Perfis sustentado/burst, múltiplos alvos, HP mínimo e UI de limites | Agregação normalizada, alternância gear/stats opt-in, Pareto; farm requer objetivo minimizado corretamente |
| 7 | MCP fino, get_skill, crítico, Optimize compartilhado; novos find_synergies e variantes multi-alvo | Completar extração de condições e patches de sinergias; medir custo de consultoria ponta a ponta |
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

## Estrutura necessária para os algoritmos

Não foi identificada necessidade de migrar o banco, alterar `item.json`, trocar
catálogos ou reimplementar o motor. O formato atual já representa as condições
que o motor executa. As mudanças necessárias são nas estruturas que a busca usa:

1. **Condições derivadas, sem perder informação.** O índice antigo de parceiros
   achata AND/OR em relações entre pares. O novo `engine/synergies.ts` preserva
   os grupos de equipamentos e a expressão original; refino, grau, stats e outros
   predicados ainda precisam de interpretação para gerar movimentos automáticos.
   Referências por nome devem seguir o casamento exato do motor, não busca textual.
2. **Movimentos completos e legais.** Traduzir os requisitos em patches depende
   de escolher posições de cartas/enchants, lados dos acessórios, liberar slots
   incompatíveis e respeitar travas/limites. A validação existente é reutilizável.
   O MCP inicial entrega evidências, sem fingir que já gera esses movimentos.
3. **Avaliador e orçamento de job.** Já existe avaliação reutilizável; falta
   padronizar seu uso entre buscas e incluir finalização no teto real. Cache,
   contadores de avaliações e chamadas internas do motor têm semânticas distintas.
4. **Estado da busca.** O Optimize atual mantém um incumbente. Beam requer vários
   estados, deduplicação, desempate determinístico e histórico. VNS requer política
   de vizinhanças sobre os movimentos anteriores; não é necessário outro motor.
5. **Objetivo explícito.** Optimize multi-alvo ainda usa agregação de números
   brutos; a agregação normalizada do roadmap está pendente. `hitsToKill` é para
   minimizar, enquanto a busca atual foi escrita para maximizar. A nova ordenação
   de variantes corrige esse caso apenas na comparação de hipóteses.
6. **Prova justa.** Nomear/preservar a estratégia atual e comparar com o mesmo
   motor, catálogo, restrições e teto total. Separar mudanças de seleção de
   candidatos das mudanças no algoritmo, com fixtures físicas, mágicas e conjuntos.

O índice de parceiros antigo permanece na busca para não alterar a baseline antes
do benchmark. O novo índice estruturado está no core, não em uma cópia exclusiva do
MCP; a migração do gerador deve consumir esse índice e aposentar a extração antiga
quando a equivalência e os ganhos forem demonstrados.

## MCP adiantado independentemente do Optimize

- `evaluate_variants`: validação estrita por padrão, inclusive erros herdados e
  orçamento de pontos. O usuário aprovou `validationMode: hypothetical` explícito
  para simulações com erros herdados/excesso de pontos, rotuladas como hipóteses.
- Até cinco alvos por lote, com números reproduzíveis separados por alvo. A ordenação
  usa o primeiro alvo, declarado em `rankingTarget`, sem inventar agregação. Pisos e
  tetos valem em todos; menos `hitsToKill` é melhor.
- Cache por lote reutiliza o avaliador existente. Não há concorrência entre solves
  sobre o estado do motor. Contadores distinguem avaliações novas e reutilizadas.
- `find_synergies`: consulta paginada de cláusulas reais, referências inversas,
  AND/OR, origem e expressão restante. Trata o catálogo como autoritativo e expõe
  limites da extração. Com `includePatches` e build, posiciona os requisitos de
  equipamento/soquetes, valida a build e verifica a expressão completa no motor.
  Não indexa itens personalizados nem gera upgrades/buffs/stats para satisfazer
  condições adicionais. Não ranqueia dano nem garante patch mínimo.
- `get_build_context` foi pulado: os dados já podem ser compostos pelas ferramentas
  atuais; não há necessidade demonstrada de adicionar outra resposta sobreposta.

**Limitação corrigida nesta sequência:** `optimize_stats` usava o maior entre os
pontos permitidos e os pontos já gastos, inflando o orçamento de entradas ilegais.
Agora recusa a base inválida, usa os pontos reais do nível e valida o resultado.
O problema estava na operação, não nos dados. Fixtures de redistribuição e de
cenários foram alinhadas a entradas legais; hipóteses ilegais continuam explícitas
nos testes de `evaluate_variants`.

### Prova desta etapa

- Suíte de integração: 10 arquivos, 141 casos; 140 passaram. A única falha foi
  o teto de tamanho de `tools/list` após adicionar o contrato novo.
- As descrições foram compactadas sem aumentar o teto de 48.000 caracteres.
  A reexecução direcionada dos três testes de superfície passou, incluindo
  tamanho, catálogo completo de ferramentas e schema compacto.
- Typecheck `tsconfig.backend-tests.json` passou; `git diff --check` passou.
- Os testes novos verificam rejeição estrita, hipótese explicitamente rotulada,
  reparação de base ilegal, reprodução por alvo, deduplicação e filtros em todos
  os alvos, ordenação de farm e evidências de conjuntos de duas/cinco peças,
  OR, referências não resolvidas, paginação e paridade core/MCP.
- No lote de teste com duas variantes idênticas e uma distinta contra dois alvos,
  foram quatro avaliações novas e quatro reutilizações. Isso prova deduplicação
  nesse cenário, não melhoria da qualidade ou do tempo do Optimize.
- Não foi executado benchmark A/B dos algoritmos nem validação completa de release.

## Sequência seguinte: MCP e início do Optimize

O MCP ganhou geração opcional e limitada de patches de conjuntos. Ela reutiliza
`swapPatch`, `socketOptions` e `validateBuild`; a ativação vem de `evaluateItemRule`
do próprio motor, sem reimplementar as condições. Novas peças entram +0/sem grau,
sem upgrades implícitos. A busca preserva travas e aplica exclusões/política MVP.
Sem encontrar patch, declara o limite, sem afirmar que a combinação é impossível.
O fluxo de consultoria foi exercitado sem chamar Optimize: conjunto real de cartas,
patch legal, avaliação, ganho de HP e reprodução pelo link. Também foi testado um
conjunto real de quatro equipamentos e uma condição adicional que impede ativação.

Após validar o MCP, o avaliador foi movido para `engine/evaluate.ts`; o caminho
antigo reexporta as funções para compatibilidade. A chave preserva lados de slots
e ordem de arrays, ordena apenas chaves de objetos e inclui versão do app, identidade
do dataset imutável, alvo completo, política/metadados de proc e build resolvida.
Resultados do cache não podem ser alterados por mutação dos diagnósticos devolvidos.

A busca de atributos passou a usar esse cache, contar avaliações novas no teto,
respeitar os limites da classe e minimizar `hitsToKill`. Retorna estado parcial
legal e reproduzível com motivo de parada; recusa saída que não atende a `require`.
São mudanças compartilhadas por UI e MCP. A busca de equipamentos continua com
a estratégia atual e seu orçamento legado: unificar a passada final de soquetes
e preservar uma baseline explicitamente versionada são os próximos gates, antes
de mexer no gerador e comparar Beam/VNS.

Provas executadas nesta sequência:

- MCP antes do início do Optimize: 141 testes passando em 9 arquivos.
- Base do Optimize e regressões, incluindo os valores de referência do motor:
  102 testes passando em 6 arquivos.
- Typechecks de backend e React passaram. Os três testes finais de superfície
  passaram (incluindo o teto de 48.000 caracteres), assim como as checagens de
  imports/fronteiras de 958 arquivos TypeScript e `git diff --check`.
- O teste adicional de `require` impossível passou na reexecução dos contratos:
  a busca não devolve sugestão que viole o piso pedido.
- Nenhum dado de item ou fórmula foi alterado. Não houve commit/push/publicação.

## MCP preparado para publicação — 0.1.208-beta

As pendências independentes do Optimize foram tratadas:

- Índice inclui cláusulas condicionais mesmo sem conjuntos, com `conditions`,
  cobertura e expressão original preservada; usa o parser visual existente.
- Personalizados e anexos são resolvidos por requisição, inclusive de links,
  sem contaminar o catálogo compartilhado. A validação segue a mesma origem de
  anexos do motor; campos oficiais antigos não duplicam cartas de um personalizado.
- `customAttachments` expõe o estado já usado pelo aplicativo como override e
  patch por slot. As regras existentes de anexos validam essas entradas.
- `allowChanges` autoriza propostas adicionais de refino/grau/stats/skills;
  caps, travas e pontos são respeitados e o motor confirma a ativação. Não há
  mudanças extras implícitas nem redistribuição automática para financiar um limiar.
- `get_skill.dependencies` registra leituras condicionais dos callbacks existentes
  e de habilidades ativas/aprendidas, com restauração das leituras locais da classe.
- Consultoria conduzida pelo agente via MCP HTTP local, sem Optimize, com comparação
  em dois alvos e reprodução por link: ver [validação](mcp-consultation-validation.md).
- Release local: 9.279 testes passaram, 3 ignorados; typechecks e source checks
  passaram. Versão, Novidades em três idiomas e artefato web/Node preparados.

A extração não pretende resolver estaticamente toda condição possível: sintaxe
residual permanece disponível e a ativação concreta é decidida pelo motor. Isso
é um limite declarado da consulta, não uma suspeita sobre as informações dos itens.
As mudanças do Optimize que ainda faltam continuam sendo orçamento de equipamentos,
baseline versionada e, depois, gerador/algoritmos comparados por benchmark.
