# Conhecimento de obtenção — Fase 2

Entrega local de 05/11/2026. O catálogo interno do LaRo Calc continua sendo a fonte de runtime. RagnarokDB, Divine Pride, rAthena, bROWiki e GNJOY são **entradas de preparação**, nunca dependências de uma consulta ou de um ciclo do Optimize.

## Contratos reaproveitados

| Contrato existente | Uso nesta fase | O que não foi substituído |
| --- | --- | --- |
| `ItemModel`, `item.json` | Identidade numérica, Aegis, arma/peça, propriedades mecânicas e vínculos. | Registros, descrições, scripts, fórmulas, cartas e bônus. |
| `latam-items.json`, `ItemIndex` | União de IDs conhecidos, inclusive materiais sem registro mecânico. | Nomes, localizações e flags `latam`/`inCalcDb`; presença no cliente não confirma uma rota. |
| `MonsterModel`, `monster.json` | Identidade dos monstros para as relações de drop. | Atributos e `spawn`; monstros ausentes não são criados por este importador. |
| `_enchant_table.ts`, `dim_glacier.ts` | Pools e posições já existentes das 26 armas Vis Invernais. | Nenhuma ampliação de pool nem alteração de fórmula. |
| `AcquisitionKnowledge`, `AcquisitionRoute` da Fase 1 | Rotas, requisitos, passos, fontes, revisão, disponibilidade e efeitos funcionais. | As 67 rotas originais e suas fontes foram preservadas, inclusive o evento expirado. |
| `reviseKnowledge` | Histórico append-only, IDs imutáveis, motivos e proteção de regras revisadas/confirmadas. | Curadoria continua explícita; importação não confirma LATAM. |
| Exportador `export-ragnarokdb-monster-names.py` | Mesmo padrão de conexão do RagnarokDB, lock próprio e `PRAGMA query_only=ON`. | Nenhum sync de APIs, fila, atributo ou banco do projeto fonte foi alterado. |

O contrato normalizado continua em **schemaVersion 1**, com extensões opcionais compatíveis com os artefatos da Fase 1:

- `method`: drop, troca, extração, encantamento, reforma ou recipiente.
- `drop`: `monsterId`, mapa restritivo ou `null`, canal, índice do slot de drop, variante da fonte, probabilidade fracionária ou `null`, quantidade mínima/máxima ou `null`.
- `outputs`: itemId, intervalo de quantidade e chance de cada resultado; `outputSelection` distingue uma saída de todas ou agrupamento desconhecido.
- Requisitos: alternativas `anyItemIds`, quantidade escolhida, monstro, refino mínimo/máximo, consumo conhecido/desconhecido, número mínimo de opções aleatórias, sockets vazios e encanto anterior por ID/posição.
- `resultProperties`: mudança de refino e preservação de cartas/encantos/grau quando a fonte realmente os informa.
- `importKey`: identidade lógica da relação para reprocessamento; `id` continua sendo uma revisão imutável. Novos fatos geram outra revisão com `supersedes`, preservando a anterior.

Não há novo catálogo de itens ou monstros, tabela econômica, serviço ou banco de aquisição paralelo. `data/acquisition/latam.v1.json` é a mesma base canônica da Fase 1, enriquecida. Snapshots de entrada, propostas de curadoria e relatórios são artefatos de preparação e auditoria; somente o catálogo é importado pelo runtime.

## Fontes inspecionadas e lacunas

O RagnarokDB local foi lido em `D:/Developer/RagnarokDB`, via seu `db.connect()`, respeitando o lock e uma transação de leitura. A localização configurada do SQLite não foi copiada, substituída nem incorporada ao produto.

Estruturas úteis do espelho:

