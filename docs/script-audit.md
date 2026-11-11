# Auditoria dos bônus de item (scripts)

Como conferimos os bônus de `src/assets/demo/data/item.json` contra o que o cliente realmente aplica,
de onde vem cada dado e como decidir quando as fontes divergem. Complementa
[item-json.md](item-json.md) (formato do script) e [game-assets.md](game-assets.md) (ragassets).

## Fontes de dados e prioridade

| # | Fonte | O que traz | Papel |
|---|---|---|---|
| 1 | `aegisScript` do RagnarokDB | Script real do cliente (`event OnStartEquip:`), com valores por refino e grau | **Primária** para números, quando o item é LATAM e tem script de equipar |
| 2 | Texto pt-BR (ragassets `latam-items.json`) | Descrição exibida no jogo | **Validação**. Se bate com o script, aplica. Se diverge, vai para revisão: o texto pode estar errado (24541) ou o script defasado |
| 3 | Descrição do DP em inglês (dpRO/kRO) ou coreano | Texto quando o item ainda não existe em LATAM | **Fallback**. Tailandês é só dica, nunca aplicado |
| 4 | rAthena | Valores derivados do kRO | Conferência de valor. Nunca sobrescreve e **não** diz se o item está no LATAM |
| 5 | Testes de replay | Dano medido em jogo | Abaixo de todas as fontes de texto. Replay que contradiz o texto é reaberto |

"Está no LATAM" vem de `availableServers`/`region` do RagnarokDB e de existir texto pt-BR no ragassets.

### RagnarokDB

Projeto separado (`D:\Developer\RagnarokDB`), SQLite sincronizado com o DP. A tabela `items` guarda o JSON da
resposta do DP em `raw_json`: `description`, `aegisScript`, `equipmentPropertiesScript`, `scripts` (linhas em
inglês, sem condições, **não usar**), `availableServers`, `region`, `aegisName`. Acesso **somente leitura**
(`file:...?mode=ro&immutable=1`); a calculadora nunca escreve nele.

### ragassets

Toda informação derivada do cliente entra por ragassets (`/raw/<table>.json`). Este repositório não abre GRF.
Fluxo e tabelas em `.agents/skills/sync-with-ragassets/SKILL.md`. Resumo:

```
GRF do cliente -> ragassets (VPS: /srv/laro-assets/{mirror,icons,raw})
  -> /game-assets/raw/*.json -> tools/sync-latam-db.mjs -> latam-items.json, item-views.json, latam-classes.json
                              -> tools/sync-monster-db.mjs / build-latam-monsters.mjs -> monster.json, latam-monsters.json
                              -> tools/build-skill-delays.mjs -> skill-delay.json
  -> node tools/missing-items.mjs (itens do cliente sem registro em item.json)
```

`item.json` é mantido à mão; o sync só torna o item conhecido. Atualizar o GRF exige regenerar o mirror e as
tabelas `/raw` na VPS (ver `game-assets.md`), o que é uma mudança na VPS e precisa de autorização explícita.

## Linguagem do aegisScript

Corpo de `event OnStartEquip:` até `return`.

- Variáveis: `var temp = GetRefineLevel [GetLocation]`, `GetEquipGradeLevel [...]`, divisão inteira, `&` `|`.
- Controle: `if / elseif / else / endif`.
- Contexto: `get[VAR_STANDARD_STR]`, `get[VAR_CLEVEL]`, `get[VAR_JOB]`, `GetSkillLevel [SK]`, `IsPremiumPcCafe`,
  `GetPureJob`, `GetWeaponClass`, `GetEquipWeaponLv`, `GetEquipArmorLv`, `GetPetRelationship`,
  `GetRefineLevel [LOCATION_X]` (refino/grau de **outra peça**).
- Bônus: `AddExtParam User VAR_X expr`, `AddDamage_SKID`, `RaceAddDamage`, `AddDamage_Size`, `AddAttrTolerace`,
  `SubSpellCastTime`, `SetIgnoreDefRace_Percent`, `ClassAddDamage`, e cerca de 120 famílias de efeitos
  (`SetAutoSpell2`, `AddHPdrain`, `SplashAttack`, ...).
- Escalas: CRIT do cliente é ×10 em relação ao nosso DB; `vct`/`acd` são guardados como reduções positivas.
- Nomes: RACE `Nothing`=formless, `Animal`=brute, `Human`=demihuman; PROPERTY `Nothing`=neutral, `Saint`=holy,
  `Ground`=earth, `Telekinesis`=ghost, `Darkness`=dark.

