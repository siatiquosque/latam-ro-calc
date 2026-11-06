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

## Triagem do reteste após publicação

- **find_synergies:** publicado em 0.1.208-beta; o `tools/list` público anuncia
  28 ferramentas. A conexão da sessão conserva o catálogo antigo e precisa ser
  recarregada. É uma pendência de atualização do cliente, não de registro no servidor.
- **Crítico:** `canCrit` é capacidade. Foi reproduzida chance efetiva zero com
  pouco crítico e positiva com SOR 120, sem qualquer mudança na matemática.
  Correção local aditiva: `damage.skill.effectiveCritRate` explicita a porcentagem
  efetiva; `critRate` continua alias compatível. A ficha `stats.crit` não é a mesma
  grandeza. Testes comparam o retorno aos termos de `explain_damage`.
- **Tokens:** URL completa e token codificado da build funcionaram no servidor
  público; identificador curto isolado não é esse token. Contrato esclarecido e
  regressões adicionadas em calculate, validate_build e parse_share_link. Não foi
  necessário mudar a resolução; um caso diferente exige a chamada/token que falhou.
- **Variantes multi-alvo:** já publicadas (`targets`, `perTarget`, `rankingTarget`).
- **get_build_context:** não implementado, opcional; as ferramentas atuais compõem
  o contexto. Reavaliar apenas com um ganho concreto de chamadas/payload.
- **Referências regionais:** manter no backlog a proveniência LATAM da árvore e da
  classificação MVP. Os avisos atuais são preservados; não substituir por inferências
  nem tratar essa origem como evidência de erro das informações do motor/catálogo.

As alterações deste reteste são locais; não constituem outra publicação nem commit.

---

## Revisão proposta em 03/11/2026 — metas de farm e restrições reais

> **Escopo desta seção:** análise da interface pública do MCP `0.1.210-beta` e
> regressões observadas na consultoria da build `5hTy6pd`; **não é nova inspeção
> do código do repositório, benchmark A/B nem aceite das fases**. O histórico de
> 02/11 acima foi preservado. Implementações abaixo são propostas até prova local.

### Reteste de superfície: atualizar o estado, não reescrever o histórico

- O MCP reconectado expôs **29 ferramentas**, incluindo `find_synergies` e
  `get_build_context`. O último foi executado com sucesso, inclusive na
  rejeição de builds inválidas. Assim, a nota histórica "não implementado" da
  triagem de `0.1.208-beta` não descreve a superfície atual.
- `evaluate_variants` aceitou múltiplos alvos, patches e rejeitou uma carta MVP
  proibida; os testes de consultoria foram pontuais e não provam a completude
  da busca automática.
- **Bug de superfície reproduzido:** `optimize_slot` no slot de carta do topo
  sugeriu Carta Celacanto Violento (ID 4529), mas a mesma build foi rejeitada
  por `validate_build` como `MVP_CARD_EXCLUDED`. O contrato de `optimize_slot`
  exposto não tem opção de excluir cartas MVP. Corrigir a política/validação
  para qualquer ranking gerado por essa ferramenta e criar teste de regressão.
- **Cobertura parcial:** `optimize_slot` testa até 40 candidatos por chamada.
  A seleção automática deixou a Carta Ultra Limacina (ID 300377) de fora do
  lote. Uma busca separada e paginada encontrou 107 IDs de cartas elegíveis à
  categoria `headCard`; em três lotes a Ultra Limacina foi encontrada.
  Distinguir `testedCandidates`, `eligibleCandidates` e `complete` e nunca
  apresentar um resultado parcial como melhor global do slot.
- **Validação de ocupação:** a combinação de equipamento de meio+baixo com
  equipamento de meio foi aceita em um teste anterior; criar fixture de
  conflito entre slots compartilhados antes de afirmar que foi corrigido.

### Ajuste no roadmap de referência: Fase 2.5 — Goal & Constraint Engine (P0)

Inserir **entre as fases 2 e 3** do `roadmap_optimize_mcp_laro.md`, sem descartar
Greedy, Candidate Generator, Beam Search nem VNS:

- `GoalSpec`: objetivo (`dps`, `farm`, `burst`, etc.), habilidade, alvos,
  `maxHitsToKill`, critico efetivo minimo, precisão mínima e margem opcional.
- `ConstraintSpec`: política MVP, limites de grau/refino, slots/cartas/
  encantamentos travados, IDs indisponíveis, consumíveis permitidos/proibidos,
  limite de consumíveis, buffs externos e permissão para reset de atributos.
- **Separar habilidade aprendida de efeito ativo**: proibir aplicar Oleum
  Sanctum durante o farm **não** significa remover o nível de habilidade
  exigido como pré-requisito de Mão Explosiva. Modelar efeitos/estados
  proibidos separadamente de habilidades aprendidas.
- `FeasibilityEvaluator` no core compartilhado, consumindo métricas existentes:
  classificar `invalid`, `infeasible`, `feasible` e `unknown` sem alterar a
  matemática do motor. Resultados desconhecidos não contam como cumpridos.
- Ranking de finalistas **lexicográfico**: legalidade → cumprir todos os alvos
  → minimizar mudanças/refinos/buffs → margem e desempenho. Não usar média
  ponderada que esconda o pior monstro; reportar gargalo e violações por alvo.
- Durante a exploração, permitir estados temporariamente `infeasible` no Beam
  quando puderem completar sinergias; não confundir isso com sugerir finais
  inviáveis.
- Reutilizar avaliações canônicas: metas e preferências de ranking não devem
  invalidar resultados do motor se não modificarem os inputs do cálculo.
