# Acquisition ↔ Optimize: proposta de integração

Data: 2026-11-05. As seções 1 a 6 são a proposta original; as seções 7 a 9 registram o que foi implementado. Sem mercado, zênis ou nova política de custo-benefício.

## 1. Como `optimize_build` retorna hoje

`optimizeBuild` (`src/app/build-analysis/operations/optimize.ts`) devolve **uma** build final: `baseline`, `final`, `steps`, `changes`, `patch`, `share` (link da build final), `alerts`, `coverage` etc. Não há lista de finalistas nesse retorno. Finalistas existem em `scan_slot` (`ranking`, com `share` só para as 3 primeiras). `get_acquisition` já aceita `builds: [{ share }]`, então o resultado de qualquer uma das duas ferramentas é consumível sem adaptação.

## 2. Menor integração

Anexar o diagnóstico **depois** da busca, a pedido, reutilizando o serviço da Fase 3.

1. Em `mcp/src/tools/optimize.ts`, o handler de `optimize_build` ganha um parâmetro opcional `acquisition?: 'brief' | 'full'` (ausente = nada muda, custo zero).
2. Com o parâmetro, após `operations.optimizeBuild(args)` o handler chama o mesmo `createAcquisitionOperations(...).assess({ builds: [{ share: result.share }], asOf })` já usado por `get_acquisition` (import dinâmico: o catálogo de 3,1 MB só carrega quando pedido) e devolve o resultado em `result.acquisition`.
3. Nada entra no Greedy, na ordenação ou no filtro de candidatos; a análise roda uma vez, na build final, fora da busca. Sem nova ferramenta MCP e sem novo contrato: o objeto é a saída de `get_acquisition`.
4. A mesma regra serve a `scan_slot` (anexar às 3 linhas com `share`) num passo posterior.

Fora do escopo: excluir ou penalizar candidatos sem informação de obtenção.

## 3. Peça-base versus configuração exata

O serviço já avalia cada componente separado (`aspect`: item, enchant, refine…), mas o resultado não diz explicitamente que obter a peça não é obter a configuração. Proposta de campo derivado, calculado a partir dos diagnósticos (sem novo dado):

```
configuration: {
  base:    'documented' | 'partial' | 'undocumented',   // itens da build
  exact:   'unknown' | 'documented_unconfirmed' | 'confirmed_incomplete' | 'confirmed',
  notCovered: ['refine', 'grade', 'card', 'randomOption']   // aspectos sem nenhuma regra no catálogo
}
```

Regras: `exact: confirmed` só se todo componente tiver rota `confirmed` e nenhum `insufficient`; refino, grau, cartas e opções aleatórias entram em `notCovered` enquanto não tiverem rota (hoje `undocumentedByAspect` já os contabiliza). Assim o Diadema Temporal pode ter `base: documented` e `exact: confirmed_incomplete` (a Insígnia 10 é confirmada, mas o refino atual não é coberto). Requisitos e riscos só aparecem quando existe evidência: `exceptional`, `insufficient`, `chance: unknown` e `unknowns` já vêm das rotas.

## 4. Custo em tokens (medido)

Chamadas reais de `get_acquisition` com `builds`, em caracteres do JSON (≈ 3,5 caracteres por token):

| Build | Caracteres | Rotas | Fontes |
|---|---|---|---|
| Diadema Temporal Arcano 19482 + Insígnia da Virtude 10 (29080) | 4.588 | 3 | 3 |
| Arma Vil Invernal 500054 + Cristal Invernal (Grau Físico 5) 311453 | 7.218 | 4 | 7 |
| As duas peças | 11.311 | 7 | 10 |