## Método da auditoria

1. **Avaliador do script**: interpreta o `OnStartEquip` para cada refino (0..20) e grau (D..A) e devolve os
   bônus no vocabulário de chaves do DB. Suporta contexto (peça parceira, atributo base, nível, skill,
   premium, job, classe e nível da arma). Para um item que lê contexto, testa várias combinações e vale a que
   melhor explica o DB.
2. **Dump do motor**: veste o item sozinho no motor da calculadora (refino × grau) e subtrai a base.
   Cartas usam uma faca inerte como hospedeira; encantamentos, um elmo inerte.
3. **Comparação** item a item: `MATCH`, `MATCH-CTX` (bate em um contexto específico) ou `DIFF`.
4. **Classificação dos DIFF** cruzando script (a), texto pt-BR (t), rAthena (r) e DB:
   `A` script = texto ≠ DB (corrigir DB); `D0` texto e DB sem o bônus que o script dá (bônus escondido);
   `D1` texto = DB ≠ script (script difere do que o jogo mostra); `E` todos diferem; `C1`/`C2` sem texto pt-BR.
5. **Relatório** com uma linha por item. **Nenhuma alteração** em `item.json` antes da validação.

Tudo isso roda com `node tools/audit-item-scripts.mjs` (próxima seção).

Limites conhecidos: o motor só expressa o que tem chave; penalidades por atributo/nível, `refino²` e bônus
que variam com a peça parceira aparecem como DIFF sem serem erro de dado. Costumes e outros tipos sem
bônus no motor não são avaliados.

## Como re-auditar (passo a passo)

Para humanos e agentes. Este documento é **único e sobrescrito**: descreve o método, as decisões e as pendências
**atuais**. O histórico de cada execução vai em [script-audit-log.md](script-audit-log.md) (uma entrada datada por
auditoria, só acrescenta).

Comando único, fases reexecutáveis (nada é gravado em `item.json`, no RagnarokDB ou na VPS; saída em `.tmp/item-audit/`):

```
node tools/audit-item-scripts.mjs all --raw <ragassets raw dir> [--db <ragnarok.db> | --aegis <aegis.json>]
node tools/audit-item-scripts.mjs check|export|dump|compare|report   # fases isoladas
```

| Fase | O que faz |
|---|---|
| `check` | Vê quais fontes existem e define o modo: **full** (script + texto) ou **text** (sem RagnarokDB) |
| `export` | RagnarokDB -> `aegis.json`, somente leitura (`tools/export-ragnarokdb-aegis.py`) |
| `dump` | Veste cada item no motor (refino 0..20 x grau D..A) e grava o bônus que o motor aplica. Roda `src/app/core/__tests__/item-audit-dump.spec.ts`, pulado na suíte normal |
| `compare` | `tools/audit/script-vs-db.mjs` (script do cliente x DB) e `tools/audit/text-vs-db.mjs` (texto pt-BR x DB) |
| `report` | `tools/audit/classify.mjs` classifica; grava `report.json` e `report.md` |

Ordem de trabalho de uma atualização:

1. **Atualizar o cliente** (se houve patch): ver "Atualização do cliente (ragassets)" abaixo e rodar `tools/sync-latam-db.mjs`.
2. **Rodar a auditoria** (`all`). Sem RagnarokDB roda em modo `text` (abaixo).
3. **Ler `report.md`**: cada item traz a confiança e a classe por chave. Aplicar as **decisões já tomadas**
   (seção seguinte) e levar ao usuário só o que for caso novo.
4. **Aplicar** as correções classe `A` à mão, com edição pontual em `item.json` (sem reordenar entradas). D0 e C só se
   documentam. D1 e kRO vão para o overlay (`tools/build-item-script-kro.mjs`); chaves sem suporte no motor para
   `tools/build-item-script-extra.mjs`.
5. **Validar**: `npx vitest run src/app mcp worker`, os três `tsc` (`tsconfig.react.json`, `tsconfig.backend-tests.json`,
   `worker/tsconfig.json`), `node tools/check-source.mjs`, `node tools/release-notes.mjs`, `node tools/build-web.mjs --check`.
   A suíte inteira roda **antes de commitar**.
6. **Documentar**: atualizar este documento (decisões e pendências) e acrescentar a entrada no log.
7. **Fechar**: fragmento de Novidades (PT-BR, ES, EN) e PR. Publicar na VPS é um passo à parte, só com permissão.