- `items`: ID, Aegis e aquisição em `raw_json`, `dp_last_update`, `last_synced_at`.
- `mobs`: ID, `raw_json`, servidor solicitado, servidores disponíveis e versões.
- `mob_drops`: **não usado para importar probabilidades**. O sincronizador soma slots repetidos do mesmo item: `rate` pode significar quantidade esperada em percentual, e não a probabilidade de cair pelo menos uma unidade.
- `raw_json.drops` e `mvpDrops`: preservam slots independentes. A probabilidade vem como fração; `0` continua sendo 0%, `null` continua desconhecido.
- `mapSpecificDrops`: a unidade difere de `drops` no sincronizador do projeto fonte. Este pipeline conservador registra a relação, mas deixa a chance desconhecida e informa a ambiguidade, sem aplicar um multiplicador presumido.
- `items.raw_json.reformUsage.asBaseItem`: base, resultado, ferramenta, materiais, restrições e preservação de propriedades. Chance de sucesso ausente não vira 100%.
- `enchantSystems`, `lapineDdukdakSources` e `containedIn`: neste recorte fornecem referências úteis, mas não um procedimento completo com todos os materiais, pesos e condições. São relatadas para curadoria, não convertidas em receitas inventadas.
- `manual_drops.json`: contém relações complementares e taxas provisórias. O recorte mantém as relações como referência genérica, com **probabilidade `null`**. As taxas provisórias ficam somente no snapshot/relatório, para explicar por que foram descartadas.

`region: LATAM` sozinho é insuficiente: nove monstros aceitos no recorte não listam LATAM em `availableServers`. Suas tabelas padrão podem ser fallback de outra região. Todas as 223 rotas desta importação RagnarokDB permanecem **genéricas e não revisadas**. Não se importam variantes históricas de outros servidores como se fossem atuais.

## Pipeline e reprocessamento

```text
RagnarokDB (somente leitura)
  → export seletivo de fatos e versões
  → validação do snapshot + resolução contra IDs internos
  → AcquisitionKnowledge / AcquisitionRoute existentes
  → merge de fatos desconhecidos + relatório de divergências
  → data/acquisition/latam.v1.json
  → consultas compartilhadas locais
```

1. `data/acquisition/import-scope.v1.json` seleciona **75 IDs** das famílias e materiais relevantes. O exportador recusa seleção vazia, IDs inválidos e mais de 256 IDs; não existe opção de importar o banco inteiro.
2. `tools/export-ragnarokdb-acquisition.py` exporta somente campos de aquisição e metadados. Não exporta nomes, scripts, atributos ou preços. Mantém SHA-256 do `raw_json`, versão upstream, data de sync e hash dos scripts/esquema do espelho.
3. `transformRagnarokSnapshot` valida estrutura/versão e confirma IDs no universo local. Uma divergência entre ID da linha e ID do payload ou Aegis conhecido é diagnosticada, sem criar item/monstro substituto. Materiais presentes apenas no cliente são aceitos por ID.
4. `mergeImportedKnowledge` preenche somente fatos ausentes (`null`, `undefined` ou `unknown`). Valor conhecido divergente permanece intacto e gera `fact_conflict`. Coleções divergentes não são unidas cegamente, pois requisitos alternativos não podem virar ingredientes cumulativos.
5. Regra revisada/confirmada não é enriquecida automaticamente por extração não revisada: gera `protected_reviewed_rule`. Rascunho pode enriquecer outro rascunho, criando sucessor com histórico; fonte genérica não substitui regra regional.
6. O mesmo recorte produz as mesmas identidades. Uma repetição sem novos fatos não escreve o catálogo nem altera revisão/fontes. Fonte e revisão existentes não podem ser reutilizadas com conteúdo diferente.
7. O CLI faz dry-run por padrão. `--apply` usa lock exclusivo de escrita, arquivo temporário e substituição atômica; verifica que o catálogo não mudou desde a leitura. Erro de validação ou conflito de escritor preserva o arquivo anterior. Não há escrita no RagnarokDB.

Comandos executados e reproduzíveis na raiz do LaRo Calc:

