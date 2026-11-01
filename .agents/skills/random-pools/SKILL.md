---
name: random-pools
description: Maintain the random-bonus (bônus aleatório) pools of Ragnarok LATAM items: refresh the bROWiki import, regenerate the rAthena fallback, review which items are unconfirmed, and promote a pool confirmed in game. Use when a random-bonus picker is too open/closed, an item has no pool, or the user confirms what an item rolls.
---

# Random-bonus pools

`randomOptionCatalogFor(id)` (src/app/core/random-option-catalog.ts) reads, strongest first (`randomPoolTier` names the source):
1. **code**: Selo de Loki + lower seals. 2. **regional** `data/random-options/regional-pools.json` (confirmed in game, hand-edited). 3. **wiki** `browiki-pools.json`. 4. **rathena** `rathena-pools.json` (kRO; LATAM tends to follow it, unconfirmed).

The picker and the MCP search use all four. Roll validation of explicit `options` skips the rathena tier. No pool anywhere → picker open, item not searched.

## Refresh the bROWiki pools
```
curl -sL -A "Mozilla/5.0" "https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios" -o .scratch/browiki/bonus-aleatorios.html
python tools/import-browiki-pools.py
```
Items are matched by the divine-pride id in the page, never by name. A rule text with no translation lands in `unmapped` and out of the pool; to support it, add an explicit row to `SIMPLE`/`PLACEHOLDER` in the script, keyed to a real leaf key of `ExtraOptionMap`. Rerun `npx vitest run src/app/core/browiki-pools.spec.ts src/app/core/regional-pools.spec.ts` (the first compares the importer with the hand-written Loki pools).

## Refresh the instance pages (regional tier)
Lago do Abismo, Torneio de Magia, Arena Noturna: download each `https://browiki.org/wiki/<Page>` to `.scratch/browiki/<Page>.html`, run `python tools/import-browiki-instances.py` (rewrites only its own entries in `regional-pools.json`). The coverage test `random-pool-coverage.spec.ts` has an empty `KNOWN_GAPS`: a new LATAM item with option slots and no pool fails it.

## Refresh the rAthena fallback
Only after `rathena-audit.json` changes (`python tools/audit-random-options.py --rathena .scratch/rathena`): `python tools/build-rathena-pools.py`.

## Review the queue, promote a confirmed pool
1. MCP `uncatalogued_pools` (`pool:"rathena"` or `"nenhum"`, filter by `query`/`slot`); with `itemId` it returns the rAthena draft in file format.
2. The user confirms in game. Save the draft's `profiles` to a file (fix the ranges seen in game) and run `python tools/add-regional-pool.py <id,id> <file> --source "jogo LATAM <date>" --confidence "confirmado"`. It writes the shared format (`tools/pool_document.py`: each pool once as a combiner, items point at it), so never paste pools into the JSON by hand and never duplicate one per item. All pool files (regional, bROWiki, rAthena) use that one format and are loaded on demand (lazy chunk), not bundled at startup.
3. `regional-pools.spec.ts` validates keys/ranges. A key must exist in `ExtraOptionMap` (leaf prefix such as `atk`, `p_race_demon`).

Docs: `docs/random-options-audit.md`. Never edit the generated files by hand.
