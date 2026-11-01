# Inquisidor: Inquistor_teste2.rrf

Gravação LATAM de 31/10/2026, nível 236/50, sem arma, alvo de treino 21077.
Fixture com nomes/AID anonimizados: `src/app/replay/__tests__/fixtures/inq-buffed-weaponless.rrf`.
Regressão: `mcp/src/engine/inquisitor-buffed-replay.spec.ts`.

Atributos, talentos, equipamentos e bônus aleatórios são lidos pelo importador.
O personagem tem POD 100 e CON 43 alocados. Os buffs registrados são:

| Configuração | Nível | EFST |
| --- | ---: | ---: |
| Mantra da Força | 5 | 1160 |
| Dragão Ascendente | 10 | 410 |
| Chakra do Vigor | 5 | 427 |
| Fúria Interior | 5 | 86 |
| Clementia / Bênção | 10 | 10 |
| Cantocandidus / Aumentar Agilidade | 10 | 12 |
| Angelus | 10 | 9 |

Os quatro primeiros não tinham mapeamento para importar o estado ativo. A correção
fica em `skill-status.map.ts`; aprender a habilidade sem registrar seu status ativo
continua insuficiente para ligá-la.

Com esses buffs, a janela inicial confere exatamente: ATQ 821 + 600, P.ATQ 62,
CRIT 66, HP máximo 214.791 e SP máximo 4.748. Mantra da Força explica os 30 de
ATQ Equip. e 15 de P.ATQ ausentes na reconstrução sem esses buffs.

São selecionadas 15 esferas para reconstruir os danos. A contagem não é importada
automaticamente: aprender Dragão Ascendente não comprova quantas esferas restam.
As esferas acrescentam 3 de ATQ de maestria oculta cada: com 15, são 45 usados
no dano, sem alterar o ATQ mostrado pelo Alt+Q. O controle foi corrigido para
manter esses 45 fora da leitura da janela, que permanece 821 + 600; o dano
continua igual ao replay.
A linha **ATQ oculto** do resumo mostra o total separado do Alt+Q. Nesta build são
75: 45 das esferas e 30 de Punhos de Ferro. Retirar as esferas para igualar a
janela do jogo era desnecessário: o defeito estava na exibição, e elas continuam
necessárias para reproduzir os danos.

Com zero esferas, Mão Explosiva 5 resulta em 2.067.302 sem crítico e 3.494.556 com
crítico, exatamente os valores divergentes relatados. Com 15 esferas, ambos
voltam aos inteiros registrados abaixo. A rotação também exibe uma média
ponderada pela chance de crítico; ela não representa um acerto individual.
Auréola das Chamas 5 é selecionada para a rotação final; as auréolas não são
importadas pela união de todos os status vistos, pois o personagem alterna entre
elas durante o arquivo.

| Habilidade nível 5 | Dano do servidor e da calculadora |
| --- | ---: |
| Mão Explosiva normal | 2.086.581 |
| Mão Explosiva crítica | 3.527.256 |
| Estigma | 1.456.849 |
| Palma Fervorosa | 3.487.137 |
| Fogueira Espiritual sem efeito da bota | 10.499.184 × 3 = 31.497.552 |
| Fogueira Espiritual com efeito da bota | 19.173.383 × 3 = 57.520.149 |

A Bota Desconhecida VIT +11, grau C, concede VIT +225 por dez segundos. O replay
confirma VIT adicional de 17 para 242 e HP máximo de 214.791 para 410.380.
Janelas observadas: 41.190–51.149 ms e 53.185–63.187 ms. Dos quatro pacotes de
Fogueira, somente o de 51.979 ms ocorre sem o efeito. Na calculadora, selecionar
o efeito da Bota Desconhecida VIT reproduz os outros três.

Todos os pacotes das quatro habilidades são comparados por igualdade inteira
nesta gravação. Nenhuma fórmula de dano foi alterada para este resultado; ele não
estende a validação a outras builds ou gravações.

## Reprodução na interface

1. Importar o replay como build principal.
2. Conferir Mantra da Força 5, Dragão Ascendente 10, Chakra do Vigor 5,
   Fúria Interior 5 e os três buffs de suporte da tabela.
3. Selecionar **15 Esferas Espirituais** manualmente; o arquivo não fornece
   uma contagem que o importador consiga recuperar.
4. Selecionar o dummy neutro da gravação (21077) e a fórmula **Atual (LATAM)**.
5. Usar as habilidades da tabela no nível 5. Para a sequência final,
   selecionar Auréola das Chamas 5.
6. Comparar inicialmente sem o efeito da bota; ativá-lo para comparar as
   Fogueiras dentro das janelas de VIT +225. O número da Fogueira na rotação
   representa a soma dos três acertos.

Os Mantras da Energia, Saúde e Força agora permitem desativado ou níveis 1–5,
mantendo a exclusividade entre eles. Seus bônus acompanham o nível selecionado;
a Vel.Atq do Mantra da Energia segue a tabela do cliente. Este replay valida
Mantra da Força 5; os demais níveis são conferidos contra a descrição do cliente,
sem alegar medição no servidor para cada um.

## Cobertura de regressão

- `mcp/src/engine/inquisitor-buffed-replay.spec.ts`: janela de atributos,
  os 43 pacotes das quatro habilidades por igualdade inteira, Fogueira com/sem
  efeito da bota, ATQ oculto e reprodução da divergência causada por zero esferas.
- `src/app/replay/skill-status.map.spec.ts`: buffs ativos importáveis e bloqueio
  quando não há status correspondente.
- `src/app/jobs/Inquisitor.mantras.spec.ts`: opções e bônus dos três Mantras
  nos níveis 0–5, além do grupo de exclusividade.
- `src/app/layout/pages/ro-calculator/stats-summary.spec.ts`: linha ATQ oculto,
  explicação, comparação entre builds e separação do Alt+Q.

```sh
npx vitest run mcp/src/engine/inquisitor-buffed-replay.spec.ts src/app/replay/skill-status.map.spec.ts src/app/jobs/Inquisitor.mantras.spec.ts src/app/layout/pages/ro-calculator/stats-summary.spec.ts
```

O usuário confirmou a conferência final na interface nesta sessão. As diferenças
relatadas deste arquivo estão resolvidas; isso não encerra resíduos documentados
em outras gravações de Inquisidor.
