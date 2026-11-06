# Auditoria MCP para otimização guiada por conhecimento

05/11/2026. Código local `0.1.211-beta`, checkout `latam-ro-calc-goal-search` com alterações não commitadas. A POC usa o MCP real por `Client`/`InMemoryTransport`, com hipóteses escritas pelo agente desta sessão e respostas inspecionadas antes da rodada seguinte. Não foi chamado um modelo pago adicional.

O roadmap original não está no checkout: foi localizado e lido em `C:/Users/Felipe/Downloads/roadmap_optimize_mcp_laro.md`. Foram consultados `optimize-roadmap-status.md`, `optimize-v1-acceptance.md`, os relatórios de orçamento/progressiva e o código. Documentação antiga chamava fixtures de classe 4262 de Meister: `get_build_context` e o registro de classes identificam **Inquisidor**. Esses nomes históricos não comprovam cobertura de outra classe.

O serviço público respondeu `0.1.221-beta`, com dados e schema diferentes; não anuncia `maxEngineCalls`. O reconhecimento conectado não participa dos números A/B/C. O congelamento local e os hashes estão em [fixture](benchmarks/ai-guided-poc/fixture.json) e [proveniência](benchmarks/ai-guided-poc/code-provenance.json).

## Dados e propriedade

| Conhecimento | Fonte executável/estruturada | Superfície MCP e limite |
| --- | --- | --- |
| Equipamento, cartas, encantos, classe, nível, LATAM | `data/dataset.ts`, `data/item-index.ts`, `slot-classifier.ts`, catálogos de bônus aleatórios | `search_items`, `get_item`, `slot_options`; itens só em `latam-extra` podem não ter mecânica para cálculo. Isso é ausência de dados, não ausência de ferramenta. |
| Fórmula, tempo, crítico, atributos e estados | `jobs/*`, `skills/rebalance-2026.ts`, `engine/skill-info.ts`, `skill-dependencies.ts` | `get_skill`; dependências são observadas em ramos amostrados. Não são prova exaustiva. |
| Cálculo efetivamente executado | `core/damage-calculator.ts`, `calculator.ts`, `utils/calc-dmg-dps.ts` | `calculate`, `explain_damage.stages/crit`; os estágios têm valores e chaves mecânicas. A decomposição é do caminho/modelo selecionado, não de todos os resultados possíveis. |
| Condições, parceiros, AND/OR | `engine/synergies.ts`, `synergy-patches.ts`, expressões do catálogo | `find_synergies`; conserva expressão residual e proveniência. `equipmentRequirementsMet` só verifica requisitos de equipamento. |
| Contexto atual | `operations/build-context.ts` | `get_build_context`: validação, classe/habilidade, equipamento, dano, stats e efeitos disponíveis/selecionados. Seu `constraints` é o contrato de validação simples, não o `ConstraintSpec` completo do Optimize. |
| Hipóteses e julgamento | `operations/optimize.ts#evaluateVariants`, `engine/evaluate.ts`, `feasibility.ts` | `evaluate_variants`: patches, múltiplos alvos, cache por lote, restrições, GoalSpec e confiabilidade. Não exige reconstruir a build. |

Não há segundo motor no MCP. UI e MCP usam as operações comuns; as fórmulas permanecem nos módulos existentes. A busca de equipamentos não redistribui atributos nem escolhe novos buffs/consumíveis implicitamente.

## Matriz de ferramentas e lacunas reais

| Ferramenta | Descoberta e contexto | Informação verificável | Eficiência e lacuna |
| --- | --- | --- | --- |
| `get_build_context` | Recebe build/link e alvo; não exige IDs de equipamento | Stats, skill, dano, efeitos e validação | Uma chamada ao motor na POC; resposta 8.588 bytes. Não é relatório completo de metas/restrições nem detector automático de gargalos. |
| `get_skill` | Nome, value, ID ou rótulo e classe/versão | Tipo, crítico, tempos, entradas, dependências de skill ativa/aprendida | Zero avaliações completas observadas. **Lacuna comprovada:** texto autoral de scaling pode conservar coeficientes da versão antiga após override da fórmula. Foi adicionada proveniência e advertência aditiva; usar estágios executados para confirmar. |
| `search_items` | Nome sem acentos, slot, classe, habilidade, bônus, nível, LATAM, MVP, paginação | IDs e até seis bônus curtos por item | Zero chamadas ao motor; não avalia compatibilidade contextual completa ou ativação. `cri` é chave de bônus; `critRate` é métrica. Uma chave errada pode produzir um conjunto vazio silenciosamente. Detalhes truncados exigem `get_item`. |
| `find_synergies` | Itens da build, IDs conhecidos, referências inversas e filtro por bônus | `allOf/anyOf`, itens, condições, expressão residual, origem e versão | Zero chamadas completas na POC sem `includePatches`. Geração/validação opcional de patches pode custar mais. Grau/refino composto ainda pode ficar em `unparsedExpression`; isso é lacuna da interpretação, não do catálogo. |
| `evaluate_variants` | Lote de patches pequenos ou coordenados; até cinco alvos | Métricas por alvo, legalidade, GoalSpec, viabilidade e confiabilidade | Cache local ao lote; contexto completo entra na chave. Shares em cada linha tornam lotes grandes: os seis lotes retornaram 115.075 bytes; uma projeção offline sem shares reduziria a 69.358 bytes. Essa projeção não foi implementada e não é economia medida de tokens. Com GoalSpec, candidatos que falham podem sair do ranking sem métricas/gap detalhados. A POC inspecionou hipóteses sem GoalSpec e aplicou o GoalSpec à solução selecionada. |
| `scan_slot` | Descobre itens elegíveis sem IDs prévios | Ranking de peças, soquetes medidos, cobertura e patches | É busca automática limitada; pode testar dezenas de itens. Não foi usada no braço B para evitar atribuir busca automática ao raciocínio do agente. |
| `optimize_slot` | Testa poucos IDs previamente descobertos | Ranking/contexto e complementos legais | Subbusca automática; não foi usada em B. Pode ser útil em C com custo contabilizado. |
| `optimize_build` | Descoberta e busca automáticas completas | Patch, métricas, metas, checkpoints, restrições e custo | Usado no braço A e no subconjunto C pelo mesmo core. Em baixo teto multi-alvo, triagem/tuning pode consumir tudo antes da primeira aceitação. |

