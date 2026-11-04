---
name: sync-upstream
description: Sync this fork's main with upstream adsonpleal/latam-ro-calc (add remote, fetch, merge, resolve version and Novidades collisions). Use when asked to sync with upstream, pull the original repo's changes, or before cutting a release that must include them.
---

# Sync main with upstream

Remote: `upstream` = `https://github.com/adsonpleal/latam-ro-calc.git` (`origin` is the fork). Merge only; never rebase, force-push or push without being asked.

1. `git remote get-url upstream || git remote add upstream https://github.com/adsonpleal/latam-ro-calc.git`; `git fetch upstream`.
2. Look first: `git log --oneline HEAD..upstream/main`, `git diff --name-only HEAD upstream/main`. Compare with `git status --short` — files changed on both sides are the conflict risk (usually `package.json`, `src/releases/history.json`, `src/assets/demo/data/item.json`, `tools/build-web.mjs`, `tools/web-budgets.json`).
3. A dirty tree blocks the merge. Commit local work in a few logical commits first (`git add -A`; ignore `.tmp/`, `.scratch/`, `tools/__pycache__/`), message in PT-BR, ending with the Co-Authored-By trailer.
4. `git merge upstream/main -m "chore: sincroniza com upstream/main (adsonpleal/latam-ro-calc)"`.
5. **Version collision (the fork and upstream both number patches from the same base, so `v` repeats with different content).** Never merge their notes into one entry and never leave two entries with the same `v`. Keep every entry already published by the fork exactly as it is. Then bring each upstream release in as **its own entry**, oldest first, renumbered as the next patches after the fork's current version (fork at `0.1.212-beta` + upstream `0.1.195…0.1.203` → `0.1.213…0.1.221`), keeping its `date` and its three `logs` lists verbatim. Put them at the top of `src/releases/history.json`, newest first, and set `package.json` to the last one. Take the upstream entries from `git show upstream/main:src/releases/history.json`, only those whose `v` is not in `git show $(git merge-base HEAD upstream/main):src/releases/history.json`. In a conflict on `history.json`, `git checkout --ours` it and add the entries this way; do not use `release:prepare` for them (it would fold them into a single entry). The fork's own unreleased fragments in `release-notes/` stay pending for the release after these. The first entry of `history.json` must equal `package.json`.
6. Re-run `node tools/release-notes.mjs`, then the validation in the `deploy-vps` skill. A test that fails after the merge: compare against `upstream/main` in a throwaway worktree (`git worktree add .tmp/base-wt upstream/main`, reuse `node_modules` via symlink, remove it afterwards) to tell upstream breakage from ours.
7. Report: commits brought in, conflicts and how they were resolved, tests. Push only on request.
8. Do the merge in a throwaway worktree of `main` (`git worktree add -b sync/upstream ../<repo>-sync main`, reuse `node_modules` with a junction), validate there, then `git merge --ff-only` it into `main` and remove the worktree: the main checkout may hold someone's work in progress, and a test run in it can overwrite untracked files. Counts hard-coded in specs (e.g. the item total in `worker/mcp/handler.spec.ts`) change when `item.json` grows: update them to the merged value.
