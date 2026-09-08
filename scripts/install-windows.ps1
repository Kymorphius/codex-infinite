[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ApplicationDirectory = (Split-Path -Parent $PSScriptRoot),
  [string]$NodeId = 'windows-desktop',
  [string]$NodeName = 'Windows Desktop',
  [string]$NodeLocation = 'Windows workstation',
  [string]$TaskName = 'Codex Control Console',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an elevated PowerShell session.'
  }
}

function Resolve-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) { throw "Required command is not installed: $Name" }
  return [IO.Path]::GetFullPath($command.Source)
}

if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows only.' }
Assert-Administrator

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Write-Host "Removed scheduled task '$TaskName'. Application and user data were preserved."
  exit 0
}

if ($NodeId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$') { throw 'NodeId contains unsupported characters.' }
$application = [IO.Path]::GetFullPath($ApplicationDirectory)
$entrypoint = Join-Path $application 'src\main.mjs'
$startScript = Join-Path $application 'scripts\start-windows.ps1'
$prepareScript = Join-Path $application 'scripts\prepare-wrapper.mjs'
foreach ($file in @($entrypoint, $startScript, $prepareScript)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Deployment file not found: $file" }
}

$node = Resolve-CommandPath 'node.exe'
$nodeVersion = (& $node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw 'Node.js 22 or newer is required.' }
$codex = Resolve-CommandPath 'codex.exe'
$null = Resolve-CommandPath 'ssh.exe'
$package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $package -or $package.Status -ne 'Ok') { throw 'The unified OpenAI ChatGPT/Codex Windows package is not installed for this user.' }

$wrapperHome = Join-Path $env:USERPROFILE '.codex-control-console'
$sourceHome = Join-Path $env:USERPROFILE '.codex'
$profileDirectory = Join-Path $env:LOCALAPPDATA 'Codex Control Console\Profile'
$primaryProfileDirectory = Join-Path $env:LOCALAPPDATA 'Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex\web\Codex'
$peerConfigPath = Join-Path $wrapperHome 'peers.json'
$runtimeConfigPath = Join-Path $wrapperHome 'windows-node.json'
New-Item -ItemType Directory -Path $wrapperHome -Force | Out-Null
$nodeActionKeyPath = Join-Path $wrapperHome 'node-action.key'
if (-not (Test-Path -LiteralPath $nodeActionKeyPath)) {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  [IO.File]::WriteAllText($nodeActionKeyPath, [Convert]::ToBase64String($bytes))
}

$env:CODEX_CONTROL_PROFILE_DIR = $profileDirectory
$env:CODEX_CONTROL_SOURCE_CODEX_HOME = $sourceHome
$env:CODEX_CONTROL_CODEX_HOME = $wrapperHome
$env:CODEX_CONTROL_CODEX_PATH = $codex
& $node $prepareScript
if ($LASTEXITCODE -ne 0) { throw 'Failed to prepare the isolated wrapper CODEX_HOME.' }

$runtimeConfig = [ordered]@{
  version = 1
  applicationDirectory = $application
  nodeExecutable = $node
  codexExecutable = $codex
  nodeId = $NodeId
  nodeName = $NodeName
  nodeLocation = $NodeLocation
  profileDirectory = $profileDirectory
  sourceCodexHome = $sourceHome
  wrapperCodexHome = $wrapperHome
  peerConfigPath = $peerConfigPath
  primaryCdpHost = '127.0.0.1'
  primaryCdpPort = 9232
  primaryCdpEnabled = $false
  primaryProfileDirectory = $primaryProfileDirectory
}
$temporaryConfig = "$runtimeConfigPath.tmp"
$runtimeConfig | ConvertTo-Json | Set-Content -LiteralPath $temporaryConfig -Encoding UTF8
Move-Item -LiteralPath $temporaryConfig -Destination $runtimeConfigPath -Force

$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -ConfigPath `"$runtimeConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $application
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

if ($PSCmdlet.ShouldProcess($TaskName, 'register and start Windows full-node task')) {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Registered '$TaskName' for interactive user $env:USERNAME."
Write-Host "Runtime config: $runtimeConfigPath"
Write-Host 'Ordinary ChatGPT and its profile were not modified.'
