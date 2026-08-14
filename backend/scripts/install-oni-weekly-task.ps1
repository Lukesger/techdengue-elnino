# Instala (ou atualiza) tarefa agendada no Windows para rodar o ONI 1x/semana.
# Padrao: toda segunda-feira as 05:00 (horario local).
#
# Uso:
#   npm run el-nino:oni-atual:instalar-tarefa
#   powershell -ExecutionPolicy Bypass -File scripts/install-oni-weekly-task.ps1 -Remove

param(
  [string]$TaskName = "TechDengue-ONI-Semanal",
  [string]$DayOfWeek = "MON",
  [string]$Time = "05:00",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  throw "Node.js nao encontrado no PATH."
}
$Node = $NodeCmd.Source

$ScriptJs = Join-Path $Root "scripts\consultar-oni-atual.js"
if (-not (Test-Path $ScriptJs)) {
  throw "Script nao encontrado: $ScriptJs"
}

if ($Remove) {
  cmd /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"
  Write-Host "Tarefa removida: $TaskName"
  exit 0
}

$dataDir = Join-Path $Root "data\el-nino"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$CmdPath = Join-Path $Root "scripts\run-oni-atual-weekly.cmd"
$LogPath = Join-Path $dataDir "oni_atual_task.log"
$CmdBody = @(
  "@echo off"
  "cd /d `"$Root`""
  "`"$Node`" --use-system-ca scripts\consultar-oni-atual.js --ultimos 6 >> `"$LogPath`" 2>&1"
) -join "`r`n"
Set-Content -Path $CmdPath -Value $CmdBody -Encoding ASCII

cmd /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"

# /TR precisa de aspas escapadas quando o caminho tem espacos
$TrArg = "`"$CmdPath`""
$argsCreate = @(
  "/Create",
  "/TN", $TaskName,
  "/TR", $TrArg,
  "/SC", "WEEKLY",
  "/D", $DayOfWeek,
  "/ST", $Time,
  "/RL", "LIMITED",
  "/F"
)

& schtasks @argsCreate
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao criar tarefa (exit $LASTEXITCODE)."
}

Write-Host "Tarefa instalada: $TaskName"
Write-Host "Quando: toda $DayOfWeek as $Time"
Write-Host "Comando: $CmdPath"
Write-Host "Log: $LogPath"
Write-Host ""
Write-Host "Testar agora: schtasks /Run /TN $TaskName"
Write-Host "Remover:      npm run el-nino:oni-atual:remover-tarefa"