### Quando a fonte não existe

A confiança de cada item é a da sua melhor fonte; o relatório a mostra, para ninguém ler "bate" sem saber que só um lado foi conferido.

| Item | Com RagnarokDB (`full`) | Sem RagnarokDB (`text`) |
|---|---|---|
| LATAM, com texto pt-BR | script + texto: classes `A`, `D0`, `D1`, `E` | só texto x DB: `T-OK` / `T-DIFF` (sem `A`/`D1`, que dependem do script) |
| Prévia (sem texto pt-BR) | script x DB: classe `C`; a descrição do DP (en/kr) fica no `aegis.json` como dica | **`N/A`: não verificável** |
| Sem nenhuma fonte | `N/A` | `N/A` |

- O texto do DP só existe **dentro do RagnarokDB** (campo `desc`). O projeto não acessa o Divine Pride diretamente.
- Qualquer outra fonte é **manual**: a pessoa (ou o agente) lê a página do DP/rAthena e edita `item.json` baseada nela,
  e registra a origem no log. O audit não busca nada na rede.
- A auditoria de texto lê só o pt-BR do ragassets; `latam-items.json` não traz as prévias.

### Classes (variáveis, dependem das fontes)

`A` script = texto != DB (corrigir DB) · `D0` texto e DB sem o bônus que o script dá · `D1` texto = DB != script ·
`E` os três diferem · `C` sem texto pt-BR e script != DB (`C1`/`C2` dividem pelo rAthena, ainda manual) ·
`T-OK`/`T-DIFF` só texto x DB · `N/A` sem fonte. O relatório continua listando as exceções já conhecidas como `A`
(skills que o simulador não tem, 27173/27174, etc.); estão em "Pendências" e só se decidem uma vez.

Limites da rotina: rAthena e replays não entram no comando (ficam como conferência manual); o mapa
`tools/audit/skill-ids.json` (`NOME_AEGIS -> id`) precisa de skills novas quando o cliente as ganha; a auditoria de
texto não lê as descrições em inglês do DP (não há tradutor no repo).

## Decisões já tomadas

- Bônus de conjunto só na peça cuja descrição o traz; "a cada refino do +N ao +M" conta o +N.
- Blocos "Durante a transformação" e "Efeito" são procs (`chance__`): o bônus só vale com o proc ativo.
- "Conjuração fixa" sem sinal é redução.
- Solid Claymore (21063): +10 no grau C (texto, rAthena e script concordam).
- Coroas Issgard (400105-7): sem base +7; LATAM vale mais que o teste do iRO.
- Sombrios (24036-24043) e Booster 24739: mantidos até teste no servidor.

## Duas versões dos dados: LATAM e kRO

O `item.json` é a versão **LATAM**: segue o texto pt-BR do cliente. O script do cliente (`aegisScript`, igual ao do
servidor kRO) e o rAthena descrevem a versão **kRO**, que costuma estar à frente do LATAM. Onde as duas divergem,
`item.json` fica com o pt-BR e o lado kRO vai para `src/assets/demo/data/item-script-kro.json`:

```json
"1187": { "p_race_demihuman": ["70", "6===9", "7===7", "..."] }
```

Cada chave listada **substitui** a mesma chave do script do item quando a versão kRO está selecionada; lista vazia
significa que o script não dá nada naquela chave. Mesma sintaxe de cláusulas do `item.json`. Itens que leem contexto
são avaliados com o contexto neutro.

**Seletor "Itens"** (ao lado do seletor "Fórmulas", só aparece com as prévias ligadas): `model.itemScriptVersion`
(`latam` por padrão, `kro`). Com `kro`, `Calculator.getItem` devolve o item com as chaves do overlay no lugar das
suas (`applyItemScriptOverlay`, `src/app/core/item-script-version.ts`); o arquivo é baixado só na primeira vez que a
build pede kRO (artefato `itemScriptKro`). Sem prévias a versão volta a `latam`. Só o cálculo muda: as descrições
continuam o texto pt-BR. Itens de prévia (sem versão LATAM) não dependem do seletor: o `item.json` já os traz pelo script.

Entram no arquivo as divergências dos grupos D0, D1, C1 e C2 abaixo. Regenerar:

```bash
node tools/build-item-script-kro.mjs --aegis aegis.json --keys keys.json --skill-ids skill_ids.json
```

`keys.json` é `{ "<id>": ["<chave>", ...] }` com as chaves que a auditoria achou diferentes do script.

