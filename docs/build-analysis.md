# Melhorias de build: calculadora e MCP

A calculadora e o MCP são dois acessos às mesmas capacidades. O motor calcula;
a busca explora opções com limites; a interface permite experimentar sem IA;
o MCP permite que uma IA consulte os dados e conduza hipóteses para uma ocasião.
O otimizador é opcional nos dois fluxos. Não existe classificação automática de
early/mid/endgame, preço ou custo-benefício sem informação de preço e obtenção.

## Usar sem IA

Abra uma build e clique em **Encontrar melhorias**, junto das ações de importar,
salvar e compartilhar. Existem quatro caminhos:

1. **Melhorar equipamentos:** escolha os slots que podem mudar. Os desmarcados
   ficam preservados; pode fixar candidatos por ID num slot e excluir outros IDs.
2. **Explorar um slot:** varra os equipamentos permitidos para a classe e nível,
   opcionalmente filtrados por nome. Os resultados incluem cartas/encantamentos
   usados na medição e parceiros de conjunto que precisam de um teste separado.
3. **Redistribuir atributos:** busca pontos base e traits, respeitando o orçamento
   de pontos do nível, o perfil escolhido e o HP mínimo informado.
4. **Entender dano e próximos upgrades:** examine etapas da fórmula, contribuição
   das peças, efeitos que ficaram fora da conta e investimentos individuais.

Escolha o alvo, perfil sustentado ou burst. O padrão é **Ajustar minhas peças atuais**:
preserva equipamentos, refino e grau, procurando cartas, encantamentos e rolagens.
**Explorar trocas e upgrades** permite substituições e usa os limites de refino/grau
informados (+12/A por padrão, com sombrios limitados a +10). Grau máximo menor que
o da build base é recusado. Na busca completa é possível escolher um segundo alvo
com o mesmo peso e definir HP mínimo. Tempo de busca e número de cálculos são
limites separados; atingir um deles produz uma sugestão parcial.

A política de execução pertence a cada acesso: a tela começa com 60 segundos e
10.000 cálculos, ajustáveis no formulário; o MCP mantém os limites configurados
no servidor (por padrão, 45 segundos e 10.000 avaliações). Compartilhar a busca não
significa prometer resultados idênticos com orçamentos ou máquinas diferentes.

Os resultados mostram métricas antes/depois, ganho por tipo, mudanças, perfis,
checagens de defesa e evolução, procs e alternativas quando disponíveis. **Comparar
na calculadora** leva a sugestão exata, com seus soquetes/rolagens, ao painel de
comparação. A build principal é preservada. O alvo da análise passa a ser o alvo
da comparação, sem Aliviar. O fluxo existente de comparação continua permitindo
editar as peças e decidir quais mudanças usar. Também é possível abrir o link
da sugestão em outra aba. Se a build mudar desde a busca, é necessário refazê-la.

A busca roda em um Web Worker local carregado sob demanda. Cancelar ou fechar
encerra o worker. O navegador baixa os dados normais da calculadora, mas não chama
o MCP nem um modelo de IA. O worker isola o estado mutável do motor da edição
que permanece na tela. Esta análise é PvE; não otimiza dano recebido nem Aliviar.

## Divisão das features

### Nos dois

| Feature | Calculadora | MCP |
| --- | --- | --- |
| Dano, DPS, atributos e tempos | Resultado da build | `calculate` |
| Consultar itens, bônus e condições | Busca/pickers e descrições | `search_items`, `get_item`, `list_bonus_keys` |
| Consultar classes e habilidades | Seletores e descrições | `list_classes`, `list_skills`, `get_skill` |
| Alvos e dummies com defesa | Seleção de monstros e análise | `search_monsters`, `get_monster` |
| Montar e comparar variações | Editor e painel de comparação | `evaluate_variants`, `compare_builds`, `optimize_slot` |
| Procurar melhorias de equipamentos | Encontrar melhorias → Melhorar equipamentos | `optimize_build` |
| Explorar equipamentos de um slot | Encontrar melhorias → Explorar um slot | `scan_slot` |
| Melhorar distribuição de atributos | Encontrar melhorias → Redistribuir atributos | `optimize_stats` |
| Burst e DPS sustentado, com rotação quando presente | Perfil da análise e rotação da build | `profile`, métricas de rotação |
| Fixar peças e limitar evolução | Slots, candidatos, exclusões, refino/grau e HP | `slots`, `lock`, `candidates`, `exclude`, `refine`, `maxGrade`, `require` |
| Cartas, encantamentos e rolagens permitidas | Pickers e busca de complementos | `slot_options`, ferramentas de busca |
| Fórmula, contribuições e próximos upgrades | Análise e detalhes de dano | `explain_damage` |
| Alertas, procs, perfis e checagens de evolução/defesa | Resultado da análise | Blocos do resultado da busca |
| Builds e itens personalizados | Editor, biblioteca, links | `get_custom_item_schema`, `validate_custom_items`, `create_custom_items` |
| Importar/gerar links | Importar e compartilhar | `parse_share_link`, `share_link` |