- Manter **preços, liquidez e custo em zenys fora de escopo**: "menos trocas" não
  equivale a "menor custo financeiro". Disponibilidade de itens informada pelo
  jogador é restrição da busca, não estimativa de mercado.

**Aceite da fase 2.5:** UI e MCP aplicam o mesmo contrato de objetivo/restrição;
nenhum finalista viola uma hard constraint; múltiplos alvos são julgados
individualmente; buscas antigas de DPS mantêm resultados compatíveis; o
resultado explica por que cada candidato foi aceito/rejeitado.

### Integração nas fases atuais

- **Fase 0 (P0):** acrescentar regressões de MVP em `optimize_slot`, conflito de
  slots, preservação de encantamentos, cobertura parcial e distinção entre
  `hitsToKill` determinístico e chance real de abate.
- **Fase 1 (P0):** concluir orçamento rígido **incluindo passada final de
  soquetes**, antes de qualquer comparação séria de `Quality@budget`; separar
  avaliação matemática de pontuação do objetivo.
- **Fase 2:** preservar cláusulas AND/OR; gerar movimentos legais mínimos e
  explicitar condições não suportadas, sem considerar catálogo incompleto
  automaticamente incorreto.
- **Fase 3:** aplicar `ConstraintSpec` antes de avaliar candidatos; preservar
  diversidade de famílias, cartas do topo, botas sem grau e combinações de
  acessórios; contabilizar universo elegível, testado e truncamentos.
- **Fases 4–5:** selecionar estados por progresso para a meta, diversidade e
  potencial de sinergia; manter o incumbent final viável e preservar a comparação
  A/B contra Greedy com mesmo orçamento.
- **Fase 6:** mover o perfil de farm para `GoalSpec`; refinar atributos apenas
  quando opt-in; comparar fronteiras por viabilidade, HP, mudanças e dano.
- **Fase 7:** `optimize_build` segue wrapper do mesmo Optimize da UI; `scan_slot`,
  `optimize_slot` e `evaluate_variants` devem aplicar políticas consistentes;
  não criar outro algoritmo no MCP.
- **Fase 8:** incluir métricas `feasible@budget`, tempo até primeira build viável,
  `worstTarget`, violações de critérios por alvo, completude e confiabilidade.

### Confiabilidade: não prometer 2 hits garantidos com dano máximo

`hitsToKill` calculado a partir do golpe crítico/máximo pode indicar que
**dois críticos** matam, mas não necessariamente que **quaisquer dois ataques**
matem. A primeira entrega de farm pode exigir mínimos explícitos de
`effectiveCritRate` e `accuracy` e reportar a margem de dano; isso é um filtro
conservador, não uma probabilidade calculada.

Somente uma fase posterior, após validar distribuição de dano, crítico,
acerto, procs e estados condicionais, poderá expor
`killProbabilityWithinHits` com semântica e testes próprios. Não inferir
`99%` a partir de `hitsToKill: 2`.

### Fixture obrigatória: Inquisidor em `jor_ab02`

- **Build de entrada:** `5hTy6pd`; salvar também **snapshot resolvido**,
  atributos, encantamentos e versões do motor/dados para reprodutibilidade.
- **Alvos:** `21544`, `21545`, `21542`, `21601`, `21539`.
- **Meta:** até 2 golpes em **cada** alvo; crítico efetivo e acerto mínimos
  declarados no cenário; identificar sempre o pior monstro.
- **Hard constraints:** nenhuma carta MVP, grau máximo C, Abrasivo (ID 14536)
  proibido, **efeito ativo** de Oleum proibido, Insígnia do Talento 5 travada,
  Cordão do Inquisidor sem novos encantamentos, Casaco Pirata (ID 480174)
  excluído e respeito a classe/nível/pontos.
- **Preferências:** preservar equipamentos, permitir Bota Física do Éden II
  (ID 470069), poucas fontes de buff e consumíveis, evitar refino caro sem
  proibir todo upgrade; não estimar zenys.
- **Referências conhecidas:** builds verificadas manualmente em
  `L7P7qcS`, `GIPObNf` e `0TdaENM`. São *best-known fixtures* do cenário,
  não ótimos globais nem saída garantida do algoritmo. Confirmar snapshots
  e condições dos links antes de congelar métricas de regressão.
- **Aceite:** encontrar ao menos uma solução compatível com as restrições em
  um orçamento definido; reportar `feasible@budget`, qualidade, cobertura,
  número de alterações e diferença em relação ao best-known. Comparar com
  GreedyV1 e testar caso em que candidato isolado perde, mas conjunto vence.

### Próxima sequência executável (sem reescrever o motor)

1. Corrigir filtragem/validação e cobertura de candidatos em `optimize_slot`;
   completar o orçamento único e o baseline do Optimize.
2. Introduzir tipos/validação de `GoalSpec`, `ConstraintSpec` e julgamento de
   viabilidade, mantendo as operações atuais compatíveis por adaptação.
3. Criar o fixture `jor_ab02` resolvido e executar Greedy atual com orçamento
   controlado, registrando alvos e violações.
4. Integrar o novo julgamento ao Candidate Generator e à busca atual; **medir**
   ganho antes de desenvolver Beam Search/VNS por obrigação arquitetural.
5. Só promover novos algoritmos por benchmark de qualidade, custo,
   reprodutibilidade e estabilidade.

**Não realizado nesta revisão:** alterações no repositório, publicação,
benchmark, commit ou push. Esta seção registra decisões propostas e evidência
externa do MCP, não certificação de uma implementação concluída.

## Blocos de execução: objetivo, gate e exclusões

Um bloco por item da sequência acima. Cada bloco só começa quando o gate do
anterior passa; "fora" lista o que não deve entrar no bloco, mesmo que pareça próximo.

