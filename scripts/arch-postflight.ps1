$ErrorActionPreference = 'Stop'
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '../.cache/uv'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & uv run --locked python tools/arko.py check --root .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & uv run --locked ruff check terraform
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & terraform -chdir=terraform fmt -check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & terraform -chdir=terraform validate -no-color
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & uv run --locked python scripts/check-publication.py
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($env:AGENT_DESK_SCHEDULED_BROWSER_URL) {
        & node scripts/browser-check.cjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } elseif ($env:AGENT_DESK_IDENTITY_BROWSER_URL) {
        & node scripts/browser-identity-check.cjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } elseif ($env:AGENT_DESK_PLAYWRIGHT_MODULE) {
        if (-not $env:AGENT_DESK_CONTENT_BROWSER_URL) {
            & uv run --locked python scripts/browser-fixtures.py
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        & node scripts/browser-check.cjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if (Test-Path 'graphify-out/graph.json') {
        & ./scripts/graphify.ps1
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & sentrux gate .
    exit $LASTEXITCODE
} finally { Pop-Location }
