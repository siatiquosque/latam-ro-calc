import { readFileSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** esbuild emits a CSS bundle for a lazy entry even when main's CSS already
 * contains exactly the same rules. Keep one physical artifact and point bundle
 * metadata at it before generating the HTML and measuring deployment size.
 */
export function deduplicateCss(outputs, outputDirectory, root = process.cwd()) {
  const directory = resolve(outputDirectory);
  const canonical = new Map();
  const removed = [];
  for (const name of Object.keys(outputs).filter(name => name.endsWith('.css'))) {
    const file = resolve(root, name);
    if (!file.startsWith(directory + sep)) throw new Error('CSS output escaped the build directory');
    // Maps differ by output filename; they have no effect on the stylesheet.
    const css = readFileSync(file, 'utf8').replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '');
    const previous = canonical.get(css);
    if (!previous) { canonical.set(css, name); continue; }
    // Never delete an output whose filename is referenced in emitted code/CSS.
    // cssBundle is build metadata, not an emitted reference, and is remapped below.
    if (Object.values(outputs).some(meta => meta.imports?.some(entry => entry.path === name))) continue;
    for (const meta of Object.values(outputs)) if (meta.cssBundle === name) meta.cssBundle = previous;
    for (const path of [name, `${name}.map`]) {
      if (!outputs[path]) continue;
      const target = resolve(root, path);
      if (!target.startsWith(directory + sep)) throw new Error('CSS output escaped the build directory');
      unlinkSync(target);
      delete outputs[path];
    }
    removed.push(name);
  }
  return removed;
}
