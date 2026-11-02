# Servidor MCP

A arquitetura, o uso sem IA e a lista separada de features da calculadora e do MCP
estão em [Melhorias de build](build-analysis.md). Cálculos e buscas pertencem à
camada compartilhada `src/app/build-analysis`; o MCP adapta essa camada ao protocolo.
`optimize_build` é opcional: uma IA também pode consultar itens, regras e habilidades
e medir hipóteses específicas com `evaluate_variants`, sem executar uma busca completa.

Na calculadora, o botão **Encontrar melhorias** oferece a busca local, exploração de
slots, atributos e análise de dano/upgrades, com revisão no painel de comparação.

O MCP deixa uma IA usar a calculadora como ferramenta: carregar uma build (de um link do simulador ou
montada campo a campo), consultar itens, habilidades e monstros, calcular dano e procurar melhorias. É o
**mesmo motor** da interface web — nada é recalculado à parte. O endpoint é `/mcp` (HTTP) do Worker
(`worker/`, ferramentas em `mcp/src/tools/`).

## Ferramentas

| Ferramenta | Para quê |
|---|---|
| `list_classes`, `list_skills` | ids de classe e as habilidades ofensivas (`"Nome==Nível"`) de cada uma |
| `search_items`, `get_item`, `item_description` | achar peças por nome, slot ou chave de bônus; ficha e descrição pt-BR; `excludeMvpCards` tira cartas de MVP, `withBonuses` mostra o que cada item faz, e o `get_item` traz `mvpCard` e os `partners` (conjuntos e combos) |
| **`validate_build`** | audita uma build sem consertá-la: classe, nível, slot, encaixes de carta, encantamentos, refino, item sem bônus no calculador, carta de MVP (`constraints.excludeMvpCards`). Devolve `errors`/`warnings` com `code`, `path`, `itemId`, `unknowns` (o que não foi checado) e `engineVersion` |
| `list_bonus_keys` | as chaves de bônus pesquisáveis (`atk`, `p_race_demon`, …) |
| `search_monsters`, `get_monster` | alvos; o padrão é o boneco Neutro (21077) |
| `calculate` | dano, DPS, atributos finais, tempos e um link para abrir no simulador |
| `damage_table`, `compare_builds` | uma build contra vários monstros; até 4 builds contra o mesmo alvo |
| **`scan_slot`** | mede **todos** os itens do LATAM que a classe usa num slot, com o resto da build como está, e afina os melhores com cartas, encantamentos e rolagens; devolve os parceiros de conjunto de cada um |
| `optimize_slot` | testa candidatos **de um slot** e ordena por DPS, cada um com os melhores cartas e encantamentos que aceita (`complements: false` compara só as peças nuas); itens fora do LATAM vão em `skippedNotInLatam` |
| **`optimize_build`** | percorre os slots trocando a melhor peça até nada melhorar (ver abaixo); `strictMvp` exige build final sem carta de MVP; a resposta traz `coverage` |
| **`optimize_stats`** | redistribui os pontos de atributo/traits dentro do orçamento do nível (ver abaixo) |
| **`uncatalogued_pools`** | itens sem pool de bônus aleatório confirmado + rascunho de pool do rAthena (ver abaixo) |
| **`evaluate_variants`** | variantes legais ou hipóteses explícitas, com até cinco alvos por lote |
| **`find_synergies`** | cláusulas de conjuntos, requisitos AND/OR e limites da extração, sem busca automática |
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

A build inicial deve passar na validação, incluindo o orçamento de pontos: a busca
não aumenta o orçamento para acomodar uma entrada ilegal. Respeita também o teto
específico da classe. Para hipóteses deliberadamente ilegais use `evaluate_variants`
com `validationMode: hypothetical`. `hitsToKill` é minimizado. Se nenhuma solução
encontrada cumpre `require`, retorna erro em vez de anunciar uma sugestão abaixo do piso.

