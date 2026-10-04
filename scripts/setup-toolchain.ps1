$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'tools'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$archive = Join-Path $destination 'zig.zip'
Invoke-WebRequest -Uri 'https://ziglang.org/download/0.15.2/zig-x86_64-windows-0.15.2.zip' -OutFile $archive
$expected = '3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Compiler archive checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
Write-Output 'Verified Zig 0.15.2 toolchain ready. Run: node scripts/build.cjs'
