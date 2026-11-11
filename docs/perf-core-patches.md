# Mudanças de desempenho fora do otimizador (merge com o upstream)

Regra: dados e scripts (`item.json`, `src/assets/demo/data/*`) ficam idênticos ao upstream. A lógica nova do otimizador
fica em `src/app/build-analysis/`. Só os três ganchos abaixo tocam código herdado do upstream; a fórmula de dano
(`damage-calculator.ts`) não foi alterada. Depois de um merge, confira cada item e rode os testes da última coluna.

| Arquivo | O que mudou | Por que | Teste que trava |
|---|---|---|---|
| `src/app/core/calculator.ts` (`calcScriptEntryValue`) | Linha sem `[` e sem `:` pula `validateCondition` | Evita ~25 regex em 59% das linhas | `core/calculator-plain-lines.spec.ts` |
| `src/app/jobs/_character-base.abstract.ts` | `getAtkSkills` guardado por versão; `setLearnSkills` lê `passiveSkills` uma vez | O getter reconstruía e ordenava a lista a cada chamada (O(n²)) | `damage-golden.spec.ts`, specs de replay |
| `src/app/utils/format-number.ts` | Cache de resultado por (valor, min, max), limite 20.000 | `Intl.format` dominava a geração das linhas de fórmula | `damage-golden.spec.ts` |

Trava geral de dano (falha se qualquer número mudar):
- `mcp/src/engine/damage-golden.spec.ts`: dps/avgHit/max/min/crítico/acerto das builds de referência.
- `mcp/src/engine/optimize-reference-score.spec.ts`: resultado final do `optimize_build` (600 solves).
- Specs de replay em `src/app/jobs/*replay*.spec.ts` e `src/app/replay/`: dano contra o jogo real.

Intencional? Regenere com `UPDATE_GOLDEN=1 npx vitest run <spec>` e revise o diff de `__tests__/fixtures/*-golden.json`.

No otimizador (não é código do upstream): chave do cache e estados de proc em `build-analysis/engine/evaluate.ts`
(travado por `mcp/src/engine/proc-states.spec.ts`).
