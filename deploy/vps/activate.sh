#!/usr/bin/env bash
# First provision /tmp/laro-<release>/{web,node}.tar.gz via SCP.
# Existing Caddy runs in Docker with /srv/tools mounted; backend stays outside it.
set -euo pipefail
release=${1:?release ID required}
[[ "$release" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 2
base=/srv/laro-calc
web=/srv/tools/laro-calc
stage=/tmp/laro-$release
target=$base/releases/$release
public=$web/releases/$release
config=/root/web/Caddyfile
backup=/root/web/Caddyfile.before-laro-$release
test ! -e "$target"
test ! -e "$public"
test -f "$stage/web.tar.gz"
test -f "$stage/node.tar.gz"
test -f "$config"
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
command -v pm2 >/dev/null
mkdir -p "$target" "$public"
tar -xzf "$stage/web.tar.gz" -C "$public"
tar -xzf "$stage/node.tar.gz" -C "$target"
ln -s "$public" "$target/dist/sakai-ng"
test -f "$public/index.html"
test -f "$public/assets/data-manifest.json"
cp -p "$config" "$backup"
cp "$config" "$stage/Caddyfile"
python3 - "$stage/Caddyfile" "$target/deploy/vps/Caddyfile" <<'PY'
import pathlib, sys
path, block = map(pathlib.Path, sys.argv[1:])
text = path.read_text()
marker = 'laro-calc.siatiquosque.com.br {'
start = text.find(marker)
if start >= 0:
    depth = 0
    end = None
    for index in range(start + len(marker) - 1, len(text)):
        depth += (text[index] == '{') - (text[index] == '}')
        if depth == 0:
            end = index + 1
            break
    if end is None:
        raise SystemExit('Unbalanced calculator Caddy block')
    text = text[:start] + block.read_text() + text[end:]
else:
    text += '\n' + block.read_text()
path.write_text(text)
PY
docker cp "$stage/Caddyfile" caddy:/tmp/laro-Caddyfile >/dev/null
docker exec caddy caddy validate --config /tmp/laro-Caddyfile --adapter caddyfile
previous=$(readlink "$base/current" || true)
previous_web=$(readlink "$web/current" || true)
activated=0
config_changed=0
rollback() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo 'Activation failed; restoring previous configuration.' >&2
    if [ "$config_changed" = 1 ]; then
      cat "$backup" > "$config"
      docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
    fi
    if [ "$activated" = 1 ]; then
      if [ -n "$previous" ]; then
        ln -sfn "$previous" "$base/current"
        ln -sfn "$previous_web" "$web/current"
        pm2 startOrReload "$base/current/deploy/vps/ecosystem.config.cjs" --update-env || true
      else
        pm2 delete laro-calc || true
        unlink "$base/current"
        unlink "$web/current"
      fi
    fi
  fi
  exit "$code"
}
trap rollback EXIT
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
ln -s "$public" "$web/current.next"
mv -Tf "$web/current.next" "$web/current"
activated=1
pm2 startOrReload "$target/deploy/vps/ecosystem.config.cjs" --update-env
curl --fail --silent --show-error --max-time 5 --retry 5 --retry-delay 1 --retry-all-errors -H 'Host: laro-calc.siatiquosque.com.br' http://127.0.0.1:8787/healthz
if [ -f "$public/assets/release.json" ]; then
  python3 - "$public/assets/release.json" <<'PY'
import json, sys, urllib.request
expected = json.load(open(sys.argv[1]))['version']
request = urllib.request.Request('http://127.0.0.1:8787/healthz', headers={'Host': 'laro-calc.siatiquosque.com.br'})
with urllib.request.urlopen(request, timeout=10) as response:
    actual = json.load(response)['version']
if actual != expected:
    raise SystemExit(f'Server version {actual} differs from web artifact {expected}')
PY
fi
# Write in place: Docker bind-mounts the file's inode.
config_changed=1
cat "$stage/Caddyfile" > "$config"
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
curl --fail --silent --show-error --max-time 10 --retry 10 --retry-delay 8 --retry-all-errors https://laro-calc.siatiquosque.com.br/healthz
pm2 save
echo "Activated release $release"
