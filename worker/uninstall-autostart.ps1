<#
.SYNOPSIS
  Elimina la tarea programada "Snip Worker" (y la detiene si esta corriendo).
#>
$ErrorActionPreference = "Stop"
$TaskName = "Snip Worker"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "La tarea '$TaskName' no existe; no hay nada que quitar." -ForegroundColor Yellow
    exit 0
}
if ($task.State -eq "Running") {
    Stop-ScheduledTask -TaskName $TaskName
    Write-Host "Tarea detenida. (Si el worker sigue abierto, cierra su ventana o proceso python.)"
}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarea '$TaskName' eliminada." -ForegroundColor Green