### Bloco 1 — Correções de `optimize_slot` e orçamento único

- **Objetivo:** `optimize_slot` aplica a política MVP e a validação de ocupação;
  distingue `testedCandidates`, `eligibleCandidates` e `complete`; a passada final
  de soquetes entra no teto de avaliações; baseline versionada e identificada.
- **Gate:** regressões de MVP, conflito de slots compartilhados, preservação de
  encantamentos e cobertura parcial passam; nenhuma sugestão de `optimize_slot`
  é rejeitada por `validate_build`; o teto de avaliações é medido incluindo a
  finalização; versões de motor/dados/regras registradas nos benchmarks.
- **Fora:** novo algoritmo, `GoalSpec`/`ConstraintSpec`, mudança no gerador de
  candidatos, alteração de dados de itens ou fórmulas, qualquer comparação A/B.

### Bloco 2 — `GoalSpec`, `ConstraintSpec` e julgamento de viabilidade

- **Objetivo:** tipos e validação do contrato de objetivo/restrição no core
  compartilhado; `FeasibilityEvaluator` classifica `invalid`, `infeasible`,
  `feasible` e `unknown`; habilidade aprendida separada de efeito ativo proibido;
  operações atuais adaptadas sem mudar o comportamento padrão.
- **Gate:** UI e MCP usam o mesmo contrato; buscas antigas de DPS dão resultados
  compatíveis com a baseline do bloco 1; `unknown` nunca conta como cumprido;
  múltiplos alvos são julgados individualmente, com pior alvo e violações por alvo.
- **Fora:** preço, liquidez e custo em zenys; `killProbabilityWithinHits` (sem
  inferir probabilidade a partir de `hitsToKill`); mudanças na matemática do motor;
  Beam e VNS.

### Bloco 3 — Fixture `jor_ab02` e Greedy com orçamento controlado

- **Objetivo:** fixture do Inquisidor com build `5hTy6pd`, snapshot resolvido,
  atributos, encantamentos, versões, alvos e hard constraints; execução do Greedy
  atual com orçamento fixo registrando alvos atendidos e violações.
- **Gate:** snapshots e condições dos links `L7P7qcS`, `GIPObNf` e `0TdaENM`
  confirmados antes de congelar métricas; execução reproduzível; `feasible@budget`,
  cobertura, número de alterações e diferença para o best-known reportados.
- **Fora:** tratar as builds de referência como ótimo global ou saída garantida;
  congelar bugs de legalidade na baseline; otimizar o algoritmo.

### Bloco 4 — Julgamento integrado ao Candidate Generator e à busca atual

- **Objetivo:** aplicar `ConstraintSpec` antes de avaliar candidatos; preservar
  diversidade (famílias, cartas do topo, botas sem grau, acessórios); contabilizar
  universo elegível, testado e truncamentos; consumir o índice de `engine/synergies.ts`
  e gerar movimentos legais mínimos.
- **Gate:** nenhum finalista viola hard constraint; ganho **medido** contra o
  Greedy do bloco 3 com o mesmo motor, catálogo, restrições e orçamento; seleção
  de candidatos isolada do algoritmo no A/B; caso em que o candidato isolado perde,
  mas o conjunto vence.
- **Fora:** Beam e VNS por obrigação arquitetural; aposentar a extração antiga de
  parceiros antes de equivalência e ganhos demonstrados; cache global; duplicar
  fórmulas no MCP.

### Bloco 5 — Promoção de novos algoritmos por benchmark

- **Objetivo:** decidir Beam Search, VNS e demais estratégias por qualidade, custo,
  reprodutibilidade e estabilidade medidos, com estados temporariamente `infeasible`
  só na exploração.
- **Gate:** A/B em orçamentos iguais contra Greedy, `feasible@budget`, tempo até a
  primeira build viável, `worstTarget`, completude, memória e estabilidade; só então
  mudar o padrão e planejar o rollout.
- **Fora:** mudar o padrão sem o gate; pesquisa opcional da Fase 9 sem evidência
  das fases anteriores; sugerir finais inviáveis.

### Bloco 1 — estado (03/11/2026)

Implementado localmente, sem commit: `excludeMvpCards` em `optimize_slot` (candidatos e
complementos); `testedCandidates`/`eligibleCandidates`/`complete`; erro `SLOT_OCCUPIED` em
`validate_build` e candidatos que criam conflito de slots de cabeça descartados em
`optimize_slot`, `scan_slot` e `optimize_build`; testes do teto de `budgetMode: 'unified'`
(30–800), de preservação de cartas/encantamentos em `swapPatch` e versão/estratégia/modo da
baseline no golden e na saída do benchmark. `budgetMode: 'legacy'` continua o padrão: o gate
de Quality@budget comparável vale apenas com `unified` explícito. Benchmark A/B não foi executado.

### Bloco 2 — estado (03/11/2026)