## Resultado da auditoria (10/11/2026)

5.185 itens avaliados; o texto pt-BR é lido também para cartas e encantamentos. Regra por grupo:

| Grupo | Situação | O que fazemos |
|---|---|---|
| A | script = texto pt-BR ≠ DB | **DB corrigido** pelo script |
| D0 | script dá bônus que o texto não cita (oculto) | `item.json` não muda; lado kRO no overlay |
| D1 | texto pt-BR = DB ≠ script | **`item.json` segue o pt-BR**; script no overlay kRO |
| E | script, texto e DB diferem | corrigido por revisão; ver abaixo |
| C1 | sem texto pt-BR (item fora do LATAM); script = rAthena ≠ DB | `item.json` não muda; script no overlay kRO |
| C2 | sem texto pt-BR; script ≠ rAthena | `item.json` não muda; script no overlay kRO |

Um item só cai em C1/C2 se **não** tem descrição pt-BR. A primeira versão da auditoria lia o texto só dos itens
equipáveis e jogava todas as cartas e encantamentos em C; hoje o texto é lido para eles também (ex.: Carta Chonchon
de Aço, 4042: texto 5, DB 5, script 10 → D1).

### Correções aplicadas ao DB

- **Grau contado duas vezes (E).** Em 13 itens a mesma chave tinha `GRADE[me==X]` e a cláusula do slot do próprio
  item (`GRADE[weapon==X]`, `GRADE[armor==X]`) e as duas valiam: Camisa Fofinha 15282 dava SPL 7 no grau C (texto 4),
  as armas Precision (`5353`, `5355`...) 17 (texto 7), as Paenitentia POD 3 (texto 1). Ficou só a cláusula `me`.
- **Grupo A:** Machado do Apocalipse (ASPD -40%), Guisarme-Bico, Lança de Longuinho, Lança Gigante (ASPD -10), Grevas de
  Ur (HP +1% por refino do +8), as Gloriosas de Gunslinger (dano de skill por refino do +9), Cota Perene (SP -100),
  Erde e Bolsas (Terror Ácido), Taco Ilusional (ASPD +1 a cada 2 refinos) e cartas com texto = script.
- Não são erro do DB (limite da grade 0..20 da auditoria): sombras Full Penetration/Tempest em +11 (o bônus é só no
  +10, e sombra vai até +10) e a Guarda Imperial 2153 (o texto diz "acima do +6", o DB está certo).

- Dano de skill que o simulador não tem (ids 229 Terror Ácido, 250/251, 502 Ataque Triplo, 515, 2485) **não entra** no
  `item.json`: o teste de chaves recusa um id sem skill. Fica pendente para quando a skill existir (Erde, Bolsas, Gloriosas
  de Atirador, Carta Tamruan). O mesmo vale para o dano de skill do bônus oculto.

Cartas com refino da arma hospedeira, revisadas: 27261, 27181, 4528 e 4669 corrigidas; 27113, 31017, 300003,
300005, 310549, 311064, 4435, 4436 e 27109 já estavam certas; 310704 e 310724 só divergem do script (overlay kRO).
"A cada refino a partir do +N" se escreve como escada (`N===V`, `N+1===V`...), `REFINE_FROM[N]---V` ou `REFINE[N]1---1`; Punho Violento 1830, Escudo Celestial 2168 e Sobrepeliz 2581 foram completados assim.
Thanos Hammer/Axe/Bow-AD: grau D contado duas vezes e chaves sem texto removidos. As 22 prévias graduadas (Coroas
Ambivalentes, Botas, armas, sombras Magistral dos Falcões, Essências Vigor) conferem com o texto; Dom Celestial e Dom
Infernal (312014/312021) ganharam os bônus dos conjuntos com as armas.

## Pendências

Nada abaixo bloqueia o uso; são limites conhecidos, cada um com o motivo.

