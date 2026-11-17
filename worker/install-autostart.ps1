<#
.SYNOPSIS
  Registra la tarea programada "Snip Worker": arranca worker\run.ps1 al iniciar sesion.
.DESCRIPTION
  - Se ejecuta al iniciar sesion del usuario actual, con la ventana oculta.
  - Funciona con bateria (no exige corriente alterna).
  - Si el worker se cae, Windows lo reinicia (hasta 5 veces, cada minuto).
  - Los logs quedan en worker\data\logs\worker-AAAAMMDD.log (los escribe el propio worker).
  No requiere administrador (la tarea corre como tu usuario). Para quitarla: uninstall-autostart.ps1
.PARAMETER StartNow
  Ademas de registrar la tarea, la inicia ahora mismo.
#>
param(
    [switch]$StartNow
)
$ErrorActionPreference = "Stop"
$TaskName = "Snip Worker"
$RunScript = Join-Path $PSScriptRoot "run.ps1"

if (-not (Test-Path $RunScript)) {
    Write-Host "No se encontro $RunScript" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $PSScriptRoot ".venv\Scripts\Activate.ps1"))) {
    Write-Host "Aviso: todavia no existe .venv; crea el entorno antes de que la tarea corra (ver README)." -ForegroundColor Yellow
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -Hidden `
    -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force `
    -Description "Worker de Snip: procesa videos y renders en segundo plano." | Out-Null

Write-Host "Tarea '$TaskName' registrada: se iniciara al iniciar sesion ($user)." -ForegroundColor Green
Write-Host "Logs: $(Join-Path $PSScriptRoot 'data\logs')"
if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Tarea iniciada." -ForegroundColor Green
}
