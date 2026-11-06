# Acquisition Knowledge Base — Fase 4.1

Data: 2026-11-05. Nada foi commitado, enviado, publicado, implantado ou escrito no NAS/VPS. Optimize, fórmulas e ranking não foram alterados. Todas as rotas novas entram com `review: reviewed`/`unreviewed`, `period.known: false` e, portanto, evidência `unconfirmed` e `insufficient`: nenhum procedimento foi contado como totalmente verificado e nenhuma regra bROWiki/rAthena virou confirmação de implementação no LATAM.

## 1. Fontes pesquisadas e resultado

| Fonte | Resultado |
|---|---|
| bROWiki `Equipamentos_Automatron` (rev. registrada na fonte `browiki-automatron-<oldid>`) | 47 Automódulos (M-ATQ, P-Bárbaro, P-Geral, B-VIT, M-HPMax, P-Robusto…) × 3 posições, troca dos equipamentos Automatron e limite por peça. Aplicação 100%; o módulo em si sai de sorteio (`automatron-module-exchange-v1`). Os 51 módulos H- (habilidade/classe) foram incluídos no fechamento da fase (seção 8). |
| bROWiki `Equipamentos_Invernais` | Armaduras e acessórios (Flor Invernal) e Armas Vis Invernais (Cristais de Dano/Utilidade/Atributos). Custos de Globo marcados como não confirmados. |
| bROWiki `Cinzentos` (Lobo Cinzento) | Compra das peças, custo por slot (100.000 z + 15 / 150.000 z + 25 / 200.000 z + 50 Ametistas) e chance exata por Orbe Lupino. Duas linhas repetidas na página (Capas slot 3 INT 3, Acessórios slot 2 SPR 4); a primeira ocorrência foi mantida. |
| bROWiki `Encantamento` | Mecânica geral e pools (Ziki, Primordial, Ancestral, Sombrio, Brotos Temporais) sem chances por opção. **Pesos uniformes não foram assumidos**; pools ficam fora das rotas até haver chance. |
| rAthena `db/re/item_enchant.yml`, `item_reform.yml` | Consultados. A armadura Automatron (`Id: 44`) tem custo extra BarMealTicket ×25 no rAthena, ausente no bROWiki LATAM: mantida só como documentação, sem rota. |
| ragnaplace (laRO PT) | Confirma o drop da carta 300076 (monstro 20639, 0,01%, patch 2026-10-29). |

Procedência das páginas bROWiki: `wgRevisionId`, data de última edição e sha256 do HTML gravados na fonte de cada rota.

## 2. Regras realmente adicionadas (catálogo 359 → 1038 rotas)

- Curadoria direta (`data/acquisition/curation/phase41-browiki.v1.json`, gerada por `tools/build-browiki-acquisition.py`): **633 rotas** — 305 Automatron (inclui os H-), 127 Invernais, 201 Cinzentos. Revisão `latam-acquisition-phase41-2026-11-05`, 98 fontes no catálogo.
- Importação RagnarokDB: **+45 rotas de drop** (ver seção 5). 0 rotas alteradas ou perdidas (verificado comparando com o backup).
- Chance de Orbe Lupino = chance da orbe no sorteio do slot, não sucesso de aplicação.

## 3. Auditoria refeita (mesmas 37 configurações, 143 componentes únicos)

| Classe | Fase 4 | 4.1 |
|---|---|---|
| Encantamentos com procedimento documentado | 3 / 44 | 21 / 44 |
| Itens com rota documentada | 26 / 96 | 41 / 96 |
| Itens sem informação | 70 | 55 |

Documentados nesta rodada (todos `unconfirmed`, `insufficient`): B-VIT, M-ATQ, P-Bárbaro, P-Geral, M-HPMax, P-Robusto; Orbes Lupinos (AGI 1, Fatal 2/4, Triplo, Artilheiro 2, Mira 4, FOR 3); Flor Invernal (Gemini, Atirador); Cristal Invernal (Raça Física, Propriedade Física, ATQ). Dos 21 encantamentos documentados, só 3 (Insígnias Temporais) têm rota confirmada; os outros 18 estão pendentes de confirmação LATAM.

- **Rotas confirmadas:** apenas as Insígnias dos Diademas Temporais e os itens já revisados.
- **Parcialmente documentadas / pendentes de confirmação LATAM:** todas as novas (Automatron, Invernais, Cinzentos) e os drops do RagnarokDB.
- **Problemas de conciliação resolvidos:** os seis drops recusados (seção 5).

## 4. Regras preparadas para o RagnarokDB e diffs pendentes de aprovação do NAS

Nada foi escrito no RagnarokDB. O RagnarokDB não tem representação adequada para essas famílias (procedimentos de encantamento por posição com custos e chances), então elas foram registradas direto na KB. Não há diff pendente de gravação no NAS: o que o RagnarokDB já cobre foi importado dele em modo leitura. Se for desejado enriquecer o RagnarokDB (por exemplo os 25 itens do escopo que ele não possui), isso é uma proposta separada que depende da sua aprovação explícita.

## 5. Os seis drops recusados

Causa raiz: o importador usava `monster.json` (estatísticas mecânicas, 537 monstros) como autoridade de identidade do monstro. Identidade não precisa de estatísticas: a lista do cliente (`latam-monsters.json`, 4170 entradas) agora também vale como identidade em `tools/import-ragnarokdb-acquisition.mjs`. Os monstros continuam não simuláveis pelo motor, mas o conhecimento de aquisição é preservado.

