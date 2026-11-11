import { z } from 'zod';

/** Closest valid key by edit distance, only when it is near enough to be a typo or a synonym of the same length class. */
function closest(key: string, valid: string[]): string | undefined {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const keep = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
        prev = keep;
      }
    }
    return row[b.length];
  };
  const best = valid.map((candidate) => ({ candidate, d: distance(key, candidate) })).sort((a, b) => a.d - b.d)[0];
  // "classId" -> "class", "targets" -> "target": a prefix or one-to-three edits.
  return best && (best.d <= 3 || best.candidate.startsWith(key) || key.startsWith(best.candidate)) ? best.candidate : undefined;
}

/**
 * An object that refuses fields it does not know, and says which ones are valid. A dropped misspelling ("classId" for "class")
 * made tools answer about the default instead; the bare "Unrecognized key" that replaces it left the AI guessing the next name.
 */
export function strictShape<T extends z.ZodRawShape>(shape: T, where = '') {
  const valid = Object.keys(shape);
  return z.strictObject(shape, {
    error: (issue) => {
      if (issue.code !== 'unrecognized_keys') return undefined;
      const keys = issue.keys as string[];
      const hints = keys.map((key) => { const near = closest(key, valid); return near ? `"${key}" → "${near}"` : undefined; }).filter(Boolean);
      return `Campo(s) desconhecido(s)${where ? ` em ${where}` : ''}: ${keys.join(', ')}.${hints.length ? ` Você quis dizer: ${hints.join('; ')}?` : ''} Campos válidos: ${valid.join(', ')}.`;
    },
  });
}