No caso combinado, `routes` ocupa 6,8 mil e `sources` 2,6 mil; `builds` só 2,2 mil. Rotas `unreviewed` do RagnarokDB (drops em `jor_dun01`) pesam sem acrescentar decisão. Modo `brief`, a implementar junto: devolver só `builds` (componentes com status, disponibilidade, chance, `exceptional`, `insufficient`, ids das rotas, `configuration`) mais, por componente, as duas melhores rotas resumidas (id, método, chance, materiais, `requires`), sem tabela de fontes (apenas ids, resolvidos por `get_acquisition`). Estimativa: cerca de metade do modo `full`, a confirmar na implementação. O modo `full` é exatamente a saída atual.

Custo de tempo: uma decodificação de `share` e uma avaliação por componente, sobre a build final apenas. O catálogo cresceu para 3,16 MB; deve ser conferido contra o limite de bundle do Worker e o teto de 50.500 caracteres da lista de ferramentas (`tools.spec.ts`), que o novo parâmetro precisa respeitar.

## 5. Incremento mínimo da próxima entrega

Uma entrega única, comportamento aditivo:

1. Parâmetro `acquisition` em `optimize_build` (e depois `scan_slot`), modos `brief` e `full`.
2. Campo derivado `configuration` no serviço compartilhado, com testes.
3. Saída que apresenta: a build recomendada (`share`), as rotas conhecidas por componente, requisitos excepcionais (`exceptional`), probabilidades exatas em fração e incertezas (`chance: unknown` ≠ 0%), e `availability: unconfirmed` quando falta confirmação LATAM.
4. Testes com fixtures reais: Diadema Temporal (19482 + 29080: base confirmada, evento, `exceptional`, troca +17) e Arma Vil Invernal (500054 + 311453: custo documentado, `chance: unknown`, `insufficient`). Verificar também que o ranking e o `solves` do `optimize_build` ficam idênticos com e sem o parâmetro.

## 6. Pontos de integração com a UI

Proposta original (implementada na seção 8). O serviço (`createAcquisitionOperations`, `assessAcquisition`) é puro e roda no cliente. O ponto natural é o painel de resultado do Optimize: ao exibir a build final, chamar `assess` sobre a mesma build, em carga preguiçosa (o catálogo é um chunk separado), e mostrar por peça um selo de estado (documentado, incompleto, sem confirmação LATAM) com as rotas em detalhe expansível. O texto de interface deve reutilizar as mesmas chaves (`status`, `availability`, `chance`) e seguir a regra de que ausência de rota é "sem informação", nunca "impossível".

## 7. Implementação (2026-11-05)

Implementado o escopo mínimo: `optimize_build` aceita `acquisition: 'brief'`. Sem o parâmetro nada muda. Com ele, depois da busca, o handler MCP (`mcp/src/tools/optimize.ts`) chama `createAcquisitionOperations(...).brief({ original, final })`, em import dinâmico (o catálogo continua em chunk separado). Nada entra no Greedy, no ranking, nos candidatos, nas fórmulas ou no orçamento. Se o diagnóstico falhar, o resultado da otimização é devolvido intacto e `acquisition` vira `{ status: 'unavailable', reason }`. Não há modo `full`: o detalhe completo é `get_acquisition` com `builds: [{ share }]`.

**O que o `brief` avalia.** Só o que a build final muda ou acrescenta em relação à original (`src/app/build-analysis/acquisition/brief.ts`): item-base novo (todos os componentes dele são novos), refino ou grau maior, carta, encantamento, opção aleatória e item de sub-slot diferentes. Peça preservada, refino/grau menor e componente igual não são aquisição; entram só na contagem `components.preserved`. Os caminhos usam as mesmas chaves de `assessAcquisition` (`equipmentFacets` foi extraído de lá; o contrato dos diagnósticos não mudou).

**Campo `configuration`** (derivado, sem dado novo):
- `level`: `unchanged`, `complete` (todo componente novo com rota documentada, confirmada no LATAM, sem insuficiência; não significa fácil nem garantido), `partial`, `undocumented`.
- `components`: `changed`, `preserved`, `documented`.
- `withoutProcedure`: contagem por aspecto e até 8 nomes de itens/encantamentos. Ausência de procedimento é falta de informação, não impossibilidade.
- `expiredOnly`, `unknownChance`, `unconfirmedLatam`: contagens.

