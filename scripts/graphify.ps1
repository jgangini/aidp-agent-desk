param([switch]$NoHtml)

$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
        throw 'Graphify is required. Install the version documented in docs/profiles/fastapi-react.md.'
    }
    if (Test-Path 'graphify-out/graph.json') {
        & graphify update . --no-cluster
    } else {
        & graphify extract . --code-only --no-cluster --max-workers 1
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & graphify cluster-only . --no-label --no-viz
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & graphify export wiki
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (-not $NoHtml) {
        & graphify export html
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} finally { Pop-Location }
