# Servidor MCP

O MCP deixa uma IA usar a calculadora como ferramenta: carregar uma build (de um link do simulador ou
montada campo a campo), consultar itens, habilidades e monstros, calcular dano e procurar melhorias. É o
**mesmo motor** da interface web — nada é recalculado à parte. O endpoint é `/mcp` (HTTP) do Worker
(`worker/`, ferramentas em `mcp/src/tools/`).

## Ferramentas

| Ferramenta | Para quê |
|---|---|
| `list_classes`, `list_skills` | ids de classe e as habilidades ofensivas (`"Nome==Nível"`) de cada uma |
| `search_items`, `get_item`, `item_description` | achar peças por nome, slot ou chave de bônus; ficha e descrição pt-BR |
| `list_bonus_keys` | as chaves de bônus pesquisáveis (`atk`, `p_race_demon`, …) |
| `search_monsters`, `get_monster` | alvos; o padrão é o boneco Neutro (21077) |
| `calculate` | dano, DPS, atributos finais, tempos e um link para abrir no simulador |
| `damage_table`, `compare_builds` | uma build contra vários monstros; até 4 builds contra o mesmo alvo |
| `optimize_slot` | testa candidatos **de um slot** e ordena por DPS, cada um com os melhores cartas e encantamentos que aceita (`complements: false` compara só as peças nuas); itens fora do LATAM vão em `skippedNotInLatam` |
| **`optimize_build`** | percorre os slots trocando a melhor peça até nada melhorar (ver abaixo) |
| **`optimize_stats`** | redistribui os pontos de atributo/traits dentro do orçamento do nível (ver abaixo) |
| **`uncatalogued_pools`** | itens sem pool de bônus aleatório confirmado + rascunho de pool do rAthena (ver abaixo) |
| **`evaluate_variants`** | várias variações de uma build numa só chamada (ver abaixo) |
| **`explain_damage`** | de onde vem o dano e o que o número não conta |
| **`slot_options`** | os encantamentos que cada soquete de uma peça aceita |
| `parse_share_link`, `share_link` | link ↔ build; aceita o link curto, o longo e o token puro |
| `get_custom_item_schema`, `validate_custom_items`, `create_custom_items` | itens personalizados |

Toda ferramenta que recebe uma build aceita `build.share` (o link) com overrides esparsos por cima, então
"aqui está minha build, o que melhora?" é uma chamada só.

### `optimize_stats`

Move pontos entre FOR/AGI/VIT/INT/DES/SOR e, nas classes de 4ª, POD/STA/SAB/FEI/CON/CRV. O custo dos atributos
base vem do próprio simulador (`BaseStateCalculator`, teto 130) e o das traits é 1 por nível (teto 100); pontos
ainda não gastos entram na conta. `lock` trava atributos e `require` impõe pisos (ex.: `hp` mínimo, para não trocar
sobrevivência por dano sem ver). Cada passo estima o ganho de mover N níveis para cada atributo, verifica os
melhores pares com cálculo real e reduz N (8, 4, 2, 1). Resposta: `changes` (de → para), `points` (usado/orçamento),
`patch` e `share`. Heurística: não prova o ótimo global; confirme os tetos no jogo.

### `uncatalogued_pools`

A fila de itens cujo pool de bônus aleatório ainda não foi confirmado no LATAM. Sem `itemId`, lista (com `query`,
`slot`, `policy`, paginação), os que têm referência no rAthena primeiro. Com `itemId`, devolve um **rascunho** de
pool (`profiles`), com as opções do rAthena que têm chave no simulador
e as `unmapped`. O rascunho não é confirmação: veja o item no jogo e só então grave o pool com
`python tools/add-regional-pool.py <ids> <arquivo> --source ... --confidence ...`. O seletor de bônus da tela e a busca do `optimize_build` passam a
usar o pool na hora, e `regional-pools.spec.ts` valida o formato. Sem pool, a tela fica aberta a qualquer bônus
e a busca ignora o item.

### `evaluate_variants`

```jsonc
{ "build": { "share": "…" },
  "variants": [ { "label": "mais POD", "patch": { "stats": { "pow": 130 } } },
                { "label": "sem Mantra", "patch": { "skills": { "active": { "Powerful Faith": 0 } } } } ],
  "metrics": ["max", "dps", "hp"],            // padrão: max, min, dps, hitsToKill
  "require": [ { "metric": "hp", "min": 150000 } ],
  "sortBy": "dps", "limit": 10 }
```

