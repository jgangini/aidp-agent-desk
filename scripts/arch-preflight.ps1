$ErrorActionPreference = 'Stop'
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '../.cache/uv'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & uv run --locked python tools/arko.py check --root .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if (Test-Path -LiteralPath .sentrux/baseline.json) {
        & sentrux gate .
    } else {
        & sentrux gate --save .
    }
    exit $LASTEXITCODE
} finally { Pop-Location }