**Saída (`brief`).** Prioriza o que ajuda a decidir. `alerts` nomeia os componentes por tipo: `expired` (evento encerrado), `exceptional` (evento ou requisito excepcional) e `lowChance` (chance conhecida abaixo de 1%). Esses alertas nunca são cortados para caber em tamanho. Cada entrada de `changed[]` (componentes com rota documentada, agrupados por item, aspecto, status e rotas, com `paths` quando o grupo tem mais de um slot) traz `alert`, item, aspecto, status, disponibilidade, chance, `route` (método, monstro e mapa, chance em fração ou `n/d`, até 2 requisitos de 90 caracteres, `until`) e `otherRoutes`. Ordem: encerrado, excepcional, chance baixa, resto. Só o resto sem alerta é limitado a 8 entradas (`omitted` conta o que sobrou). Contagens e procedência continuam: `configuration`, `uncertainties` e `sources` (contagem por host). O detalhe completo continua sendo `get_acquisition`.

### Medição (bench, objetivo `dps`, mesmo alvo; 3 builds)

| Build | Resposta sem | Com `brief` | Adicionado | Tokens (≈3,5 car./token) | Resultado idêntico |
|---|---|---|---|---|---|
| b1 | 13.334 B | 17.558 B | 4.224 B | ~1.200 | sim |
| b2 | 12.412 B | 16.888 B | 4.476 B | ~1.280 | sim |
| weak | 13.836 B | 19.853 B | 6.017 B | ~1.720 | sim |

Histórico do tamanho adicionado: 14–19 KB na primeira versão, 3,6–5,4 KB na segunda (cortava entradas) e 4,2–6,0 KB na final, que mantém todos os alertas e a procedência. O cálculo do `brief` leva 5–39 ms, ruído diante de uma busca de 16–23 s; DPS, build final, `patch` e ordenação são idênticos com e sem o parâmetro (comparados campo a campo nas três builds). Sem `acquisition` a resposta não muda.

### Utilidade e limites

Em b1, 51 componentes mudam e só 12 têm rota documentada, todos `unconfirmed` e `insufficient`: o nível é `partial`. O resumo diz o que importa (cartas com drop de 1/10000 e monstro, uma manopla com chance desconhecida, 39 componentes sem procedimento: 9 itens, 9 encantamentos, 8 refinos, 5 graus, 8 opções aleatórias), mas a cobertura do catálogo ainda é baixa para builds completas; nesses casos o `brief` mostra principalmente lacunas. Refino, grau e opções aleatórias não têm rota alguma no catálogo. Nos fixtures Diadema Temporal e Arma Vis Invernal o resultado é útil: encantamento excepcional confirmado (Temporal), rota expirada, chance desconhecida e disponibilidade não confirmada ficam distintos (testes em `mcp/src/tools/optimize-acquisition.spec.ts`).

### Worker e MCP

`node tools/build-worker.mjs`: o catálogo vira o chunk `acquisition-*.js` de 1,8 MB minificado (78 KB com gzip; todos os chunks juntos ≈ 743 KB gzip). Só é carregado por uma chamada que o peça (o `index.js` de entrada tem 3 KB). O JSON bruto (3,16 MB) não é o tamanho de deploy. Não foi feito deploy nem consultado o limite do plano da conta no Cloudflare: **confira esse limite antes de publicar**. A lista de ferramentas do MCP passou do teto de 50.500 caracteres com o novo parâmetro; o teto foi mantido e as descrições foram enxugadas.

## 8. Interface (painel no resultado do Optimize)

`src/react/views/acquisition-panel.tsx`, renderizado em `build-improvements.tsx` logo abaixo do resultado, sem nova tela nem novo fluxo de otimização. É um `<details>` recolhido; ao abrir, uma única requisição somente leitura (`mode: 'acquisition'`, `original` + `patch`) vai ao Worker de análise, que usa o mesmo serviço (`createAcquisitionOperations`) e carrega o catálogo por import dinâmico. Não chama o motor de dano. O detalhe de cada item (`mode: 'acquisitionItem'`) só é pedido ao abrir "Detalhes e fontes".