“Nos dois” significa capacidade equivalente, não interfaces ou parâmetros idênticos.
A tela apresenta controles para experimentos comuns; o MCP preserva todos os seus
parâmetros avançados e respostas estruturadas.

### Somente na calculadora

- Edição visual, seleção de peças e cores, descrições e revisão da comparação.
- Execução local da busca, cancelamento imediato e revisão sem consumir tokens de IA.
- Salvar simulações e preferências no navegador e importar replays `.rrf` pela interface.
- Painéis e visualizações interativos, incluindo PvP, dano recebido, autocasts e edição
  da rotação. Esses painéis não ganharam otimizadores próprios nesta mudança.

### Somente no MCP

- Protocolo de ferramentas para agentes, schemas, erros estruturados e guia `guide`.
- Lotes programáticos: `evaluate_variants`, `damage_table` e comparação de várias
  builds por chamada. A tela não ganhou um editor genérico de lotes.
- Controles avançados não expostos no novo formulário: pesos arbitrários de até cinco
  alvos, pares explícitos de slots, limites de outras métricas via `require`, travas
  individuais de atributos, `countProcs`, esforço/rodadas e seleção de todas as métricas.
- Auditoria programática dos pools não confirmados: `uncatalogued_pools`.
- Opção `scan_slot.includePatches` para devolver os patches exatos das linhas. A tela
  usa esses mesmos patches internamente para comparar sem reconstruir encantamentos.

A interpretação de pedidos em linguagem natural pertence à IA conectada, não ao
servidor MCP. Nem a tela nem o MCP prometem descobrir o ótimo global ou preços reais.

## Fronteira técnica e preservação

- `src/app/core`: fórmulas e regras compartilhadas, incluindo limites de equipamentos.
- `src/app/build-analysis/data` e `engine`: dataset, índices, resolução da build,
  execução do motor, métricas, patches, complementos e links.
- `src/app/build-analysis/operations`: cálculos, comparação, buscas e explicações
  sem envelopes MCP. Recebem dataset e política de execução do chamador.
- `mcp/src/tools`: schemas, instruções e adaptação de resultados para o protocolo.
  Os caminhos antigos `mcp/src/engine` e `data` reexportam a implementação para manter
  compatibilidade com os demais consumidores e testes; o carregador Node continua lá.
- `src/react/services/build-analysis*`: carregamento, worker e cancelamento locais.

O limite de tamanho do bundle inicial permanece o mesmo. O worker opcional tem um
orçamento separado porque inclui uma segunda instância isolada do motor e os dados
de análise sob demanda. Não carrega SDK MCP nem acesso a filesystem. As condições e
limitações da heurística continuam explícitas. `scan_slot`
com `topSockets: 0` agora devolve os candidatos medidos sem complementos, em vez de
descartá-los e listar somente a peça atual.

## Pesquisa de sinergias sem otimizador

`get_skill` consulta uma habilidade ofensiva por nome, id ou value e devolve a
descrição do cliente, tempos e dependências documentadas. Para Fogueira Espiritual,
o motor documenta a participação do HP máximo: `hp`, `hpPercent`, VIT e allStatus.
`search_items` com `classId`, `skill` e `synergy: true` pesquisa tanto bônus diretos
da skill quanto essas dependências indiretas. Use `slot` para separar equipamentos,
cartas e encantamentos; `get_item` inspeciona bônus/condições, `slot_options` verifica
as posições permitidas e `evaluate_variants` compara as combinações propostas.
Nenhuma dessas etapas exige `optimize_build`. Outras skills ainda podem não ter
dependências indiretas documentadas; a descrição e os testes continuam necessários.

## Correções da busca

- HP passa a participar da seleção de candidatos da Fogueira; não há corte fixo de
  oito cartas/encantamentos. O orçamento é repartido entre posições e evita patches repetidos.
- Equipamentos com pools de encantamento entram na triagem mesmo sem bônus direto
  no script base. Famílias diferentes recebem avaliação de complementos antes do descarte.
  Isso permite considerar Lobo Cinzento e Varmundt; Nebulosa exige nível 240.
