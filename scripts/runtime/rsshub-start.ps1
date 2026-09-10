param(
    [string]$RsshubDir = "",
    [string]$PidFile = "",
    [int]$Port = 1200,
    [int]$StartupTimeoutSeconds = 90,
    [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($RsshubDir)) { $RsshubDir = Join-Path $projectRoot "RSSHub" }
if ([string]::IsNullOrWhiteSpace($PidFile)) { $PidFile = Join-Path $projectRoot "data\rsshub.pid" }
$RsshubDir = [System.IO.Path]::GetFullPath($RsshubDir)
$PidFile = [System.IO.Path]::GetFullPath($PidFile)

if (-not (Test-Path -LiteralPath $RsshubDir -PathType Container)) { throw "RSSHub directory does not exist: $RsshubDir" }
$entryFile = Join-Path $RsshubDir "lib\index.ts"
$tsxCli = Join-Path $RsshubDir "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path -LiteralPath $entryFile -PathType Leaf)) { throw "RSSHub source entry does not exist: $entryFile" }
if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) { throw "RSSHub local tsx runtime does not exist: $tsxCli. Run npm install in the RSSHub directory." }
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = $env:WORKBENCH_NODE_PATH }
if ([string]::IsNullOrWhiteSpace($NodePath)) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [System.IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node runtime does not exist: $NodePath" }

function Test-Rsshub {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch { return $false }
}

if (Test-Rsshub) {
    Write-Output "RSSHub is already healthy on port $Port"
    exit 0
}

$pidDirectory = Split-Path -Parent $PidFile
if (-not (Test-Path -LiteralPath $pidDirectory)) { New-Item -ItemType Directory -Path $pidDirectory -Force | Out-Null }
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PidFile)
$logDirectory = Join-Path $workspaceRoot "logs\rsshub"
if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }
$stdout = Join-Path $logDirectory "rsshub.log"
$stderr = Join-Path $logDirectory "rsshub.error.log"

$arguments = "`"$tsxCli`" `"$entryFile`""
$process = Start-Process -WindowStyle Hidden -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $RsshubDir -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$process.Id | Set-Content -LiteralPath $PidFile -Encoding ascii
Write-Output "RSSHub process started (PID: $($process.Id)); waiting for port $Port"

$deadline = (Get-Date).AddSeconds([Math]::Max(10, $StartupTimeoutSeconds))
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
        $detail = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
        throw "RSSHub exited before becoming healthy (code $($process.ExitCode)). $detail"
    }
    if (Test-Rsshub) {
        Write-Output "RSSHub is healthy on port $Port (PID: $($process.Id))"
        exit 0
    }
    Start-Sleep -Milliseconds 750
}

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
$detail = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
throw "RSSHub did not become healthy within $StartupTimeoutSeconds seconds. $detail"
