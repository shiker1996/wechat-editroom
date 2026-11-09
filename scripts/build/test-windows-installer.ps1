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
  if (-not $install.WaitForExit(300000)) {
    $install.Refresh()
    $processDetails = Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq $install.Id -or $_.ParentProcessId -eq $install.Id
    } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | Format-List | Out-String
    @(
      "Installer did not finish within 300 seconds: $installer"
      "Install directory: $installDir"
      "Installer process ID: $($install.Id)"
      "Installer has exited: $($install.HasExited)"
      $processDetails
    ) | Set-Content -LiteralPath (Join-Path $diagnosticsDir 'installer-timeout.txt') -Encoding utf8
    & taskkill.exe /PID $install.Id /T /F | Out-Null
    throw 'NSIS installer did not finish within 300 seconds; see test-results/desktop-installer/installer-timeout.txt'
  }
  if ($install.ExitCode -ne 0) { throw "NSIS installer exited with code $($install.ExitCode)" }

  $appPath = Join-Path $installDir '见字.exe'
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw "Installed application is missing: $appPath" }
  $uninstaller = Join-Path $installDir 'Uninstall 见字.exe'
  if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw "Installed uninstaller is missing: $uninstaller" }

  $stdoutPath = Join-Path $diagnosticsDir 'app-stdout.log'
  $stderrPath = Join-Path $diagnosticsDir 'app-stderr.log'
  $electronLogPath = Join-Path $diagnosticsDir 'electron-main.log'
  $portsBeforeLaunch = @(
    Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty LocalPort -Unique
  )
  Write-Host 'Starting installed application and waiting for /api/overview'
  $appProcess = Start-Process -FilePath $appPath -ArgumentList @('--disable-gpu', '--enable-logging=file', "--log-file=$electronLogPath") -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $serverLog = Join-Path $workspaceDir 'logs\desktop-workbench.log'
  $serverErrorLog = Join-Path $workspaceDir 'logs\desktop-workbench.error.log'
  $ipcLog = Join-Path $workspaceDir 'logs\desktop-ipc.log'
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $healthy = $false
  $apiUri = $null

  while ((Get-Date) -lt $deadline) {
    if ($appProcess.HasExited) { throw "Installed application exited early with code $($appProcess.ExitCode)" }
    $candidatePorts = @(
      Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
        Where-Object { $portsBeforeLaunch -notcontains $_.LocalPort } |
        Select-Object -ExpandProperty LocalPort -Unique
    )
    if (Test-Path -LiteralPath $serverLog) {
      $logText = Get-Content -LiteralPath $serverLog -Raw -ErrorAction SilentlyContinue
      $match = [regex]::Match($logText, 'http://127\.0\.0\.1:(\d+)')
      if ($match.Success) {
        $loggedPort = [uint16]$match.Groups[1].Value
        if ($candidatePorts -notcontains $loggedPort) { $candidatePorts += $loggedPort }
      }
    }
    foreach ($port in $candidatePorts) {
      $uri = "http://127.0.0.1:$port/api/overview"
      try {
        $response = Invoke-WebRequest -Uri $uri -TimeoutSec 3 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
          $healthy = $true
          $apiUri = $uri
          break
        }
      } catch {
        # Ignore unrelated loopback listeners and probe again while the app starts.
      }
    }
    if ($healthy) { break }
    Start-Sleep -Milliseconds 500
  }

  if (-not $healthy) {
    $processDetails = Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq $appProcess.Id -or $_.ParentProcessId -eq $appProcess.Id
    } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | Format-List | Out-String
    $listenerDetails = Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
    @(
      "Installed application did not serve /api/overview within $StartupTimeoutSeconds seconds"
      "Application process ID: $($appProcess.Id)"
      "Application has exited: $($appProcess.HasExited)"
      'Application process tree:'
      $processDetails
      'Loopback listeners:'
      $listenerDetails
    ) | Set-Content -LiteralPath (Join-Path $diagnosticsDir 'startup-timeout.txt') -Encoding utf8
    foreach ($path in @($serverLog, $serverErrorLog, $ipcLog, $stdoutPath, $stderrPath, $electronLogPath)) {
      if (Test-Path -LiteralPath $path) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $diagnosticsDir (Split-Path -Leaf $path)) -Force -ErrorAction SilentlyContinue
      }
    }
    throw "Installed application did not serve /api/overview within $StartupTimeoutSeconds seconds"
  }

  $rendererDeadline = (Get-Date).AddSeconds(75)
  $roamingRoot = Join-Path $env:USERPROFILE 'AppData\Roaming'
  $rendererLogRoots = @(
    $workspaceDir,
    $isolatedAppData,
    (Join-Path $roamingRoot 'wechat-newsroom-workbench'),
    (Join-Path $roamingRoot '见字'),
    (Join-Path $roamingRoot 'com.shiker.wechat-newsroom-workbench')
  ) | Select-Object -Unique
  $rendererReady = $false
  while ((Get-Date) -lt $rendererDeadline) {
    if ($appProcess.HasExited) { throw "Installed application exited after the API became healthy with code $($appProcess.ExitCode)" }
    $ipcLogs = @(
      foreach ($root in $rendererLogRoots) {
        if (Test-Path -LiteralPath $root -PathType Container) {
          Get-ChildItem -LiteralPath $root -Filter 'desktop-ipc.log' -File -Recurse -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
        }
      }
    ) | Select-Object -Unique
    foreach ($candidateLog in $ipcLogs) {
      if ((Get-Content -LiteralPath $candidateLog -Raw -ErrorAction SilentlyContinue) -match '"stage":"renderer-ready"') {
        $rendererReady = $true
        $ipcLog = $candidateLog
        break
      }
    }
    if ($rendererReady) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $rendererReady) {
    $logFiles = @(
      foreach ($root in $rendererLogRoots) {
        if (Test-Path -LiteralPath $root -PathType Container) {
          Get-ChildItem -LiteralPath $root -Filter 'desktop-*.log' -File -Recurse -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
        }
      }
    ) | Select-Object -Unique
    $processDetails = Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -eq $appProcess.Id -or $_.ParentProcessId -eq $appProcess.Id
    } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | Format-List | Out-String
    $apiPort = [uint16]([regex]::Match($apiUri, ':(\d+)/').Groups[1].Value)
    $apiListener = Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue |
      Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
    $appDataInventory = @(
      foreach ($root in @($isolatedAppData, (Join-Path $roamingRoot 'wechat-newsroom-workbench'), (Join-Path $roamingRoot '见字'))) {
        if (Test-Path -LiteralPath $root -PathType Container) {
          Get-ChildItem -LiteralPath $root -Force -Recurse -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
        }
      }
    )
    @(
      'Installed application API started, but the renderer did not report ready within 75 seconds'
      "Workspace marker: $($markerPaths -join '; ')"
      "Expected workspace: $workspaceDir"
      "Isolated APPDATA: $isolatedAppData"
      "Renderer log search roots: $($rendererLogRoots -join '; ')"
      'Desktop logs found:'
      ($logFiles -join [Environment]::NewLine)
      'App data files and directories found:'
      ($appDataInventory -join [Environment]::NewLine)
      'Application process tree:'
      $processDetails
      'API listener:'
      $apiListener
    ) | Set-Content -LiteralPath (Join-Path $diagnosticsDir 'renderer-timeout.txt') -Encoding utf8
    foreach ($path in $logFiles) {
      $name = [System.IO.Path]::GetFileName($path)
      $destination = Join-Path $diagnosticsDir $name
      if (Test-Path -LiteralPath $destination) {
        $destination = Join-Path $diagnosticsDir "$(Split-Path -Leaf (Split-Path -Parent $path))-$name"
      }
      Copy-Item -LiteralPath $path -Destination $destination -Force -ErrorAction SilentlyContinue
    }
    throw 'Installed application API started, but the renderer did not report ready within 75 seconds; see test-results/desktop-installer/renderer-timeout.txt'
  }

  Write-Host "Installer smoke test passed: renderer ready and $apiUri returned HTTP $($response.StatusCode)"
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
  foreach ($path in @($stdoutPath, $stderrPath, $electronLogPath)) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      Copy-Item -LiteralPath $path -Destination (Join-Path $diagnosticsDir (Split-Path -Leaf $path)) -Force -ErrorAction SilentlyContinue
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
