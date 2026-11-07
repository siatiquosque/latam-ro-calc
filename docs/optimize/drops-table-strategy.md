# Estratégia para drops na base de aquisição

Implementada em 2026-11-07 na branch `perf/optimize-memory`. Medido no Windows com Node 22.9 e na cópia local da RagnarokDB.

## Problema

Importar drops pelo pipeline atual transforma cada relação item/monstro em uma rota completa. Rotas servem para procedimentos com requisitos, etapas e revisão regional. Um drop é só item, monstro, mapa e taxa.

| Formato para as 16.269 linhas de `mob_drops` | Tamanho | Heap | Carga |
| --- | --- | --- | --- |
| Rotas completas | 18,2 MB de JSON | 29,8 MB | 202 ms |
| Tabela em colunas com índice por item | 283 KB (47 KB em gzip) | 1,24 MB | 5 ms |

A linha de rotas é um piso: não inclui as fontes por monstro nem a cópia feita por `knowledgeSchema.parse`. Para comparação, `latam.v1.json` ocupa 8,9 MB de heap e `item.json` ocupa 30,2 MB.

O import também é lento porque `reviseKnowledge` e `effectiveRoutes` usam buscas lineares dentro de laços. Um lote de 256 itens passou de 10 minutos sem terminar.

## Decisão proposta

Criar `data/acquisition/drops.v1.json`, uma tabela em colunas gerada a partir da RagnarokDB, carregada junto do catálogo e indexada por item e por monstro. SQLite não é necessário nesse volume. `latam.v1.json` continua dono das rotas com procedimento.

`queryAcquisition` passa a montar a rota de drop sob demanda, só para o item ou monstro consultado. Assim `assess`, `brief`, o painel de aquisição e o MCP seguem com o mesmo contrato. As 285 rotas de drop que já existem migram para a tabela, exceto as que tiverem revisão regional.

Todo drop gerado continua `server: generic`, `review: unreviewed` e `confidence: low`. Nenhum monstro da cópia local traz LATAM em `availableServers`, então a tabela não pode afirmar disponibilidade regional.

## Efeito por área

- **Memória da VPS:** cerca de 1,2 MB a mais, contra pelo menos 30 MB no formato de rotas. Retirar as rotas de drop atuais reduz um pouco o catálogo.
- **Optimize:** nenhum ganho de velocidade direto. A busca filtra candidatos só pela flag `latam` e usa a aquisição depois da busca, no `brief`. Um filtro futuro de itens obteníveis poderia reduzir candidatos, mas é uma mudança de comportamento e ainda não foi medido.
- **Calculadora web:** o painel de aquisição passa a responder para muito mais itens. O custo é de 47 KB em gzip no chunk já carregado sob demanda pelo worker. O carregamento inicial não muda.
- **MCP:** as ferramentas de aquisição ganham a mesma cobertura sem mudar de contrato. O bundle da VPS cresce cerca de 283 KB.

## Compatibilidade com o upstream

`src/app/build-analysis` e `data/acquisition` não existem no upstream, então a mudança fica nessas pastas e não gera conflito. Ela não altera `item.json`, `data-manifest`, `src/app/core` nem o formato de item, que são arquivos do upstream.

Hoje 16 arquivos mudaram nos dois lados desde a base comum, e `main` está 20 commits atrás de `upstream/main`. A sincronização segue a skill `sync-upstream`. Falta só um passo nela: depois do merge, um teste compara os IDs da tabela com o índice de itens e relata os que deixaram de existir, sem bloquear a sincronização.

## Resultado

- `data/acquisition/drops.v1.json`: 16.752 drops de 3.510 itens e 2.279 monstros, 352 KB (colunas esparsas para canal, mapa e quantidade). Gerado por `tools/export-ragnarokdb-drops.py`, somente leitura, a partir dos itens e monstros que a calculadora conhece.
- `src/app/build-analysis/acquisition/drops.ts` define o contrato e monta a rota de um drop sob demanda. `queryAcquisition` soma essas rotas às do catálogo e não duplica um fato que o catálogo já tem pela mesma `importKey`.
- As rotas de drop do catálogo que a tabela reproduz exatamente (91 de 93) saíram de `latam.v1.json`, junto com 50 fontes que ficaram sem uso. As 2 restantes pertencem a uma cadeia de revisão (Ragnaplace) e continuam no catálogo.
- `effectiveRoutes`, `reviseKnowledge` e o merge do importador usam mapas por ID em vez de buscas lineares.
- O chunk de aquisição do worker foi de menos de 2,1 MB para 2,13 MB (`acquisitionChunkError` passou de 2.100.000 para 2.200.000). O bundle da VPS foi de 9,28 MB para 9,50 MB.
- Sonda de carga com `--max-old-space-size=256`: RSS aquecido 148 MB (antes 147), pico 297 MB com uma busca e 306 MB com três (antes 290 e 308). A tabela não mexeu na memória medida.
- Smoke no bundle da VPS: `get_acquisition` do item 4001 (Carta Poring) devolve os drops por monstro, com a fonte da tabela.

Os drops continuam `unreviewed` e `generic`: nenhum monstro da cópia local traz LATAM em `availableServers`, então a tabela não confirma disponibilidade regional.

## Como atualizar

```
RAGNAROK_DB=<ragnarok.db> python tools/export-ragnarokdb-drops.py --project D:/Developer/RagnarokDB --assets src/assets/demo/data --output data/acquisition/drops.v1.json
```

Rode depois de um sync com a RagnarokDB ou quando `drops.spec.ts` acusar IDs que a calculadora não conhece mais (por exemplo, depois de sincronizar com o upstream). O arquivo não muda se o conteúdo for o mesmo.

## Pendências

- `mob_drops` não traz o canal do drop, então o gerador lê `raw_json`.
- As medidas de memória não foram repetidas em Linux com Node 24.
- Ainda não há filtro de "itens obteníveis" na busca do Optimize. Seria uma mudança de comportamento e precisa de medição própria.