- Refino sombrio respeita +10. Os módulos Automatron respeitam limites de repetição
  e Fantásticos; encantamentos alterados são validados por item e posição (incluindo Issgard).
  Fontes: [Automatron](https://browiki.org/wiki/Equipamentos_Automatron) e
  [Issgard](https://browiki.org/wiki/Issgard). Não se presume um limite de repetição universal.
- Resultados mostram peças, cartas e encantamentos antes/depois, com acesso às alternativas do slot.

`optimize_build` usa `procMode: average` por padrão, a 3 ataques/s. Também aceita
`off` e `active`. A média combina estados de até três procs com chance/duração
conhecidas, supondo independência e ataques regulares. Procs desconhecidos/excedentes
ficam fora e aparecem em `procContext.uncounted`; não se assume ativação permanente.
Só DPS, dano médio e métricas de rotação são ponderados; HP mínimo permanece sem os
procs adicionais. Uma avaliação pode resolver vários estados: o limite de avaliações
não é uma contagem de todos os solves internos, e o tempo continua limitando a busca.
`scan_slot` e `evaluate_variants` aceitam a política explicitamente e usam `off` por
padrão. `calculate`, `optimize_slot` e `optimize_stats` usam os efeitos explícitos.
O painel de comparação mostra a build com os efeitos selecionados, sem converter
uma estimativa de média em um bônus permanente. O resultado identifica essa diferença.

A busca é heurística, com cobertura e interrupções informadas; não prova o ótimo
global e não substitui validação do dano por gravações do jogo.

## Verificação desta mudança

- Suíte de lógica com pool de threads: 9.164 testes passando e 2 ignorados,
  incluindo o benchmark manual opt-in entre os ignorados.
- Cinco fluxos Playwright: busca com limites e preservação da build, cancelamento
  em celular, varredura e comparação de uma linha, análise de dano/upgrades e atributos.
- Paridade entre operações diretas e MCP, reprodução do ranking por patch e proteção
  contra aplicar uma sugestão de uma build que já mudou.
- Typechecks de React/backend, limites de dependências e build de produção.
- Regressões da Fogueira: candidato de HP, resultado pelo menos igual à Derreting,
  média de proc entre desligado/ativo, regras Automatron/Issgard, sombrios +10,
  preservação das peças atuais, famílias Lobo/Varmundt e requisito de nível da Nebulosa.

O benchmark longo é opt-in com `BENCH_LABEL`, para não disparar nas execuções normais
de testes. Os casos de regressão não substituem uma medição ampla da qualidade do otimizador.

## Velocidade e qualidade da busca

- **Cálculo mais barato.** Cada avaliação cria um registro de bônus por peça, habilidade e buff (~100). Cada um copiava as ~300
  chaves de `allStatus`, e isso era a maior parte do tempo do motor (medido com o perfilador do Node: `prepareAllItemBonus` era 43%
  do tempo, quase todo nessa cópia). Agora o registro lê de `allStatus` e guarda só o que recebe (`Calculator#blankBonus`), e o
  resumo continua listando só chaves não nulas. Num `optimize_build` real o cálculo caiu de 8,6 para 4,4 ms (procs desligados) e de
  16,4 para 8,3 ms (média dos procs), sem mudar nenhum resultado: os 9.165 testes, incluindo os replays, passam.
- **Cálculos repetidos.** Cerca de 28% das avaliações de uma busca real eram repetições exatas (uma carta testada na passagem
  rápida e de novo na completa, a peça atual reencontrada na rodada seguinte). `evaluationCache` guarda as métricas por build
  resolvida, alvo e efeitos; uma repetição custa a chave e não conta no orçamento (`reused` na resposta).
- **Régua de qualidade.** `mcp/src/engine/optimize-quality.bench.spec.ts` roda o `optimize_build` em três builds fixas (as duas
  Inquisidor do teste e uma de equipamento fraco), mede a build recomendada com o mesmo motor e falha se ficar abaixo do piso
  registrado em `__tests__/fixtures/optimize-golden.json` (tolerância de 2%). Só roda com `BENCH=1` (leva minutos). Toda mudança na
  busca deve passar por ela; quando achar uma build melhor, sobe-se o piso, nunca se baixa.

## Passada final sobre os soquetes

A busca ranqueia cartas e encantamentos pelas chaves de script que espera que importem e experimenta os melhores. Uma carta que vence
por um motivo que o ranking não vê (a Carta Derreting escala com HP) nunca era testada, e a resposta mantinha uma pior: foi o caso da
Alga Brilhante no lugar da Derreting na build de Fogueira Espiritual. Agora, depois da busca, `optimize_build` confere a build
resultante soquete por soquete contra **todas** as cartas e encantamentos legais (`socketOptions`), dividindo o tempo
igualmente entre os soquetes e com tempo próprio (no mínimo 25 s), e aceita a troca que melhora a métrica (passos `polish`).

Medido com um teste independente que, depois da busca, tenta todas as cartas legais em cada soquete (orçamento curto de 4 mil
cálculos, alvo Betelgeuse): antes da passada, 5 a 6 soquetes por build tinham carta melhor disponível (Tao Gunka na armadura, +17 a
+23%; Derreting no Selo, +2%; Gan Ceann na arma, +4%); depois, nenhum. O DPS da build recomendada foi de 385 mil para 696 mil
(fixture da Fogueira), de 1,41 para 2,46 milhões (build 1) e de 892 mil para 1,27 milhão (build 2).
