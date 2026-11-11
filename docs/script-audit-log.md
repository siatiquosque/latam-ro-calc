# Registro das auditorias de scripts

Histórico incremental: **uma entrada por auditoria, só acrescenta** (a mais nova no topo). O método, as decisões e as
pendências atuais ficam em [script-audit.md](script-audit.md), que é um documento único e sobrescrito. Cada entrada traz
a data, o modo (`full` ou `text`), a versão do cliente, os números do `report.md` e o que mudou.

## 10/11/2026 — primeira auditoria completa (modo `full`)

- **Fontes:** RagnarokDB (`aegisScript`), pt-BR do ragassets, rAthena como conferência; cliente da época (0.1.216-beta+).
- **Escopo:** 7.127 itens equipáveis, cartas e encantamentos passaram pelo motor.
- **Resultado da rotina** (`node tools/audit-item-scripts.mjs all`): script x DB — 4.464 `MATCH`, 5 `MATCH-CTX`, 715 `DIFF`;
  classes por chave: `D0` 238, `D1` 305, `E` 45, `A` 35 (exceções conhecidas), `C` 468; `T-DIFF` 96, `N/A` 1.131.
- **Mudou:** correções `A` aplicadas ao `item.json`; versão kRO em `item-script-kro.json` (696 itens); chaves sem suporte
  em `item-script-extra.json`; 22 itens graduados, três Thanos, cartas por refino (27261, 27181, 4528, 4669), escadas
  "a cada refino a partir do +N" (1830, 2168, 2581), Dom Celestial/Infernal. Seletor LATAM/kRO na calculadora.
- **Pendente:** ver "Pendências" em `script-audit.md`. 24747 fechado (o "+0,3" é erro de texto do pt-BR).
- **Visuais novos:** 400100, 400325 (`locations` Topo + Meio), 400965, 420204, 420703 e 480488 entraram em `item.json` sem bônus, porque `tools/missing-items.spec.ts` exige um registro para cada visual do cliente.
- **Validação antes do commit:** `npx vitest run src/app mcp worker tools` (462 arquivos, 11.480 testes, 0 falhas), três `tsc`, `check-source`, `release-notes` e `build-web --check` passaram.
