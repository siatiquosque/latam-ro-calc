# Conhecimento de obtenção LATAM — Fase 1

Este documento preserva o retrato inicial. A evolução do contrato, o pipeline e a cobertura atual estão em [acquisition-knowledge-phase2.md](history/acquisition-knowledge-phase2.md).

Estado: **MVP funcional** (integrado ao Optimize no MCP e na interface; ver [acquisition-optimize-integration.md](acquisition-optimize-integration.md), seção 9; lacunas de dados são backlog incremental). Revisão documental em **05/11/2026**. Frente independente do Optimize V1. Não altera ranking, fórmulas, contratos públicos, benchmarks, filtros mecânicos nem transporte MCP.

## Arquitetura e contratos

- `src/app/build-analysis/acquisition/contracts.ts`: contrato normalizado **schemaVersion 1**, validação Zod e revisão append-only.
- `data/acquisition/latam.v1.json`: 67 rotas regionais, sete grupos de Insígnias (70 IDs de encantos) e seis registros de efeitos dos dois pares Sombrios. Dados pequenos o suficiente para inclusão direta, sem serviço ou armazenamento externo.
- `catalog.ts`: valida o JSON na entrada. Nenhuma dependência de Node, rede ou UI no runtime.
- `assess.ts`: consulta pura compartilhável por Optimize, MCP, validador e UI; hoje nenhum desses consumidores a chama automaticamente.
- `tools/import-acquisition.py`: extração offline seletiva para **candidatos genéricos não revisados**, separada da curadoria regional. Os dois JSONs experimentais não são carregados pelo catálogo padrão.

`AcquisitionKnowledge` reúne fontes, grupos de encantos, rotas e efeitos. A identidade usa IDs numéricos locais; `aegisName` serve apenas para resolver a importação, nunca nomes traduzidos como chave. Grupo de Insígnia tem ID estável e mapeamento explícito nível → itemId. `family` agrupa o equipamento/procedimento; não é identidade do encanto.

Cada rota tem identidade/revisão imutável, alvo (IDs da peça, aspecto, posição 0..3 e IDs do encanto ou intervalo de refino/grau), servidor, período, fontes, confiança, revisão, requisitos, transições, distribuição de resultados, propriedades resultantes, custo e lacunas. Requisitos distinguem equipamento, material, NPC e procedimento. Restrições adicionais não normalizadas ficam descritas, sem serem silenciosamente interpretadas.

`success` é a chance da operação, não a chance de construir toda a configuração. Em evolução com várias etapas, é `null`: cada transição tem sua própria chance e falha. Nas Lágrimas, a operação é garantida, mas o nível é sorteado em `outcomes`. `guaranteedForRequestedOutcome` permanece falso para essas rotas. Campos resultantes ainda não confirmados, como preservação do refino na troca do Atemporal, ficam `unknown`; o texto oficial não autoriza inferi-los.

Valores econômicos desconhecidos são `null`, nunca zero. `difficulty` é classificação editorial com motivo (`ordinary`, `high`, `unknown`), não preço ou expectativa estatística. Zeny conhecido é separado de preço de mercado. Materiais da evolução são **por tentativa**: regressões tornam incorreto somar as etapas uma vez ou aplicar simplesmente `1/p`. Não há cálculo de custo esperado nesta fase.

Fontes registram URL canônica, versão, data de leitura, SHA-256 do documento lido, localização da evidência, licença e eventual intermediário. O SHA é do conteúdo consultado, não necessariamente do HTML original. `reviewed` significa leitura documental regional; `confirmed` nesta versão significa regra explícita na notícia oficial, **não teste em jogo**. Confiança não substitui estado de revisão nem servidor.

`reviseKnowledge(base, additions)` mantém a regra anterior, exige novo ID, motivo e `supersedes` explícito para substituição. Extração não revisada não pode substituir regra revisada; regra confirmada exige sucessora confirmada; regra genérica não substitui regra regional. IDs de fontes e grupos também são imutáveis. Uma alternativa sem `supersedes` apenas complementa o catálogo. Não existe escrita automática nem promoção por prioridade de arquivo. Histórico é mantido no JSON e posteriormente no Git; não há commit nesta entrega.

## Consulta interna