Implementado localmente, sem commit: contrato `GoalSpec`/`ConstraintSpec` (zod) em
`src/app/build-analysis/engine/goal-spec.ts`; `judgeFeasibility` (`FeasibilityEvaluator`) em
`engine/feasibility.ts`, com `invalid | infeasible | unknown | feasible`, veredito e violações por
alvo e `worstTarget`; `unknown` (métrica ilegível, margem sem HP) nunca conta como cumprido.
`forbiddenEffects` olha só o efeito ativo (`skillBuffMap`/`activeSkillMap`), nunca o nível aprendido
(passivas). `optimize_build` e `evaluate_variants` aceitam `goal`/`constraints` (UI e MCP chamam as
mesmas operações; o MCP anuncia um schema compacto e o tópico `meta-e-restricoes` do `guide` traz o
contrato). `adaptSpecs` mapeia o spec sobre `lock`, `exclude`, `mvpPolicy`, `maxGrade`, `refine`,
`require` e `target(s)`; flag explícita da chamada prevalece, e sem spec nada muda (golden e testes de
orçamento passam). Em `optimize_build` o julgamento (`feasibility.baseline`/`final`) é posterior à
busca; a busca ainda não filtra candidatos por `consumables`, `forbiddenEffects`, buffs e atributos
(bloco 4). Não há controle novo na UI: ela usa o mesmo tipo `OptimizeBuildArgs`.
O schema de `goal`/`constraints` no MCP é compacto, sem descrição por campo, para caber no teto de
49 000 caracteres da lista de ferramentas (o contrato está no tópico `meta-e-restricoes` do `guide`).
Benchmark A/B não foi executado.

Margem, dano e abate garantido (Bloco 2): `margin` tem padrão 0 e, acima de 0, exige
`minDano × maxHitsToKill ≥ HP × (1 + margin)`; a 0 vale o `hitsToKill` do motor (`ceil(HP / skillMinDamage)`).
`skillMinDamage` é o mínimo do caminho crítico (ATK máximo + bônus de crítico) em habilidades que critam;
sem crítico o motor expõe `skillMinDamageNoCri`, que só é comparável em habilidade de um golpe numa classe
sem ajuste próprio por golpes (lido como a métrica interna `minNoCri`; fora disso, indefinido). Leituras
internas novas (fora do enum público): `minNoCri`, `canCri`, `hitChance` (`skillAccuracy`). O relatório
`feasibility.kill` separa `damageFeasible` (a meta de dano, sem exigir precisão nem crítico),
`constraintsMet` (limites declarados: `minCritRate`, `minAccuracy`, `require`, restrições duras; são
obrigatórios e não provam abate) e `reliability` (`guaranteed` | `conditional` | `unknown`, ausente se o
dano não cumpre a meta). `conditional`: o abate depende de crítico < 100% ou o acerto é < 100%;
`unknown`: falta dado (p.ex. dano sem crítico), nunca `guaranteed`. Nenhuma probabilidade é inventada;
cada alvo é julgado e o pior decide. O `status` continua refletindo dano e restrições, não a certeza.

### A/B dos blocos 1–2 e decisão sobre o bloco 3 (03/11/2026)

Medição única (sem repetição), Betelgeuse 20994, dps, +12/A, procs off, builds `b1`, `b2`, `weak` e o
Inquisidor da fixture. Greedy `unified` a 400/2 000/8 000/20 000 cálculos, `legacy` a 20 000, reinício
do `unified` a partir do próprio resultado e busca larga (`candidatesPerSlot: 40`, `rounds: 4`).
Critério fixado antes de ver os números: o bloco 3 só entra se a busca terminar sozinha e um reinício ou
busca mais larga do mesmo Greedy achar mais de 2% acima.

| build | u-400 | u-2000 | u-8000 | u-20000 | legacy-20000 | reinício | larga |
|---|---|---|---|---|---|---|---|
| b1 | 0,81 M | 1,15 M | 3,17 M | 3,85 M | 5,30 M | 3,85 M | 2,91 M (parou) |
| b2 | 0,52 M | 0,82 M | 1,25 M | 1,56 M | 1,56 M | 1,56 M | 1,64 M |
| weak | 0,37 M | 1,43 M | 3,08 M | 4,28 M | 5,29 M | 5,63 M | 4,25 M |
| inq | 0,22 M | 0,34 M | 0,91 M | 1,10 M | 1,52 M | 1,10 M | 0,82 M |

Leitura: o dps cresce com o orçamento até 8 000–20 000 em todos; o `unified` chega a 20 000 gastando
17–19,7 mil (reserva de 15% para a passada final), então ainda é limitado por orçamento, e o `legacy`
(com folga própria para soquetes, portanto não é igual orçamento) fica 0–38% acima. Reinício ganha
apenas em `weak` (+31%, com o dobro do gasto total, sem igualdade de orçamento); busca larga ganha só em
`b2` (+4,9%) e perde em três das quatro (conjunto de candidatos maior, resultado pior: dependência de
caminho). Critério não atendido de forma consistente: **bloco 3 não será implementado**. A dependência de
caminho e o ótimo local de `weak` ficam como pergunta para os blocos 4–5, a medir com orçamento igual.

### Benchmark do orçamento (03/11/2026)

Investigação sem novo algoritmo: relatório e tabelas em [optimize-budget-benchmark.md](optimize-budget-benchmark.md), artefatos
em `docs/benchmarks/optimize-budget/`. Implementado localmente, sem commit: ledger por fase (`instrument`, interno, fora do MCP),
`socketReserve` experimental (padrão 0,15 inalterado), contador de chamadas ao motor (`engineCallCount`), harness
`optimize-budget.bench.spec.ts` (`BUDGET_BENCH=1`) e `tools/optimize-budget-report.mjs`.

Resultado: classe **A (orçamento)**. Com o mesmo teto de busca do Legacy (20.000) o Unified reproduz o Legacy exatamente em
b1, b2, weak e inq; o Legacy 20.000 custa 20,1–21,7 mil avaliações (2,6–3,3 mil na passada fora do teto) e o Unified 20.000 gasta
18,1–19,7 mil com teto de busca 17.000. Nenhuma reserva fixa domina (8.000: reservas maiores ajudam; 20.000: ≤ 10% é igual ou melhor).
Reinício (2×10.000) não ganha; busca larga ganha só em b2 (+4,9%, com outro universo de candidatos). O resultado não é monotônico no
teto (22.000 pior que 20.000 em b1 e inq). Recomendação: sem Beam/VNS e sem bloco 3 por ora; `legacy` continua o padrão. A hipótese de
reservar por necessidade absoluta da passada fica como proposta a testar com mais builds. Substitui a leitura "reinício/larga" do A/B de 03/11 como evidência
de dependência de caminho: ali o orçamento não era igual.

