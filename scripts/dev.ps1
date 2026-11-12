$ErrorActionPreference = 'Stop'
$deskRoot = Split-Path $PSScriptRoot -Parent
$ports = (Get-Content -LiteralPath (Join-Path $deskRoot '.arko/project.json') -Raw | ConvertFrom-Json).development
foreach ($port in @($ports.backend_port, $ports.frontend_port)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port already in use; no process was stopped." }
}
Push-Location $deskRoot
try {
    & uv run --locked python tools/arko.py dev --root .
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