```ts
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { assessAcquisition } from 'src/app/build-analysis/acquisition/assess';

const resolved = resolveBuild(input, dataset);
const assessment = assessAcquisition(resolved, 'LATAM', {
  asOf: '2026-11-05',
  requireGuaranteed: false,
  owned: [{
    itemId: 19482, refine: 12, grade: '',
    attachments: { headUpperEnchant1: 29080 },
    acquiredOn: '2026-10-10',
  }],
});
```

A entrada é `{ model: MainModel }`, já resolvida pelo contrato existente. A UI pode passar seu MainModel; share/preset e overrides precisam passar por `resolveBuild`. Não foi criado outro BuildInput nem adaptador público.

Retorna `diagnostics` por componente, com caminho, ID, aspecto, status, motivo, **todas as rotas correspondentes**, requisitos e fontes completas. Os estados são:

| Estado | Significado |
| --- | --- |
| `obtainable` | Procedimento regional documentado, ativo e comum, condicionado aos requisitos descritos. Não prova estoque de materiais. |
| `difficult` | Rota ativa documentada, porém onerosa/probabilística ou com dificuldade econômica desconhecida. `requireGuaranteed` impede tratar rota não garantida como comum. |
| `expired_routes` | Existe evidência de rota encerrada e nenhuma rota ativa suficientemente documentada no catálogo; não declara impossibilidade atual. |
| `insufficient_information` | Regra ausente, lacuna impeditiva, servidor não confirmado, período desconhecido ou rota futura. |
| `owned` | Posse **declarada pelo usuário** da configuração exata, em data anterior à consulta. Não verifica inventário externamente. |

Rotas têm `availability: active | expired | future | unknown`. Uma configuração pode ser `difficult` pela evolução normal e ainda apresentar a alternativa do evento como `expired`. Não se descarta a evidência expirada.

Item base, cartas/encantos, refino, grau e bônus aleatórios são diagnósticos separados. Não há selo agregado de “build inteira obtenível”, composição automática de cadeias ou prova de compatibilidade entre duas rotas. Uma rota para o item base **não** aprova seu refino/encantos. Bônus aleatórios e encantos visuais sem rotas ficam desconhecidos. Custom attachments são lidos, mas obter um item customizado continua sem evidência regional própria.

Posse exige mesmo item, refino, grau, anexos e bônus aleatórios. Ter a peça sem o encanto não comprova posse da peça encantada. Data futura não satisfaz posse. O fim de um evento não invalida equipamento já produzido. Datas de rota são civis inclusivas (`YYYY-MM-DD`); o horário da manutenção não foi publicado como instante inequívoco. Passe `asOf` explicitamente para decisões históricas; sem ele usa-se o dia UTC atual.

`mechanicalValidity: not_assessed` e `economicCost: null` são intencionais. Continue chamando `validateBuild` para legalidade e usando o motor para efeitos numéricos. Obtenção não é erro mecânico. `effects` informa efeitos funcionais ativos por conjunto e sua cobertura no motor, sem adicioná-los ao DPS.

## Auditoria do que já existe

| Estrutura | Reuso e limite |
| --- | --- |
| `src/assets/demo/data/item.json`, `ItemModel`, `docs/item-json.md` | Identidades, propriedades, refino, scripts e bônus estruturados. Não contêm preços ou procedimentos de fabricação. |
| `latam-items.json` / `latam-items-{en,es}.json` | Nomes, Aegis, descrição, slots do cliente via ragassets. Presença no cliente não comprova NPC, lançamento, estoque ou disponibilidade atual. A versão local e SHA estão nas fontes. |
| `tools/build-web-data.mjs`, `ItemIndex` | Mesclam dados e derivam `presentInLatam`, `latam`, `inCalcDb`, `preRelease`. Esses flags continuam com a semântica existente; não foram convertidos em prova de aquisição. |
| `constants/enchant_item/_enchant_table.ts`, `equipment-slot-derivation.ts` | Pools por Aegis/posição. Não modelam sequências de NPC, probabilidade ou regressão. |
| `core/equipment-rules.ts`, `utils/can-grade.ts`, `utils/to-grade-list.ts` | Limites mecânicos: equipamentos até +20, Sombrios até +10, elegibilidade de grau. Não são rotas ou chances de atingir esses valores. |
| `core/random-option-catalog.ts`, `data/random-options`, `item-options-table.ts` | Pools e proveniência de bônus aleatórios. Uma opção permitida não prova acesso econômico ao sorteio. |
| `app-config/equipment-slots.ts`, `MainItemWithRelations` | Slots e anexos canônicos. A consulta reutiliza os descritores e índices de opções, sem inventar outra lista de slots. |
| `build-analysis/engine/build-input.ts`, `validate.ts` | Resolução compartilhada e validação mecânica; `unknowns` já evita tratar informação ausente como sucesso. Não foram alterados. |
| `build-analysis/data/dataset.ts`, `operations`, `browser-protocol.ts`, `mcp/src/tools`, `worker/mcp` | Core compartilhado e adaptadores já existentes. Integração futura deve ocorrer aqui, não duplicando regra nos transportes. |

