# Run the app in "desktop app mode" on Windows: a single process serves both
# the built frontend and the API. For development with hot-reload, prefer running
# the backend (uvicorn --reload) and frontend (npm run dev) separately instead.
#
# First-time backend setup (only once):
#   cd backend
#   python -m venv venv
#   .\venv\Scripts\python.exe -m pip install -r requirements.txt
#
# Then, from the repo root, run:  .\run-app.ps1
# If script execution is blocked, run:  powershell -ExecutionPolicy Bypass -File .\run-app.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$venvPy = Join-Path $root 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host 'backend\venv not found. Create it first (see comments at top of this script).' -ForegroundColor Yellow
    exit 1
}

# Build the frontend if it has not been built yet.
if (-not (Test-Path (Join-Path $root 'frontend\dist'))) {
    Write-Host 'First run: building the frontend...'
    Push-Location (Join-Path $root 'frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    Pop-Location
}

Write-Host 'Starting app (FastAPI serving frontend + API)...'
# Launch from the backend directory so load_dotenv() finds backend\.env and the
# relative essays.db path resolves correctly.
$server = Start-Process -FilePath $venvPy `
    -ArgumentList '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000' `
    -WorkingDirectory (Join-Path $root 'backend') -PassThru -NoNewWindow

try {
    Write-Host 'Waiting for the backend to become ready...'
    do {
        Start-Sleep -Milliseconds 800
        try { $ok = (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/essays' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
        catch { $ok = $false }
    } until ($ok)

    Write-Host 'Ready -> http://127.0.0.1:8000' -ForegroundColor Green
    Start-Process 'http://127.0.0.1:8000'

    Write-Host 'Close this window or press Ctrl+C to stop the server.'
    Wait-Process -Id $server.Id
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
