# Bônus aleatórios: catálogo e auditoria

O catálogo regional validado e a referência do rAthena são camadas distintas.

Os três arquivos de dados (`regional`, `browiki` e `rathena-pools.json`) têm **o mesmo formato**
(`tools/pool_document.py`): cada pool é escrito uma vez como combinador e os itens apontam para ele, então um pool
compartilhado (as seis Cotas Dracônicas, as quatro capas) nunca é duplicado, de qualquer fonte. Eles não ficam no
bundle inicial: `loadRandomPools()` os carrega sob demanda (chunk separado), a tela dispara o carregamento ao criar o
cartão de equipamento e o MCP o aguarda antes de cada ferramenta. Para acrescentar um pool confirmado:
`python tools/add-regional-pool.py` (veja a skill `random-pools`).

Quatro fontes alimentam `randomOptionCatalogFor`, da mais forte para a mais fraca (`randomPoolTier` diz de qual veio):

1. **Código** (`random-option-catalog.ts`): Selo de Loki e os selos de elmo inferior, escritos à mão.
2. **Regionais** (`data/random-options/regional-pools.json`): um pool por id de item. Vem do que foi visto no jogo, de
   edição manual (Botas Desconhecidas) ou de `tools/import-browiki-instances.py`, que lê as páginas de instância do
   bROWiki (Lago do Abismo: Cotas, Capa e Bota Dracônicas; Torneio de Magia: Traje/Manto Anti-Magia e Anéis de Reforço;
   Arena Noturna: Uniformes, Mantos, Escudos e Anéis Condensadores) e reescreve só as entradas que ele mesmo gerou.
3. **bROWiki** (`data/random-options/browiki-pools.json`): gerado por `tools/import-browiki-pools.py` a partir da
   página [Bônus Aleatórios](https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios). A página identifica cada item
   pelo link do divine-pride, então o vínculo é por id, nunca por nome; cada texto de regra é traduzido por uma
   tabela explícita para a chave do simulador, e o que não tem tradução fica em `unmapped` e fora do pool, sem
   chute. São faixas de referência de um wiki brasileiro, não medidas por nós. O teste `browiki-pools.spec.ts`
   confere o importador contra os pools do Selo de Loki escritos à mão (todas as regras e faixas batem).
4. **rAthena** (`data/random-options/rathena-pools.json`): o último recurso, gerado por `tools/build-rathena-pools.py`
   a partir do instantâneo `rathena-audit.json` (cerca de 1.150 itens). A auditoria lê `laphine_upgrade.yml`,
   `item_reform.yml`, `item_group_db.yml` (kits, caixas de Sombrios de Classe) e `mob_db.yml`; as opções são traduzidas
   pelo próprio script do rAthena para as chaves do seletor (elemento, raça, tamanho, classe, atributos). Blocos
   comentados do `laphine_upgrade.yml` (Geffen, Cota Dracônica) dizem quais itens aceitam um combinador, mas sem
   `RandomOptionGroup`: não há pool neles (esses itens vêm da fonte 2). Ventiladores e Fones quebrados rolam como
   os normais (`SAME_POOL` em `build-rathena-pools.py`). O LATAM tende a seguir o kRO, que o
   rAthena reproduz, então um item que nenhuma fonte regional cobre fica restrito a esse pool em vez de aberto a
   qualquer bônus. Não é confirmação: a validação de rolagens de uma build compartilhada **não** o impõe (só as
   fontes 1 a 3), e a busca do MCP lista o que rolou a partir dele em `unconfirmedRolls`. Item sem pool em nenhuma
   fonte continua aberto na tela e fora da busca.

Para atualizar a fonte 2 (páginas de instância):

```powershell
foreach ($p in 'Lago_do_Abismo','Torneio_de_Magia','Arena_Noturna') { curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/$p" -o ".scratch/browiki/$p.html" }
python tools/import-browiki-instances.py
```

Resistência física/mágica por propriedade fica de fora (o seletor não oferece a opção; o motor tem as chaves só para PvP).

Para atualizar a fonte 3:

```powershell
curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios" -o .scratch/browiki/bonus-aleatorios.html
python tools/import-browiki-pools.py
```

Ficam de fora o que a página não liga a itens (pools de Sombrios de Classe, Encantador Sombrio, Fascículos, Essência
de Magma) e as linhas sem chave no simulador (EXP, "ignora DEF", resistência a todas as propriedades). A referência
do rAthena entra como a fonte 4. Para regerá-la após atualizar o instantâneo: `python tools/build-rathena-pools.py`.
`random-option-catalog.ts` valida as faixas conhecidas do Selo de Loki com fonte
regional; os grupos do rAthena não substituem essas regras automaticamente.

O levantamento completo por ID está em
[random-options-items.generated.md](random-options-items.generated.md).
O snapshot `data/random-options/rathena-audit.json` preserva o commit consultado,
os vínculos, condições dos combinadores, grupos por posição, faixas, parâmetros
e chances originais. Nenhuma chance é interpretada como distribuição LATAM.

Para reproduzir, com Python e PyYAML instalados:

```powershell
python tools/audit-random-options.py --rathena .scratch/rathena
```

O arquivo `item_randomopt_group.yml` define os pools. O vínculo com os itens vem
de `laphine_upgrade.yml`, `item_reform.yml` e drops de `mob_db.yml`. Reformas
vinculam o grupo ao item resultante. A identidade exige ID e Aegis iguais;
não usamos tradução nem semelhança de nomes. O levantamento de `npc/` no commit
consultado encontrou apenas consulta de opções existentes em
`npc/re/merchants/enchan_illusion_dungeons.txt`, sem pools adicionais.

O escopo cobre toda a `ExtraOptionTable`, todas as armas e sombrios que recebem
campos genéricos e demais itens locais vinculados pelas bases consultadas.
Campos genéricos são capacidade da interface, não evidência de obtenção.
Itens sem vínculo, grupos indefinidos e opções sem conversão ficam explícitos.
`Group_0` é um grupo vazio usado para remover opções, não para rolar bônus.
TODOs e linhas comentadas não geram validação fictícia.

O MCP `slot_options` retorna `randomOptions.upstream` com o grupo, combinador,
condições, fonte e revisão. Opções com equivalência exata de script recebem
`calculatorKey`; as demais conservam o identificador e `mapping: not-mapped`.
Isso permite consultar o pool sem confundir opções ainda não modeladas com
bônus de valor zero. Pools regionais ausentes precisam de documentação local
ou evidência do servidor antes de restringir entradas legítimas.

`optimize_build` busca novas rolagens quando há catálogo regional: Selo de Loki
e os quatro selos inferiores. A busca mantém cada combinador e suas posições
como um perfil, sem misturar moedas. Itens sem pool em qualquer fonte continuam omitidos e
os IDs aparecem em `complementSearch.uncataloguedRandomItems`. `slot_options`
informa `automaticRollSearch` por item. Faixas catalogadas são validadas também
nas entradas explícitas (exceto as do rAthena, que são só o substituto); o que não tem pool não vira opção
livre da busca.
