# Acquisition Knowledge Base — Fase 4 (revisada)

Data da auditoria: 2026-11-05. Nada foi commitado, enviado ou publicado. O RagnarokDB foi usado **somente para leitura**.

## 1. Auditoria focada

Amostra: 37 configurações (builds de bench b1/b2/weak, resultados de `optimize_build` e `scan_slot`, fixtures Inquisidor e as quatro builds Jor_ab02). Contadas por **componente único** (item/carta/encantamento), não por repetição: 143 componentes únicos (96 itens, 44 encantamentos, 3 refinos). Reprodução: `acquisition-phase4.bench.spec.ts` (`BENCH=1`, `PHASE4_TAG`); resultados em `.tmp/acquisition-phase4/{before,afterA}.json`.

| Classe | Antes | Depois |
|---|---|---|
| Drop conhecido (rota de drop documentada, LATAM não confirmado) | 0 | 24 |
| Item com rota não-drop (reforma/troca) | 2 | 5 |
| Item sem informação de origem | 94 | 70 |
| Encantamento com procedimento documentado | 3 | 3 |
| Encantamento com procedimento incompleto | 0 | 0 |
| Encantamento sem procedimento | 41 | 41 |

Ausência de rota continua significando "sem informação", nunca "impossível" (testes `assess-cases.spec.ts`).

## 2. Origem dos dados

**Caminho A (RagnarokDB já tem o contrato)** — 61 IDs da amostra existiam no RagnarokDB. Foram acrescentados a `data/acquisition/import-scope.v1.json` (75 → 136) e importados pelo pipeline da Fase 2 (exportador read-only → `transformRagnarokSnapshot` → `mergeImportedKnowledge`): **+45 rotas** (drops e reformas de Invernais), 0 enriquecidas, 223 inalteradas. Rotas entram como `unreviewed`, com a fonte Divine Pride/RagnarokDB e sem confirmação LATAM.

Seis cartas têm drop no RagnarokDB mas seus monstros não existem em `monster.json` do LATAM; o importador as recusou (`unknown_or_mismatched_monster`): 4392, 4393, 4582, 4608, 4609, 300076. Não foram forçadas.

**Nada foi escrito no RagnarokDB.** Ele fica no NAS, fora de git e com lock de escrita; alterá-lo é uma ação externa e difícil de reverter. Os itens ausentes dele (79 de 140) precisam de uma fonte nova antes de qualquer sync, e essa fonte não foi encontrada (ver abaixo).

**Caminho B (regra direta no LaRo Calc)** — nenhuma regra registrada. Buscas web (notícias oficiais, wikis) não trouxeram procedimento, opções ou chances verificáveis para as famílias M-ATQ/S-ATQ/S-HPMax/B-VIT, P-Bárbaro/P-Geral, Orbes Lupinos, Cristais Invernais/Issgard nem origem dos equipamentos Sombrio/Temporal/-LT. As descrições do cliente trazem só os efeitos. Sem fonte, ficam como desconhecido em vez de inventadas.

## 3. Famílias de encantamento

| Família | Situação |
|---|---|
| Insígnias dos Diademas Temporais | Documentadas (Fases 1–2): níveis, materiais, chances, evento. |
| Chapéus Memoráveis | Item `18979` com rota; encantamento sem procedimento. |
| M-ATQ, S-ATQ, S-HPMax, B-VIT, P-Bárbaro, P-Geral, P-Robusto, M-HPMax | **Sem procedimento** (não estão no RagnarokDB como itens; sem fonte). |
| Vis Invernais (Coroas, Armadura, Varinha, Soqueira, Mangual, Báculo) | Referências de reforma e de caixa do RagnarokDB importadas; materiais de reforma sim, chance de encantamento não. |
| Cristais Invernais / Issgard, Flores Invernais | Referenciados no RagnarokDB (enchantSystems) mas sem procedimento (`reference_without_procedure`: 133 no total). |

## 4. Cobertura (escopo auditado, não catálogo)

- Itens únicos sem drop identificado antes: 94; com rota alternativa/drop agora: 24 (+3 reformas); ainda sem informação: 70.
- Famílias de encantamento com procedimento: 1 de 5 pedidas (Insígnias).
- Regras incompletas por falta de chance/requisito: 8 drops com `chance: unknown` (taxa provisória descartada) + todo encantamento sem procedimento.
- Importado do RagnarokDB: 45 rotas. Registrado direto: 0.

## 5. Conflitos e desconhecidos

- `aegis_conflict` (36): nomes Aegis do RagnarokDB diferem dos do cliente LATAM; mantido o do cliente.
- `map_probability_unit_unverified` (5): chances de drop de mapa sem unidade comprovada; não usadas como conhecidas.
- 184 taxas provisórias de `manual_drops.json` descartadas (desconhecido).
- 25 itens do escopo ausentes do RagnarokDB.

## 6. Testes

`vitest` em `src/app/build-analysis/acquisition`, `mcp/src/tools` e `tools/import-ragnarokdb-acquisition.spec.ts`: 13 arquivos, 176 testes passando antes dos 2 testes novos; `assess-cases.spec.ts` agora com 10 testes passando. `tsc` (worker e backend-tests) sem erros. Specs Python não rodadas. Backup do catálogo anterior: `.tmp/acquisition-phase4/backup/`.

## 7. Próximas lacunas

1. Fonte verificável (bROWiki/GNJOY/rAthena) para M-ATQ/S-ATQ/S-HPMax/B-VIT/P-*.
2. Equipamentos Sombrio, Temporal (-LT, Manto/Bota) e Lupino: origem desconhecida e ausentes do RagnarokDB — primeiro enriquecer o RagnarokDB (com aprovação), depois importar.
3. Cartas com monstros fora de `monster.json`: acrescentar os monstros LATAM correspondentes.
4. Revisão LATAM dos 24 drops `unreviewed`.
