# Auditoria dos monstros e mapas de Jörmungandr

Conferência de 31/10/2026 contra o projeto `D:/Developer/RagnarokDB` e o banco
configurado em `RAGNAROK_DB`, consultado usando o lock do próprio projeto e
`PRAGMA query_only=ON`. Nenhum dado do banco ou da calculadora foi alterado.

## Fontes atuais

- A calculadora seleciona os IDs cadastrados em `src/assets/demo/data/monster.json`.
- `tools/sync-monster-db.mjs` atualiza atributos de IDs existentes usando
  `https://assets.latam-tools.com.br/raw/mobs.json`; não adiciona IDs nem atualiza
  `spawn`. O feed é descrito em `tools/mob-source.mjs` como derivado do RagnaPlace.
- `latam-monsters.json` sobrepõe nomes; atualmente vários nomes do EP19 continuam
  em inglês, apesar de o artefato ser destinado à localização.
- `spawn` é mantido manualmente. `monster-spawn-mapper.ts` transforma os códigos
  `jor_*` conhecidos em um único grupo **EP 19**.
- O seletor em `CalculatorSession.setMonsterDropdownList()` pesquisa pelo nome,
  grupo e ID, mas seu `searchVal` não inclui o `spawn` original. Por isso pesquisar
  `jor_back2` não encontra esses monstros pelo mapa.
- O RagnarokDb é independente desta sincronização. Seu README estabelece
  DivinePride para atributos e RagnaPlace para nomes PT-BR e descoberta de roster.

## Escopo e resultado

Foram consultadas as relações de `mob_spawns` nos mapas `jor_*` e comparados os
IDs únicos. A separação entre episódios usa `spriteName` (`EP19`/`EP20`), pois o
prefixo do mapa sozinho não identifica o episódio nem confirma disponibilidade
no LATAM.

| Conteúdo encontrado no RagnarokDb | Cadastrados na calculadora | Ausentes |
| --- | ---: | ---: |
| EP19 com spawn em `jor_*` | 22 | 0 |
| EP20 com spawn em `jor_*` | 1 | 26 |

Os 22 monstros do primeiro grupo têm **37 relações mob/mapa**, todas já presentes
no campo `spawn`. Não houve divergência nos atributos usados pelo cálculo: nível,
HP, DEF, DEFM, RES, RESM, atributos básicos, raça, tamanho, elemento, chefe e MVP.
Foram normalizadas apenas diferenças de representação, como `Demi-Human` /
`DemiHuman` e elemento com nível já concatenado.

As relações EP19 encontradas cobrem `jor_ab01`, `jor_ab02`, `jor_back1`–`jor_back6`,
`jor_dun01`, `jor_dun02` e `jor_tail`. Isso descreve o conteúdo do espelho consultado,
não um inventário completo de todas as instâncias do episódio.

**21 dos 22 nomes diferem** da tradução disponível em `mobs.name_ptbr`. Exemplos:

| ID | Nome na calculadora | Nome PT-BR no RagnarokDb |
| --- | --- | --- |
| 21520 | Limacina | Remakina |
| 21521 | Unfrost Flower | Flor que Não Congela |
| 21537 | Ultra Limacina | Ultra Remakina |
| 21599 | Heart Hunter AT | Caçador de Corações AT |

Há ainda registros com `EP19` no sprite que não entram nessa contagem: NPCs,
variantes de instância sem spawn e entradas cujo retorno lista apenas kROM.
Não foram considerados automaticamente monstros LATAM ausentes. Aquila (21531)
e Simulation Juncea (21533) já existem na calculadora com agrupamento sintético
`MD_EP19`; o banco não informa spawn real para esses dois IDs.

## Ajuste indicado

Expor os mapas reais no seletor e na busca, preservando os códigos de `spawn`
usados pelos bônus `SPAWN[]`. Atualizar os nomes a partir de um export reproduzível
do RagnarokDb, sem trocar os atributos que já conferem. A atualização precisa
preservar essa fonte para que o próximo build de `latam-monsters.json` não volte
aos nomes ingleses.

Para adicionar os registros do EP20, confirmar separadamente o conteúdo lançado
no LATAM e os mapas das variantes. Estar no espelho ou em um mapa `jor_*` não
prova essa disponibilidade.

Artefatos locais da consulta: `.scratch/monster-audit/comparison.json`,
`audit.py` e `compare.mjs`. A consulta usou os dados já sincronizados no espelho;
não executou uma atualização remota das APIs.

## Implementação após a auditoria

O seletor agora inclui os códigos reais na opção e na busca. A ficha do alvo
também mostra os mapas; agrupamentos sintéticos `MD_*` continuam válidos para
as regras existentes, mas não são apresentados como mapas reais.

As traduções explícitas de `mobs.name_ptbr` dos IDs já cadastrados são exportadas
para `data/monsters/ragnarokdb-names.json`. A prioridade da geração de nomes é:
fallback existente, feed ragassets, traduções RagnarokDB e rótulos próprios da
calculadora, nessa ordem. O build normal não precisa acessar o NAS.

Atualização manual, com `RAGNAROK_DB` configurado:

```sh
python tools/export-ragnarokdb-monster-names.py --project D:/Developer/RagnarokDB
node tools/build-latam-monsters.mjs
node tools/build-web-data.mjs
```

O export é restrito às traduções dos IDs presentes em `monster.json`: não adiciona
mobs, não altera atributos e não substitui `spawn`. O primeiro export trouxe
426 traduções. O teste `tools/build-latam-monsters.spec.ts` protege a prioridade
das traduções contra uma atualização posterior do feed.
