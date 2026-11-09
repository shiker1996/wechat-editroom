param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [int]$StartupTimeoutSeconds = 75
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$workspaceRoot = if ($env:GITHUB_WORKSPACE) { $env:GITHUB_WORKSPACE } else { $repoRoot }
$smokeRoot = Join-Path $tempRoot 'jianzi-installer-smoke'
$installDir = Join-Path $smokeRoot 'app'
$workspaceDir = Join-Path $smokeRoot 'workspace'
$diagnosticsDir = Join-Path $workspaceRoot 'test-results\desktop-installer'
$originalAppData = $env:APPDATA
$isolatedAppData = Join-Path $smokeRoot 'appdata'
$userDataDir = Join-Path $isolatedAppData 'wechat-newsroom-workbench'
$productUserDataDir = Join-Path $isolatedAppData '见字'
$markerPaths = @(
  (Join-Path $userDataDir 'workspace-location.txt'),
  (Join-Path $productUserDataDir 'workspace-location.txt')
)
$appProcess = $null

try {
  New-Item -ItemType Directory -Force -Path $installDir, $workspaceDir, $diagnosticsDir, $isolatedAppData, $userDataDir, $productUserDataDir | Out-Null
  $env:APPDATA = $isolatedAppData
  foreach ($markerPath in $markerPaths) {
    Set-Content -LiteralPath $markerPath -Value $workspaceDir -Encoding utf8NoBOM
  }

  Write-Host "Installing $installer into $installDir"
  $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -PassThru -WindowStyle Hidden
  if (-not $install.WaitForExit(120000)) {
    & taskkill.exe /PID $install.Id /T /F | Out-Null
    throw 'NSIS installer did not finish within 120 seconds'
  }
  if ($install.ExitCode -ne 0) { throw "NSIS installer exited with code $($install.ExitCode)" }

  $appPath = Join-Path $installDir '见字.exe'
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw "Installed application is missing: $appPath" }
  $uninstaller = Join-Path $installDir 'Uninstall 见字.exe'
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Installed uninstaller is missing: $uninstaller" }

  $stdoutPath = Join-Path $diagnosticsDir 'app-stdout.log'
  $stderrPath = Join-Path $diagnosticsDir 'app-stderr.log'
  Write-Host 'Starting installed application and waiting for /api/overview'
  $appProcess = Start-Process -FilePath $appPath -ArgumentList @('--disable-gpu') -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $serverLog = Join-Path $workspaceDir 'logs\desktop-workbench.log'
  $serverErrorLog = Join-Path $workspaceDir 'logs\desktop-workbench.error.log'
  $ipcLog = Join-Path $workspaceDir 'logs\desktop-ipc.log'
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $healthy = $false

  while ((Get-Date) -lt $deadline) {
    if ($appProcess.HasExited) { throw "Installed application exited early with code $($appProcess.ExitCode)" }
    if (Test-Path -LiteralPath $serverLog) {
      $logText = Get-Content -LiteralPath $serverLog -Raw -ErrorAction SilentlyContinue
      $match = [regex]::Match($logText, 'http://127\.0\.0\.1:(\d+)')
      if ($match.Success) {
        $uri = "http://127.0.0.1:$($match.Groups[1].Value)/api/overview"
        try {
          $response = Invoke-WebRequest -Uri $uri -TimeoutSec 3 -UseBasicParsing
          if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch {
          # The child server may have logged its address just before listen completes.
        }
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $healthy) {
    foreach ($path in @($serverLog, $serverErrorLog, $ipcLog, $stdoutPath, $stderrPath)) {
      if (Test-Path -LiteralPath $path) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $diagnosticsDir (Split-Path -Leaf $path)) -Force -ErrorAction SilentlyContinue
      }
    }
    throw "Installed application did not serve /api/overview within $StartupTimeoutSeconds seconds"
  }

  $rendererDeadline = (Get-Date).AddSeconds(30)
  $rendererReady = $false
  while ((Get-Date) -lt $rendererDeadline) {
    if ($appProcess.HasExited) { throw "Installed application exited after the API became healthy with code $($appProcess.ExitCode)" }
    if ((Test-Path -LiteralPath $ipcLog) -and (Get-Content -LiteralPath $ipcLog -Raw -ErrorAction SilentlyContinue) -match '"stage":"renderer-ready"') {
      $rendererReady = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $rendererReady) { throw 'Installed application API started, but the renderer did not report ready within 30 seconds' }

  Write-Host "Installer smoke test passed: renderer ready and /api/overview returned HTTP $($response.StatusCode)"
} finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
  }

  if (Test-Path -LiteralPath $workspaceDir) {
    foreach ($name in @('desktop-workbench.log', 'desktop-workbench.error.log', 'desktop-ipc.log')) {
      $path = Join-Path $workspaceDir "logs\$name"
      if (Test-Path -LiteralPath $path) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $diagnosticsDir $name) -Force -ErrorAction SilentlyContinue
      }
    }
  }

  try {
    $uninstaller = Join-Path $installDir 'Uninstall 见字.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDir") -PassThru -WindowStyle Hidden
      if (-not $uninstall.WaitForExit(120000)) {
        & taskkill.exe /PID $uninstall.Id /T /F | Out-Null
        throw 'NSIS uninstaller did not finish within 120 seconds'
      }
      if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstaller exited with code $($uninstall.ExitCode)" }
    }
  } finally {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
    $env:APPDATA = $originalAppData
  }
}
