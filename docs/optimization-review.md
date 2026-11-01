# Revisão das sugestões para Inquisidor

Base: `mcp/src/engine/__tests__/fixtures/inquisitor-optimization.json`, nível 236/50,
POD 100, CON 43, Garra Primordial-LT +11 e Mão Explosiva 5. Os números abaixo são
do motor; não são novas medições de servidor nem prova de melhor build global.

Todas as variantes mantêm o restante da base e usam o rebalance Atual (LATAM).
O objetivo desta comparação é o maior dano crítico, não custo nem disponibilidade.

## Meio e baixo

| Configuração | Máximo crítico |
| --- | ---: |
| Orelhas Espirituais, sem baixo | 37.212.295 |
| Selo de Loki + Selo de Copas, sem carta ou rolagens novas | 34.827.327 |

Isso não conclui que Orelhas vence um Selo de Loki com outra carta ou outros
bônus aleatórios. O conjunto Loki/Copas está implementado; o Selo sozinho não
tem bônus fixos no script. Configurações completas devem declarar as rolagens.

## Botas

Refino +11, sem novos encantamentos, sem ativar procs. As opções da bota antiga
(Delírio e Espírito do Lutador 7) são retiradas das variantes.

| Bota | Grau | Máximo crítico |
| --- | --- | ---: |
| Primordial-LT | A | 38.885.397 |
| Física do Éden II | sem grau | 37.310.833 |
| Primordial-LT | sem grau | 36.367.567 |
| Invernal | sem grau | 36.092.983 |

A arma paga o conjunto com a Primordial-LT. Uma Invernal com runas ou uma
Primordial-LT com encantamentos próprios exigem outras variantes, não herdar os
encantamentos da Temporal. O grau muda a conclusão; a busca aceita `maxGrade`.

## Sombras e tamanho

Ambas as peças +10, demais configurações/rolagens da base mantidas. Dummy Médio
21077 e Grande 21066. Escudo Pontual 24737 é mágico: seus bônus mágicos não
melhoram a Mão Explosiva física.

| Manopla + escudo | Médio | Grande |
| --- | ---: | ---: |
| POD + POD | 38.641.853 | 35.590.574 |
| POD + Infinito | 36.406.311 | 36.406.311 |
| Infinito + POD | 36.406.311 | 36.406.311 |
| Infinito + Pontual | 34.428.102 | 34.428.102 |

O Infinito evita a penalidade da soqueira no Grande; o par POD vence no Médio.
Não existe uma recomendação universal sem especificar o alvo.

## Correções na descoberta

- Conjuntos por nome inglês agora são localizados pelo nome de exibição e pelo
  aegis, retirando o sufixo `[N]` dos slots.
- Referências inversas permitem partir do Selo de Loki e descobrir Selo de Copas.
- Remoção da penalidade de tamanho entra nas chaves de seleção de candidatos.
- Graus e bônus aleatórios não migram implicitamente para peças substituídas.
- O patch inclui as limpezas de cartas/encantamentos incompatíveis e as opções
  removidas, para reproduzir a mesma métrica de seu link.
- A resposta informa IDs candidatos, teto de grau, orçamento e motivo de parada.

Os testes de `mcp/src/tools/optimize.spec.ts` preservam a inversão por tamanho,
a influência do grau, a descoberta de parceiros e a reprodução pelo link/patch.
