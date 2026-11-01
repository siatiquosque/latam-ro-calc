---
name: sync-upstream
description: Sync this fork's main with upstream adsonpleal/latam-ro-calc (add remote, fetch, merge, resolve version and Novidades collisions). Use when asked to sync with upstream, pull the original repo's changes, or before cutting a release that must include them.
---

# Sync main with upstream

Remote: `upstream` = `https://github.com/adsonpleal/latam-ro-calc.git` (`origin` is the fork). Merge only; never rebase, force-push or push without being asked.

1. `git remote get-url upstream || git remote add upstream https://github.com/adsonpleal/latam-ro-calc.git`; `git fetch upstream`.
2. Look first: `git log --oneline HEAD..upstream/main`, `git diff --name-only HEAD upstream/main`. Compare with `git status --short` — files changed on both sides are the conflict risk (usually `package.json`, `src/releases/history.json`, `src/assets/demo/data/item.json`).
3. A dirty tree blocks the merge. Commit local work in a few logical commits first (`git add -A`; ignore `.tmp/`, `.scratch/`, `tools/__pycache__/`), message in PT-BR, ending with the Co-Authored-By trailer.
4. `git merge upstream/main -m "chore: sincroniza com upstream/main (adsonpleal/latam-ro-calc)"`.
5. **Version collision:** if upstream released the version we also used locally (e.g. both `0.1.194-beta`), keep upstream's entry as published, and move our unreleased notes into a new fragment for the next patch. Never leave two entries with the same `v`; the first entry of `history.json` must equal `package.json`.
6. Re-run `node tools/release-notes.mjs`, then the validation in the `deploy-vps` skill. A test that fails after the merge: compare against `upstream/main` in a throwaway worktree (`git worktree add .tmp/base-wt upstream/main`, reuse `node_modules` via symlink, remove it afterwards) to tell upstream breakage from ours.
7. Report: commits brought in, conflicts and how they were resolved, tests. Push only on request.
