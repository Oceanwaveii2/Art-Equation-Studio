param(
  [string]$QualityEvidence = $env:AE_RELEASE_EVIDENCE,
  [string]$QualityManifest = $env:AE_RELEASE_MANIFEST
)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$candidateRoot = Split-Path -Parent $desktopRoot
$portableRoot = Join-Path $candidateRoot 'release'
$targetRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $desktopRoot 'src-tauri\target' }
$releaseExecutable = Join-Path $targetRoot 'release\art-equation-studio.exe'
if (-not $QualityEvidence -or -not $QualityManifest) {
  throw 'RELEASE BLOCKED: matching native/browser quality evidence and manifest are required. Compilation is not release acceptance. See scripts/QUALITY_GATE_GUIDE.txt.'
}
if (-not (Test-Path -LiteralPath $QualityEvidence) -or -not (Test-Path -LiteralPath $QualityManifest)) {
  throw 'RELEASE BLOCKED: quality evidence or manifest is missing.'
}
if (-not (Test-Path -LiteralPath $releaseExecutable)) { throw 'Build the desktop executable with npm run desktop:build first.' }
$certificatePath = Join-Path (Split-Path -Parent $QualityEvidence) 'release-certificate.json'
& node (Join-Path $PSScriptRoot 'quality-evidence.mjs') --release --report $QualityEvidence --manifest $QualityManifest --output $certificatePath
if ($LASTEXITCODE -ne 0) { throw 'RELEASE BLOCKED: quality gate rejected this candidate. See release-certificate.json.' }
$certificate = Get-Content -LiteralPath $certificatePath -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $releaseExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if ($certificate.decision -ne 'ACCEPT' -or $certificate.level -ne 'release' -or $certificate.executableSha256 -ne $actualHash) {
  throw 'RELEASE BLOCKED: certificate does not qualify the exact executable being packaged.'
}
if (-not (Test-Path -LiteralPath (Join-Path $portableRoot 'projects\p1-v2-studies\project.json'))) { throw 'Run package_boards.py before packaging.' }
if (-not (Test-Path -LiteralPath (Join-Path $portableRoot 'tools\libvips\vips-dev-8.18\bin\vips.exe'))) { throw 'The pinned libvips distribution, including its licenses, is required in release/tools.' }
$portableExecutable = Join-Path $portableRoot 'Art Equation Studio 2.1.exe'
Copy-Item -LiteralPath $releaseExecutable -Destination $portableExecutable -Force
Copy-Item -LiteralPath $certificatePath -Destination (Join-Path $portableRoot 'release-certificate.json') -Force
Get-FileHash -LiteralPath $portableExecutable -Algorithm SHA256
