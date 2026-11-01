# Bônus aleatórios: catálogo e auditoria

O catálogo regional validado e a referência do rAthena são camadas distintas.

Três fontes alimentam `randomOptionCatalogFor`, da mais forte para a mais fraca:

1. **Código** (`random-option-catalog.ts`): Selo de Loki e os selos de elmo inferior, escritos à mão.
2. **Confirmados no jogo** (`data/random-options/regional-pools.json`): edição manual, um pool por id de item.
3. **bROWiki** (`data/random-options/browiki-pools.json`): gerado por `tools/import-browiki-pools.py` a partir da
   página [Bônus Aleatórios](https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios). A página identifica cada item
   pelo link do divine-pride, então o vínculo é por id, nunca por nome; cada texto de regra é traduzido por uma
   tabela explícita para a chave do simulador, e o que não tem tradução fica em `unmapped` e fora do pool, sem
   chute. São faixas de referência de um wiki brasileiro, não medidas por nós. O teste `browiki-pools.spec.ts`
   confere o importador contra os pools do Selo de Loki escritos à mão (todas as regras e faixas batem).

Para atualizar a fonte 3:

```powershell
curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios" -o .scratch/browiki/bonus-aleatorios.html
python tools/import-browiki-pools.py
```

Ficam de fora o que a página não liga a itens (pools de Sombrios de Classe, Encantador Sombrio, Fascículos, Essência
de Magma) e as linhas sem chave no simulador (EXP, "ignora DEF", resistência a todas as propriedades). A referência
do rAthena, abaixo, continua separada e só entra na busca com `pools: "upstream"`.
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
como um perfil, sem misturar moedas. Pools sem catálogo continuam omitidos e
os IDs aparecem em `complementSearch.uncataloguedRandomItems`. `slot_options`
informa `automaticRollSearch` por item. Faixas catalogadas são validadas também
nas entradas explícitas; referências rAthena não confirmadas não viram opções
livres da busca.
