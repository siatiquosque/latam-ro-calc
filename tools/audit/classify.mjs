// Classification of the audit results (docs/script-audit.md, "Classificação").
//
// Pure: takes the per-item results of script-vs-db.mjs (script) and text-vs-db.mjs (text) and says, per item and bonus key,
// what kind of disagreement it is. The class depends on which sources exist for the item, so it is not fixed.
//
//   confidence: full (script + pt-BR text) | script (script only) | text (pt-BR text only) | none
//   per key:    A   script = text, DB differs          -> fix the DB
//               D0  text and DB lack what the script grants (hidden bonus)
//               D1  text = DB, script differs          -> DB follows the pt-BR text
//               E   the three differ
//               C   no pt-BR text, script differs from DB (C1/C2 would also need rAthena, see the doc)
//   per item without script: T-OK / T-DIFF (text vs DB only); nothing at all: N/A

const eq = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * Classify one DIFF key. `text` is { mentioned, series }: whether the pt-BR text talks about the key and, when it
 * disagrees with the DB there, [[point, txt, db], ...]. Text that mentions the key without a series equals the DB.
 */
export function classifyKey(scriptSeries, text) {
  if (!text) return 'C';
  if (!text.mentioned) return scriptSeries.every(([, , d]) => eq(d, 0)) ? 'D0' : 'E';
  if (!text.series) return 'D1';
  const textByPoint = new Map(text.series.map(([p, t, d]) => [p, [t, d]]));
  let textIsDb = true;
  let scriptIsText = true;
  for (const [p, a, d] of scriptSeries) {
    const [t] = textByPoint.get(p) ?? [0, d];
    if (!eq(t, d)) textIsDb = false;
    if (!eq(a, t)) scriptIsText = false;
  }
  if (textIsDb) return 'D1';
  return scriptIsText ? 'A' : 'E';
}

/** @returns {{ [id: string]: { name: string, confidence: string, status: string, keys: { key: string, class: string, sample: string[] }[] } }} */
export function classify(script, text) {
  const out = {};
  const ids = new Set([...Object.keys(script), ...Object.keys(text)]);
  for (const id of ids) {
    const s = script[id];
    const t = text[id];
    const scriptOk = s && s.status !== 'SKIP';
    const confidence = scriptOk && t ? 'full' : scriptOk ? 'script' : t ? 'text' : 'none';
    const name = s?.name ?? t?.name ?? '';
    if (scriptOk) {
      const keys = (s.diffs ?? []).map((d) => {
        return { key: d.key, class: classifyKey(d.series, t && textInfo(t, d.key)), sample: d.sample };
      });
      out[id] = { name, confidence, status: keys.length ? 'DIFF' : s.status, keys };
    } else if (t) {
      out[id] = {
        name,
        confidence,
        status: t.status === 'MATCH' ? 'T-OK' : 'T-DIFF',
        keys: (t.diffs ?? []).map((d) => ({ key: d.key, class: 'T', sample: d.sample })),
      };
    } else {
      out[id] = { name, confidence, status: 'N/A', keys: [] };
    }
  }
  return out;
}

// text-vs-db lists the keys the text mentions (`domain`) and the point series only for those that disagree with the DB.
const textInfo = (t, key) => ({
  mentioned: (t.domain ?? []).includes(key),
  series: t.diffs?.find((d) => d.key === key)?.series,
});