`maxSolves` conta avaliações novas, incluindo a base; acertos do cache não consomem
esse orçamento. `evaluations` informa `uniqueEvaluations` e `cacheHits`. Interrupções
retornam o melhor estado legal encontrado, com `complete: false` e `stoppedReason`
(`maxSolves` ou `deadline`); término da busca local usa `converged`, sem prova global.
Os contadores não medem os solves internos adicionais de cada passo de rotação.
Essa semântica já vale para atributos; o orçamento da busca de equipamentos ainda
tem a passada final de soquetes separada, pendente de unificação.

### `uncatalogued_pools`

A fila de itens cujo pool de bônus aleatório ainda não foi confirmado no LATAM. Sem `itemId`, lista (com `query`,
`slot`, `policy`, paginação), os que têm referência no rAthena primeiro. Com `itemId`, devolve um **rascunho** de
pool (`profiles`), com as opções do rAthena que têm chave no simulador
e as `unmapped`. O rascunho não é confirmação: veja o item no jogo e só então grave o pool com
`python tools/add-regional-pool.py <ids> <arquivo> --source ... --confidence ...`. O seletor de bônus da tela e a busca do `optimize_build` passam a
usar o pool na hora, e `regional-pools.spec.ts` valida o formato. Sem pool, a tela fica aberta a qualquer bônus
e a busca ignora o item.

### Crítico e formatos de link

Em `calculate`, `damage.skill.effectiveCritRate` é a chance efetiva, em **porcentagem**,
da habilidade selecionada contra o alvo, no estado de efeitos solicitado.
`damage.skill.critRate` permanece como alias compatível com o mesmo valor.
`get_skill.canCrit` descreve capacidade, não a probabilidade da build concreta.
`stats.crit` é o CRIT da ficha do motor, que pode seguir regras próprias do ataque
básico; não é a chance efetiva da habilidade. Uma habilidade capaz de critar pode
ter chance efetiva zero. Consulte `explain_damage` com `parts: ["crit"]` para os termos.
Nas métricas de variantes, `critRate` já representa essa mesma chance efetiva.

Links completos, fragmentos antigos e o token codificado extraído de `/s/<token>/`
são aceitos em `build.share` e `parse_share_link.share`. O identificador de
`/l/<identificador>` é uma chave do encurtador, não um token codificado da build:
nesse caso envie a URL curta completa para que o resolvedor consulte o encurtador.

### `evaluate_variants`

