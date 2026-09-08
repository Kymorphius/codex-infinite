[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,
  [switch]$ConfirmIdle
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmIdle) { throw 'Explicit idle confirmation is required.' }

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (-not [bool]$config.primaryCdpEnabled) { throw 'The primary bridge is disabled in the Windows node config.' }
if ([string]$config.primaryCdpHost -ne '127.0.0.1') { throw 'The primary bridge host must be literal loopback.' }
$port = [int]$config.primaryCdpPort
if ($port -lt 1 -or $port -gt 65535) { throw 'The primary bridge port is invalid.' }
$profile = [IO.Path]::GetFullPath([string]$config.primaryProfileDirectory)

$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'ChatGPT.exe' -and
  $_.CommandLine -notlike '*--type=*' -and
  ($_.CommandLine -notlike '*--user-data-dir=*' -or $_.CommandLine -like "*--user-data-dir=$profile*")
} | Select-Object -First 1
if ($existing) { throw 'The ordinary ChatGPT desktop is already running; it was not modified.' }

$package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Select-Object -First 1
$executable = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "ChatGPT executable not found: $executable" }

$env:CODEX_ELECTRON_USER_DATA_PATH = $profile
Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
Remove-Item Env:CODEX_CONTROL_WRAPPER_SIGNATURE -ErrorAction SilentlyContinue
Start-Process -FilePath $executable -ArgumentList @(
  "--user-data-dir=$profile",
  '--remote-debugging-address=127.0.0.1',
  "--remote-debugging-port=$port",
  "--remote-allow-origins=http://127.0.0.1:$port"
)
