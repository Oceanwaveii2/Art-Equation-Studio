$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $desktopRoot 'tools\libvips'
$package = Join-Path $toolRoot 'vips-dev-x64-web-8.18.2.zip'
$expected = '08effbafe12c6700345882b011cefeb41bcb305b959f5c0812a56cd1b0ddb752'
New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $package)) {
  Invoke-WebRequest -Uri 'https://github.com/libvips/build-win64-mxe/releases/download/v8.18.2/vips-dev-x64-web-8.18.2.zip' -OutFile $package
}
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'libvips package checksum mismatch.' }
if (-not (Test-Path -LiteralPath (Join-Path $toolRoot 'vips-dev-8.18\bin\vips.exe'))) { Expand-Archive -LiteralPath $package -DestinationPath $toolRoot -Force }
$executable = Join-Path $toolRoot 'vips-dev-8.18\bin\vips.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Pinned libvips executable was not found in the extracted package.' }
& $executable --version
if ($LASTEXITCODE -ne 0) { throw 'libvips runtime validation failed.' }
Write-Output "Image tools ready at $toolRoot (verified SHA-256)."