Cada `patch` tem o formato dos overrides de `build` e **mescla por chave** sobre a base (um `gear` com um slot
não limpa os outros; `null` limpa o slot). Devolve a base, o ranking com `deltaPct` por métrica, quantas
variantes foram descartadas por `require` ou não resolveram, e um link do simulador para as três primeiras.

Métricas: `max`, `min`, `dps`, `rotationDps`, `hitsToKill`, `critRate`, `hp`, `sp`, `atk`, `def`, `softDef`,
`mdef`, `flee`, `hit`, `aspd`, `crit`. `rotationDps` lê a `rotation` da build (o campo `rotation` também é um
override) e usa o mesmo ciclo do painel de rotação — `simulateRotationOf`, em `src/app/core/rotation-dps.ts`.
Os atalhos por passo (acúmulos por posição da rotação) são do painel e não entram aqui.

### `optimize_build`

A busca pela build inteira: para cada slot de equipamento e de sombra, testa os melhores candidatos, **aceita a
troca que mais melhora a métrica** (`objective`, padrão `dps`) e passa ao próximo slot; repete por até
`rounds` rodadas ou até nada melhorar. Uma troca precisa passar de +0,1% (abaixo disso é arredondamento do motor).

```jsonc
{ "build": { "share": "…" }, "objective": "max",
  "lock": ["weapon"], "exclude": [470094],          // slots que não mudam; itens proibidos
  "refine": 11,                                      // refino das peças novas (padrão: o do slot)
  "maxGrade": "C",                                  // sem grau, D ou C; nunca B/A
  "require": [ { "metric": "hp", "min": 150000 } ],  // pisos e tetos
  "candidatesPerSlot": 12, "rounds": 2, "maxSolves": 400 }
```

Como os candidatos são escolhidos: só entram itens cujo script tem **chaves de bônus que mexem no dano desta
habilidade neste alvo** — as chaves das etapas da fórmula (`explain_damage.stages`), as da raça, tamanho e
elemento do monstro e as da própria habilidade —, os melhores primeiro, filtrados por classe e nível. Sem esse
filtro seriam dezenas de milhares de cálculos. A resposta expõe `candidateIds` para auditar quais itens
entraram na seleção. O corte é heurístico, não uma classificação por dano de todo o catálogo.

Conjuntos são descobertos em ambas as direções, por `EQUIP_ID` e pelos nomes de exibição/aegis de `EQUIP`.
As trocas conjuntas cobrem pares; `targets` permite comparar, por exemplo, Médio e Grande com pesos. Efeitos
de remover penalidade de tamanho entram nos candidatos e a penalidade é recalculada em cada alvo.

A busca de rolagens usa o pool de cada item, da fonte mais forte para a mais fraca: código, `regional-pools.json`,
bROWiki (cerca de 60 itens, entre eles o Manto Branco Físico/Mágico e os Mantos Temporais) e, por último, o rAthena
(cerca de 1.050 itens). O LATAM tende a seguir o kRO, que o rAthena reproduz, mas isso não está confirmado: as
rolagens escolhidas a partir do rAthena vêm em `unconfirmedRolls`. Item sem pool em nenhuma fonte fica fora da busca
(contagem em `complementSearch.uncataloguedRandomItems`). Veja `docs/random-options-audit.md`.

`countProcs: true` conta, em cada build testada, todos os procs que ela oferece (inclusive os de peças recém-trocadas)
e devolve `countedProcs`; custa até o dobro dos cálculos das builds com procs. A resposta traz `alternatives`: por slot,
as 3 melhores alternativas que perderam e quanto valiam sobre a build daquele momento (`vsBuildThenPct`), para
entender por que uma peça não entrou. As buscas devolvem a CPU ao servidor a cada ~40 ms e param ao fim de
`MAX_SEARCH_MS`, para que uma otimização longa não congele o site.

`pairs` (até 6 pares, ex. `[["garment","boot"]]`) testa dois slots trocados **juntos** mesmo sem conjunto que os
ligue: depois da busca normal, os 4 melhores candidatos de cada slot em todas as combinações, aceitos só se o par
vencer a build atual em mais de 0,1%. Ambos os slots precisam estar entre os percorridos e não travados.

A resposta traz `procs`: o ganho de DPS de cada proc ainda não contado, medido na build final (até 10). A busca em
si só conta os procs passados em `effects`; use o ganho para decidir se vale buscar de novo com o proc ligado.
Peças sem pool de bônus aleatório catalogado ficam fora da busca de rolagens e aparecem, com id e nome, em
`complementSearch.uncataloguedRandomItems`.

