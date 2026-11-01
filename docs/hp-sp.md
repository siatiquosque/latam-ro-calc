# HP/SP base: fontes, representação e validação

O motor consulta `src/assets/demo/data/hp_sp_table.json` por classe e nível.
Depois aplica o multiplicador de classe, VIT/INT, bônus fixos (incluindo
VIT/INT de equipamento) e percentuais. A fórmula está em
`src/app/core/hp-sp-calculator.ts`. Esta atualização preserva sua ordem de
operações e arredondamentos. Além dos dados, o adicional fixo por VIT/INT
intrínseca das peças foi corrigido conforme descrito abaixo.

## Fontes e cobertura

Coletas de **~小月鈴~ (zyxvaaaa)** no fórum Bahamut, consultadas em 31/10/2026:

- [Quartas tradicionais](https://forum.gamer.com.tw/Co.php?bsn=4212&sn=2890904):
  níveis 201–250, 13 classes em 12 curvas; Troubadour/Trouvere compartilham a curva.
- [Quartas expandidas](https://forum.gamer.com.tw/Co.php?bsn=4212&sn=2896152):
  níveis 201–250 para Sky Emperor, Soul Ascetic, Shinkiro, Shiranui, Night Watch,
  Hyper Novice e Spirit Handler. Shinkiro e Shiranui têm curvas diferentes.
- [Níveis 251–275](https://forum.gamer.com.tw/C.php?bsn=4212&snA=439588):
  coleta com lacunas, não importada; o motor continua limitado a 250.

Os snapshots numéricos estão em `data/hp-sp/taiwan-fourth.csv` e
`data/hp-sp/taiwan-expanded.csv`: uma linha por nível, um par HP/SP por curva,
950 pares no total, cobrindo 20 classes. Os números tradicionais incluem
o bônus de transclasse e foram publicados com VIT/INT zero. Os das expandidas
são usados diretamente, com multiplicador de classe 1 no motor.

O acesso direto aos tópicos retornou HTTP 403 durante a coleta. Os números
foram transcritos do conteúdo indexado da
[busca do próprio fórum](https://forum.gamer.com.tw/search.php?bsn=4212&q=HP&type=tag),
conferindo a ordem das colunas e a cobertura de níveis. São dados comunitários
de TwRO, não uma exportação oficial da Gravity nem prova de equivalência ao LATAM.
Conferir também revisões da publicação: a das expandidas relata uma alteração
de +2.000 HP do Hyper Novice em 2024, sem identificar a data de implantação.

## Normalização sem perda de precisão

`baseHp` e `baseSp` são valores antes do multiplicador de classe. Para as
tradicionais, importar `publicado / 1,25`, preservando as casas decimais.
Para as expandidas, importar o inteiro publicado. Não usar `floor`, `round`
ou `ceil` nessa divisão, nem aplicar um +1 indiscriminado.

```text
Inquisidor 236, HP publicado antes da VIT: 39.157
Normalizado sem perda:                    31.325,6
Motor: piso(31.325,6 × 1,25):              39.157
VIT total 126: piso(39.157 × 2,26):        88.494
Angelus 10 (+500):                        88.994
```

A tabela anterior guardava 31.325; reaplicar 1,25 e truncar produzia 39.156.
Nas tradicionais, 598/600 entradas de HP e 600/600 de SP correspondiam à
divisão truncada. As exceções eram HP de Arch Mage 249 e Troubadour/Trouvere
231, também atualizadas conforme a fonte. O motor já aceita frações: seus
testes conferem que a multiplicação pelo bônus retorna o inteiro publicado.

## Importação reproduzível

Depois de revisar os CSVs contra a fonte:

```sh
node tools/import-hp-sp-taiwan.mjs
node tools/import-hp-sp-taiwan.mjs --check
npx vitest run src/app/core/observed-hp-sp-table.spec.ts src/app/core/expanded-fourth-hp-sp-table.spec.ts src/app/jobs/Inquisitor.angelus-replay.spec.ts
```

O importador valida as classes/colunas, inteiros positivos e cobertura exata
201–250 antes de salvar. `--check` não escreve; falha se a tabela divergir
dos snapshots. Não há consulta de rede na importação nem nos testes.

## Lacunas e validação no LATAM

- **Nível 200 preservado**, sem recalcular: nas seis expandidas antes geradas
  por rAthena, mantém a estimativa; no Spirit Handler, a extrapolação anterior.
  Pode existir descontinuidade entre a estimativa no 200 e a observação no 201.
  Não ajustar uma observação para forçar monotonicidade: obter dados no 200.
- Classes anteriores e níveis até 200 permanecem inalterados.
- Coeficientes aproximados do rAthena ou uma interpolação não substituem os
  pontos medidos. Não foi identificada uma fórmula oficial que gere todos eles.
- Replays do LATAM continuam sendo a prova local. Não se promete erro zero
  de HP/SP ou dano para todas as classes por importar uma fonte de outro servidor.

Para validar sem resetar atributos: gravar sem equipamentos (incluindo
sombrios), pet, consumíveis ou buffs; trocar de mapa durante a gravação para
registrar os atributos. Guardar nível, VIT/INT totais e HP/SP máximos. Basta
aplicar a VIT/INT real ao valor publicado. Se usar Angelus ou outro bônus,
registrar seu nível e obter um estado com ele e outro sem ele.

No exemplo, 88.994 menos 500 deixa 88.494. Sob a hipótese
`piso(B × 2,26) = 88.494`, o único inteiro possível para B é 39.157.
A observação com VIT 130 e HP 90.061 confirma o mesmo inteiro. Isso valida
o ponto 236 sob essa ordem de cálculo, não toda a tabela do LATAM.

### Evidências e resíduos conhecidos

- `Inquisitor.angelus-replay.spec.ts`: HP absoluto 90.061 sem Angelus e
  90.111–90.561 com Angelus 1–10, sem tolerância de cinco pontos.
- `SoulAscetic.exorcism-replay.spec.ts`: HP fecha em 60.398; SP fica em 6.294
  contra o pico gravado de 6.416. VIT/INT vieram do cartão do jogador;
  permanece um resíduo de 122 SP que esta atualização não resolve.
- `DragonKnight.dragon-breath-replay.spec.ts`: preserva os pacotes exatos
  256.897 e 6.913.590. O teste usa substitutos para poções ainda não modeladas;
  o ajuste fixo de SP desses substitutos passou de +4 para +1 após as correções
  da tabela e dos atributos intrínsecos, mantendo os intervalos de HP/SP usados pelo sopro. Esse +1 é
  calibração do fixture, não uma fórmula oficial de poção.
- `Inquisitor.brand-rotation-replay.spec.ts`: a build equipada fica em
  148.476 HP contra 149.376 gravados, diferença ainda sem causa confirmada.
- `Biolo.cart-cannon-replay.spec.ts`: a build com Fortaleza fica em 109.881 HP
  contra 109.860 gravados. O resíduo de +21 não é tratado como acerto exato.

### Adicional fixo de VIT/INT das próprias peças

Além do efeito percentual da VIT/INT total, existe um adicional fixo de +1 HP
por VIT e +1 SP por INT **intrínseca da peça**. Cartas e encantamentos
participam do atributo total, mas não desse adicional. O bônus da própria
peça em todos os atributos também participa do adicional.

Essa separação é explícita no
[status.cpp do rAthena](https://github.com/rathena/rathena/blob/master/src/map/status.cpp):
o motor salva `param_equip` após os scripts dos equipamentos e antes de
processar cartas; HP/SP usam `param_equip[VIT/INT]` para o adicional fixo.
Isso é evidência do mecanismo, complementada pela medição local abaixo.

A build [wwGlfR](https://short.latam-tools.com.br/wwGlfR), informada pelo jogador,
tem VIT total 137, HP fixo +3.450 e HP +112%. Os 10 pontos de VIT das cartas
e encantamentos estavam entrando indevidamente no adicional fixo, enquanto
o +1 de todos os atributos do topo era omitido. O adicional correto de +1
produz `piso(39.157 × 2,37) + 3.450 + 1 = 96.253`, seguido de +112%:
**204.056 HP**, contra os 204.075 anteriores. O preset foi preservado em
`mcp/src/engine/__tests__/fixtures/inquisitor-geared-hp.json` e é exercitado
pelo pipeline completo em `mcp/src/engine/hp-sp-equipment.spec.ts`.

### Dano exato depende do estado e da defesa do alvo

Acertar HP/SP ou um golpe sem equipamento não valida todas as etapas de dano
de uma build equipada. Em `Inquisitor.mao-explosiva-replay.spec.ts`, algumas
comparações equipadas usam tolerância relativa de 0,02%; elas não são uma
prova de igualdade ao inteiro. O fixture de Bafo também usa substitutos de
consumíveis calibrados, cuja limitação está descrita acima.

Uma segunda medição da build wwGlfR, sem arma e com Fogueira Espiritual 5,
informou 8.364.528 no LATAM contra 8.364.478 no simulador. O grafo já chegava
a 8.364.528 após a razão da habilidade e subtraía 50 de DEF leve, embora a
build tivesse o conjunto sombrio Penetrante com refinos somados >=18.
A causa era independente do HP: o script do conjunto havia sido reduzido
a penetração percentual, perdendo o efeito de ignorar a DEF inteira.

O [combo 24661+24662 no rAthena](https://github.com/rathena/rathena/blob/master/db/re/item_combos.yml)
declara `bIgnoreDefRace,RC_All`, um efeito distinto de `bIgnoreDefRaceRate`.
O primeiro passa por `attack_ignores_def` em
[battle.cpp](https://github.com/rathena/rathena/blob/master/src/map/battle.cpp),
ignorando as duas parcelas. O script do Brinco Sombrio Penetrante mantém
as parcelas percentuais por refino e agora usa `ignorePhysicalDef: 1` para
o efeito do conjunto. O core aplica esse desvio às habilidades e ataques
básicos, sem conceder o pseudo-ATQ da Infiltração nem ignorar TEN.

A tentativa inicial de generalizar a redução da DEF leve proporcionalmente
a toda penetração foi descartada: contrariava replays de outras classes.
A penetração percentual mantém o comportamento validado anteriormente;
o efeito de ignorar DEF inteira é modelado separadamente.

As medições do jogador — Fogueira 8.364.528, básico 8.190 e crítico 15.649,
sem arma — têm testes sem tolerância. A Mão Explosiva crítica equipada do
replay também passa a ter igualdade exata, eliminando seu resíduo de 82.

Os limites simulados do Hyper Novice equipado mudam em +61/+62 por causa do
mesmo conjunto; não são golpes registrados exatos e o resíduo de composição
descrito naquele teste continua aberto. No replay de Ofensiva Fatal do
Renegado, o básico normal fica +0,592% e o crítico -0,877%; a regressão fixa
esses valores e reduz a margem anterior de 2,5% para 1%. Esses casos não
foram ajustados na fórmula para fazer os números coincidirem.
