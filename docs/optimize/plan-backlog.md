# Plano e backlog: Optimize, base de conhecimento e MCP

Data: 2026-11-06. Parte do veredito NOT READY de [optimize-v1-acceptance.md](optimize-v1-acceptance.md). Nada aqui autoriza commit, merge, implantação, mudança na VPS ou escrita no NAS: cada um desses passos precisa de aprovação própria.

Esta versão considera as duas linhas de trabalho: a árvore da `main` e o worktree `D:/Developer/latam-ro-calc-goal-search` (`feat/goal-search`). Nenhuma das duas foi commitada, e nenhuma medição existente cobre as duas juntas.

## Objetivo

Sair de NOT READY com o menor trabalho possível. Cada etapa tem um critério de saída medível. Funcionalidade nova fica para depois do aceite.

## Estado das duas linhas

| Tema | `main` (árvore de trabalho) | Worktree `feat/goal-search` |
| --- | --- | --- |
| Base de conhecimento (Acquisition) | Completa: dados, importadores, painel, integração | Ausente |
| Filtro LATAM de encantamentos | Ausente (bloqueio 2) | Presente em `complements.ts`, não medido contra este bloqueio |
| Teto rígido `maxEngineCalls` e cancelamento com checkpoint | Ausente | Presente, opt-in |
| Travas por campo (`lockedFields`), `optimize_slot`/`scan_slot` com restrições | Ausente | Presente |
| Paridade UI/MCP | Feita aqui | Feita lá também; as duas precisam ser unificadas |
| Benchmark legacy × unified | `docs/benchmarks/optimize-acceptance/` | Matriz `optimize-ready-audit`, interrompida e incompleta |
| POC de IA pelo MCP | Ausente | Concluída, com 1 build e 1 sessão de agente |
| Documento de aceite | `docs/optimize/optimize-v1-acceptance.md` | `docs/optimize-v1-acceptance.md`, outro texto, com a matriz de 7 critérios |

Consequências:

- O bloqueio 2 pode já estar resolvido pelo código do worktree. Confirmar depois do merge, sem reimplementar.
- A frase "`maxEngineCalls` não existe" do aceite da `main` deixa de valer depois do merge.
- A memória medida não inclui o código do worktree, nem o custo da base de conhecimento carregada.

Decisão registrada no worktree em [optimization-architecture-decision.md](../../../latam-ro-calc-goal-search/docs/optimization-architecture-decision.md), em 2026-11-05: priorizar o planejamento por agentes externos via MCP (modalidade B) e as ferramentas verificáveis (D), preservar a busca automática (A) e aprofundar a busca local guiada (C) só com medição, sem Beam ou VNS. A evidência é de uma build e uma sessão, e o dono do projeto precisa confirmar essa direção.

## Plano

| # | Etapa | Depende de | Aprovação | Critério de saída |
| --- | --- | --- | --- | --- |
| 0 | Consolidar as duas linhas | nada | Commits e merge | Branch `integrate/optimize-v1` com tudo, sem perda de arquivo e com a suíte completa passando. |
| 1 | Corrigir a subida do bundle da VPS | etapa 0 | Não | Teste automatizado inicia `dist/vps/server.mjs`, `/healthz` responde 200 e `/mcp` lista ferramentas. |
| 2 | Sincronizar o RagnarokDB | nada | Escrita no NAS | IDs de prioridade 1 e 2 processados e `availableServers` lido para os 1130 encantamentos. |
| 3 | Decidir os encantamentos | etapa 2 | Avaliação do dono | `existeNoLatam` preenchida, com amostra conferida no jogo. |
| 4 | Fechar o bloqueio dos encantamentos | etapas 0 e 3 | Não | Nenhuma das 5 builds sai com `ITEM_NOT_AVAILABLE_LATAM`, e `evaluate_variants` em `strict` aceita a saída de `optimize_build`. |
| 5 | Medir e reduzir memória | etapas 0 e 1 | Não | Pico de RSS por fase medido em Linux com Node 24, e decisão registrada sobre limitar buscas simultâneas. |
| 6 | Regravar pisos e referências | etapa 4 | Não | Pisos e `feasible@budget` regravados, com a queda do `weak` explicada. |
| 7 | Comparar com builds reais | etapa 4 | Não | Relatório contra as 17 builds de Cardeal e uma amostra de Inquisidor da VPS, mais uma referência de Meister. |
| 8 | Reavaliar o aceite | etapas 1 a 7 | Não | Um só documento de aceite, avaliado pelos 7 critérios, com novo veredito. |
| 9 | Publicar | etapa 8 | Merge, Novidades e implantação | Só com aprovação; validar a versão publicada depois. |