```jsonc
{ "build": { "share": "…" },
  "variants": [ { "label": "mais POD", "patch": { "stats": { "pow": 100 } } },
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

O padrão é `validationMode: "strict"`: a **build resultante inteira** deve ser legal,
incluindo pontos e erros herdados da base. Uma variante pode corrigir uma base ilegal.
`baselineValid` e `baselineIssues` identificam a referência; ela não é uma recomendação.
Para experimentos deliberados, `validationMode: "hypothetical"` permite excesso de
pontos e erros já existentes, com `status: "hypothetical"` e avisos em cada resultado
afetado. Novos erros estruturais continuam recusados. `status: "ok"` identifica as
variantes legais. Atributos acima do limite da classe continuam sendo erros novos.

`targets: [{ "monsterId": 21077 }, { "monsterId": 21066 }]` substitui `target` e
aceita até cinco alvos. `baselinePerTarget` e `results[].perTarget` devolvem métricas
e ganhos por alvo; os campos principais e a ordenação usam o primeiro, identificado
em `rankingTarget`. Não há agregação implícita de DPS. `require` deve valer em todos
os alvos. `hitsToKill` ordena do menor para o maior; as demais métricas, do maior para
o menor (`sortOrder`). O cache é local ao lote, com execução sequencial para preservar
o estado do motor: `evaluations.uniqueEvaluations` conta avaliações não reutilizadas
e `cacheHits` as reutilizadas, incluindo a base. Uma avaliação pode calcular vários
estados de proc ou passos de rotação; esses contadores não são chamadas internas do motor.

### `find_synergies`

Consulta cláusulas condicionais por `build` e/ou `itemIds`, com filtro `bonusKeys`
e paginação `limit`/`offset`. Inclui conjuntos e bônus condicionados a refino,
grau, atributos ou habilidades, mesmo sem parceiro de equipamento.

`allOf`/`anyOf` preservam AND/OR; `conditions` usa o parser de regras visuais do
projeto. `unparsedExpression` mantém a sintaxe que ele ainda não decompõe, sem
perder a expressão original. `conditionCoverage` distingue essa cobertura.
`equipmentRequirementsMet` só verifica equipamentos, não ativação do bônus.

O catálogo e o motor são a referência. Itens personalizados são indexados apenas
na requisição da build, inclusive ao reabrir links; recebem `sourceConfidence:
user-defined`, sem entrar no catálogo global. Anexos personalizados substituem
os campos oficiais antigos, como no motor. `build.customAttachments` permite
sobrescrever, por slot, os anexos/refino/grau persistidos no link; cada estado tem
`itemId`, `cards`, `enchants`, `bas`, `refine` e `grade`. Variantes mesclam esse mapa
por slot e validam os anexos com as mesmas regras dos itens personalizados.

Por padrão, a consulta não calcula dano nem gera patches. `includePatches: true`
requer build e tenta posicionar requisitos legais, respeitando `lock`, `exclude`
e `mvpPolicy`. Peças novas entram +0/sem grau. Para autorizar mudanças adicionais,
informe `allowChanges: ["refine", "grade", "stats", "skills"]` com apenas os tipos
desejados. `maxRefine` e `maxGrade` limitam os upgrades propostos. A geração usa os
limiares estruturados; não redistribui pontos para financiar um atributo nem muda
classe ou nível. A sintaxe não estruturada continua disponível para hipóteses manuais.

O próprio motor verifica a expressão completa no `target` informado, ou no alvo
padrão, sem procs adicionais. Só devolve `patch` com `patchStatus: available` quando
a build é válida e o bônus está ativo (`activation` informa valor, posição e alvo).
`not-found` não prova impossibilidade; `budget-limited` informa interrupção; `failed`
indica falha de cálculo. O lote limita a geração a 50 avaliações, 2.000 nós e ao
tempo do runtime. `patchEvaluations` conta as avaliações. Não ranqueia dano nem
promete patch mínimo: confirme o ganho com `evaluate_variants`.

Itens sem bônus são válidos. Ausência de resultado pode ser limite da extração,
nunca é, por si só, evidência de um erro no item ou no motor.

### `optimize_build`

A busca pela build inteira: para cada slot de equipamento e de sombra, testa os melhores candidatos, **aceita a
troca que mais melhora a métrica** (`objective`, padrão `dps`) e passa ao próximo slot; repete por até
`rounds` rodadas ou até nada melhorar. Uma troca precisa passar de +0,1% (abaixo disso é arredondamento do motor).

```jsonc
{ "build": { "share": "…" }, "objective": "max",
  "lock": ["weapon"], "exclude": [470094],          // slots que não mudam; itens proibidos
  "refine": 11,                                      // refino das peças novas (padrão: o do slot)
  "maxGrade": "C",                                  // limita o grau (padrão: A, o ideal)
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

A resposta traz `procs`: o ganho individual de DPS de cada proc, medido contra a build final sem ele (até 10).
`optimize_build` usa `procMode: "average"` por padrão (3 ataques/s); `off` desliga os procs adicionais e `active`
os considera sempre ativos. `countProcs` continua compatível como atalho para off/active quando `procMode` não foi informado.
`procContext` informa os efeitos contados e excluídos. A média enumera estados de até três procs com chance/duração
conhecidas, supondo independência e ataques regulares; procs desconhecidos/excedentes não entram automaticamente.
HP mínimo usa o estado sem procs adicionais. Cada avaliação pode resolver vários estados internos, sob o mesmo limite de tempo.
Peças sem pool de bônus aleatório catalogado ficam fora da busca de rolagens e aparecem, com id e nome, em
`complementSearch.uncataloguedRandomItems`.

**Refino e grau, por padrão, no ideal.** Sem `refine` nem `maxGrade`, toda peça testada (inclusive a que a build já
usa) entra com +12 (o teto alcançável; acima disso é endgame alto) e grau A nas que aceitam grau, porque um grau maior nunca tira bônus: assim a busca mostra o melhor
que a build pode ser, e subir o refino ou o grau da peça atual aparece como um passo. `limits` na resposta diz o que
valeu. Para limitar, passe `refine` (refino fixo) e/ou `maxGrade` (`none`, `D`, `C`, `B` ou `A`): com `maxGrade`,
testa todos os graus até o teto nas peças que podem ser graduadas, e a base inteira (inclusive slots travados) deve
respeitá-lo; caso contrário, a chamada informa os slots a ajustar. `optimize_slot` aceita os mesmos dois parâmetros.
Mais graus e alvos consomem mais trabalho: confira `stopped` e o orçamento antes de interpretar a sugestão como
conclusão da busca.

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

### Refino alcançável, classes de alvo e procs

- **Refino:** o padrão da busca é +12; sombrios respeitam o máximo +10. Valores maiores para equipamentos normais só são testados se `refine` pedir.
- **Chefe e normal:** a mesma build rende diferente contra os dois (bônus e penetração por classe). Passe `targets` com um
  de cada; `perTarget` devolve o resultado em cada um e `context.classNote` avisa quando só um foi usado.
- **Procs:** `procs[].gainPct` é o ganho com o proc ligado o tempo todo. `average` traz a chance, a duração, o tempo
  ativo e o ganho médio por 1, 3 e 5 ataques por segundo (ou o `procHitsPerSecond` pedido), porque um proc de 5% por
  10 s fica ligado quase sempre a 5 ataques por segundo e menos da metade do tempo a 1. Uma peça forte sem proc pode
  ser mais estável, e melhor contra chefe, que uma com proc de chance baixa.

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
2. `explain_damage` para ver onde está o dano e o que ele deixa de fora (com `parts: ["refine"]`, o ganho de +1 e +2 refinos por peça; com `parts: ["upgrades"]`, o que vale mais investir: refino, grau, nível de cada encantamento e encantar um soquete vazio, um passo isolado de cada vez), e `optimize_stats` para os pontos de atributo.
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
| `MAX_SOLVES` | 10000 | avaliações de `optimize_build` e `optimize_stats` |
| `MAX_SEARCH_MS` | 45000 | tempo máximo de uma busca, em ms; ao esgotar devolve a melhor build até então |
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
- Avaliação dessas escolhas com beam de largura 3, sem corte fixo de oito candidatos
  por soquete. O esforço é repartido entre posições, movimentos e slots conforme o
  orçamento restante. O limite padrão do servidor é 10.000 avaliações.
  O resultado é reproduzível por patch/link. A busca continua heurística: só pode afirmar
  o melhor resultado entre as configurações efetivamente examinadas.

O levantamento do rAthena é referência; pools sem confirmação regional não
geram rolagens. Selo de Loki e os quatro selos inferiores têm perfis regionais
catalogados. O patch e o link incluem todos os complementos escolhidos.
Ver `docs/random-options-audit.md`.

O MCP calcula o que o motor sabe. Antes de agir numa recomendação:

- **Buffs de grupo** (Competentia, Benedictum, Presens Acies, …) vêm das tabelas do cliente e do rAthena, mas
  muitos **não foram conferidos com replay**. Os maiores ganhos de uma busca são os que mais merecem conferência.
- O **Óleo Ungido** aparece duas vezes (botão da classe e buff compartilhado) e o motor o fixa em Nv5; quem
  tem o Nv1 recebe um ganho menor no jogo.
- `calculate`, `optimize_slot` e `optimize_stats` usam efeitos explícitos. `scan_slot` e `evaluate_variants`
  aceitam `procMode`, com padrão off. `optimize_build` usa média estimada por padrão. O painel visual de comparação
  continua mostrando os efeitos selecionados; não representa uma média como um bônus permanente.
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

### Peça atual ajustada e níveis de comparação

- **Peça atual ajustada primeiro:** antes de comparar com qualquer troca, `optimize_build` ajusta o que a build já usa
  (melhores cartas, encantamentos e rolagens catalogadas), mesmo que o link não os traga; esses passos vêm com `atual`.
  Sem isso, uma peça sem rolagens no link perdia para uma troca que a busca alcançava antes dela.
- **`levelCheck`:** para cada slot que mudou, a peça nova e as melhores alternativas são medidas contra a atual em dois
  níveis, cada lado com seus melhores soquetes: o refino e o grau que você tem hoje (`now`) e os ideais (`evolved`).
  `verdict` diz se vence nos dois, só evoluída, só agora, ou não vence. `levelChecks: false` economiza cálculos.

### Alvos com defesa, objetivo e limites

- **Dummies com defesa** (ids 9000001 a 9000004, em `search_monsters`): cópias do Dummy - Neutro com as defesas dos chefes de
  nível 200+ dos dados (mediana e percentil 90), como normal e chefe, Médio e Grande. O alvo padrão, sem DEF, DEFM, TEN
  nem TENM, esconde penetração e redução de TEN; quando é ele, `context.undefendedNote` avisa e `defendedCheck` repete o
  resultado contra um chefe Médio e um Grande com defesa.
- **`avgHit`:** dano médio por golpe com chance de acerto e de crítico (o `dps` dividido pelos golpes por segundo). `max` é o
  golpe máximo e não conta crítico; `objectiveNote` avisa. Com rotação no link, `rotationDps` mede o ciclo inteiro.
- **`context.breakpoints`:** ASPD contra o teto (193) e ACERTO contra o necessário para 100% no alvo, com o que falta.
- **`aspdPotionCheck`:** quando o ASPD não está no teto, o ganho de trocar a poção de velocidade de ataque da build final.

### Varredura de slot e perfis de build

- **`scan_slot`** não filtra por palavra-chave: toda peça que a classe e o nível permitem passa pelo motor (centenas, em segundos),
  então acha a peça improvável. O resto da build é o do link; `base: "tuned"` (padrão) compara contra a peça atual já afinada
  (melhores soquetes e rolagens) e `"current"` contra a build como veio. Os `topSockets` melhores da varredura nua recebem a busca
  de soquetes e o ranking final usa esses valores. Conjuntos que dependem de outro slot aparecem em `partners`: só valem testados
  juntos (`evaluate_variants`, ou `optimize_build` com `pairs`).
- **`profile`** (`optimize_build` e `scan_slot`): `sustained` (padrão) mede o ciclo da rotação em regime, onde ASPD, conjuração e
  pós-conjuração contam (`rotationDps`; `dps` sem rotação); `burst` mede a abertura da rotação com as recargas livres (`burstDps`;
  `avgHit` sem rotação). `profiles` na resposta traz os dois para a build base e a final: uma peça pode ganhar a abertura e perder
  a luta longa.

### Custo da lista de ferramentas

O schema completo de `build` (cerca de 3,6 KB) é anunciado só em `calculate`; as demais ferramentas anunciam `share` e a lista dos
campos, e validam a build contra o schema completo ao receber (`compactBuildSchema`, `pipe`). A lista de ferramentas caiu de cerca de
62 KB para 39 KB mesmo com `scan_slot` a mais; um teste (`tools.spec.ts`) segura o teto. Cada ferramenta que se sobrepõe às outras
abre a descrição com "USE para… NÃO use para…", para a escolha não depender de inferência.

### Guia sob demanda, resposta curta e cenários

- **`guide`** devolve o índice de tópicos ou a receita de um (`fluxo`, `melhorar-build`, `comparar-pecas`, `achar-peca-improvavel`,
  `alvos`, `perfil`, `proc-ou-estavel`, `ler-resposta`, `tank`). As instruções do servidor ficaram curtas e apontam para ele; o texto de
  cada tópico só custa tokens quando é lido. Quem muda uma ferramenta atualiza o tópico (`mcp/src/tools/guide.ts`); um teste falha se o
  guia citar uma ferramenta que não existe.
- **Resposta curta por padrão** em `optimize_build`: números, caminho (`steps`), `patch`, `share`, `profiles`, `perTarget`, `levelCheck`,
  `defendedCheck`, `procs` e `alerts` (o que muda a leitura). `detail: true` traz também o contexto do alvo, candidatos, alternativas e
  as notas que explicam cada bloco.
- **Cenários** (`mcp/src/tools/scenarios.spec.ts`): pedidos típicos, a ferramenta esperada e uma chamada que roda. O teste confere que a
  chamada responde e que o tópico do guia cita a ferramenta. A mesma tabela serve de corpus para medir um agente de verdade: dê a ele só
  o `ask` e as instruções, e compare a ferramenta e os argumentos que escolher com `tool` e `args`.

### Ler o ganho: troca, refino/grau e ajuste

O `optimize_build` testa por padrão com refino +12 e grau A, então um "+116%" mistura tudo. Os testes com agentes reais (duas builds de
Inquisidor) mostraram que isso engana, e a resposta agora separa:

- **`gainByKind`**: o ganho total quebrado em `ajuste` (a peça que você já usa, com os melhores soquetes e rolagens), `refinoGrau` (subir
  o que você já usa até +12/A) e `troca` (outra peça). Cada passo de `steps` traz o seu `kind`.
- **`changes`**: o que pôr onde, em palavras: peça de/para, refino, grau, soquetes e rolagens. O `patch` continua, para quem encadeia ferramentas.
- **`alerts`** ganhou três avisos: queda de HP maior que 5% (com o `require` para repetir), quanto do ganho vem de rolagens do rAthena não
  confirmadas (e o ganho sem elas), e a parcela do ganho que é só refino e grau.

- **Um passo só para o ajuste:** o ajuste de tudo o que você já usa aparece como um passo (`kind: "ajuste"`, com a lista de `slots`), não
  um por peça. `parse_share_link` não devolve mais o preset bruto (`buildInput`, ~5 KB) a não ser com `raw: true`: todas as ferramentas
  aceitam o `share`.
- **Procs perdidos:** se a busca troca uma peça com proc, `alerts` informa o ganho individual ligado e a estimativa média,
  junto da política de procs usada para ordenar a busca.

### Pesquisar uma skill sem otimizar

1. `get_skill({ classId: 4262, skill: "Fogueira Espiritual", level: 5 })`: descrição do cliente, tempos e dependências documentadas da fórmula.
2. `search_items({ classId: 4262, skill: "Fogueira Espiritual", synergy: true, slot: "headCard" })`: bônus diretos e HP/HP%/VIT relevantes.
3. `get_item({ id: 300174 })`: descrição, bônus e condições da Carta Derreting. `slot_options` consulta opções do equipamento por posição.
4. `evaluate_variants`: medir as combinações propostas na mesma build/alvo; `share_link` permite levá-las ao editor.

Esse fluxo não chama o otimizador. `get_skill` cobre habilidades ofensivas; a documentação de dependências indiretas
ainda é parcial (inclui Fogueira). Não encontrar um bônus nessa ficha não prova que ele seja irrelevante.
Detalhes da divisão de recursos entre calculadora e MCP em [build-analysis.md](build-analysis.md).

## Auditoria e cartas de MVP

- `validate_build` é a primeira chamada de uma consultoria: um erro (`INVALID_SLOT`, `INCOMPATIBLE_CLASS`, `REQUIRED_LEVEL`, `INVALID_REFINE`, `INVALID_ENCHANT`, `ITEM_NOT_CALCULABLE`, `ITEM_NOT_AVAILABLE_LATAM`, `UNKNOWN_ITEM`, `MVP_CARD_EXCLUDED`) significa que o número daquela build não é confiável. Valida limites e orçamento de atributos; a árvore de habilidades é referência de avisos, conforme explicado abaixo.
- A classificação de carta de MVP está em `src/app/constants/mvp-cards.ts`. O LATAM não traz tabela de drops: a lista cruza o nome da carta com os MVPs de `constants/mvp.ts` e inclui à mão as que mudam de nome. Carta em dúvida está na lista (bloquear a mais é mais seguro). O filtro vale para a **carta**, nunca para o alvo.
- `evaluate_variants` valida cada variante com as mesmas regras do `validate_build` e recusa, no modo estrito padrão, qualquer variante com erros (carta deixada em peça sem encaixe, peça que a classe não usa, carta de MVP com `excludeMvpCards`): ela volta em `errors` com `status: "invalid"` e `code`, sem número; erro de cálculo volta como `status: "failed"`; as medidas trazem `status: "ok"`. No modo padrão estrito, erros herdados também bloqueiam a variante. Só `validationMode: "hypothetical"` permite erros herdados e excesso de pontos, identificados com status e avisos. O `optimize_build` e o `scan_slot` não propõem a carta e, se a build já usa uma, mantêm-na e avisam em `alerts`.
- Roteiro para o agente: tópico `consultoria` do `guide`.

## Orçamento e cobertura da busca

- O orçamento de cálculos do `optimize_build` tem fases: **descoberta** (medir cada item elegível sem soquetes; até 35%, repartidos entre os slots, o que um slot não usa passa ao seguinte), **ajuste do que a build já usa** (até 75% somados) e o resto para a busca de trocas e a passada final nos soquetes. Antes, os primeiros slots (a arma tem centenas de candidatos) consumiam um orçamento curto e a busca de trocas nem começava.
- O líder do ranking por habilidade é sempre medido no objetivo real, mesmo com o orçamento esgotado: o melhor candidato parcial não se perde.
- `coverage` na resposta: `slots` (alcançados/total e `notReached`), `candidates` (medidos/disponíveis e `notMeasured` por slot), `worn` (peças ajustadas), `sockets` (conferidos/total), `calculations` (descoberta, avaliação, reaproveitados) e `complete`. `complete: false` significa "o melhor entre o que foi medido", não "o melhor possível".
- `validate_build` também confere limite de nível e de atributos, orçamento de pontos de atributo e habilidades desconhecidas ou com nível inexistente. Pré-requisitos, nível máximo, nível exigido e pontos da própria classe vêm da árvore do **kRO** (`data/skill-tree/rathena-skill-tree.json`, gerada por `tools/build-skill-tree.mjs` a partir de `skill_tree.yml` e `skill_db.yml` do rAthena): só aparecem como **avisos** (`SKILL_PREREQUISITE_NOT_MET`, `SKILL_ABOVE_TREE_MAX`, `SKILL_LEVEL_REQUIREMENT`, `SKILL_POINTS_OVER_BUDGET`), nunca como erro, porque a árvore não está confirmada no LATAM. Um pré-requisito só conta como faltando se o calculador guarda o nível aprendido dele (seletor passivo): um toggle desligado (Oleum Sanctum 5/0) não prova que a habilidade não foi aprendida. O orçamento de pontos (1 por nível de classe) soma só as habilidades que o calculador modela, então é um mínimo. No `evaluate_variants`, pontos além do orçamento do nível recusam a variante por padrão; no modo explícito `hypothetical`, saem em `warnings` com `status: "hypothetical"`. Máximo de atributo, nível e habilidade inexistente continuam recusando erros novos.
- Valores de referência do motor (habilidades do Inquisidor, builds de bancada, conjuntos): `mcp/src/engine/reference-golden.spec.ts`. É o que o calculador diz hoje, não o que o jogo diz; regenere com `UPDATE_GOLDEN=1` só para uma correção deliberada.

## Dependências das habilidades e pools do rAthena

- `get_skill` informa em `scaling.inputs` de que a fórmula depende (POD/STA/SAB/FEI/CON/CRV, HP máximo, SP máximo) e em `bonusKeys` as chaves de bônus que alimentam isso. As entradas são lidas **executando a fórmula** uma vez com uma entrada que registra o que ela toca (`formulaInputs` em `src/app/core/skill-synergy.ts`), então valem para todas as classes e versões (inclusive as fórmulas do rebalanceamento) sem uma segunda tabela. Só enxerga o ramo que a fórmula toma sem buff ou estado ativo e não vê o que a classe guarda no próprio estado (por exemplo, o peso do carrinho).
- Os pools de bônus aleatórios do rAthena (kRO) são aceitos como referência do LATAM: a busca os usa sem o alerta "não confirmado" e sem o cálculo extra do ganho sem eles; `unconfirmedRolls` continua dizendo de onde a rolagem veio. Itens que rolam e não têm pool em nenhuma fonte (Marionete de Thanatos-LT, Pingentes da Força Física/Mental-LT) seguem fora da busca de rolagens (`uncatalogued_pools`).

## Correções de contrato (patch, crítico, solves, MVP estrito)

- **Links curtos:** toda ferramenta que recebe `build.share` resolve o link curto antes de ler (`normalizeShare`), inclusive `validate_build`.
- **`scan_slot`:** cada linha é anunciada com o número que o próprio patch dá: os patches devolvidos são medidos de novo (alguns cálculos, fora do orçamento) e o ranking usa esse valor. Com `includePatches`, `reference.patch` traz o patch da peça atual afinada.
- **Crítico:** `explain_damage` com a parte `crit` (padrão) traz `skillChancePct` (a chance que a habilidade realmente rola contra o alvo, igual a `calculate.damage.skill.critRate`) e os passos do cálculo (crítico do personagem, parte que a habilidade aplica, escudo do alvo). `get_skill.crit` diz se a habilidade crita, que parte do crítico do personagem aplica e que parte do dano crítico.
- **`get_skill.structure`:** acertos, elemento, acúmulos, segundo pacote, dano fixo, ajuste do dano final e da precisão, como dados.
- **`solves`:** conta cálculos feitos (não repetições do cache); a passada final nos soquetes aparece à parte em `coverage.calculations.socketPass`.
- **`strictMvp`:** no `optimize_build`, a build final não tem nenhuma carta de MVP (`mvpFree: true`): as que a build já usa saem primeiro (passo `semMvp`) e os soquetes são procurados de novo sem elas. Falha com mensagem clara se uma está numa peça travada em `lock`. `excludeMvpCards` continua sendo o modo brando (mantém as que você já usa e avisa).
- **`atkSkill`:** aceita `Nome==nível`, o nome sem nível (usa o nível máximo), o nome em pt-BR ou o id. Habilidade que a classe não tem ou nível que ela não oferece é **erro** (com a orientação de usar `list_skills`); antes o cálculo trocava em silêncio pela habilidade padrão da classe e a resposta só mostrava o outro nome. Um link antigo cuja habilidade não existe mais continua caindo no padrão, com aviso em `warnings`.

## Dependências condicionais das habilidades

`get_skill.dependencies` rastreia os callbacks existentes de fórmula, crítico,
precisão, dano fixo/final, fórmula customizada, segundo pacote e ratio. Expõe
caminhos de entrada lidos e skills consultadas como ativas, em nível ativo ou
aprendidas, com IDs e a origem de cada leitura. Usa amostragens ativas/inativas
e numéricas e restaura as leituras locais da classe ao terminar.

`coverage: observed-branches` é observação, não prova de todos os ramos possíveis
nem de todo estado privado. Nenhum dano amostrado é usado como recomendação.
`scaling` continua trazendo as dependências e descrições já existentes; use
`dependencies` para formular hipóteses condicionais e `calculate`/`evaluate_variants`
para verificar a build concreta. Não há outra tabela de fórmulas.