Lacuna mecânica identificada: os pools `labHead2`/`tempHead2` atuais não oferecem nível 1 das Insígnias nem a família Afeição, embora constem na evidência de aquisição. Isso é uma divergência de cobertura do picker, não uma autorização para ampliar pools ou mudar validação nesta tarefa. A base de aquisição pode conhecer um resultado que a interface atual não oferece; cada consumidor deve manter ambos os diagnósticos.

## Auditoria rAthena e cobertura real do importador

Commit consultado: `d4b8e7b8f16061cc2496d377ac8f777ce72a4f39`. Os conteúdos de reforma e encantamento importados foram conferidos contra as URLs fixadas nesse SHA. Cabeçalhos encontrados:

| Arquivo | Formato auditado | Importação nesta fase |
| --- | --- | --- |
| `db/re/item_enchant.yml` | `ITEM_ENCHANT_DB` v1; TargetItems, mínimo de refino/grau, Order, Slots, Reset, sorteios por grau, PerfectEnchants e Upgrades. Chance normal/reset em escala 100000; pesos de resultados precisam ser tratados separadamente. | Apenas `PerfectEnchants` e `Upgrades` selecionados. Preserva materiais, zeny, posição, encanto anterior, refino mínimo, grau/ordem e permissões descritas. Não interpreta sorteios normais, bônus por grau nem reset. |
| `db/re/item_reform.yml` | `ITEM_REFORM_DB` v1; gatilho, BaseItems, refino mínimo/máximo, opções aleatórias, cartas permitidas, materiais, item resultante, mudança de refino, limpeza de slots/grau. | Entradas selecionadas, inclusive metadados de resultado; RandomOptionGroup fica como referência, sem expandir pool. Consumo do gatilho e limites aplicados no runtime continuam pendentes de revisão. |
| `db/re/enchantgrade.yml` | `ENCHANTGRADE_DB` v3; tipo/nível → grau → chance por refino, catalisador e opções de custo/falha; escala 10000. | **Não importado**. Requer cruzamento com NPC/catalisador e confirmação regional. |
| `db/re/refine.yml` | `REFINE_DB` v2; grupo/nível → refino → tipo de minério, Rate, Price, quebra/regressão, BlacksmithBlessingAmount; escala 10000. | **Não importado**. Neste commit o nome é `refine.yml`, não `refine_db.yml`. Nunca usar chance bruta sem a política do NPC/evento. |
| `npc/re/merchants/nightmare_biolab.txt` | Encantamento inicial, evolução, reset e fabricação de Memoráveis. Contém comentários `unknown rates` e `custom text`; uniformidade de `rand()` não é prova oficial. | **Não executado nem convertido**. Evolução comparada à tabela regional manualmente. |
| `npc/re/merchants/OldGlastHeim_merchants.txt` | Principalmente Botas Temporais, não o evento dos Diademas. Inclui probabilidades marcadas como customizadas. | **Não importado**. Não aplicar regras de Botas ao Diadema por semelhança do nome. |

O importador falha em versão desconhecida, campo desconhecido nas operações interpretadas, seleção inexistente e Aegis ausente/ambíguo. Não avalia scripts, não baixa o banco, não resolve imports/overlays de outro servidor nem escreve no catálogo regional. O arquivo de saída usa criação exclusiva: uma nova execução não sobrescreve sequer o candidato anterior. Python 3 e PyYAML 6 são ferramentas de preparação; não há dependência nova no runtime/package.json.

Experimentos reais registrados:

- `rathena-experimental.v1.json`: **duas** reformas do gatilho `Shadow_Changer_W_Shi` (Hasty/Infinity Weapon → Shield), não uma regra do conjunto Pedras Preciosas.
- `rathena-enchant-experimental.v1.json`: **três** operações determinísticas da seleção `Id: 2`, Gray Wolf Manteau/Muffler.
- Total: cinco operações. Nenhuma promovida a LATAM. A extração experimental demonstra o pipeline; as três famílias desta entrega exigiram curadoria regional.

