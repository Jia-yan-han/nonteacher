$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('nonteacher-launch-' + [guid]::NewGuid())
$agentDir = Split-Path -Parent $PSScriptRoot
$port = 48324
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'Test port in use' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$env:AGENT_DATA = Join-Path $testRoot 'data'
$env:AGENT_BRIDGE = Join-Path $testRoot 'bridge'
$serverPid = $null
try {
  & (Join-Path $agentDir 'tools\desktop-launch.ps1') -Port $port -NoBrowser -NoSimulator -NoAsr
  $health = Invoke-RestMethod "http://127.0.0.1:$port/api/app/health"
  if ($health.app -ne 'nonteacher-desktop') { throw 'Unexpected server' }
  $status = Invoke-RestMethod "http://127.0.0.1:$port/api/app/status"
  if ($null -eq $status.bridge -or $null -eq $status.asr) { throw 'Missing status' }
  $serverPid = (Get-NetTCPConnection -LocalPort $port -State Listen).OwningProcess
  $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid").CommandLine
  if ($commandLine -notmatch 'server[/\\]index\.js') { throw 'Test port owned by unexpected process' }
  Write-Output 'PASS: launcher starts isolated server and reports live status'
} finally {
  if ($serverPid) { Stop-Process -Id $serverPid }
  $resolved = (Resolve-Path -LiteralPath $testRoot).Path
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test directory' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
  Remove-Item Env:AGENT_DATA -ErrorAction SilentlyContinue
  Remove-Item Env:AGENT_BRIDGE -ErrorAction SilentlyContinue
}
