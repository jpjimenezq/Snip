# Activa el venv y arranca el worker de Snip.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".venv\Scripts\Activate.ps1")) {
    Write-Host "No existe .venv. Crea el entorno: python -m venv .venv ; .\.venv\Scripts\pip install -r requirements.txt" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".env")) {
    Write-Host "Falta worker\.env (copia .env.example y llena los valores)." -ForegroundColor Red
    exit 1
}
. .\.venv\Scripts\Activate.ps1
python -m snip_worker