## Eficiência das avaliações (03/11/2026)

Detalhes e tabelas em [optimize-budget-efficiency.md](optimize-budget-efficiency.md). Padrões inalterados.

- O teto `maxSolves` também planeja o esforço por slot; só o esforço muda o caminho. Teto de busca 17000 com esforço planejado de 20000 fica a −1,3% (b1) e −1,5% (inq) do Legacy com 8% menos avaliações; o resultado de um teto menor é um prefixo exato da execução maior. A resposta ao esforço não é monotônica (E=24000 pior que 20000), então desacoplar dá reprodutibilidade, não qualidade, e piora tetos pequenos.
- Passada de soquetes: a 2ª passada custa 49% da fase e não rendeu nada nas quatro builds; o ganho está em poucos campos de encantamento baratos. `socketRecheck: 'touched'` (interno) manteve o DPS idêntico em 6 de 6 execuções e poupou de 171 a 1488 avaliações. Candidato a padrão, aguardando aprovação e validação em outras classes.
- Candidatos: só 8% dos candidatos de soquete são intercambiáveis; deduplicar não compensa. Parada por platô é insegura (a curva é em degraus tardios).
- Sem evidência para Beam, VNS ou mudança no Candidate Generator.

## Otimização direcionada do Greedy (03/11/2026)

Detalhes em [optimize-targeted-greedy.md](optimize-targeted-greedy.md). Padrões inalterados.

- `socketRecheck: 'touched'` **não é seguro**: −0,72% num caso adversarial (b1 com cartas sorteadas; `headMiddleCard` melhora depois que o elmo superior muda). Fica experimental.
- `socketRecheck: 'near'` (peças não tocadas re-verificadas só contra os 5 melhores candidatos da 1ª passada): DPS idêntico em 13 de 13 casos, de 151 a 1407 avaliações a menos (0,8% a 11%); b1 93,7 s para 89,2 s, build física 47,8 s para 43,0 s. Pronto para promoção, aguardando aprovação.
- Causa da trajetória não monotônica: só `fullEffort` (profundidade da busca de soquetes dos finalistas). `quickEffort` satura em 8 e `discoveryCap` nunca limita. DPS é monotônico e saturante na profundidade fixa (b1: 3,47 / 3,85 / 5,02 / 5,30 / 5,30 M para 100 / 150 / 200 / 300 / 500). Estabilizar custa 6% a 17% mais avaliações: sem economia.
- Proposta, não implementada: parada por estagnação dentro de `searchComplements` (de 300 para 500 de profundidade, +2,9 mil avaliações sem ganho).

## Validação final e promoção do `socketRecheck: near` (03/11/2026)

Detalhes na seção 9 de [optimize-targeted-greedy.md](optimize-targeted-greedy.md). **Investigação de `socketRecheck` encerrada.**

- Comparação a partir do mesmo estado (valor e avaliações únicas idênticos antes da 2ª passada): build mágica (Magus), arma com 2 cartas e 3 encantamentos (b1, busca completa) e 12 estados adversariais (b1, b2, Windhawk, Magus). DPS final do `near` igual ao do `all` em todos. b1 completa: 2ª passada de 1602 para 936 avaliações (5,5 s para 3,1 s), total 21654 para 20988.
- Vencedores da 2ª passada completa: 9 campos; os 4 em peças não tocadas (as únicas que o `near` restringe) eram o 1º da 1ª passada; o pior ranque, 5, foi numa peça tocada (re-verificada por inteiro). O caso exato pedido (vencedor em 6º lugar ou pior) não pôde ser construído: a busca dirigida por avaliação direta não achou nenhuma troca isolada que mude o melhor candidato de outro campo.
- **`near` é o padrão** (`all` preservado como `socketRecheck: 'all'`; `touched` segue experimental e não promovido). Sem mudança em `effortBudget`, `fullEffort`, Candidate Generator ou contratos do MCP. Testes: suíte `mcp/src` com 363 passando; o teste de regressão adversarial de `socketRecheck` rodado sem limite de tempo (a passada de soquetes dá fatia de tempo por campo).

### Pendência futura: sensibilidade da busca de complementos aos limites de tempo por campo

A passada final de soquetes e a `searchComplements` dão uma fatia de tempo por campo (`maxSearchMs`). Sob carga (processos em paralelo ou máquina lenta) a fatia corta a busca antes do fim e a contagem de avaliações muda (3587 contra 3509 no teste adversarial); o DPS pode mudar junto. Hoje só isso é conhecido: a contagem é determinística apenas com `maxSearchMs` elevado, e o teste de regressão o eleva. **Não investigado**: se a qualidade (não só a contagem) cai de forma relevante com a fatia curta, e se a fatia deve ser medida em avaliações em vez de milissegundos para dar reprodutibilidade. Registrado como pendência; fora do escopo da retomada atual.

## Retomada: Goal & Constraint Engine (04/11/2026) — inventário, lacunas e menor incremento

**Aviso:** `roadmap_optimize_mcp_laro.md` não existe no repositório nem no disco desta máquina; esta seção parte só deste documento (Fase 2.5 e Blocos 1–5). Nada aqui foi implementado. Smoke da UI após a promoção do `near`: `e2e/build-improvements.spec.ts` passou (5 de 5); a UI não passa `socketRecheck`, então roda o padrão `near`.