As etapas 0 e 2 são independentes e podem andar juntas. A referência de Meister da etapa 7 precisa vir do dono do projeto, porque a VPS não tem builds dessa classe.

### Etapa 0: consolidação

O worktree tem 527 arquivos sujos, e 201 deles já coincidem com a `main`. Restam 105 logs para apagar, 159 arquivos de benchmark para avaliar e 62 de código e documentação. Destes 62, 31 só existem no worktree, 4 são documentos que a `main` moveu para `docs/optimize/`, 7 mesclam sem conflito e 20 têm conflito. O número de conflitos é um teto: foi medido contra a base `5440182e`, e parte do trabalho já entrou na `main` pelo commit `53456052`.

1. Criar um zip das duas árvores fora do repositório, como backup.
2. Apagar os 105 logs do worktree.
3. Commitar o trabalho do worktree em `feat/goal-search`.
4. Criar `integrate/optimize-v1` a partir da `main` e commitar nela o trabalho atual da `main`.
5. Fazer merge de `feat/goal-search` em `integrate/optimize-v1` e resolver os conflitos. Mover os documentos do worktree para `docs/optimize/`.
6. Unificar a paridade da UI, que foi feita duas vezes, e os dois documentos de aceite.
7. Rodar `tsc`, a suíte completa e os testes de ponta a ponta da UI.
8. Levar para a `main` só com aprovação. O trabalho seguinte sai em branches separadas, e o worktree só é removido depois de conferido.

O maior risco é `operations/optimize.ts`, com 26 pontos de conflito. Resolver esse arquivo primeiro, sem escolher um lado inteiro.

### Etapa 1: subida do bundle

Trocar o `import()` dinâmico de `operations/acquisition` por import estático é a correção mais simples, porque mantém o pacote de um arquivo só. Medir antes o custo em memória ociosa, já que a base de conhecimento passa a carregar na subida. Se o custo for alto, a alternativa é `splitting: true` com `tools/package-vps.mjs` empacotando toda a pasta `dist/vps`, o que exige revisar `activate.sh`.

### Etapa 2: RagnarokDB

A lista está em `docs/audits/latam-2026-11/ragnarokdb-sync-prioridade.csv`. Nenhum dos 1130 encantamentos marcados como fora do LATAM está no banco: 1043 estão na fila `legacy_backfill` e 87 estão ausentes. O campo `availableServers` do DivinePride é a evidência que falta, e já distingue itens no banco (9425 de 11702 têm LATAM).

| Prioridade | IDs | Conteúdo | Tempo a 1,5 s por item |
| --- | --- | --- | --- |
| 1 | 1221 | Encantamentos fora do LATAM e itens usados em builds | cerca de 31 min |
| 2 | 406 | Encantamentos sem rota | cerca de 10 min |
| 3 | 3654 | Demais itens | cerca de 1h30 |

Rodar pelo container, com `add_to_queue.py` e `sync_pending.py --ids`, fora do horário do sync diário das 04:00. O DivinePride tem um teto não documentado, então pode precisar de mais de uma rodada. Depois, reexportar com `tools/export-ragnarokdb-acquisition.py`, que aceita até 256 IDs por vez.

O sync não resolve tudo: 451 encantamentos e 698 itens já estão no banco sem fonte, e precisam de Browiki ou curadoria. Também não transforma evidência em prova: `availableServers` é uma informação do DivinePride.

### Etapa 5: memória

A medição vem antes da decisão sobre limitar a uma busca por vez. Dados atuais, com o bundle de HEAD em Windows e Node 22: 91 MB ocioso, 137 MB aquecido, pico de 602 MB com uma busca e 801 MB com três. A VPS tem 917 MB e 197 MB livres, e o PM2 reinicia em 512 MB. Nenhum reinício por memória apareceu em produção até agora.

