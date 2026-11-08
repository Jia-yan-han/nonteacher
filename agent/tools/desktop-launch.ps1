param([int]$Port = 4321, [switch]$NoBrowser, [switch]$NoSimulator, [switch]$NoAsr)
$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$wsl = (Get-Command wsl.exe -ErrorAction Stop).Source
$logDir = Join-Path $agentDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$base = "http://127.0.0.1:$Port"
function Get-Health {
  try { return Invoke-RestMethod -Uri "$base/api/app/health" -TimeoutSec 2 } catch { return $null }
}
$health = Get-Health
if ($null -eq $health) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) { throw "端口 $Port 已被其他程序占用。请关闭占用该端口的旧版服务后重新启动。" }
  $previousPort = $env:AGENT_PORT
  try {
    $env:AGENT_PORT = "$Port"
    Start-Process -FilePath $node -ArgumentList @('server/index.js') -WorkingDirectory $agentDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "server-$stamp.out.log") -RedirectStandardError (Join-Path $logDir "server-$stamp.err.log") | Out-Null
  } finally { $env:AGENT_PORT = $previousPort }
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 200
    $health = Get-Health
    if ($health) { break }
  }
}
if (!$health -or $health.app -ne 'nonteacher-desktop' -or $health.version -ne 1) {
  throw "电脑端服务未启动，请检查 $logDir 中的 server 日志。"
}
if (!$NoAsr) {
  Start-Process -FilePath $wsl -ArgumentList @('-d','Ubuntu','--','bash','/mnt/c/Users/YanHang/Desktop/黑客松/agent/tools/ensure-local-asr.sh') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "asr-$stamp.out.log") -RedirectStandardError (Join-Path $logDir "asr-$stamp.err.log") | Out-Null
}
if (!$NoSimulator) {
  Start-Process -FilePath $wsl -ArgumentList @('-d','Ubuntu','--','bash','/mnt/c/Users/YanHang/Desktop/黑客松/agent/tools/run-loop.sh') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "simulator-$stamp.out.log") -RedirectStandardError (Join-Path $logDir "simulator-$stamp.err.log") | Out-Null
}
if (!$NoBrowser) {
  $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
  if (Test-Path -LiteralPath $edge) { Start-Process -FilePath $edge -ArgumentList $base -WindowStyle Normal }
  else { Start-Process $base }
}
Write-Output "不新手老师已启动：$base"
