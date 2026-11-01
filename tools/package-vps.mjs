import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFragments } from './release-notes.mjs';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const history = JSON.parse(readFileSync(resolve(root, 'src/releases/history.json'), 'utf8'));
if (history[0]?.v !== version) throw new Error('Package version and Novidades disagree');
if (readFragments(root).length) throw new Error('Prepare pending notes with pnpm release:prepare before packaging');
const web = '.tmp/vps-release';
const artifact = '.tmp/vps-artifact';
const env = { ...process.env, PUBLIC_APP_ORIGIN: 'https://laro-calc.siatiquosque.com.br', SHORTENER_URL: '' };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const git = args => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Unable to identify source checkout');
  return result.stdout.trim();
};
const metadata = { version, builtAt: new Date().toISOString(), gitHead: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']) };
run(process.execPath, ['tools/build-web-data.mjs', '--hash']);
run(process.execPath, ['tools/build-web.mjs', '--output', web]);
run(process.execPath, ['tools/inject-data-manifest.mjs', '--dist', web]);
run(process.execPath, ['tools/build-vps.mjs']);
mkdirSync(resolve(root, artifact), { recursive: true });
writeFileSync(resolve(root, web, 'assets/release.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(resolve(root, artifact, 'release.json'), JSON.stringify(metadata, null, 2) + '\n');
run('tar', ['-czf', `${artifact}/web.tar.gz`, '-C', web, '.']);
run('tar', ['-czf', `${artifact}/node.tar.gz`, 'dist/vps/server.mjs', 'deploy/vps/ecosystem.config.cjs', 'deploy/vps/Caddyfile']);
console.log(`VPS release ${version} packaged at ${artifact}${metadata.dirty ? ' (worktree snapshot)' : ''}`);