- Mostra resumo (novos, documentados, preservados), nível da configuração, a nota de que peça-base não é configuração exata, alertas por tipo, contagens de disponibilidade não confirmada e chance desconhecida, as entradas, e o grupo recolhido "Sem procedimento documentado", com a revisão da base e as fontes por host.
- "Rota documentada" nunca é apresentada como disponibilidade confirmada: o texto da disponibilidade vem à parte (confirmada, não confirmada, só encerradas, só futuras). Falta de dado diz "sem informação na base, não impossível"; a interface não apresenta nenhuma configuração como inviável.
- Se a análise falhar (inclusive o chunk do catálogo não carregar), o painel mostra um aviso (`role="alert"`) e a build otimizada, a tabela e o botão de comparar permanecem intactos.
- Textos em PT-BR, ES e EN (`acq.*`). Links de fonte só para `http(s)`.
- Orçamento: o chunk do catálogo é medido à parte em `tools/web-budgets.json` (`acquisitionChunkError`, 2,1 MB); o orçamento do Worker de análise passou a excluí-lo. O início da página já excedia o aviso de 2,3 MB (2,43 MB, abaixo do erro de 2,47 MB); as chaves de tradução somam cerca de 2,5 KB.

## 9. Encerramento do MVP

**Estado: MVP funcional.** A Acquisition Knowledge Base responde, para uma build otimizada, o que mudou, se há rota documentada, se há confirmação LATAM, a chance conhecida e o que é evento encerrado, excepcional ou sem informação, no MCP (`acquisition: 'brief'`, `get_acquisition`) e na interface.

**Validação.**
- Fixtures Diadema Temporal e Arma Vis Invernal mais três builds reais do Optimize (b1, b2, weak).
- Dano e `patch` idênticos com e sem `acquisition`.
- Evento encerrado identificado (`alerts['expired']`); chance desconhecida continua desconhecida.
- Configuração exata distinguida da peça-base; peça preservada não é aquisição.
- O `brief` não chama o motor de dano (`engineCallCount()` não muda).
- Painel testado com dados completos, parciais, ausentes e com falha, e em 390 px; a interface continua responsiva porque o trabalho roda no Worker e só depois de abrir o painel.
- Testes: `e2e/acquisition-panel.spec.ts` (9) e `e2e/build-improvements.spec.ts` (5) passam; vitest de `src/app`, `mcp/src/tools` e `tools`; os quatro `tsc` (worker, backend-tests, react, app) limpos; build de produção da web e do Worker.
- Na execução completa em paralelo, 5 testes sensíveis a tempo falharam por carga (`optimize.spec.ts` e `tools.spec.ts`); isolados, passam.

**Resultado real (b1, b2, weak).** Os três ficam em `partial`. Alertas: chance baixa em 9, 5 e 7 componentes (cartas a 1/10000), excepcional em 1 (b2, Insígnia do Talento 10), encerrado em 0. Em b1, cerca de 39 componentes ficam sem procedimento (peças, encantamentos, refino, grau, opções aleatórias). Uma carta mantida em uma peça nova conta como componente novo, porque a peça-base mudou (decisão conservadora de `changedComponents`).

**Limitações.** A cobertura do catálogo é baixa para builds completas, e refino, grau e opções aleatórias não têm rotas. Chance e disponibilidade seguem a documentação regional, sem teste em jogo. Não há preço, mercado, score de dificuldade nem mudança de ranking. O limite do Worker no plano Cloudflare não foi verificado.

**Backlog incremental (não bloqueia).** Ampliar as rotas do catálogo por demanda de builds reais (itens, encantamentos), rotas de refino, grau e opções aleatórias, confirmar a disponibilidade LATAM por fonte oficial e declarar posse na interface. Nenhuma nova fase de enriquecimento foi iniciada.