`maxGrade` aceita `none`, `D`, `C`, `B` ou `A`. Testa todos os graus até esse teto apenas nas peças que podem
ser graduadas, incluindo a peça já vestida. A base inteira deve respeitar o teto (inclusive slots travados);
caso contrário, a chamada informa os slots que precisam ser ajustados. Sem o parâmetro, peças novas ficam
sem grau e as peças mantidas conservam o grau existente. Mais graus e alvos consomem mais trabalho: confira
`stopped` e o orçamento antes de interpretar a sugestão como conclusão da busca.

Devolve o caminho das trocas (`steps`, cada uma com o ganho no momento e o acumulado), a métrica final, o `patch`
pronto para `evaluate_variants` e um link do simulador. O que ele **não** faz:

- **Cartas e encantamentos não são escolhidos.** Quando a peça nova não tem o soquete (ou o encantamento não está
  no pool dela), o que a peça antiga carregava é tirado e listado em `dropped` — senão o motor contaria uma
  carta que ninguém consegue usar, e o ganho seria falso (a primeira versão prometia +87% por isso).
- **Acha um máximo local.** Uma troca que só compensa junto de outra pode passar na primeira rodada; a segunda
  rodada pega algumas (um conjunto de sombra apareceu assim), não todas.
- Bônus aleatórios não são transferidos para outra peça. Os graus são escolhidos apenas até `maxGrade`, quando
  informado. Cartas e encantamentos novos, rolagens específicas e procs exigem configurações explícitas em
  `evaluate_variants`; não compare uma Éden sem encantamentos com uma Invernal encantada como se fossem iguais.
- Não sabe de disponibilidade, preço ou obtenção: use `exclude` para itens que você não tem.

Comparações da build de Inquisidor usadas na revisão estão em `docs/optimization-review.md`.

### `explain_damage`

- `stages`: as etapas da fórmula com o valor depois de cada uma (o `skillFormulaTrace` do motor).
- `contributions`: quanto a métrica cai **sem** cada peça, carta, encantamento, buff, passiva ou consumível.
  Retirar uma peça também desfaz os conjuntos e combos dela; o valor é o da peça inteira. Positivo significa
  que o item está atrapalhando.
- `warnings`: itens com script vazio (efeito que o número não conta) e procs não ativados, com o ganho de
  ativá-los. Passe o nome do proc em `effects` para contá-lo.
- `refine` (opt-in): ganho de +1 e +2 níveis de refino em cada peça vestida, ordenado, sobre a build atual. Não considera
  chance de falha nem custo.

### `slot_options`

Além dos itens de encantamento, peças como Selo de Loki expõem `randomOptions`:
quantidade de campos e posições de `options` por slot de equipamento. Esses bônus
já entram no cálculo quando informados na build. `validation: capacity-only`
indica que faltam os atributos/faixas daquele item; não significa que qualquer
bônus digitado seja obtível no jogo.

O Selo de Loki com slot (410233) tem um catálogo inicial em
`src/app/core/random-option-catalog.ts`, com referência bROWiki: quatro moedas,
atributos, mínimos/máximos e posições. Os dois campos precisam caber na mesma
moeda. `slot_options` expõe esse catálogo como `reference-ranges`; alterações
explícitas em `options` são validadas no MCP, inclusive em `evaluate_variants`.
Presets antigos/importados não são rejeitados retroativamente. As faixas são de
referência, sem probabilidades, passos de valores ou medição independente no
LATAM; não se devem confundir com validação completa de obtenção no servidor.

`automaticRollSearch` continua `false`: a busca automática ainda não escolhe
novas cartas, encantamentos ou rolagens. Use os bônus reais nas comparações e
não atribua a equipamentos sem catálogo opções de outros itens.

Para um item, lista o que cada soquete de encantamento aceita (id e nome), a partir dos mesmos pools que a
interface usa (`src/app/constants/enchant_item/`). Para cartas devolve só a categoria a procurar em
`search_items` (`weaponCard`, `armorCard`, …).

## Procurando melhorias (fluxo)

1. `parse_share_link` (ou `calculate`) para ler a build — confira **POD/CON e os talentos**: uma build de 4ª
   classe com os talentos em zero dá um dano muito menor e envenena qualquer comparação.