Custos reais por ferramenta, tempos de processo e bytes estão em [tool-costs.json](benchmarks/ai-guided-poc/tool-costs.json). Na sessão B: 16 buscas de itens custaram zero chamadas completas, mas 21.780 bytes; seis lotes de variantes custaram 205 chamadas e 115.075 bytes. Consultas de metadados têm CPU e custo de contexto mesmo quando custam zero avaliações do simulador. Os números não são limites universais.

## O que já permite raciocínio fundamentado

O agente identificou a habilidade 5244 e a dependência **ativa** de Oleum Sanctum, preservando todas as skills/passivas da build e deixando seu efeito desligado. O estágio executado revelou crítico efetivo de 67% no primeiro alvo, alto dano à distância, DEF já penetrada e redução por RES. Assim, não foi necessário testar mais penetração de DEF indiscriminadamente.

`search_items` encontrou armas específicas, `get_item` mostrou seus limiares e `find_synergies` revelou o par atual Garra Primordial-LT/Bota Primordial-LT. `slot_options` confirmou a Flor Invernal (Espiritual) na Armadura Invernal. A armadura nua perdeu dano; a combinação legal com encantos e outros componentes melhorou a solução. O par Fé/Vivatus foi testado mesmo com desempenho isolado ruim e foi rejeitado por evidência do motor.

A hipótese sobre Carta Drosera foi explicitamente testada e refutada: não elevou a chance crítica dessa habilidade no modelo. Uma descrição de bônus disponível não demonstra que ele seja consumido pelo cálculo escolhido. Nenhuma fórmula foi alterada para fazer a hipótese funcionar.

## Ativação e explicação ainda incompletas

- `get_build_context.effects` informa os procs selecionados/disponíveis; não fornece um inventário completo de cada cláusula de item efetivamente ativa, sua contribuição e a razão das inativas.
- `calculate` tem seções de bônus e `explain_damage` tem estágios/contribuições. Remover um item mede um efeito marginal, incluindo sinergias perdidas; não prova uma atribuição aditiva independente.
- O índice preserva AND/OR e o catálogo original; condições residuais exigem leitura e confirmação no motor. `not-found` de um patch não prova impossibilidade.
- HIT, crítico, mínimo sem crítico e estados temporários precisam permanecer separados. A POC encontrou uma divergência no julgamento de crítico certo/precisão e a corrigiu contra o ramo real de DPS.
- O cache é por operação/lote; não existe cache de hipóteses persistente entre chamadas independentes. A POC pagou novamente baselines repetidas e contabilizou isso.

## Redução do espaço: prova e hipótese

Foram testadas 33 variantes explícitas em quatro lotes exploratórios, com 185 chamadas reais nos cinco alvos. A primeira combinação de dano suficiente surgiu no lote de custo acumulado 92. Isso mede seleção nesta fixture; não mede redução percentual contra o catálogo inteiro ou uma referência exaustiva.

Deduplicar a mesma build/contexto pelo cache é seguro. Filtrar classe, nível, disponibilidade, MVP e soquetes ilegais também é seguro dentro das regras do motor. Priorizar bônus baixos, sensibilidade e parceiros é heurística. Eliminar um item por ganho individual negativo é inseguro: pode haver dependência entre peças/encantos. Não foi implementada eliminação de dominados; equivalência/dominância exigiria cobrir condições, graus, refinos e sinergias, não apenas comparar números isolados.

## Instrumentação mínima recomendada

Não criar uma ferramenta duplicada de “analisar build”. Priorizar extensões compactas, se uma próxima POC justificar:

1. Tornar a proveniência de texto de fórmula inequívoca — advertência aditiva implementada; não manter uma segunda fórmula matemática.
2. Opcionalmente devolver um resumo limitado de métricas/gap e razão de descarte de variantes inviáveis. Essa foi a lacuna funcional que exigiu dois passos na POC.
3. Expor custo real observável por operação e, sob demanda, ativação de cláusulas com origem. O runner atual mede isso por observação, sem nova API pública.

Não há evidência para expor o banco inteiro, criar dez novas ferramentas, contratar API de IA ou embutir um modelo na calculadora.