1. Usar `tools/mcp-load-probe.mjs` como linha de base e adaptar a leitura de RSS para Linux, que hoje depende de `tasklist`.
2. Medir localmente em Linux com Node 24 e o mesmo limite de memória da VPS, sem tocar na VPS.
3. Separar o heap por fase da busca, para achar o que cresce.
4. Reduzir o maior consumidor.
5. Decidir com os números. Se uma busca couber com folga e três não, limitar as simultâneas e devolver erro claro às excedentes. Se nem uma couber, reduzir os padrões do MCP antes de qualquer limite.

## Backlog

Prioridade: P1 bloqueia o aceite, P2 melhora a qualidade logo depois, P3 pode esperar.

### Optimize

| Prioridade | Item |
| --- | --- |
| P1 | Confirmar o filtro `latam` do worktree em `socketOptions`, `complementChoices` e `enchantLevels`, completando só o que faltar. |
| P1 | Teste de ponta a ponta: toda saída de `optimize_build` passa em `strict`. |
| P1 | Investigar a queda do `weak`: 5.210.892 contra piso de 5.403.123. |
| P1 | Concluir a comparação de qualidade com custo equivalente, que o worktree deixou incompleta em `optimize-ready-audit`. |
| P2 | Ordem dos slots e pisos de esforço em metas com vários alvos, gargalo apontado em `optimize-discovery.md`. |
| P2 | Prazo padrão da UI: a busca de 60 s para com 38% a 59% das buscas. Avaliar prazo maior ou aviso de qualidade limitada pelo tempo. |
| P2 | Decidir se `maxEngineCalls` continua opt-in, e como `maxSolves` convive com ele. |
| P2 | Motivo por candidato descartado, para a pessoa entender por que uma peça ficou de fora. |
| P3 | Retestar a busca local guiada (C) contra o agente (B), cobrando todas as chamadas no mesmo job. |
| P3 | Sensibilidade à fatia de tempo por campo e polimento por DPS. |

### Base de conhecimento

| Prioridade | Item |
| --- | --- |
| P1 | Aplicar a avaliação de `encantos-nao-latam.csv` na lista LATAM, com a origem de cada correção registrada. |
| P2 | Importar as fontes dos 3089 itens que o RagnarokDB já tem. Começar pelos 39 usados em builds e pelos 2223 com `mob_drops`; filtrar os outros 866, que podem ser de outro servidor. |
| P2 | Cobrir os 46 encantamentos e 117 itens sem rota usados em builds da VPS. |
| P2 | Curar pelo Browiki os 451 encantamentos e 698 itens sem fonte no RagnarokDB, a começar pelos usados, como FOR +3 e Fatal 3. |
| P2 | Revisar as 324 rotas sem revisão, começando pelas mais recomendadas. Só 8 de 1038 estão confirmadas. |
| P2 | Reexecutar `acquisition-phase4.bench.spec.ts` depois de cada lote, para medir a cobertura do que o Optimize recomenda. |
| P3 | Sincronizar a prioridade 3 e tratar o restante por valor. Cobrir tudo não é meta. |
| P3 | Tirar de `.tmp/acquisition-*` a proveniência que precisa sobreviver a uma limpeza. |

### MCP

| Prioridade | Item |
| --- | --- |
| P1 | Teste que inicia o bundle e chama `/mcp` (etapa 1). |
| P1 | Limite de buscas simultâneas em `/mcp`, se a etapa 5 confirmar a necessidade. Hoje a rota não tem limite nem autenticação para chamadas sem `Origin`. |
| P2 | Repetir o protocolo da POC em outras classes, incluindo magia e sinergias, com agentes independentes e registro de tokens, latência e custo. |
| P2 | Isolar a busca do laço de eventos, se `/healthz` continuar em segundos depois da etapa 5. Hoje piora para 3,1 s com uma busca e 8,6 s com três. |
| P2 | Resumo compacto de métricas das hipóteses descartadas e custo real por operação, reutilizando `evaluate_variants` e `explain_damage`. |
| P2 | Reduzir o tamanho das respostas de listas longas. A POC recebeu 181.209 bytes em 45 chamadas. |
| P2 | Explicar no `guide` e no resultado quando uma peça foi recusada por disponibilidade no LATAM. |
| P3 | Telemetria mínima de duração e pico de memória por busca nos logs da VPS. Exige aprovação, por ser mudança em produção. |

## Fora de escopo até o aceite

Novos algoritmos (incluindo Beam e VNS), API de IA embutida, novas rotas de obtenção além das listadas, mercado, farming e novos serviços.
