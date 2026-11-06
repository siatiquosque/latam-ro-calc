import { build } from 'esbuild';
import { resolve } from 'node:path';

// One file, no chunks: the lazy acquisition door is swapped for a static one (see acquisition-operations.static.ts).
const staticAcquisition = { name: 'static-acquisition', setup: (b) => b.onResolve({ filter: /acquisition-operations$/ }, () => ({ path: resolve('mcp/src/tools/acquisition-operations.static.ts') })) };

await build({
  entryPoints: ['mcp/src/node/index.ts'], outfile: 'dist/vps/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  tsconfig: resolve('worker/tsconfig.json'),
  // The SDK has CJS dependencies that use require for Node builtins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [staticAcquisition],
  logLevel: 'info',
});