**Já existe (blocos 1–2, local, sem commit):** `GoalSpec`/`ConstraintSpec` (`engine/goal-spec.ts`), `judgeFeasibility` com `invalid | infeasible | unknown | feasible`, violações e pior alvo por alvo (`engine/feasibility.ts`, `feasibility.spec.ts`), `adaptSpecs` mapeando o spec sobre `lock`/`exclude`/`mvpPolicy`/`maxGrade`/`refine`/`require`/alvos, relatório `feasibility.baseline/final` em `optimize_build` e julgamento por variante em `evaluate_variants`.

**Lacunas (lidas no código; ainda não reproduzidas por teste):**

1. **Sem gradiente para a meta.** No Greedy, `meets(metrics, rules)` é um filtro: movimento que não cumpre as regras é descartado (`optimize.ts`, ~1122, 1153, 1223). Se a build inicial não cumpre a meta e nenhum movimento isolado a cumpre, nenhum é aceito, mesmo que reduza a distância. O ranking é por DPS, não lexicográfico (legalidade → cumprir → margem → desempenho) como a Fase 2.5 exige.
2. **Multi-alvo na busca.** A busca filtra por `meets` nas métricas do alvo principal; com mais alvos, `dps`/`max`/`min` viram média ponderada e `hitsToKill`/`critRate`/`hit` não são agregados por alvo (`evaluate.ts`, ~125). O julgamento por alvo só acontece depois da busca (`judgeSearch`). Isso contradiz "não usar média que esconda o pior monstro".
3. **Restrições fora do espaço de busca.** `forbiddenEffects`, `consumables`, `allowExternalBuffs`, `allowStatReset` só são julgados no final. Como o Greedy muda apenas equipamento e soquetes, não os viola sozinho; só importam se a build base já viola ou quando outras buscas (stats, buffs) entrarem. Não é lacuna do Greedy hoje.
4. **Candidate Generator sem o contrato.** Universo elegível, testado e truncado ainda não é contabilizado; `exclude`/`lock`/MVP chegam por `adaptSpecs`, mas não há veredito por candidato ("aceito/rejeitado porque").
5. **Fixture `jor_ab02` (bloco 3) não existe.** Os links `5hTy6pd`, `L7P7qcS`, `GIPObNf`, `0TdaENM` não estão no repositório; o mais próximo é `inquisitor-optimization.json`. Também não há métrica `feasible@budget`.

**Menor incremento proposto (não implementado):** um predicado `rulesHold(build)` no Greedy, usado nos mesmos três pontos de `meets`, que (a) julga as regras em cada alvo, não só no principal, e (b) quando a build corrente não cumpre, aceita o movimento que mais reduz a distância à meta (o `gap` que `judgeTarget` já calcula) antes de comparar DPS, voltando ao DPS assim que cumprir. Sem spec, `rules` vazio e o comportamento atual intacto (golden e testes de orçamento). Primeiro passo: dois testes que falham hoje, sem mudar código: (1) build inicial infeasível sem movimento único viável, com meta `maxHitsToKill`; (2) dois alvos onde o principal cumpre e o secundário não. Só depois implementar. Custo: avaliações extras por alvo só para contendores que passam no alvo principal.

Fora desta etapa, como pedido: Beam, VNS, novas heurísticas de orçamento, fórmulas e catálogos.

### Jor_ab02 e `feasible@budget` (04/11/2026)

Fixture local dos quatro links (`mcp/src/engine/__tests__/fixtures/jor-ab02.json`), início `gear-only` derivado e benchmark em
`docs/optimize-goal-search.md`. Resultado: a meta (2 golpes com 10% de folga nos 5 monstros) é cumprida a partir do `gear-only` com 300–2000
avaliações e a partir do original com 800; os dois casos inviáveis (300) são orçamento insuficiente (distância 0,031). Alvos extras custam
~1,5× fora de `solves` (medido, não refatorado). Refino de soquetes por DPS: cego confirmado em 4/26 campos, sem perda fim a fim; ajuste testado
e revertido por custo.

### Fechamento de confiabilidade do Goal & Constraint Engine (04/11/2026)

Detalhes e tabelas em `docs/optimize-goal-search.md` ("Contagem corrigida e variante restrita"). O parágrafo acima descreve a primeira
rodada (contagem anterior) e foi mantido.

- **Auditoria da fixture:** o benchmark original não aplicava MVP, Abrasivo/Casaco Pirata, Oleum nem travas. Ficou como benchmark matemático
  (`math`) e ganhou a variante `scenario` com as regras do estudo e auditoria por resposta. `scenario`: auditoria vazia em todas as
  respostas; `math`: 2–5 violações a partir de 800 (esperado). Viabilidade idêntica nas duas: as regras não custaram viabilidade nesta meta.
  `damageFeasible` e confiabilidade do abate seguem separados (`conditional` na maioria; `guaranteed` só em 2000 gear-only).
- **Contagem multi-alvo:** as leituras dos outros alvos agora gastam o orçamento; sem saldo, o candidato fica sem julgamento
  (`skippedForBudget`) e não vence; baseline e verificações finais são obrigatórias e reportadas à parte (`afterSearch`, `finalChecks`).
  Custo real caiu de ~1,5–1,7× para ~1,01–1,09× do orçamento. Sem `GoalSpec` o caminho não mudou.
- **Generalização:** Magus (Crimson Rock) e Windhawk (Crescive Bolt) cumprem meta de farm com 300; meta inviável por travas explícitas
  termina com `stoppedBy: 'completed'`; com 3 monstros o pior decide (300 falha só nele, 600 cumpre os três).