```powershell
python tools/export-ragnarokdb-acquisition.py --project D:/Developer/RagnarokDB --scope data/acquisition/import-scope.v1.json --output data/acquisition/inputs/ragnarokdb.v1.json

node tools/import-ragnarokdb-acquisition.mjs --input data/acquisition/inputs/ragnarokdb.v1.json --report .tmp/acquisition-dry-run.json
node tools/import-ragnarokdb-acquisition.mjs --input data/acquisition/inputs/ragnarokdb.v1.json --apply --report data/acquisition/ragnarokdb-import-report.v1.json

node tools/import-ragnarokdb-acquisition.mjs --input data/acquisition/rathena-glacier-experimental.v1.json --curation --apply
node tools/import-ragnarokdb-acquisition.mjs --input data/acquisition/curation/reference-families.v1.json --curation --apply
```

O export requer o ambiente já configurado do RagnarokDB e Python; o import usa Node e esbuild/Zod já instalados no LaRo Calc. Nenhuma dependência nova foi adicionada. Relatórios em `.tmp` requerem que essa pasta exista.

`--curation` é uma ação explícita sobre regras normalizadas preparadas localmente. Usa a mesma validação e política de revisão; não altera o estado de revisão declarado pelo arquivo. Por isso importar o recorte rAthena com essa opção mantém suas regras `generic/unreviewed`. Reaplicar o mesmo arquivo de curadoria também é idempotente; alterar uma revisão já existente exige outro ID, motivo e `supersedes`.

## Dados efetivamente incorporados

| Entrada | Cobertura | Estado |
| --- | --- | --- |
| Snapshot RagnarokDB | 50 registros de item, 15 registros de monstro com relações relevantes; 25 IDs selecionados sem item no espelho. | Entrada seletiva; não é substituição de catálogo. |
| Drops padrão Divine Pride | **31 slots de drop**, preservados individualmente, com chances conhecidas da tabela consultada. | Genéricos/não revisados; não confirmados LATAM. |
| Relações manuais RagnarokDB | **166 relações** com monstro/mapa/item; todas as taxas provisórias descartadas. | Genéricas/não revisadas, chances desconhecidas. |
| Reformas RagnarokDB | **26 reformas** de armas Vis Invernais, com ingredientes, refino de entrada/saída e propriedades estruturadas. | Genéricas/não revisadas; sucesso/falha não presumidos. |
| rAthena `item_enchant.yml`, seleção 47 | **10 operações**: aplicação do Grau Físico/Mágico 1 e oito evoluções até 5. | Genéricas/não revisadas; fonte fixada no SHA da Fase 1. |
| Curadoria regional | **14 regras**: dez operações de Grau, Incinerador, duas trocas de materiais e revisão estruturada do Combinador de Pedras Preciosas. | Revisadas documentalmente, confiança média; lacunas mantidas. |
| Fase 1 | **67 rotas anteriores**, sete grupos de Insígnias e seis registros de efeitos. | Preservados. Uma rota antiga do Combinador fica no histórico e tem sucessora. |

Resultado: **314 revisões de rotas**, sendo **313 efetivas**, 68 fontes e nove grupos de encantamentos. Nenhum item, monstro, descrição ou script mecânico foi substituído. A contagem de revisões inclui a antecessora do Combinador; não deve ser apresentada ao usuário como 314 procedimentos distintos confirmados.

O relatório persistido da primeira aplicação é `data/acquisition/ragnarokdb-import-report.v1.json`. Reprocessamento posterior das três entradas retornou **0 adicionadas, 0 enriquecidas** e manteve o SHA-256 e os bytes exatos do catálogo. Também foi comparada a integridade das 67 rotas/fontes anteriores e dos arquivos mecânicos `item.json`, `monster.json`, `latam-items.json` e `latam-monsters.json`.

## Conflitos e lacunas encontrados

| Diagnóstico da importação | Quantidade | Tratamento |
| --- | --- | --- |
| Taxa manual provisória descartada | 166 | A relação fica como referência; chance `null`. Não copiar 0,1%/0,15%/0,75% como taxa real. |
| Referência sem procedimento completo | 110 | Registrar IDs de sistema/ferramenta/recipiente para curadoria; não fabricar receita, chance ou resultado. |
| Fallback de servidor | 9 monstros | Manter origem genérica e não revisada. |
| Monstro externo ausente/divergente no universo mecânico local | 6 monstros | Ignorar suas rotas e relatar o ID; sem criar registros. |
| Relação manual com identidade não resolvida | 8 | Não importar a relação. |
| Item selecionado ausente no RagnarokDB | 25 | Preservar o conhecimento interno; ausência externa não apaga regras. |

