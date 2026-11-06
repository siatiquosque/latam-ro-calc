# Optimize V1 — descoberta automática (04/11/2026)

Escopo: qualidade da descoberta de combinações de equipamento/cartas/encantamentos em builds reais equipadas, com restrições específicas e
orçamento previsível. Sem Beam/VNS, sem mudança de fórmula, catálogo ou do polish por DPS. Nada foi commitado, publicado ou implantado.

## 1. Travas por campo (`constraints.lockedFields`)

Contrato novo, aditivo (`goal-spec.ts`): lista de chaves do modelo (`weapon`, `weaponCard1`, `accRightEnchant2`, `weaponRefine`, `weaponGrade`…).
Travar carta/encantamento/refino/grau fixa também a peça usada (só fazem sentido nela); travar o item (`weapon`) proíbe a troca, mas refino, grau
e soquetes seguem livres. `lockedSlots` continua congelando o slot inteiro e combina com `lockedFields`.

Todos os caminhos respeitam a trava (`optimize.ts`): descoberta (slot fixado ao item usado, sem trocas de parceiros de conjunto), refino/grau do
movimento, complementos (escolhas que tocam campo travado são filtradas), polish final de soquetes (campo excluído), MVP estrito, e o juiz
`lawful` (`constraintViolations` → `LOCKED_FIELD_CHANGED`). Testes: `mcp/src/engine/field-locks.spec.ts` (8), escritos antes da implementação;
controle sem trava prova que a busca mexe nos campos (os testes não passam por vacuidade).

## 2. Auditoria do gerador de candidatos (`instrument: true` → `candidateAudit`)

`engine/candidate-audit.ts`: contagens de candidatos **distintos** (conjuntos; cache hit e movimento repetido não contam duas vezes), por slot:
`catálogo = excluído (unavailable/mvp) + não relevante + elegível`; `elegível = cortado pela cota de triagem + cortado pelo score cru + no pool`;
`pool = avaliado + não avaliado`; `avaliado = rejeitado + aceito`. Por campo (carta/encantamento): legais, oferecidos, tentados, travado.
Slots não pesquisados (travados / fixados) aparecem à parte, nunca como falha de descoberta. `knownCandidates` (só instrumentação) devolve o destino
de cada candidato de referência: `unavailable`, `mvp`, `notRelevant`, `screenCut`, `bareCut`, `pooled`, `evaluated`, `accepted`,
`notLegalOnTheAnswerPiece`, `tried`, `legalNotTried`, `legalNotOffered`, `slotLocked`, `fieldLocked`. Testes: `candidate-audit.spec.ts` (4).
Sem `instrument` nada é registrado no relatório (a lógica de busca não muda; o teste `instrumenting changes nothing` compara os dois).

## 3. Benchmark de descoberta (`optimize-discovery.bench.spec.ts`, `DISCOVERY_BENCH=1`)

Casos (todos equipados): `jor-original` e `jor-restricted` (início `gear-only`, regras do estudo; o segundo com travas exatas da Insígnia e do
Cordão); `meister` (`weak` → referência `b1`, mesmo personagem com o conjunto completo; Third Flame Bomb, física, outra classe, 3 golpes com
10% de folga em 4 monstros); `magus` (Magus com o equipamento real de `b1`, Cajado Arcanista do Éden +12, 20 golpes em 3 monstros; **não há build
mágica equipada no repositório**, então não existe solução de referência: mede cobertura e viabilidade); `meister-sets` (arma e escudo travados:
o ganho precisa vir de armadura/capa/bota/chapéus/acessórios). Dados: `docs/benchmarks/optimize-discovery/discovery-300-800.json` e `discovery.json`
(2000/4000).

| Caso | 300 | 800 | 2000 | 4000 |
| --- | --- | --- | --- | --- |
| jor-original | viável, 36,2M | viável, 47,0M | viável, 59,2M | viável, 74,6M |
| jor-restricted | viável, 36,2M | viável, 46,4M | — | — |
| meister (DPS ref. `b1` 79,1M) | inviável, dist. 0,50 | inviável, 0,24, 43,5M | **viável, 77,3M** | viável, 116,3M |
| magus | viável, 93 mil | viável, 318 mil | — | — |
| meister-sets | inviável, 0,72 | inviável, 0,69 | inviável, 0,06 | **viável**, 68,4M |