- **Verificação:** `tsc -p tsconfig.backend-tests.json` limpo; suítes de goal (25 testes) e `tools.spec.ts` (52) verdes isoladas; `mcp/src`
  inteira: 395 verdes, 2 falhas em `tools.spec.ts` por timeout padrão de 5 s sob carga (as mesmas duas famílias de timeouts anteriores:
  `optimize_build`/`scan_slot` e `consultant.spec.ts`), que passam sozinhas; não escondem regressão porque o resultado (asserts) é o mesmo
  quando há folga de tempo. Limitações: trava por slot inteiro; polish ranqueia por DPS; classes extras só com builds nuas; sem Beam/VNS.

### Fase de descoberta automática do Optimize V1 (04/11/2026)

Detalhes, tabelas e cobertura em `docs/optimize-discovery.md`. Sem Beam/VNS, fórmulas, catálogo ou polish alterados; sem commit, publicação ou Novidades.

- **Travas por campo:** `constraints.lockedFields` (campos do modelo; carta/encanto/refino/grau fixam a peça, `weapon` só impede a troca). Respeitada
  na descoberta, nos complementos, nos movimentos de refino/grau, no polish e no juiz (`LOCKED_FIELD_CHANGED`). 8 testes (`field-locks.spec.ts`).
- **Auditoria do gerador:** `instrument: true` devolve `candidateAudit` (catálogo → excluído → não relevante → elegível → triado → no pool → avaliado
  → aceito, por slot; legais/oferecidos/tentados por campo; destino de candidatos conhecidos). Contagens distintas. 4 testes.
- **Descoberta real** (`optimize-discovery.bench.spec.ts`): jor original/restrita, Meister físico (referência `b1`), Magus com equipamento real de `b1`
  (sem build mágica equipada no repositório), Meister com arma/escudo travados. Todos viáveis com 2000–4000 avaliações (Meister ≈ referência a 2000;
  sets a 4000). A 300–800 com 4 alvos o orçamento acaba no 9º slot de 16 (pisos de esforço × leituras por alvo): lacuna de orçamento, não de gerador.
  Correção testada (share por custo de leitura) não mudou o resultado e foi revertida.
- **Timeouts de 5 s:** testes de 2–4 s sozinhos chegavam a 5–6 s com um fork por core; `vitest.config.mts` ganhou `testTimeout: 20_000`.
  Também: `optimize-budget.spec.ts` ignora `candidateAudit` na comparação instrumentado × simples.
- **Verificação:** `tsc -p tsconfig.backend-tests.json` limpo; `mcp/src` inteira: 409 verdes, 0 falhas (21 benchmarks opt-in pulados).
- **Pendente de decisão:** pisos/ordem de slots em metas com vários alvos; travas por campo em `optimize_slot`/`scan_slot`; commit/PR/Novidades.

## Experimento de cobertura progressiva (04/11/2026)

Detalhes e dados reproduzíveis: [optimize-progressive-experiment.md](optimize-progressive-experiment.md) e `docs/benchmarks/optimize-progressive/`. O A/B foi medido com procs desligados e com todas as chamadas ao motor, alvos agregados, relatórios e verificação final dentro do mesmo teto por fixture; o experimento reserva previamente uma fração fixa para a etapa posterior à busca. Resultados não são diretamente comparáveis aos números históricos de `solves`.

- A sondagem progressiva aumenta a cobertura, mas não será promovida: no Jor restrito com 800 chamadas totais o Greedy chega à meta e a progressiva não; com 2.000 ambos chegam, com DPS de 46,16M e 41,35M respectivamente. Em contrapartida, no Meister a 2.000 a progressiva chega à meta e o Greedy não, e no Meister com arma/escudo travados reduz a distância a 4.000 de 0,6658 para 0,1959; nenhum dos dois a cumpre. O protótipo fica interno para reprodução, sem mudar o padrão.
- Causa de correção confirmada por regressão: o primeiro alvo da busca usava a margem da média entre alvos. O julgamento agora lê o alvo isoladamente. O gerador e o polish também deixaram de oferecer encantos fora do LATAM, após a progressiva propor o ID 312655 e o validador rejeitá-lo.
- `optimize_slot` e `scan_slot` aceitam as restrições existentes e compartilham a política de travas por campo; o restante do slot continua disponível. O teste de combinação da armadura 450206 e encantos 311164/311100 mostra que, com limites totais de 300/800/2000, respectivamente o conjunto completo não foi avaliado, foi avaliado mas não aceito, e foi aceito. O estado `notLegalOnTheAnswerPiece` da auditoria não identifica o histórico de peças intermediárias.
- O golden de qualidade foi executado separadamente: 3/3 passaram. Typecheck completo passou. Testes direcionados: 37 passaram. A suíte completa em `forks` foi interrompida após erro de encerramento de workers (`kill EPERM`). Reexecutada em `threads`: 9.392 passaram, 2 falharam e 22 benchmarks opt-in foram pulados. As duas falhas foram reproduzidas isoladamente e são anteriores a esta etapa: faltam a opção de busca e o rótulo de `matk_element_holy`. A correção está na main (38b6a086), mas não integra este checkout; a suíte não está verde.

**Ainda falta para aceitar Optimize V1:** definir e implementar uma contabilidade pública rígida que cubra todas as leituras agregadas de alvo e as verificações; verificar o desempenho sob limites de tempo de produção; ampliar o benchmark com uma build mágica equipada real e referências independentes, inclusive configurações de conjuntos; confirmar os critérios de qualidade por fixture e orçamento; manter visível que a busca pode parar sem encontrar solução e que isso não prova impossibilidade. O polish ainda ordena soquetes por DPS; não houve evidência fim a fim para alterá-lo. Uma busca mais sofisticada não foi demonstrada necessária por este experimento; o resultado misto exige mais evidência, não uma troca de padrão.