Exemplo reproduzível, a partir de download externo já fixado no SHA (saída deve ser um caminho novo):

```powershell
python tools/import-acquisition.py --kind reform --input caminho/item_reform.yml --select Shadow_Changer_W_Shi --revision d4b8e7b8f16061cc2496d377ac8f777ce72a4f39 --retrieved-on 2026-11-05 --output .tmp/reform-candidates.json
python tools/import-acquisition.py --kind enchant --input caminho/item_enchant.yml --select 2 --revision d4b8e7b8f16061cc2496d377ac8f777ce72a4f39 --retrieved-on 2026-11-05 --output .tmp/enchant-candidates.json
```

O SHA informado identifica a versão declarada da fonte; o CLI offline não autentica GitHub. Conferir o download pela URL fixada faz parte da preparação. IDs são resolvidos pela união dos snapshots locais de cliente e calculador; colisões são recusadas. Mudanças nesses snapshots podem exigir revisão da resolução de identidade.

Licenças: repositório MIT; os YAMLs rAthena declaram **GPL-3.0-or-later**, não MIT. Os candidatos derivados permanecem identificados com essa origem, separados e fora do runtime. Não se afirma que podem ser relicenciados como MIT; rever obrigações antes de distribuí-los em produto. Descrições do cliente e artigos GNJOY são de terceiros. A licença de reutilização da bROWiki não foi confirmada nesta auditoria: cadastraram-se fatos e referências, sem incorporar artigos, imagens ou scripts. Não há crawler nem redistribuição dos documentos brutos baixados em `.tmp`.

## Famílias cadastradas e evidências

### Diadema Temporal

19 peças de classe: IDs **19474–19492**. Obtenção base documentada: cinco Diademas Selados (25864) e acesso às recompensas de Glastheim Infernal via HUGINN2001. A wiki apresenta coordenadas diferentes no resumo/na seção de recompensa; isso permanece no requisito, sem inventar precisão.

Evolução de Insígnia já existente no slot 2, por tentativa:

| Transição | Poder Temporal (25866) | Sucesso |
| --- | --- | --- |
| 1 → 2 | 4 | 50% |
| 2 → 3 | 6 | 35% |
| 3 → 4 | 8 | 20% |
| 4 → 5 | 10 | 10% |
| 5 → 6 | 12 | 7% |
| 6 → 7 | 16 | 5% |
| 7 → 8 | 20 | 2% |
| 8 → 9 | 28 | 1% |
| 9 → 10 | 40 | 1% |

Falha reduz um nível, com piso 1; preserva equipamento. Ordem inicial dos slots: 4 → 3 → 2. O catálogo não transforma a tabela de sorteio inicial em probabilidade de uma Insígnia específica: custo inicial por slot e interpretação das células agrupadas ainda precisam de extração manual. Reset documentado: 500.000z com 30% de perda total do elmo, ou dois MiauMiau (6909) com sucesso garantido; procedimento documentado aqui, ainda sem rota normalizada de reset.

