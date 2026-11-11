# Project instructions

When the user asks for a pull request for this project:

- Always add or update the Novidades for the PR, using a uniquely named JSON fragment
  in `release-notes/` as described in `docs/releases.md`.
- Every fragment ships the three languages the app publishes: `logs` in PT-BR (the
  source the notes are written in), plus `logs_es` and `logs_en` with one line each,
  in the same order. `node tools/release-notes.mjs` refuses a fragment that is missing
  a language or whose translations do not cover every line.
- Include a **Novidades** section in the PR description with one sub-section per
  language — **PT-BR**, **ES** and **EN**. Copy every relevant fragment value verbatim,
  preserving wording, accents and punctuation. Do not summarize or translate those
  values again.
- Before opening or updating the PR, verify that its Novidades section contains exactly
  the same text as the fragment entries so the user can review what will be published.
- Write the PT-BR line first and translate from it. Keep in-game proper nouns (items,
  skills, classes, monsters) in the form the client uses for that language; if the
  localized name is not known, leave the PT-BR name rather than inventing one.

## Publicação na VPS

Never publish, activate a release or change anything on the VPS (`deploy/vps/deploy.ps1`, `activate.sh`, PM2,
Caddy, the links SQLite file) without the user's explicit permission for that specific change. Preparing the
artifact, notes and tests locally needs no permission. See `docs/deploy-vps.md` and `docs/releases.md`.
Always back up `/root/web/Caddyfile` (dated copy beside it) before any change to it, validate before reload, and never print its contents: it holds other sites' `basic_auth` hashes.

## Auditoria e atualização do banco de itens

When asked to update, audit or check the integrity of `src/assets/demo/data/item.json` (new client patch, new items,
"auditar a base"), follow `docs/script-audit.md` ("Como re-auditar"): run `node tools/audit-item-scripts.mjs`, apply the
rulings already recorded there, ask the user only about new cases, run the full suite before committing, and add an entry
to `docs/script-audit-log.md`. Sources outside the RagnarokDB are manual.
