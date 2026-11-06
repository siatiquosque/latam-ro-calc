/**
 * Structural redundancy of the final socket pass (docs/optimize-budget-efficiency.md, question 3). For the build the Legacy 20000 run
 * ended with, how many of the legal cards/enchants of each socket are interchangeable with another one (same script, same position,
 * no set partner, not named by any other item's script)? Those need one evaluation for the whole class, not one each. It measures;
 * it changes nothing and eliminates nothing that could take part in a synergy.
 *
 *   PowerShell:  $env:REDUNDANCY_BENCH=1; npx vitest run mcp/src/engine/optimize-redundancy.bench.spec.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { config } from '../config';
import { createBuildContext } from '../../../src/app/build-analysis/operations/context';
import { resolveBuild } from '../../../src/app/build-analysis/engine/build-input';
import { decodeOnce } from '../../../src/app/build-analysis/engine/variants';
import { socketOptions } from '../../../src/app/build-analysis/engine/complements';
import { partnerIndex } from '../../../src/app/build-analysis/engine/item-partners';
import { SEARCH_SLOTS } from '../../../src/app/build-analysis/engine/search-slots';

const DIR = 'docs/benchmarks/optimize-budget';
describe.skipIf(!process.env['REDUNDANCY_BENCH'])('socket redundancy', () => {
  it('measures interchangeable candidates', async () => {
    const dataset = loadDatasetFromDisk();
    const { normalizeShare } = createBuildContext(config);
    const partners = partnerIndex(dataset);
    // Items whose script names another item (by id, aegis or name) as a set half: never merged.
    const named = new Set<number>();
    for (const item of Object.values(dataset.items) as any[]) {
      const text = JSON.stringify(item?.script ?? {});
      if (/EQUIP(_ID)?\[/.test(text)) named.add(item.id);
    }
    const out: Record<string, unknown> = {};
    for (const name of ['b1', 'inq']) {
      const run = JSON.parse(readFileSync(`${DIR}/runs/${name}/legacy-20000.json`, 'utf8'));
      const rb = resolveBuild(decodeOnce(await normalizeShare({ share: run.result.share } as never)), dataset);
      const rows: Record<string, unknown>[] = [];
      let total = 0, distinct = 0;
      for (const slot of SEARCH_SLOTS) {
        const itemId = (rb.model as any)[slot] as number;
        if (!(itemId > 0)) continue;
        for (const option of socketOptions(dataset, slot, itemId)) {
          const classes = new Map<string, number>();
          let guarded = 0;
          for (const id of option.ids) {
            const item = dataset.items[id] as any;
            const partnered = partners.of(id).length > 0 || named.has(id);
            if (partnered) guarded++;
            const signature = partnered ? `#${id}` : JSON.stringify([item?.script ?? {}, item?.compositionPos ?? null]);
            classes.set(signature, (classes.get(signature) ?? 0) + 1);
          }
          total += option.ids.length; distinct += classes.size;
          rows.push({ slot, field: option.field, kind: option.kind, candidates: option.ids.length, classes: classes.size, guarded });
        }
      }
      out[name] = { total, distinct, rows };
      console.info(`${name}: ${total} legal candidates, ${distinct} distinct effects (${total - distinct} interchangeable)`);
    }
    writeFileSync(`${DIR}/redundancy.json`, JSON.stringify(out, null, 1));
    expect(Object.keys(out).length).toBe(2);
  }, 120_000);
});
