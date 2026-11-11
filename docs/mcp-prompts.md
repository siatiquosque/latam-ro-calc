# Como pedir à IA usando a calculadora (MCP)

Guia para jogadores. A IA só usa a calculadora: ela **não** sabe preço, onde farmar nem se o item é fácil de achar. Isso você decide depois.

## Regras de ouro

1. **Cole o link da build.** É o jeito mais seguro: a IA lê classe, nível, atributos, gear e passivas de uma vez. Sem link, ela parte de uma build "nua" (tudo em 1) e os números só servem para comparar opções entre si.
2. **Diga o alvo.** "Baphomet", "Pesadelo de Chefe", "mobs normais de tamanho médio". Se houver mais de um monstro com o mesmo nome, informe o nível ou o id.
3. **Diga o objetivo.** Dano contínuo (DPS), dano de uma rajada (burst) ou o maior golpe? Sem isso a IA escolhe por conta própria.
4. **Diga o que não pode mudar.** "Mantenha a arma", "sem item de MVP", "não troque o elmo".
5. **Peça passo a passo quando for muito.** Primeiro uma peça (ou um slot), depois a build inteira.

## Exemplos

| Quero | Peça assim |
|---|---|
| Melhorar uma build | "Aqui está minha build: <link>. Alvo: Baphomet. Objetivo: DPS sustentado. Use a calculadora para achar trocas que aumentem o dano e me mostre o ganho em % de cada uma." |
| Trocar só uma peça | "Na build <link>, qual a melhor opção para o slot da arma contra o Baphomet? Compare as 5 melhores." |
| Comparar duas escolhas | "Compare <link A> com <link B> contra o Drake, em dano por segundo e dano máximo." |
| Montar do zero | "Mago nível 200, skill Astral Strike nível 10, contra o Baphomet. Monte a melhor build possível, mostrando os atributos que você escolheu." |
| Restrições | "Otimize minha build <link>, mas sem trocar a capa e sem cartas de MVP." |
| Entender uma skill | "Explique como a skill X funciona nesta calculadora e quais itens a melhoram." |
| Entender o dano | "Por que meu golpe causa tanto dano nesta build? Explique o cálculo passo a passo." |
| Alvos variados | "Minha build serve para mobs normais e para chefe. Otimize olhando os dois, não só um." |

## O que a IA pode fazer errado (e como corrigir)

| Sintoma | Causa provável | O que dizer |
|---|---|---|
| Ganhos absurdos (milhões de %) | Build sem atributos/gear | "Use o link da minha build" ou informe stats e gear |
| Resposta demorou ou cortou | Busca longa | A busca já limita a 40 s; peça "tempo máximo de 90 segundos" só se o seu cliente aguentar, ou peça por slot |
| Ganho enorme vindo de "refino e grau" | A busca testa tudo em +12 e grau A | "Mantenha meu refino e grau atuais" ou "sem trocar equipamento, só cartas e encantamentos" |
| Dano minúsculo contra um MVP | Alvo com aura vermelha (só 0,1% do dano chega) | Compare em %, ou escolha outra versão do monstro |
| "Servidor ocupado" | Outras buscas longas em andamento | Espere um minuto e peça de novo, ou use cálculo/comparação, que respondem na hora |
| Erro "Campo(s) desconhecido(s)" | A IA inventou um nome de campo | Normal: ela se corrige com a sugestão da mensagem |
| "Dano 0" na busca | Atributos todos em 1 | "Distribua meus atributos com optimize_stats" ou passe o link |
| Escolheu o monstro errado | Vários com o mesmo nome | Informe nível ou id do monstro |
| Sugeriu item "porque é barato" | Ela não tem preço | "Ignore preço, só dano; eu avalio a obtenção" |
| Otimizou o dano máximo | Ignora crítico | "Otimize DPS (dano por segundo), não o dano máximo" |
| Resposta sem conferir | Pulou a calculadora | "Confirme os números chamando a calculadora" |

## Dicas

- A busca automática devolve **o melhor que achou** no tempo dado, não uma garantia global. Dê mais tempo ou limite os slots se quiser mais profundidade.
- Peça o **link da build final** na resposta, para abrir no simulador e conferir.
- Efeitos de chance (procs) e burst variam por modo: diga se quer o valor médio ou o pior caso.
