[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$required = @('applicationDirectory', 'nodeExecutable', 'nodeId', 'nodeName', 'nodeLocation')
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([string]$config.$name)) {
    throw "Windows node config is missing $name"
  }
}

$applicationDirectory = [IO.Path]::GetFullPath([string]$config.applicationDirectory)
$nodeExecutable = [IO.Path]::GetFullPath([string]$config.nodeExecutable)
$entrypoint = Join-Path $applicationDirectory 'src\main.mjs'
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw "Node.js executable not found: $nodeExecutable" }
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw "Control console entrypoint not found: $entrypoint" }

$env:CODEX_CONTROL_NODE_ID = [string]$config.nodeId
$env:CODEX_CONTROL_NODE_NAME = [string]$config.nodeName
$env:CODEX_CONTROL_NODE_LOCATION = [string]$config.nodeLocation
$env:CODEX_CONTROL_PROFILE_DIR = [string]$config.profileDirectory
$env:CODEX_CONTROL_SOURCE_CODEX_HOME = [string]$config.sourceCodexHome
$env:CODEX_CONTROL_CODEX_HOME = [string]$config.wrapperCodexHome
$env:CODEX_CONTROL_PEER_CONFIG = [string]$config.peerConfigPath
$env:CODEX_CONTROL_CODEX_PATH = [string]$config.codexExecutable
$env:CODEX_CONTROL_PRIMARY_CDP_HOST = if ([string]::IsNullOrWhiteSpace([string]$config.primaryCdpHost)) { '127.0.0.1' } else { [string]$config.primaryCdpHost }
$env:CODEX_CONTROL_PRIMARY_CDP_PORT = if ($null -eq $config.primaryCdpPort) { '9232' } else { [string]$config.primaryCdpPort }
$env:CODEX_CONTROL_PRIMARY_CDP_ENABLED = if ([bool]$config.primaryCdpEnabled) { 'true' } else { 'false' }
$env:CODEX_CONTROL_PRIMARY_PROFILE_DIR = [string]$config.primaryProfileDirectory

$logDirectory = Join-Path $env:LOCALAPPDATA 'Codex Control Console\Logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdout = Join-Path $logDirectory 'service.log'
$stderr = Join-Path $logDirectory 'service.error.log'

$process = Start-Process -FilePath $nodeExecutable `
  -ArgumentList @($entrypoint) `
  -WorkingDirectory $applicationDirectory `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -NoNewWindow `
  -PassThru
$process.WaitForExit()
exit $process.ExitCode
