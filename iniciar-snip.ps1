<#
  Arranca Snip completo en tu PC: la web (http://localhost:3000) y el worker.
  Cada uno abre su propia ventana; para apagar Snip cierra esas ventanas (o Ctrl+C en cada una).

  Uso:
    .\iniciar-snip.ps1            # arranca todo (compila la web solo si hace falta)
    .\iniciar-snip.ps1 -Recompilar   # fuerza a compilar la web de nuevo
    .\iniciar-snip.ps1 -SinNavegador # no abre el navegador
    .\iniciar-snip.ps1 -Puerto 3005  # otro puerto
#>
param(
    [switch]$Recompilar,
    [switch]$SinNavegador,
    [int]$Puerto = 3000
)

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot
$web = Join-Path $raiz "web"
$worker = Join-Path $raiz "worker"

function Falla($msg) {
    Write-Host ""
    Write-Host "  [X] $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  Snip - iniciando" -ForegroundColor White
Write-Host "  ----------------"

# ---------- revisiones ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falla "No encuentro Node.js. Instálalo desde https://nodejs.org" }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Falla "No encuentro ffmpeg en el PATH." }
if (-not (Test-Path (Join-Path $worker ".venv\Scripts\python.exe"))) {
    Falla "Falta el entorno del worker. Ejecuta: cd worker; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
}
if (-not (Test-Path (Join-Path $worker ".env"))) { Falla "Falta worker\.env (copia worker\.env.example y llena los valores)." }
$envLocal = Join-Path $web ".env.local"
if (-not (Test-Path $envLocal)) { Falla "Falta web\.env.local (mira la guía: URL y anon key de Supabase)." }

# ---------- dependencias de la web ----------
if (-not (Test-Path (Join-Path $web "node_modules"))) {
    Write-Host "  - Instalando dependencias de la web (solo la primera vez)..."
    Push-Location $web
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; Falla "npm install falló." }
    Pop-Location
}

# ---------- compilar la web si hace falta ----------
# Next mete las variables NEXT_PUBLIC_* al compilar, así que se recompila si cambia .env.local
# o si el código cambió desde la última compilación (otro commit).
$buildId = Join-Path $web ".next\BUILD_ID"
$marca = Join-Path $web ".next\snip-build.txt"
$commit = ""
try { $commit = (git -C $raiz rev-parse HEAD 2>$null) } catch {}
$cambiosLocales = ""
try { $cambiosLocales = (git -C $raiz status --porcelain -- web/src web/public web/package.json 2>$null) -join "`n" } catch {}
$sha = [System.Security.Cryptography.SHA256]::Create()
$hashCambios = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cambiosLocales))).Replace("-", "")
$firma = "$commit|$((Get-Item $envLocal).LastWriteTimeUtc.Ticks)|$hashCambios"

$necesita = $Recompilar -or -not (Test-Path $buildId) -or -not (Test-Path $marca) -or ((Get-Content $marca -Raw).Trim() -ne $firma)
if ($necesita) {
    Write-Host "  - Compilando la web (1-2 minutos)..."
    Push-Location $web
    npm run build
    $ok = $LASTEXITCODE -eq 0
    Pop-Location
    if (-not $ok) { Falla "La compilación de la web falló. Revisa el mensaje de arriba." }
    Set-Content -Path $marca -Value $firma -Encoding utf8
} else {
    Write-Host "  - Web ya compilada (usa -Recompilar para forzar)."
}

# ---------- arrancar ----------
$titulo = 'Snip'
Write-Host "  - Abriendo el worker..."
Start-Process powershell -WorkingDirectory $worker -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-Command",
    "`$Host.UI.RawUI.WindowTitle='$titulo - worker'; .\run.ps1"
)

Write-Host "  - Abriendo la web en el puerto $Puerto..."
Start-Process powershell -WorkingDirectory $web -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-Command",
    "`$Host.UI.RawUI.WindowTitle='$titulo - web'; npx next start -p $Puerto -H 0.0.0.0"
)

# IP de la red local para abrir desde el celular (misma Wi-Fi)
$ip = $null
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
        Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
} catch {}

# Esperar a que la web responda
$url = "http://localhost:$Puerto"
$lista = $false
for ($i = 0; $i -lt 40; $i++) {
    $codigo = & curl.exe -s -o NUL -w "%{http_code}" --max-time 2 "$url/login" 2>$null
    if ($codigo -eq "200") {
        $lista = $true
        break
    }
    Start-Sleep -Milliseconds 750
}

Write-Host ""
if ($lista) {
    Write-Host "  Snip está corriendo" -ForegroundColor Green
} else {
    Write-Host "  La web está tardando en arrancar; revisa la ventana 'Snip - web'." -ForegroundColor Yellow
}
Write-Host "    En este PC:    $url"
if ($ip) { Write-Host "    En el celular: http://${ip}:$Puerto  (misma Wi-Fi)" }
Write-Host "    Para apagar:   cierra las ventanas 'Snip - web' y 'Snip - worker'"
Write-Host ""

if ($lista -and -not $SinNavegador) { Start-Process $url }
