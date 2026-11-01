---
name: deploy-vps
description: Prepare a release (Novidades in 3 languages, version bump), package it and publish it to the VPS (Caddy + PM2) with verification and rollback. Use when asked to release, deploy, "subir na VPS", publish a new version or check what is live. Publishing needs the user's explicit permission every time.
---

# Release and deploy to the VPS

**Gate:** preparing notes, tests and the package needs no permission. Activating a release, PM2, Caddy or anything on the VPS only after an explicit "pode publicar" for this change. An earlier approval does not carry over. Never `git push` unless asked.

## 1. Notes and version
1. One fragment in `release-notes/<unique-name>.json`: `type:"patch"`, `logs` (PT-BR, source), `logs_es`, `logs_en`, same number of lines in the same order. Keep in-game proper nouns in the client's form; unknown localized name → keep the PT-BR one. User-facing changes only.
2. `node tools/release-notes.mjs` (validates) then `node tools/release-notes.mjs --prepare` (bumps patch, writes `src/releases/history.json`, consumes fragments). `pnpm` may be missing from PATH: call node/npx directly.

## 2. Validate
```
node tools/build-web.mjs --check && npx tsc -p worker/tsconfig.json && npx tsc -p tsconfig.backend-tests.json && npx tsc -p tsconfig.react.json
node tools/check-source.mjs
NODE_OPTIONS=--experimental-sqlite npx vitest run --maxWorkers=4
```
`--experimental-sqlite` only matters on local Node 22 (VPS runs 24). Without `--maxWorkers` the Windows pool can die with `kill EPERM`. Report failures with the spec and cause; do not publish over a red test.

## 3. Commit, package
Commit the release (`chore: release X`) so the artifact is not `dirty`, then `node tools/package-vps.mjs`. `release.json` must show the commit and `"dirty": false`. A startup-bundle size warning is only a warning.

## 4. Publish (after permission)
```
./deploy/vps/deploy.ps1 -ArtifactDirectory .tmp/vps-artifact      # PowerShell
```
It uploads with hashes, backs up `/root/web/Caddyfile` (`Caddyfile.before-laro-<release>`), replaces only the calculator block, validates, reloads PM2 and reverts by itself on failure. Link SQLite lives in `/srv/laro-calc/data` (created by the server).

## 5. Verify, report
Check on `https://laro-calc.siatiquosque.com.br`: `/healthz` and `/mcp/healthz` show the new version; `POST /l/api/links {"url":"<origin>/s/<token>/"}` returns `/l/<slug>` and `GET` it → 302 to the long URL; a foreign-origin URL → 400; `POST /mcp` `tools/list` shows the tools; a `calculate` call returns a short `share`. Say what was verified.

## Rules
- Caddy: always a dated backup first, validate before reload, never print the file (other sites' `basic_auth` hashes).
- Rollback: relink `current` to the previous release (web and server) and reload PM2; see `docs/deploy-vps.md`. No new notes for a rollback.
- Docs: `docs/releases.md`, `docs/deploy-vps.md`.