2. `explain_damage` para ver onde está o dano e o que ele deixa de fora (com `parts: ["refine"]`, o ganho de +1 e +2 refinos por peça), e `optimize_stats` para os pontos de atributo.
3. `slot_options` e `search_items` para montar candidatos; `evaluate_variants` para testá-los em lote.
4. Conferir no jogo o que for recomendado — ver "Confiança" abaixo.

## Rodando localmente

```powershell
pnpm install --frozen-lockfile
pnpm --dir tooling/cloudflare install --frozen-lockfile   # o Wrangler tem instalação própria
pnpm build                                                # o Worker serve o build em dist/sakai-ng
pnpm dev:worker                                           # sobe o wrangler dev
claude mcp add --transport http ro-calc-local http://localhost:8788/mcp
```

- A porta é a que o terminal imprimir (`Ready on …`); `--port 8788` fixa uma.
- Use **`localhost`**, não `127.0.0.1`: o Worker só responde aos hosts de `ALLOWED_HOSTS`.
- O `dev:worker` chama `pnpm` por dentro. Sem `pnpm` no PATH, rode os passos soltos:
  `node tools/build-web.mjs`, `node tools/build-worker.mjs` e `wrangler dev --config ../../wrangler.jsonc`
  dentro de `tooling/cloudflare`.
- O Worker serve o **build**, não o código-fonte: depois de mexer em classes ou itens, refaça `build-web.mjs`
  e `build-worker.mjs`, e reinicie. Refazer o build com o `wrangler dev` aberto pode derrubá-lo (a pasta
  `dist/worker` é apagada e recriada).
- **Link curto, só em produção.** O MCP resolve `short.latam-tools.com.br` pelo binding `SHORTENER`
  (`services` no `wrangler.jsonc`), que o `wrangler dev` não conecta sozinho — e um erro do binding é
  devolvido como erro, de propósito (os testes de `worker/mcp` e `mcp/src/engine/short-link.spec.ts` fixam isso).
  Localmente, passe o **link longo**. Para tirá-lo de um curto: `curl https://short.latam-tools.com.br/api/links/<slug>`
  devolve `{ "url": … }` com a URL longa, inclusive a de um link feito numa máquina local
  (`http://localhost:4200/s/…`). O token do link longo carrega a build inteira; nada mais é consultado.


## Respostas curtas (tokens)

As respostas são JSON compacto e trazem só o que se usa para decidir. Medido em um Inquisidor 236/50: `optimize_build`
de ~37 KB para ~7,7 KB, `slot_options` de uma arma de ~16 KB para ~2,5 KB e do Selo de Loki de ~9,7 KB para ~2,4 KB.
O detalhe fica atrás de `detail: true`:

- `optimize_build`: `candidateIds` e `alternatives` (e `steps` já vêm como `"Nome (id) grau"`); itens sem pool aparecem
  como contagem + amostra de ids (`uncatalogued_pools` lista com nomes).
- `slot_options`: pools do rAthena e do catálogo como `"atk 1-20"` por posição; soquetes com a mesma lista são
  agrupados em `positions`; `detail: true` devolve os pools brutos.
- `calculate`: `include: ["bonuses", "tables"]` continua opt-in.

## Limites e custo

Configuráveis por variável do Worker (bloco `vars` do `wrangler.jsonc`); o valor inválido cai no padrão.

| Variável | Padrão | O que limita |
|---|---|---|
| `MAX_VARIANTS` | 100 | variantes por `evaluate_variants` |
| `MAX_CONTRIBUTIONS` | 60 | soluções de `explain_damage` |
| `MAX_SOLVES` | 2000 | cálculos de `optimize_build` e `optimize_stats` |
| `MAX_SEARCH_MS` | 25000 | tempo máximo de uma busca, em ms; ao esgotar devolve a melhor build até então |
| `MAX_OPTIMIZE_CANDIDATES` | 40 | candidatos de `optimize_slot` |
| `MAX_COMPARE_BUILDS` | 4 | builds de `compare_builds` |
| `MAX_TABLE_MONSTERS` | 20 | monstros de `damage_table` |
| `MAX_SEARCH_RESULTS` | 50 | linhas de cada busca |
| `DEFAULT_TARGET_ID` | 21077 | alvo quando nenhum é dado |
| `PUBLIC_APP_ORIGIN`, `SHORTENER_URL` | produção | origem dos links gerados e o encurtador |
| `ALLOWED_HOSTS`, `ALLOWED_ORIGINS` | produção + `localhost` | quem pode chamar |