Não houve sobrescrita de um fato conhecido do catálogo anterior nesta execução. Os testes exercitam divergências de probabilidade/quantidade e bloqueio de regras confirmadas. Uma nova versão externa contraditória fica pendente de decisão documental/manual, sem comportamento de “última fonte vence”.

## Famílias de referência

### Diademas Temporais

IDs de classe **19474–19492**, materiais **25864–25867**, Atemporal **18551**. Mantidas as nove transições da Insígnia 1 → 10 com custos e regressão, aplicação inicial, Lágrimas e troca do +17. Evento com fim em **12/10/2026** continua expirado para novas produções, sem invalidar posse declarada anterior.

O espelho acrescenta relações genéricas de drops de materiais. Elas não substituem as rotas regionais, não transformam recompensa de baú em drop de boss e não comprovam a disponibilidade atual. A [notícia 415](https://ro.gnjoyamericas.com/pt/news/notice/415) continua sendo a fonte da exceção de evento, e as chances normais mantêm a proveniência já registrada na Fase 1.

### Armas Vis Invernais

Reutilizadas as **26 armas** já vinculadas aos pools `D_Glacier_*` em `issgard-preview.spec.ts`; exemplos: Montante **600030**, Katar **610041**, Grimório **540056**. Não confundir com armaduras que também usam prefixo `D_Glacier_`, nem com as versões Invernais sem carta.

No recorte lido, os drops das armas **não estão publicados em `raw_json.drops` do Divine Pride**. As relações complementares de mapas vêm de `manual_drops.json`, que cita uma tabela thROG e documenta taxas provisórias. Foram mantidas **59 relações cobrindo as 26 armas** nos quatro mapas `jor_ab01`, `jor_ab02`, `jor_dun01` e `jor_dun02`, com pesos desconhecidos. Exemplo consultável: **600030 ↔ monstro 21526 ↔ `jor_dun01`**, sem afirmar a taxa provisória de 0,15% como medida LATAM.

O lançamento do conteúdo de Issgard foi cruzado com a [notícia oficial 448](https://ro.gnjoyamericas.com/pt/news/notice/448). Ela comprova o lançamento do episódio, não cada taxa, NPC ou combinação de materiais. Os detalhes de procedimento vêm da [bROWiki — Equipamentos Invernais](https://browiki.org/wiki/Equipamentos_Invernais), com confiança média e lacunas explícitas.

Grau Físico: encantos **311449–311453**. Grau Mágico: **311454–311458**. Ambos usam a posição interna **1** (slot `{2}` da wiki), e **não** representam grau D/C/B/A do equipamento. Para evoluir, exige-se o encanto anterior no mesmo slot.

| Material | Aplicar 1 | 1 → 2 | 2 → 3 | 3 → 4 | 4 → 5 |
| --- | --- | --- | --- | --- | --- |
| Extrato Radiante 1001036 | 60 | 30 | 40 | 50 | 65 |
| Extrato Brilhante 1001035 | 40 | 20 | 30 | 40 | 50 |
| Extrato 1001034 | 30 | 15 | 20 | 30 | 40 |
| Extrato Glacial 1001037 | 50 | 25 | 35 | 45 | 70 |
| Cristal Corrompido 1001031 | — | 5 | 7 | 10 | 15 |
| Cristal Purificado 1001032 | — | 5 | 7 | 10 | 15 |
| Magia Corrompida 1001033 | — | — | 1 | 2 | 3 |

As dez operações regionais preservam `success: null` e consequências de falha desconhecidas: a tabela regional fornece custos, sem declarar essas condições de forma suficiente. Os custos foram comparados aos dez registros extraídos separadamente do rAthena. A garantia determinística da implementação rAthena fica somente na referência genérica, sem ser promovida a LATAM.

Incinerador: três armas elegíveis, consumidas, com dez tipos de retorno possíveis e intervalos publicados, sem pesos presumidos. O agrupamento dos resultados permanece `unknown`; não se promete receber todos os materiais nem se supõe distribuição uniforme. Pré-requisito de missão e a divergência de coordenadas 192,57/192,58 continuam explícitos. A referência ao item **101639**, Combinador Vil Invernal, não foi confundida automaticamente com esse NPC ou com uma receita de saída: o espelho fornece apenas vínculos parciais.

Duas trocas de materiais foram normalizadas: Pedra Purificada **1001030** por três Pedras Corrompidas **1001029** + cinco Pétalas **1000608** + 25 Fragmentos de Ametista **1000405**; e Cristal Corrompido **1001031** por 15 Pedras Corrompidas + 30 Pétalas + 150 Fragmentos de Ametista. Outros caminhos podem ser adicionados pela mesma curadoria, sem estimar tempo de farm.

### Sombrio de Pedras Preciosas

Preservados os quatro IDs **24675–24678**, os dois pares independentes, as condições de soma de refinos e a lacuna funcional de dispensa de gemas no motor. Nenhuma fórmula ou chave de bônus foi alterada.

A sucessora `truegem-combine-v2` estrutura os seis materiais +7 escolhidos entre **nove IDs locais**, e os quatro resultados alternativos com chance desconhecida. A regra anterior continua no histórico. Repetições de materiais, oferta atual e pesos continuam pendentes. O RagnarokDB não possui os registros selecionados dessa família neste recorte; isso não elimina o catálogo interno nem invalida equipamentos existentes.

## Fontes complementares e curadoria pendente

O importador rAthena da Fase 1 foi estendido com `--enchant` para restringir a seleção 47 aos dez resultados de Grau. Ele preserva fontes e IDs e falha se o filtro não encontrar operações; não recua silenciosamente para importar todas as opções. O recorte fica em `rathena-glacier-experimental.v1.json`. Source IDs incluem a seleção, evitando colisão entre recortes distintos do mesmo YAML.

```powershell
python tools/import-acquisition.py --kind enchant --input caminho/item_enchant.yml --select 47 --enchant Physical_Grade_1 Physical_Grade_2 Physical_Grade_3 Physical_Grade_4 Physical_Grade_5 Magical_Grade_1 Magical_Grade_2 Magical_Grade_3 Magical_Grade_4 Magical_Grade_5 --revision d4b8e7b8f16061cc2496d377ac8f777ce72a4f39 --retrieved-on 2026-11-05 --output .tmp/rathena-glacier-candidates.json
```

`item_reform.yml` continua útil para conversões e preservação de propriedades; a estrutura equivalente de 26 reformas já entrou via RagnarokDB. `refine.yml` (`REFINE_DB` v2) e `enchantgrade.yml` (v3) foram auditados na Fase 1 e continuam fora da importação automática: exigem política de NPC, proteção, catalisadores e exceções regionais. Não converter tabelas genéricas em rotas confirmadas só por uma arma estar no cliente.

Pendências manuais concretas:

1. Confirmar relações de drop das armas por monstro/mapa e probabilidades LATAM, sem reutilizar taxas provisórias do outro projeto como evidência medida.
2. Confirmar chances/falhas das evoluções de Grau, agrupamentos/pesos do Incinerador, pré-requisitos e funcionamento do Combinador Vil Invernal.
3. Revisar os 110 vínculos de sistemas/recipientes/ferramentas antes de completar procedimentos; muitos referenciam conteúdo de outros períodos/servidores.
4. Confirmar disponibilidade e resultados dos Sombrios, caixas e combinador; preservar efeitos funcionais já documentados, incluindo consumo de gemas.
5. Continuar a revisão dos materiais iniciais/saída do evento Temporal e da divergência de pools identificada na Fase 1. Nada disso autoriza ampliar mecanicamente pools nesta entrega.

Licenças e versões continuam em cada fonte. rAthena declara GPL-3.0-or-later; dados derivados conservam essa atribuição, sem afirmação de relicenciamento MIT. A licença de redistribuição de Divine Pride/bROWiki não foi confirmada: este recorte contém fatos normalizados, não artigos completos, imagens ou scripts. Ver obrigações antes de publicar/distribuir artefatos; esta entrega é local e não fez deploy.

## Consultas compartilhadas e próxima integração

`src/app/build-analysis/acquisition/query.ts` expõe `queryAcquisition` por item/encanto ou monstro, com servidor/data/aspecto. Retorna rotas efetivas, fontes completas, requisitos e referências diretas de dependências. `dependencies` é um índice de IDs para navegação; **não significa que todas as alternativas sejam exigidas simultaneamente**. A semântica de consumo/alternativas/quantidades está em `requirements`.

```ts
queryAcquisition({ itemId: 600030, server: 'LATAM', asOf: '2026-11-05' });
queryAcquisition({ monsterId: 21526, server: 'LATAM', asOf: '2026-11-05' });
queryAcquisition({ itemId: 311453, server: 'LATAM', asOf: '2026-11-05', aspect: 'enchant' });
```

`assessAcquisition` reutiliza essa consulta e a mesma seleção de revisões/disponibilidade. Assim, histórico, rotas expiradas e distinção genérico/LATAM têm um único dono. A consulta não acessa arquivos externos, DB ou rede, não estima mortes por hora e não realiza análise probabilística no loop de avaliação.

Próxima fase proposta, sem execução nesta entrega:

1. Acrescentar relatório opt-in aos adaptadores existentes de `build-analysis/operations`, MCP e browser, resolvendo BuildInput uma vez e reaproveitando `queryAcquisition`/`assessAcquisition`.
2. Mostrar requisitos, alternativas, chance desconhecida e proveniência em fichas de item/monstro da UI; confirmar com o usuário a posse anterior quando necessário.
3. Anexar o relatório aos finalistas do Optimize **após** o ranking atual. Não executar esta consulta ou simulações de aquisição no loop de dano.
4. Só depois de cobertura suficiente, discutir preferências de aquisição e composição de cadeias. Sem mercado, zeny/hora, tempo de farm ou quantidade de monstros mortos por hora.

## Verificação

Testes de snapshot Python cobrem seleção, slots repetidos, leitura sem mutação, taxas manuais e export determinístico. Testes TypeScript cobrem normalização, unidades, `null`/0/100%, IDs inválidos, fallback regional, conflitos, preservação de confirmados, histórico, importação real, idempotência e curadoria. Testes de CLI verificam dry-run, aplicação, repetição byte a byte, arquivo inválido e lock de escritor. As três famílias têm provas dos IDs/pools, custos cruzados com rAthena, alternativas de extração e evento expirado.

```powershell
node node_modules/vitest/vitest.mjs run src/app/build-analysis/acquisition tools/import-ragnarokdb-acquisition.spec.ts src/app/core/sp-cost-combo-refine.spec.ts src/app/utils/can-grade.spec.ts mcp/src/engine/validate-build.spec.ts
python tools/export-ragnarokdb-acquisition.spec.py
python tools/import-acquisition.spec.py
```

Resultado executado em 05/11/2026: **74 testes TypeScript em sete arquivos passaram**, incluindo as três suítes de regressão existentes; **cinco testes Python do exportador e nove do importador passaram**. A checagem TypeScript focada em `src/app/build-analysis/acquisition` e suas dependências também passou (`tsc --noEmit`, configuração local `.tmp/acquisition-tsconfig.json`). Logs locais: `.tmp/acquisition-phase2/final-tests.log` e `final-types.log`. A prova de reprocessamento real preservou os bytes/SHA do catálogo nas três entradas.

O typecheck amplo tinha erros fora desta frente documentados na Fase 1 e não foi reexecutado; não é substituído pela checagem focada. Não houve build completo, benchmark, commit, push ou deploy.
