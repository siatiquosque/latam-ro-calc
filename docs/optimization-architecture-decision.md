# Decisão: investimento em otimização após a POC MCP

05/11/2026. Decisão limitada à evidência de uma build, dois tetos e uma sessão de agente. Não é autorização de publicação nem substituição definitiva do Optimize.

## Recomendação

Priorizar **B — planejamento por agentes externos usando o MCP**, mantendo **D — análise e comparação verificáveis** como base compartilhada. Preservar A como recurso compatível e baseline. Manter C como opção experimental promissora: o planejamento alinhado ao teto atingiu a meta com menos substituições e contexto MCP, mas a confiabilidade permaneceu condicional.

A razão é concreta: a POC usou o conhecimento já exposto para selecionar poucas dezenas de hipóteses, verificar os cinco alvos e obter uma solução com confiabilidade modelada melhor. Não foi necessário contratar API de IA, copiar fórmulas, devolver o catálogo inteiro nem adicionar uma nova ferramenta de otimização.

Essa evidência não autoriza prometer que B seja mais rápido ou barato: a sessão usa histórico de projeto, inclui trabalho manual e não mede tokens/preço/latência isolada de raciocínio. Mesmo o processo medido de B teve mais CPU que A no desenho inicial. Uma UI que dependa obrigatoriamente de IA acrescentaria um custo e uma dependência ainda não justificados.

## Comparação das modalidades

| Modalidade | Evidência | Decisão |
| --- | --- | --- |
| A: automático completo | Integridade e teto foram exercitados; qualidade em tetos baixos depende muito de triagem, planejamento e complementos. | Conservar, não declarar qualidade geral aprovada a partir desta fixture. |
| B: agente + MCP | Cinco metas atingidas e verificadas com 177 chamadas na faixa 200, e cinco garantias modeladas com 252 chamadas na faixa 1.000. | Prioridade para mais ensaios externos pequenos e auditáveis; não embutir IA na calculadora. |
| C: agente + busca local | Com planejamento alinhado: 2/5 metas em 200 chamadas; 5/5 em 1.000, sem trocar peças principais, com 15 campos alterados, confiabilidade condicional e margem crítica de 21,53%. Com planejamento 10.000/100.000 não aceitou melhoria. | Preservar esta alternativa no conjunto de recomendações; medir seu custo de agente contra B antes de eleger política de produto. Nenhum algoritmo novo é necessário para o ensaio. |
| D: análise/recomendação | Contexto, estágios, busca filtrada, AND/OR, patches e verificação já viabilizaram a POC. | Base durável para UI, MCP e agentes. Evitar novos wrappers que dupliquem essas operações. |

## Fronteira de responsabilidade

O agente escolhe perguntas e hipóteses, interpreta os limites e decide quando parar. O MCP transporta contratos compactos. O core conserva fórmulas, validação, cache e julgamento. A única autoridade sobre a legalidade e o dano é o motor com o dataset/versão declarados.

No modo B não deve existir “prova por explicação”: uma sugestão só é uma solução medida depois de reproduzir o patch/link, cumprir restrições e julgar os alvos separadamente. Dano suficiente e garantia do abate são campos distintos. Margem de 0,83% é positiva, mas frágil; uma alteração de regra/dado exige nova verificação.

## Correções pequenas justificadas

1. Cobrança compartilhada para recálculos de rotação e mínimo conservador refletindo esse custo. Testes anteriores demonstraram recálculo sem débito.
2. Conflitos iniciais de indisponibilidade, consumível ou efeito proibido geram erro explícito; a remoção MVP já suportada permanece uma etapa especial, com rejeição se uma trava impedir. `exclude` continua proibindo novas recomendações, sem declarar indisponibilidade do que já está equipado.
3. Efeitos proibidos incluem seleções de `effects`; procs automáticos proibidos são filtrados. Dano com efeitos temporários não ganha garantia implícita. Hard constraints quebradas também tornam `constraintsMet` falso por alvo.
4. Julgamento de crítico certo usa a semântica de `calcDmgDpsDetailed`: o ramo crítico não é multiplicado pela precisão normal. Houve teste que falhou antes e passou após a correção; as fórmulas e números de dano permaneceram iguais.
5. `get_skill` preserva seu texto compatível de scaling, mas identifica a origem autoral e avisa quando a fórmula executável foi substituída pela versão. A POC mostrou coeficientes textuais antigos, enquanto os estágios executados já estavam disponíveis.

Essas mudanças estão no core e nos metadados compartilhados; não constituem uma nova busca. A mudança em veredito de confiabilidade foi registrada sem reescrever os transcripts anteriores.

## Próximos três passos

1. **Repetir o protocolo em poucas fixtures equipadas de outras classes, incluindo magia e sinergias**, com agentes independentes, registro de tokens/latência/custo e seleção cega ao resultado de A. Incluir margem solicitada de antemão, evitando tratar a solução estreita desta POC como robusta.
2. **Resolver somente as lacunas comprovadas de retorno:** resumo compacto de métricas/gap de hipóteses descartadas e custo real por operação; manter a proveniência de fórmulas. Reutilizar `evaluate_variants` e `explain_damage`, sem expandir um catálogo de ferramentas redundantes.
3. **Retestar C com limitação local explícita já suportada**, cobrando descoberta, propostas, complementos e verificações no mesmo job; comparar o ganho adicional com B, inclusive CPU e custo de raciocínio. Decidir investimento por resultado, sem implementar Beam/VNS antecipadamente.

O Optimize V1 permanece **NOT READY para um aceite geral de produção**: esta POC não fecha a matriz de qualidade ampla, nem valida o serviço publicado divergente. Não houve commit, push, deploy ou Novidades.
