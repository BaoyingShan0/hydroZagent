param([string]$BinaryRoot)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $repoRoot '.artifacts/hcs-postgres-test'
New-Item -ItemType Directory -Force $testRoot | Out-Null
if (-not $BinaryRoot) {
    $archive = Join-Path $testRoot 'postgresql17.zip'
    Invoke-WebRequest 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip' -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne '6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3') {
        throw 'PostgreSQL test archive checksum mismatch'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $testRoot 'tools')
    # The test service needs no pgAdmin UI or its unrelated npm dependency tree.
    $toolsRoot = [IO.Path]::GetFullPath((Join-Path $testRoot 'tools'))
    $pgAdminRoot = [IO.Path]::GetFullPath((Join-Path $toolsRoot 'pgsql/pgAdmin 4'))
    if (-not $pgAdminRoot.StartsWith($toolsRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unexpected pgAdmin cleanup target'
    }
    if (Test-Path -LiteralPath $pgAdminRoot) { Remove-Item -LiteralPath $pgAdminRoot -Recurse -Force }
    $BinaryRoot = Join-Path $testRoot 'tools/pgsql/bin'
}
$version = & (Join-Path $BinaryRoot 'postgres.exe') --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'PostgreSQL\) 17\.') { throw 'PostgreSQL 17 is required' }
$data = Join-Path $testRoot 'data'
if (Test-Path -LiteralPath $data) { throw 'Refusing to reuse an existing test cluster' }
& (Join-Path $BinaryRoot 'initdb.exe') -D $data -U hydro_hcs_test -A trust --encoding=UTF8 --locale=C
if ($LASTEXITCODE -ne 0) { throw 'Test initdb failed' }
# Detach the daemon's inherited streams from PowerShell/CI's capture pipeline.
# Start-Process -Wait waits for descendants too; wait only for pg_ctl itself.
$pgStart = Start-Process -FilePath (Join-Path $BinaryRoot 'pg_ctl.exe') -ArgumentList @(
    '-D', ('"{0}"' -f $data), '-l', ('"{0}"' -f (Join-Path $testRoot 'server.log')),
    '-o', '"-h 127.0.0.1 -p 55432"', '-w', 'start'
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'start.stdout.log') -RedirectStandardError (Join-Path $testRoot 'start.stderr.log')
if (-not $pgStart.WaitForExit(30000)) { throw 'Test pg_ctl did not exit within 30 seconds' }
if ($pgStart.ExitCode -ne 0) { throw 'Test PostgreSQL failed to start; see start.stderr.log' }
$env:HCS_TEST_PG_BIN = $BinaryRoot
if ($env:GITHUB_ENV) {
    "HCS_TEST_PG_BIN=$BinaryRoot" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
try {
    & (Join-Path $BinaryRoot 'createdb.exe') -h 127.0.0.1 -p 55432 -U hydro_hcs_test hydro_hcs_test
    if ($LASTEXITCODE -ne 0) { throw 'Test createdb failed' }
} catch {
    & (Join-Path $BinaryRoot 'pg_ctl.exe') -D $data -m fast -w stop
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Failed to stop the test cluster after database creation failed' }
    throw
}
$env:HCS_TEST_DATABASE_URL = 'postgresql://hydro_hcs_test@127.0.0.1:55432/hydro_hcs_test'
if ($env:GITHUB_ENV) {
    "HCS_TEST_DATABASE_URL=$env:HCS_TEST_DATABASE_URL" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
