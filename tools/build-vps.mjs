import { build } from 'esbuild';
import { resolve } from 'node:path';

await build({
  entryPoints: ['mcp/src/node/index.ts'], outfile: 'dist/vps/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  tsconfig: resolve('worker/tsconfig.json'),
  // The SDK has CJS dependencies that use require for Node builtins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
