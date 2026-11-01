---
name: improve-build
description: Use the ro-calc MCP to improve a Ragnarok LATAM build from a simulator share link: where the damage comes from, stat/trait points, gear, cards, enchants, random bonuses, procs and refine. Use when the user pastes a laro-calc link or asks what to swap, whether an item is worth it, or how to distribute points.
---

# Improve a build with the MCP

The link may carry unusual state (zeroed POD/CON, no buffs, a roll in an unexpected position). Check it first and ask or state assumptions: `calculate` shows `stats`, `availableEffects`, warnings. Override on top of the link with sparse fields (`build.share` + `stats`, `gear`, `options`); never rebuild by hand. Always hand back the `share` from the result (it is already the short form).

## Order that wastes least
1. `calculate` (3 KB): baseline, final stats, `availableEffects` (procs).
2. `explain_damage` `{parts:["contributions","refine"]}`: what each piece/buff gives, what the number leaves out, gain of +1/+2 refine per piece.
3. `optimize_stats` (~1 s): moves stat/trait points within the level's budget. `lock` the stats the user wants kept, `require:[{metric:"hp",min:N}]` to protect survivability.
4. `optimize_build`: gear, cards, enchants, rolls. Useful knobs:
   - `maxGrade:"C"` cap (the base must already respect it); `lock`/`exclude`/`candidates` to focus; `slots` to limit the walk.
   - `targets:[{monsterId,weight}]` to weigh several monsters (size penalty only shows on Large).
   - `pairs:[["garment","boot"]]` for two slots that should change together without a set linking them.
   - `countProcs:true` when procs matter (doubles solves on builds with procs); otherwise read the `procs` gain list and rerun with `effects:[name]`.
   - `rotation`+`objective:"rotationDps"` for a skill rotation; default `dps`.
5. `evaluate_variants` to compare named alternatives in one call (`patch` from `optimize_build` is ready to use).

## Keep answers short (tokens)
Defaults are compact. Ask for `detail:true` (candidate ids, runners-up in `alternatives`, raw pools in `slot_options`) only when you need the "why". Use `uncatalogued_pools`/`slot_options` instead of guessing ids. Do not paste whole JSON back to the user.

## Say what the number does not prove
- Search is heuristic, bounded by solves and by `MAX_SEARCH_MS`; `stopped` says if it converged or ran out. No global optimum claim.
- Rolls come from: code, `regional-pools.json`, bROWiki, then rAthena (kRO) as fallback. `unconfirmedRolls` = from rAthena, not confirmed for LATAM. Items with no pool anywhere are not searched (`uncataloguedRandomItems`).
- Group buffs and procs not counted are listed; mention the ones that change the recommendation. Price is not modelled: say so, do not invent budgets.
- A gain under 0.1% is noise. State the % per swap and the total.

Reference: `docs/mcp.md`.