## Aceite do Optimize V1 (04/11/2026)

Ver [matriz e evidências](optimize-v1-acceptance.md). **NOT READY:** `maxSolves` continua legado e não há teto público rígido de chamadas totais; o cancelamento da UI termina o worker sem recuperar o incumbente; a UI não expõe GoalSpec/travas por campo e limita a dois alvos; ainda falta comparação de qualidade em custos verdadeiramente equivalentes. O deadline da busca e do polish agora é compartilhado, mas relatórios e uma avaliação em andamento ainda podem ultrapassá-lo. `budgetUsage` e a UI informam chamadas reais e a ausência de teto total. Existe uma fixture mágica real: Magus Pazzolino, com 19 itens e atributos/passivas registrados no replay, fórmula pré-rebalanceamento.

A opção e o rótulo `matk_element_holy` receberam as mesmas correções pontuais já existentes na main; os 77 testes dos dois arquivos passaram. Golden 3/3, typecheck e cinco testes de UI passaram. A suíte completa sobre o estado final passou: 9.402 testes verdes e 23 opt-in ignorados; o golden foi executado separadamente. Sem Beam/VNS, commit, push, deploy ou Novidades.

## Orçamento rígido e cancelamento (04/11/2026)

`maxEngineCalls` é opt-in, por job e cobre chamadas reais incluindo alvos, procs e julgamento final; `maxSolves` permanece legado. A reserva conservadora e a contagem por fase estão descritas no [aceite](optimize-v1-acceptance.md). O worker envia checkpoints completos e verificados, aceita cancelamento cooperativo e a UI guarda o último antes de eventual encerramento forçado; sem checkpoint, informa erro. No fallback, o custo total desconhecido é explicitado.

No caso de comparação reproduzível, mesmo teto total de 33 chamadas: legado 33 e modo rígido 16, ambos com 30,786M DPS; timeout devolveu baseline e cancelamento após melhoria devolveu o último checkpoint. Os relatórios opcionais não são incluídos no modo rígido, então a diferença de custo não é uma melhoria isolada do algoritmo. Passaram 89 testes direcionados, typecheck, 6 testes Playwright, golden 3/3 e suíte completa (9.414 testes passaram, 24 ignorados). Permanecem paridade de GoalSpec/travas/alvos na UI, comparação de qualidade mais ampla sob custo total igual e validação da configuração implantada; veredito global continua NOT READY.

## POC de planejamento por IA/MCP — 05/11/2026

A direção mudou durante a auditoria de READY: a matriz extensa Legacy/Unified foi interrompida, preservando as linhas já gravadas em `docs/benchmarks/optimize-ready-audit`. Ela permanece incompleta e não foi promovida a evidência de aceite. As correções reproduzidas de cobrança de rotações, conflitos iniciais e classificação de efeitos foram preservadas.

Foram produzidos [auditoria de capacidades](mcp-ai-optimization-audit.md), [benchmark A/B/C](ai-guided-optimization-benchmark.md) e [decisão de arquitetura](optimization-architecture-decision.md). A POC congelou o snapshot original de `5hTy6pd`, Inquisidor com Técnica da Mão Explosiva, cinco alvos de jor_ab02, grau C, sem MVP/Oleum ativo/Abrasivo e sem mudanças de atributos/skills/buffs/consumíveis. O link curto não resolveu; não foi substituído por uma build mais favorável.

- **A — Greedy, esforço padrão 10.000:** 0/5 metas nos tetos reais 200 e 1.000, retornando a baseline verificada; o custo ficou em triagem. Sensibilidade com esforço 200/1.000 e 100.000 também foi preservada.
- **B — hipóteses do agente via MCP:** faixa 200: 177 chamadas reais, 5/5 metas, confiabilidade condicional; faixa 1.000: 252 chamadas, 5/5 metas e 5/5 garantias dentro do modelo, margem mínima 0,83%, quatro slots de peças e 24 campos alterados. Foram 33 variantes exploratórias, sem Optimize/scan/optimize_slot no braço B. O journal registra também hipóteses refutadas e alternativas.
- **C — listas/slots indicados pelo agente + busca local:** com esforço legado alinhado ao teto, 2/5 metas em 200 chamadas e 5/5 em 1.000; a solução maior mantém as peças principais, altera 15 campos e tem margem crítica mínima 21,53%, mas o abate é condicional. Com esforço 10.000/100.000 o resultado não foi o mesmo. Não foi alterado o algoritmo para produzir a melhoria.
- **Custos ausentes:** tokens, preço e latência isolada do modelo. B/1.000 fez 45 chamadas MCP e recebeu 181.209 bytes; menor número de cálculos não demonstrou menor CPU ou custo total. Há uma sessão de agente informada pelo histórico, não amostragem independente de agentes.
- **Conhecimento:** contexto, estágios, buscas filtradas, AND/OR e patches existentes bastaram para a demonstração. O texto de scaling pode conservar coeficientes antigos após override da fórmula; `get_skill` ganhou proveniência/advertência aditivas. A classificação de crítico certo versus precisão normal foi corrigida contra `calcDmgDpsDetailed`, sem alterar dano ou fórmulas.

**Decisão:** priorizar planejamento externo B e ferramentas verificáveis D; preservar A e aprofundar C somente com medição. Não integrar API paga nem tornar IA obrigatória. O Optimize V1 continua NOT READY para aceite geral; esta POC não fecha a matriz ampla nem valida a versão publicada, que respondeu 0.1.221-beta com outro dataset/schema. Sem commit, push, deploy, Beam/VNS ou Novidades.
