---
name: audit-item-scripts
description: Audit and update the item bonuses in src/assets/demo/data/item.json against the sources (RagnarokDB aegisScript, ragassets pt-BR text, DP text, rAthena). Use after a Ragnarok LATAM client update, when new items or previews appear, when a bonus looks wrong, or when asked to "auditar a base", check item integrity or refresh the LATAM/kRO script versions.
---

# Audit the item bonuses

Full method, decisions and open items: `docs/script-audit.md` (single living doc, overwritten). History of runs:
`docs/script-audit-log.md` (append one dated entry per audit). Read both before editing anything.

## Source priority

1. `aegisScript` of the RagnarokDB (read-only, the user's other project, a SQLite synced with the DP): primary for numbers.
2. pt-BR text from ragassets (`latam-items.json`): validates; `item.json` (LATAM) follows it.
3. DP description (en/kr; Thai is a hint only): fallback, and only exists inside the RagnarokDB (`desc`).
4. rAthena: value check only, never overwrites.
5. Replays: below every text source.

No RagnarokDB -> mode `text` (pt-BR text vs DB only); previews come out `N/A`. Any other source is manual: say where it came from in the log. Never call the Divine Pride from the audit.

## Steps

1. If the client changed: sync with ragassets first (`sync-with-ragassets` skill, `tools/sync-latam-db.mjs`).
2. Run `node tools/audit-item-scripts.mjs all --raw <ragassets raw dir> [--db <ragnarok.db> | --aegis <aegis.json>]`
   (phases: `check`, `export`, `dump`, `compare`, `report`; output in `.tmp/item-audit/`, `report.md` is the result).
3. Read `report.md`. Classes: `A` fix the DB; `D0`/`C` document only; `D1` DB keeps the pt-BR, kRO goes to the overlay;
   `E` ask. Apply the rulings already recorded in `docs/script-audit.md` ("Decisões já tomadas"); ask the user only about new cases.
4. Edit `item.json` by hand, point edits, no reordering. kRO versions: `tools/build-item-script-kro.mjs`;
   keys the engine lacks: `tools/build-item-script-extra.mjs`. New items the client ships: `node tools/missing-items.mjs`.
5. Validate: `npx vitest run src/app mcp worker tools`, the three `tsc` (`tsconfig.react.json`, `tsconfig.backend-tests.json`,
   `worker/tsconfig.json`), `node tools/check-source.mjs`, `node tools/release-notes.mjs`, `node tools/build-web.mjs --check`.
   Run the **whole suite before any commit**.
6. Update `docs/script-audit.md` (decisions, pending) and append the entry to `docs/script-audit-log.md`.
7. PR needs a Novidades fragment in `release-notes/` (PT-BR, ES, EN) and the matching section in the PR description.

## Hard rules

- Never write to the RagnarokDB. Never commit, push or open a PR without explicit approval.
- Never publish or change anything on the VPS (`deploy/vps/*`, PM2, Caddy, links SQLite) without explicit permission for that change.
- Do not use bare `git stash`; the stack is shared with other worktrees.
- Keep `item.json` edits minimal so upstream syncs do not conflict; new data goes in its own file.
