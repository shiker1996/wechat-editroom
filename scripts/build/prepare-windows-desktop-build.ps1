param(
  [string]$NodeRuntimeVersion = '24.12.0',
  [string]$RsshubRevision = '49b3eb74531c6312e9eb11f8244e82ed0532de28'
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$runtimeParent = Join-Path $workspaceRoot '.node-runtime'
$runtimeDir = Join-Path $runtimeParent "node-v$NodeRuntimeVersion"
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$runtimeTemp = Join-Path $tempRoot 'jianzhi-node-runtime'
$rsshubTemp = Join-Path $tempRoot 'jianzhi-rsshub-source'

$runtimeName = "node-v$NodeRuntimeVersion-win-x64"
New-Item -ItemType Directory -Force -Path $runtimeTemp | Out-Null
$runtimeZip = Join-Path $runtimeTemp "$runtimeName.zip"
$checksumsPath = Join-Path $runtimeTemp 'SHASUMS256.txt'
Invoke-WebRequest "https://nodejs.org/dist/v$NodeRuntimeVersion/$runtimeName.zip" -OutFile $runtimeZip
Invoke-WebRequest "https://nodejs.org/dist/v$NodeRuntimeVersion/SHASUMS256.txt" -OutFile $checksumsPath
$checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match " $([regex]::Escape($runtimeName))\.zip$" } | Select-Object -First 1
if (-not $checksumLine) { throw "Node.js runtime checksum entry is missing for $runtimeName" }
$expectedChecksum = ($checksumLine -split '\s+')[0]
$actualChecksum = (Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expectedChecksum -ne $actualChecksum) { throw 'Node.js runtime checksum mismatch' }

$runtimeExtract = Join-Path $runtimeTemp 'extract'
Remove-Item -LiteralPath $runtimeExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $runtimeZip -DestinationPath $runtimeExtract -Force
Remove-Item -LiteralPath $runtimeParent -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
Move-Item -LiteralPath (Join-Path $runtimeExtract $runtimeName) -Destination $runtimeDir
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'node.exe') -PathType Leaf)) {
  throw 'Bundled Node.js runtime is incomplete'
}

New-Item -ItemType Directory -Force -Path $rsshubTemp | Out-Null
$rsshubArchive = Join-Path $rsshubTemp 'rsshub.zip'
$rsshubExtract = Join-Path $rsshubTemp 'extract'
Invoke-WebRequest "https://github.com/DIYgod/RSSHub/archive/$RsshubRevision.zip" -OutFile $rsshubArchive
Remove-Item -LiteralPath $rsshubExtract -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $rsshubArchive -DestinationPath $rsshubExtract -Force
$rsshubSource = Get-ChildItem -LiteralPath $rsshubExtract -Directory | Where-Object {
  (Test-Path -LiteralPath (Join-Path $_.FullName 'package.json')) -and
  (Test-Path -LiteralPath (Join-Path $_.FullName 'lib\index.ts'))
} | Select-Object -First 1
if (-not $rsshubSource) { throw 'Pinned RSSHub source is incomplete' }
$rsshubTarget = Join-Path $workspaceRoot 'RSSHub'
Remove-Item -LiteralPath $rsshubTarget -Recurse -Force -ErrorAction SilentlyContinue
Move-Item -LiteralPath $rsshubSource.FullName -Destination $rsshubTarget

Write-Host "Prepared Node.js $NodeRuntimeVersion and RSSHub $RsshubRevision for Windows packaging"