Fonte oficial pedida: [GNJOY 415 em espanhol](https://ro.gnjoyamericas.com/es/news/notice/415), cruzada com a [mesma notícia em português](https://ro.gnjoyamericas.com/pt/news/notice/415). Aplicação garantida de **01/09 a 12/10/2026**: Diadema de classe equipado +12 ou mais, segundo encanto presente, RUF-10 em `glast_01 142,279`, consumo de uma Lágrima. O tipo é escolhido; nível 1–5 é aleatório:

| Lágrima | Nv. 1 | Nv. 2 | Nv. 3 | Nv. 4 | Nv. 5 |
| --- | --- | --- | --- | --- | --- |
| Fraca (1001861) | 35% | 25% | 20% | 15% | 5% |
| Forte (1001860) | 25% | 22% | 20% | 18% | 15% |

Lágrimas vêm dos Artefatos Ovais de setembro; não são uma rota direta garantida ao nível 10. O procedimento pode ter sucesso sem produzir o nível desejado.

Diadema Atemporal (18551), anunciado a partir de **15/09**, pode ser convertido durante o evento:

| Refino de entrada | Insígnia escolhida no slot 2 | Joia no slot 3 | Slot 4 |
| --- | --- | --- | --- |
| +12 | 3 | 2 | Atributo +4 |
| +13 | 3 | 2 ou 3 | Atributo +4 |
| +14 | 5 | 2 ou 3 | Atributo +4 |
| +15 | 7 | 2 ou 3 | Atributo +4 |
| +16 | 9 | 2 ou 3 | Atributo +4 |
| **+17** | **10** | 2 ou 3 | Atributo +4 |

Não extrapolar +18..+20 nem inferir refino/grau/cartas preservados no resultado. A tradução espanhola contém `10/12` no parágrafo do evento de refino, enquanto o prazo geral e a versão PT dizem **12/10**; a interpretação cruzada e suas fontes estão registradas. Nome do NPC específico de conversão não consta no texto recuperado. O prazo encerra a rota; não apaga a posse anterior. Em 05/11/2026, evolução normal continua sendo alternativa documentada difícil, mesmo com troca/Lágrimas expiradas.

### Chapéus Memoráveis

14 peças: **18971–18984**, com receitas por classe. Sombra do Remorso: visual correspondente + uma Alma da classe e 20 Partículas de Energia (6820), com 20% de sucesso; ou visual + cinco Almas e 100 Partículas, com 100%. O risco perde os materiais sem produzir o chapéu.

Espectro Vagante (`lhz_dun_n 134,265`): cada aplicação inicial consome dez Fragmentos Ominosos (23016), slots 4 → 3 → 2; reset custa dez Fragmentos Sentimentais (22687) e remove todos os encantos. A obtenção inicial do tipo específico não foi tratada como distribuição uniforme. A tabela menciona 5,26%, mas a agregação dos sete tipos precisa de confirmação.

| Transição | Fragmentos Ominosos | Sucesso |
| --- | --- | --- |
| 1 → 2 | 20 | 70% |
| 2 → 3 | 40 | 50% |
| 3 → 4 | 50 | 35% |
| 4 → 5 | 70 | 25% |
| 5 → 6 | 100 | 18% |
| 6 → 7 | 150 | 13% |
| 7 → 8 | 250 | 9% |
| 8 → 9 | 500 | 6% |
| 9 → 10 | 1.000 | 4% |

Falha regride um nível, piso 1, sem destruir chapéu/refino/cartas. A tabela regional foi comparada ao NPC rAthena; isso não promove outros números do script, especialmente sorteios com comentário de chance desconhecida.

Máquina de Ar Quente, Sanctum (`lhz_d_n2 38,49`): slots 3 e 4 previamente encantados; seleção de Insígnia e evolução garantida até 5:

| Transição | Fragmentos | Zeny |
| --- | --- | --- |
| 0 → 1 | 200 | 5.000.000 |
| 1 → 2 | 100 | 3.500.000 |
| 2 → 3 | 200 | 5.000.000 |
| 3 → 4 | 250 | 8.000.000 |
| 4 → 5 | 350 | 14.000.000 |

Total garantido 0 → 5: **1.100 Fragmentos + 35.500.000z**, além de equipamento e slots prévios. Não extrapolar garantia ao nível 6–10. Fonte: [Tumba da Honra](https://browiki.org/wiki/Tumba_da_Honra), seções de fabricação, encantamento e encanto garantido. Estado `reviewed`, confiança média: fonte regional secundária, sem teste em jogo nesta entrega. Não foi inventado período de evento para um procedimento descrito sem prazo.

### Sombrio de Pedras Preciosas

Quatro peças: Malha **24675**, Greva **24676**, Brinco **24677**, Colar **24678**. São **dois pares independentes**, não um requisito de quatro peças nem um cruzamento Malha/Colar:

- Malha + Greva e Brinco + Colar: dano mágico adicional +2%.
- Soma de refinos **do par** ≥18: anula consumo de gemas e aumenta custo de SP em **40%**.
- Soma ≥20: dano mágico contra todos os tamanhos +12%.
- Cada peça: dano mágico +3%, dano mágico de propriedades +1% a cada dois refinos, conjuração variável -3% em +10; HP por refino.

Texto do cliente e `script` concordam com o aumento de SP; `spCostPercent` já usa parceiro por ID e soma de refinos. Bônus de +2%/+12% ainda usam algumas condições legadas por nome. **Não há bônus estruturado no motor para a dispensa de gemas**: o catálogo funcional reporta `engineCoverage: missing`; não transforma dispensa de reagentes em DPS nem modifica fórmulas. Não se inferiram exceções para habilidades específicas, duplicação de dispensa ou acumulação de penalidades sem confirmação adicional.

Combinador **100620**: texto indica seis materiais +7 dentre nove Sombrios de Joias/Gemas para um resultado aleatório +0 dentre as quatro peças. Não está confirmado quais combinações/repetições de materiais o NPC aceita, a distribuição de saídas ou a oferta atual do combinador. Caixas **101658–101661** indicam a peça correspondente entre +7 e +10, sem probabilidades nem prova da oferta atual. Caderno **101308** descreve até dois bônus aleatórios, sem provar o pool/procedimento de obtenção atual. Todas essas lacunas permanecem explícitas; presença no cliente não virou `obtainable`.

## Pesquisa manual ainda necessária

1. Confirmar em jogo a Máquina de Ar Quente, seu acesso e receitas atuais; obter evidência oficial/replay para elevar a confiança média do Memorável.
2. Recuperar as células/imagens dos custos de aplicação inicial dos Diademas, probabilidades por tipo e condições completas de NPC; normalizar resets sem confundi-los com evolução.
3. Confirmar saída da troca do Atemporal: preservação de refino/grau/cartas, vínculo, seleção de classe e NPC de conversão. O texto oficial confirma os encantos, mas não todos esses campos.
4. Identificar ofertas/eventos/fornecimento atuais dos Sombrios, combinador, caixas e caderno; confirmar materiais aceitos e distribuição. Não deduzir mercado ou estoque de uma descrição de item.
5. Auditar refino/grau com NPCs LATAM, minérios, catalisadores, proteção, bênçãos e eventos antes de importar essas tabelas como rotas regionais.
6. Tratar divergência dos pools de Insígnia nível 1/Afeição em uma tarefa mecânica separada, com provas próprias.

## Validação e retomada por Optimize/MCP

Testes desta fase: `src/app/build-analysis/acquisition/acquisition.spec.ts` e `tools/import-acquisition.spec.py`. Cobrem evento expirado e limites de data, posse anterior exata, regressão, troca garantida +17, sorteio de nível das Lágrimas, garantia do Memorável somente até 5, desconhecido sem impossibilidade, isolamento regional, substituição protegida e reconhecimento dos dois pares Sombrios. Incluem consumo real do `resolveBuild` existente e validação dos cinco candidatos reais contra o mesmo schema.

Comandos:

```powershell
node node_modules/vitest/vitest.mjs run src/app/build-analysis/acquisition/acquisition.spec.ts src/app/core/sp-cost-combo-refine.spec.ts src/app/utils/can-grade.spec.ts mcp/src/engine/validate-build.spec.ts
python tools/import-acquisition.spec.py
```

Resultado executado em 05/11/2026: **56 testes TypeScript em quatro arquivos e oito testes Python passaram**. A suíte nova contém 16 testes; as outras três cobrem validação mecânica, elegibilidade de grau e custos de SP existentes. Checagem TypeScript focada na pasta nova e suas dependências passou, sem emissão. Uma tentativa ampla com `tsconfig.source-checks.json` encontrou erros fora desta frente, incluindo specs existentes e tipos globais de Worker; essa tentativa não constitui aprovação do typecheck completo do projeto. Não foi executado build/deploy nem benchmark do Optimize.

Integração incremental, sem mudar Greedy nesta fase:

1. Expor relatório opcional em operação interna de `build-analysis/operations`, depois adaptadores MCP/browser com o mesmo resultado. Resolver `BuildInput` uma única vez. Não transformar aquisição em erro de `validateBuild`.
2. UI: mostrar status/requisitos/fontes no equipamento e resultados da busca, com opção de declarar posse. Não ocultar desconhecidos nem retirar equipamento legado por prazo de evento.
3. Optimize: anexar avaliação aos finalistas **depois do ranking atual**, preservando métricas e benchmarks. Observar cobertura antes de aceitar preferências como restrições.
4. Em tarefa futura autorizada, integrar preferências de aquisição/risco e preços fornecidos pelo usuário. Antes disso: composição de cadeias, checagem conjunta de resultados, estoque/posse por unidade e conflitos de requisitos. Não adicionar penalidade econômica arbitrária ao DPS.
5. Refino/grau e mais famílias só entram após revisão regional; importações continuam em staging. Regras confirmadas não podem ser rebaixadas por refresh do rAthena.

Este arquivo, os contratos e o catálogo são o ponto de retomada. O contexto do Optimize não precisa recuperar a conversa para saber o que existe, o que pode consumir e o que continua desconhecido.
