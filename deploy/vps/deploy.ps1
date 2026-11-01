param([string]$ArtifactDirectory = '.tmp/vps-artifact')
$ErrorActionPreference = 'Stop'
$artifact = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$metadata = Get-Content -LiteralPath (Join-Path $artifact 'release.json') -Raw | ConvertFrom-Json
if ($metadata.version -notmatch '^\d+\.\d+\.\d+(-beta)?$') { throw 'Invalid release version' }
$release = $metadata.version + '-' + (Get-Date -Format 'yyyyMMddTHHmmss')
function Run-Native([string]$command, [string[]]$arguments) {
  & $command @arguments
  if ($LASTEXITCODE -ne 0) { throw "$command failed ($LASTEXITCODE)" }
}
$web = Join-Path $artifact 'web.tar.gz'
$node = Join-Path $artifact 'node.tar.gz'
$webHash = (Get-FileHash -LiteralPath $web -Algorithm SHA256).Hash.ToLowerInvariant()
$nodeHash = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
Run-Native ssh @('-o', 'BatchMode=yes', 'larotools-vps', "mkdir -p /tmp/laro-$release")
Run-Native scp @('-q', $web, "larotools-vps:/tmp/laro-$release/web.tar.gz")
Run-Native scp @('-q', $node, "larotools-vps:/tmp/laro-$release/node.tar.gz")
Run-Native scp @('-q', (Join-Path $PSScriptRoot 'activate.sh'), "larotools-vps:/tmp/laro-$release/activate.sh")
Run-Native ssh @('-o', 'BatchMode=yes', 'larotools-vps', "cd /tmp/laro-$release && printf '%s  %s\n' '$webHash' web.tar.gz '$nodeHash' node.tar.gz | sha256sum -c - && bash activate.sh '$release'")
$health = Invoke-RestMethod 'https://laro-calc.siatiquosque.com.br/healthz'
if ($health.version -ne $metadata.version) { throw 'Public server version does not match the artifact' }
Write-Output "Published $release"
