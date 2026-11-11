# Levantamento LATAM de 2026-11

Gerado em 2026-11-06 a partir da base do simulador, da base de conhecimento `data/acquisition/latam.v1.json` e de uma cópia somente leitura dos links salvos na VPS. Os CSVs usam `;` e UTF-8 com BOM, para abrir direto no Excel.

| Arquivo | Linhas | O que é | O que fazer |
| --- | --- | --- | --- |
| `encantos-nao-latam.csv` | 1130 | Encantamentos que o sistema considera fora do LATAM: 1092 fora da lista LATAM e 38 em pré-lançamento. | Preencher `existeNoLatam` com `sim` ou `nao`. |
| `encantos-sem-metodo.csv` | 878 | Encantamentos LATAM sem rota de obtenção na base. | Priorizar os usados em builds (`buildsVPS`). |
| `itens-sem-metodo.csv` | 7511 | Itens LATAM sem rota de obtenção; `temPoolDeEncanto` indica se têm encantamentos. | Priorizar os usados em builds (`buildsVPS`). |
| `ragnarokdb-sync-prioridade.csv` | 5281 | IDs dos três levantamentos que o RagnarokDB ainda não tem. Prioridade 1: encantamentos fora do LATAM e itens usados em builds. Prioridade 2: encantamentos sem rota. Prioridade 3: demais itens. | Sincronizar por prioridade, se aprovado. |

Comece por `buildsVPS` maior que zero e por `pecasQueOferecem` alto: são as linhas que mais mudam o resultado do Optimize. Em `encantos-nao-latam.csv`, 1059 linhas são oferecidas por alguma peça e 5 aparecem em builds da VPS. Essas 5 são evidência fraca, porque as builds podem ter vindo do próprio Optimize. Nenhuma linha contradiz uma rota da base de conhecimento.

## Sincronização do RagnarokDB em 2026-11-06

Os 1627 IDs das prioridades 1 e 2 foram sincronizados com o DivinePride. O campo `availableServers` deu este resultado:

- `encantos-nao-latam.csv`: nenhum dos 1130 lista LATAM, o que confirma o sistema. A coluna `servidoresDivinePride` mostra onde cada um existe, e a coluna `existeNoLatam` só precisa de revisão em caso de dúvida pontual.
- `encantos-sem-metodo.csv`: os 878 listam LATAM, o que confirma que existem no servidor e só falta a rota. Nenhum tem drop registrado no RagnarokDB.
- `itens-sem-metodo.csv`: 3857 listam LATAM e 3654 continuam fora do RagnarokDB (prioridade 3, não sincronizada). 2223 têm drop registrado, 1711 deles em monstro com spawn conhecido, e 31 desses são usados em builds da VPS.

`availableServers` é a informação do DivinePride, não uma confirmação do servidor oficial. Drops do RagnarokDB ainda não entraram na base de conhecimento.

## Cobertura de aquisição dos itens da calculadora (2026-11-07)

`itens-aquisicao.csv` classifica os 11.784 itens de `item.json`. Situação: `latam` (está na lista do cliente LATAM), `prerelease` (marcado `preRelease` na calculadora) ou `other-server` (de outro servidor, sem previsão; ignorar). `origensConhecidas` junta as origens que existem hoje: rota curada, drop (tabela `drops.v1.json`), contêiner de cash, como ovos e caixas (`containedIn` da RagnarokDB), loja, Lapine e decomposição. `lacuna` marca item LATAM sem nenhuma origem conhecida.

| Situação | Na RagnarokDB | Com origem | Lacuna |
| --- | --- | --- | --- |
| latam | sim | 3.475 | 1.481 |
| latam | não sincronizado | 348 | 3.653 |
| prerelease | sim ou não | 0 | 339 (a tratar como prévia) |
| other-server | sim ou não | 102 | ignorados (2.488) |

Leitura: 3.653 das lacunas existem porque o item ainda não foi sincronizado na RagnarokDB (a fila tem 16.244 pendentes). As 1.481 restantes já foram sincronizadas e não têm drop, contêiner, loja nem troca nessa fonte: dependem de BroWiki, Hazy Forest, iRO Wiki ou Divine Pride.

Contêineres de cash: a RagnarokDB traz `containedIn` com `chance` (em centésimos de ponto percentual) e `count` para 4.534 itens. Uma tabela de contêineres, no mesmo formato em colunas dos drops, cobriria as chances dos ovos e caixas sem criar rotas.