Tempo: 4–14 s (300–800), 25–34 s (2000), 50–65 s (4000). Avaliações únicas ≈ contadas + 16 (baseline e verificações finais). Peças mudadas: 8–27
a 300–800.

### Cobertura real (800, jor-original; demais casos no JSON)

Por slot: catálogo 58–418 peças; 37–231 não relevantes; elegíveis 21–187; triadas cruas 15–24 (cota de triagem); no pool 13–21; avaliadas
1–11; aceitas 1. Ex.: `headUpper` 418/231/187/17/17/7; `armor` 175/79/96/16/14/1. Exclusões por regra: só Casaco Pirata (garment). Campos: ex.
`weaponCard1` 301 legais, 130 oferecidos, 121 tentados; `armorEnchant1` 55 legais, 4 oferecidos.

## 4. Análise de lacunas (categorias do pedido)

- **Referências do `jor` (Armadura Invernal):** Bota Física do Éden II e Coleira de Espinhos estão no pool (cat. 4 em 300: movimento disponível,
  não explorado); a 800 a coleira é aceita, a 2000 a bota é avaliada, a 4000 a coleira é aceita. A armadura da referência é `screenCut` a 300/800
  e `pooled` a 2000 (cat. 3→4). As cartas/encantos de referência são `notLegalOnTheAnswerPiece`: dependem de outra peça (cat. 6, dependência entre
  ≥2 movimentos) — só se alcançam trocando a peça junto.
- **Meister:** `b1` difere de `weak` em arma + 2 cartas de arma + peças de sombra/fantasia. Arma avaliada e não aceita com o mesmo orçamento (a
  busca achou outra melhor); a 2000 atinge 77,3M (≈ referência 79,1M) e viabilidade, a 4000 supera a referência (116M). Os slots de sombra
  (6 slots, 12 no pool cada) **não são avaliados** em 300–800 (no `meister`) e a partir de 2000 entram.
- **Causa do que falta a 300–800 com vários alvos (cat. 7, orçamento):** `slotLog` do meister@800: a rodada de ajuste gasta 243–283 e o
  descobrimento de cada slot da rodada 0 gasta ~80 (piso de 12 candidatos × 4 leituras de alvo), então o orçamento acaba em `headLower`
  (9º de 16 na ordem de `SEARCH_SLOTS`); armadura, capa, bota, acessórios e sombras nunca são visitados. A hipótese "o share não conta as leituras
  dos outros alvos" foi testada (dividir `shareAt` pelo custo de leitura): os pisos (12 descobertas, 4 de esforço rápido) dominam, o resultado
  ficou igual (42,8M vs 43,5M) e a mudança **foi revertida**. Nenhuma correção pequena demonstrada; a lacuna é de orçamento, e o relatório
  já diz isso (`stoppedBy: 'search-budget'`, distância > 0), nunca "impossível".
- Categoria 1 (ausente do catálogo): nenhum caso. Categoria 2 (filtro): só as exclusões do estudo (Casaco Pirata) e o que `notRelevant` marca
  (sem chave de bônus para a fórmula). Categoria 5 (rejeitada pelo Greedy): armas avaliadas e não aceitas do meister/jor.

## 5. Veredito

- Legalidade e restrições: respeitadas em todos os caminhos e em todas as respostas (`violations: []`, auditoria do estudo vazia nos casos `jor`).
- Resultados viáveis nunca foram trocados por inviáveis; o relatório diz explicitamente quando não achou e por quê (`search-budget`).
- A descoberta não falha por lógica do gerador: com 2000–4000 avaliações todos os casos viáveis do benchmark foram atingidos (meister ≈ referência
  a 2000; meister-sets a 4000). O gargalo observado é o orçamento por slot em metas com vários alvos.
- Recomendação: **não é necessária busca mais sofisticada (Beam/VNS) agora**. A alavanca de menor risco, a decidir com o usuário, é a ordem/pesos
  dos slots e os pisos de esforço quando há meta com vários alvos (sombras por último ficam sem orçamento).

## 6. Limitações V1

Travas por campo não cobrem `optimize_slot`/`scan_slot`; sem build mágica equipada real como fixture (o `magus` usa equipamento de `b1`);
atributos/consumíveis/habilidades fora do espaço de busca (a referência do `jor` os altera: não contados como falha); polish por DPS inalterado.
Timeouts: ver `docs/optimize/optimize-roadmap-status.md` (fechamento da fase).
