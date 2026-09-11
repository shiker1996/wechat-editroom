param(
    [string]$PidFile = "",
    [int]$Port = 0
)

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
function Read-LocalConfig {
    $configPath = Join-Path $projectRoot "config.local.json"
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json) } catch { return $null }
}
$localConfig = Read-LocalConfig
if ([string]::IsNullOrWhiteSpace($PidFile)) {
    $configuredPid = [string]$localConfig.rsshub.pidFile
    if ([string]::IsNullOrWhiteSpace($configuredPid)) { $configuredPid = "data\rsshub.pid" }
    $PidFile = if ([System.IO.Path]::IsPathRooted($configuredPid)) { $configuredPid } else { Join-Path $projectRoot $configuredPid }
}
if ($Port -le 0) {
    $baseUrl = [string]$localConfig.rsshub.baseUrl
    $parsedPort = 0
    if ($baseUrl) { try { $parsedPort = ([System.Uri]$baseUrl).Port } catch { $parsedPort = 0 } }
    $Port = if ($parsedPort -gt 0) { $parsedPort } else { 1200 }
}
$PidFile = [System.IO.Path]::GetFullPath($PidFile)
$stopped = $false

if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
    $stored = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($stored -match '^\d+$') {
        & taskkill.exe /PID $stored /T /F 2>$null | Out-Null
        Write-Output "Stopped RSSHub process tree rooted at PID $stored"
        $stopped = $true
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
    $line = netstat -ano | Select-String "LISTENING\s+\d+$" | Where-Object { $_.ToString() -match "(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):$Port\s" } | Select-Object -First 1
    if ($line) {
        $processId = [int]($line.ToString().Trim().Split()[-1])
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
        Write-Output "Stopped process $processId listening on port $Port"
    } else {
        Write-Output "RSSHub is not running on port $Port"
    }
}