`optimize_build` com o padrão (16 slots × 12 candidatos × 2 rodadas) gastou ~380 cálculos, ~4 s de CPU. Numa máquina
fraca, baixe `MAX_SOLVES`; a resposta avisa quando o orçamento acabou antes de convergir.

Medido num Inquisidor 236 (CPU de uma ferramenta, máquina de desenvolvimento): montar a build custa ~0,2 ms e
resolvê-la ~3,7 ms, então **100 variantes levam cerca de 0,5 s** e, com `rotationDps` (um solve a mais por
passo distinto da rotação), cerca de 2 s. Numa máquina fraca, baixe `MAX_VARIANTS`.

A tabela de itens é compartilhada entre requisições e só lida; só uma build com itens personalizados copia o
dicionário. O `solve` é síncrono de propósito (ver o comentário em `mcp/src/engine/solve.ts`): nada entre
montar e ler o calculador pode ter `await`, ou duas requisições se misturariam.

## Confiança nos números

### Busca de configurações completas

`calculate` e `evaluate_variants` calculam cartas, encantamentos e bônus
aleatórios quando declarados na configuração. `optimize_build` seleciona
equipamentos, parceiros de conjunto e graus, preservando soquetes compatíveis
e limpando complementos inválidos ao trocar uma peça. Por padrão também busca
novas cartas, encantamentos e rolagens catalogadas; `complements: false` mantém
a busca apenas de peças. A peça atual também é candidata, permitindo preencher
seus soquetes sem exigir uma substituição.

O gerador usa:

- Cartas elegíveis por categoria e quantidade de soquetes, incluindo conjuntos.
- Encantamentos permitidos por item e posição, com suas restrições de obtenção.
- Perfis de bônus aleatórios por combinador, respeitando posição e faixa,
  sem misturar moedas incompatíveis e sem tratar pools ausentes como livres.
- Avaliação dessas escolhas com beam de largura 3, até 8 candidatos por soquete
  e até 48 cálculos de complementos por movimento, repartidos conforme o
  orçamento restante e os slots. O limite padrão do servidor é 2.000 cálculos.
  O resultado é reproduzível por patch/link. A busca continua heurística: só pode afirmar
  o melhor resultado entre as configurações efetivamente examinadas.

O levantamento do rAthena é referência; pools sem confirmação regional não
geram rolagens. Selo de Loki e os quatro selos inferiores têm perfis regionais
catalogados. O patch e o link incluem todos os complementos escolhidos. Procs
só entram quando informados em `effects`. Ver `docs/random-options-audit.md`.

O MCP calcula o que o motor sabe. Antes de agir numa recomendação:

- **Buffs de grupo** (Competentia, Benedictum, Presens Acies, …) vêm das tabelas do cliente e do rAthena, mas
  muitos **não foram conferidos com replay**. Os maiores ganhos de uma busca são os que mais merecem conferência.
- O **Óleo Ungido** aparece duas vezes (botão da classe e buff compartilhado) e o motor o fixa em Nv5; quem
  tem o Nv1 recebe um ganho menor no jogo.
- Itens com efeito de proc (como o encanto Delírio) ficam de fora até serem listados em `effects`. O `warnings`
  de `explain_damage` e o `procs` de `optimize_build` mostram os disponíveis e o ganho de cada um.
- Links de compartilhamento nas respostas vêm encurtados (`/l/<código>`) quando `SHORTENER_URL` está configurada;
  veja [deploy-vps.md](deploy-vps.md).
- Efeitos que o motor não modela não aparecem no número nem sempre são avisados: o aviso cobre itens com script
  vazio, não regras que faltam dentro de um script.

## Diagnóstico

| Sintoma | Causa e saída |
|---|---|
| `Host não permitido.` | use `localhost`, não `127.0.0.1`, ou ajuste `ALLOWED_HOSTS` |
| `O link curto … não aponta para uma simulação` | o slug não existe, ou o binding `SHORTENER` não responde (sempre o caso no `wrangler dev`); use o link longo |
| porta já em uso | outro processo (`wrangler` antigo) segura a porta; encerre-o ou passe `--port` |
| `Slot desconhecido … ignorado` em `warnings` | o nome do slot em `gear` não existe; veja os slots em `build.gear` |
| `Item N … ainda não está no banco do calculador` | o item existe no LATAM mas o motor não o conhece; ele não conta |