| Carta | Monstro(s) | Situação |
|---|---|---|
| 4392 | 1700, 2726 | Drop importado (`unreviewed`), chance 1/10000 e 1/2000 |
| 4393 | 1701, 2665 | idem |
| 4582 | 2309 | idem |
| 4608 | 20390, 20391 | idem |
| 4609 | 20388, 20389 | idem |
| 300076 | 20639 (Guarda Quebrada) | Drop importado, 1/10000, corroborado externamente por ragnaplace; ainda `unreviewed`, LATAM não confirmado |

A mesma correção liberou outros 35 drops (monstros 2832, 20575, 20578, 21061–21063, 21588, 21853, 21854, 21980), também `unreviewed`. Nenhum foi tratado como confirmado.

## 6. Testes

- `vitest` em `src/app/build-analysis/acquisition`, `mcp/src/tools` e `tools/import-ragnarokdb-acquisition.spec.ts`: 13 arquivos, 181 testes passando (3 novos em `assess-cases.spec.ts`: rota Automatron por posição, ausência em outra posição, os seis drops).
- `tsc` (`worker/tsconfig.json` e `tsconfig.backend-tests.json`): sem erros.
- Auditoria: `PHASE4_TAG=after41b` (`.tmp/acquisition-phase4/after41b.json`).
- Ver seção 8 para os specs Python e o teste do gerador (executados no fechamento).
- Backups: `.tmp/acquisition-phase41/backup/` (pré-4.1) e `backup-pre-rdb/` (antes da importação RagnarokDB).

## 7. Próximas lacunas sem fonte verificada

- 23 encantamentos sem procedimento: S-ATQ (29534) e S-HPMax (29531) (Orbes de Modificação), Atributo +N (4702–4704, 4721, 4732, 4744), POD +3 (312189), Joia Temporal SOR 3, Espírito do Lutador 5/7, Orbe Lupino Artilheiro 1/3, Delírio, Fatal 3, Memory Fragment (Hope), Insígnia da Dedicação 3, DES Ancestral/Primordial, Cristal (Sentença), Cristais de Issgard (Bárbaro/Guerreiro). Fontes potenciais: bROWiki de cada sistema, notícias oficiais GNJOY LATAM, validação em jogo.
- Chances por opção dos pools de Encantamento (Ziki, Primordial, Ancestral, Sombrio, Brotos): sem fonte; pesos não serão assumidos.
- Custos de Globo das Armas Vis Invernais e custos por classe: não confirmados.
- 55 itens sem origem e confirmação LATAM (período, disponibilidade atual) de todas as rotas novas.

## 8. Fechamento da fase (2026-11-05)

**Carta 300076.** A RagnaPlace (laRO PT) entrou como fonte `ragnaplace-laro-pt-item-300076-20261105` (URL, patch 2026-10-27, sha256 do HTML salvo, licença não confirmada) por uma revisão da rota já importada (`supersedes`), em `data/acquisition/curation/phase41-ragnaplace-300076.v1.json`. Nenhuma rota foi duplicada: a consulta devolve uma rota efetiva, com 2 fontes, monstro 20639, 1/10000, `review: unreviewed` e disponibilidade `unknown`. Reaplicar o arquivo não muda nada, e a reimportação do RagnarokDB também não.

**Automódulos H-.** Compartilham o procedimento dos demais: a bROWiki descreve uma única troca (63 Vale Varmida, Upsilon) e a aplicação pela Liza. A página lista **51 módulos H-**; o número 17 da auditoria vinha de uma contagem de 64 módulos que não era a da página (98 no total). Representação, sem refatoração de contratos:
- `automatron-module-exchange-v1` passou de 47 para 98 saídas, todas com `chance: null` e `outputSelection: one`. Nenhum peso uniforme foi assumido.
- 153 rotas de encantamento (51 módulos × posições 1–3), alvo restrito ao Colete (450127/450128), com o limite por peça da página.
- A classe associada fica num requisito `procedure` (o contrato não tem requisito de classe). A página não diz se a aplicação é bloqueada para outras classes, e isso consta nos desconhecidos.
- O catálogo foi regenerado a partir do backup pré-4.1, pois a rota de troca já publicada mudou (`ID imutável`). Resultado: 884 → 1038 rotas, 0 perdidas, 1 alterada (a troca compartilhada, por ganhar saídas).

**Validação.**
- `tools/export-ragnarokdb-acquisition.spec.py`: 5 testes OK. `tools/import-acquisition.spec.py`: 9 OK. `tools/build-browiki-acquisition.spec.py` (novo): 3 OK — rowspan de classe, rota de troca única sem chances, determinismo, proveniência, ids sem duplicação e recusa de H- sem classe.
- Regerar a curação a partir das páginas salvas dá um arquivo **idêntico byte a byte**; reaplicar dá `added: 0, unchanged: 633`.
- `phase41.spec.ts` (novo, 5 testes): ids únicos, uma rota efetiva por `importKey`, fontes com sha256, `period.known: false` em todas as rotas bROWiki, troca compartilhada, H- só no Colete, 300076.
- `vitest` (acquisition, mcp/tools, importador): 14 arquivos, 186 testes OK. `tsc` worker e backend-tests sem erros. `get_acquisition` verificado pelos testes do MCP e por chamadas reais (seção 4 do documento de integração).
- Problema real encontrado e corrigido: arquivo aberto sem fechar no gerador (`ResourceWarning`).
- Alerta: o catálogo subiu para 3,16 MB (era 0,9 MB antes da Fase 4.1). Ele é carregado sob demanda, mas convém conferir o limite de tamanho do bundle do Worker antes de publicar.

**Pendências restantes** (sem fonte nova): as 23 da seção 7, mais a confirmação LATAM de todas as rotas novas.