| Pendência | Por quê | Para fechar |
|---|---|---|
| Dano de skill com id sem skill no simulador (229, 250/251, 502, 515, 2485; cartas 27173/27174, Erde, Bolsas, Gloriosas de Atirador, Carta Tamruan) | o teste de chaves recusa id sem skill | modelar a skill, depois gravar a chave |
| ~~Malha Sombria dos Feitiços 24747~~ (resolvida) | o "+0,3 s" do segundo bloco é erro de texto do pt-BR: a descrição do DP (tailandês) diz que **reduz** 0,3 s e que não acumula com Brinco/Colar. `item.json` já está certo | nenhuma | — |
| Pedras de Shura 25412/29426 (Mestre Meio/Baixo): "Conjuração fixa de [Zen] −40%" e "autoconjura [Zen] nv.1" | Zen não existe no simulador | modelar Zen; o bloco Topo (+10% Explosão Espiritual) já está |
| Pedras 25501, 29488, 311013, 1000674 | **fechadas**: todos os blocos estão modelados (311013 passou a `SKILL_ID[2446==1]---2`) | — |
| "A cada refino a partir do +N": Garra Gloriosa 1826 e Chapéu de Imp 5658 / Chapéu de Dourado 19264 ("chance de ativação"), Flauta/Chicote de Raiz 1930/1984 ("custo de SP de [skill] −4") | sem chave para chance de ativação nem para custo de SP por skill | criar as chaves no motor |
| Sombrios 24036–24043 e Booster 24739 | texto e script divergem; falta teste no servidor | usuário testa no servidor |
| Dilacerar (replay) | resíduo no replay | reinvestigar o replay |
| Sinal de `cd__` em EN | ambíguo ("+" pode ser aumento) | conferir no cliente EN |
| Famílias sem chave no motor (≈120, 1.445 itens) | ficam em `item-script-extra.json` | implementar a família no motor |
| Bônus ocultos (D0) e 145 `hp` de sombras (C1) | decisão do usuário: só documentar | — |
| Evaluator: Guarda Imperial 2153 (`var` em `if`), sombras em +11, `GetRefineLevel[LOCATION_BODY]` sem espaço (15282) | limite do avaliador, não do DB | corrigir o avaliador |
| Tabelas `/raw` atualizadas na VPS | exige autorização explícita | usuário autoriza |
| Seletor "Itens": descrições continuam em pt-BR sob kRO | só o cálculo muda | decidir se vale mostrar o texto kRO |

## Efeitos que a calculadora não calcula

Cerca de 120 famílias do script não têm chave no motor (1.445 itens). Ficam em
`src/assets/demo/data/item-script-extra.json`, **fora do `item.json`**, no mesmo formato de cláusulas
(`N===V` soma V a partir do refino N, `GRADE[me==X]===V`), com chave
`fn__<Família>__<argumentos fixos>__a<posição do número>`. Exemplo (Guia da Morte):

```json
"1186": { "fn__SetAutoSpell2__User__NPC_VAMPIRE_GIFT__a1": ["1", "9===1"],
          "fn__SetAutoSpell2__User__NPC_VAMPIRE_GIFT__a2": ["20"] }
```

A calculadora ignora o arquivo hoje e passa a ler quando ganhar suporte a uma família, sem tocar no
`item.json` (menos conflito com o upstream). Itens que leem contexto (peça parceira, atributo, pet) são
avaliados com o contexto neutro.

Regenerar:

```bash
python -I -X utf8 tools/export-ragnarokdb-aegis.py aegis.json      # lê o RagnarokDB (RAGNAROK_DB), somente leitura
node tools/build-item-script-extra.mjs --aegis aegis.json --skill-ids skill_ids.json
```

O avaliador está em `tools/lib/aegis-script.mjs` (sem acesso a arquivos). `skill_ids.json` é o mapa
`NOME_AEGIS -> id` das skills.

## Atualização do cliente (ragassets)

Com o GRF novo, as tabelas `/raw` são regeneradas com o extrator do ragassets
(`extract-grf.mjs --raw <dir> --grf data.grf --iteminfo System/iteminfo_new.lub`) e entram aqui com
`node tools/sync-latam-db.mjs --src <dir>`. GRF acima de 4 GiB grava o offset da tabela truncado em 32 bits:
o extrator tenta também a posição `+2^32`. Publicar as tabelas na VPS é um passo à parte, com autorização.

## Regras para não conflitar com o upstream

- Avaliador e geradores (`tools/lib/*`, `tools/audit/*`, `tools/audit-item-scripts.mjs`, `tools/build-item-script-*.mjs`) ficam em `tools/`; o relatório e os dumps do motor ficam em `.tmp/item-audit/` (ignorado pelo git). Só edições pontuais em `item.json`, sem reordenar
  entradas intocadas.
- Dados novos entram em arquivo próprio, nunca misturados às entradas que o upstream atualiza.
- Todo PR leva fragmento de Novidades em `release-notes/` (PT-BR, ES, EN) e a seção correspondente na descrição.
