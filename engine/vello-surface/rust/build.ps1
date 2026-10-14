param(
    [switch]$Test,
    [string]$CargoBin,
    [string]$BindgenBin,
    [string]$RustcBin,
    [string]$CargoRegistry
)

$ErrorActionPreference = 'Stop'
$p0RustRoot = $PSScriptRoot
$p0UserProfile = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
$p0CargoBin = if ($CargoBin) { $CargoBin } else { Join-Path $p0UserProfile '.cargo/bin/cargo.exe' }
$p0BindgenBin = if ($BindgenBin) { $BindgenBin } else { Join-Path $p0UserProfile '.cargo/bin/wasm-bindgen.exe' }
$p0Registry = if ($CargoRegistry) { $CargoRegistry } else { Join-Path $p0UserProfile '.cargo/registry' }
$p0RustcBin = if ($RustcBin) { $RustcBin } else { Join-Path $p0UserProfile '.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustc.exe' }
$p0CargoHome = Join-Path $p0RustRoot '.cargo-home'
$p0Target = Join-Path $p0RustRoot 'target'
$p0Output = [IO.Path]::GetFullPath((Join-Path $p0RustRoot '../generated'))

foreach ($p0Required in @($p0CargoBin, $p0BindgenBin, $p0RustcBin, $p0Registry)) {
    if (-not (Test-Path -LiteralPath $p0Required)) { throw "Required cached build tool missing: $p0Required" }
}
$p0BindgenVersion = & $p0BindgenBin --version
if ($LASTEXITCODE -ne 0 -or $p0BindgenVersion -ne 'wasm-bindgen 0.2.114') {
    throw 'This lockfile requires wasm-bindgen CLI 0.2.114.'
}
New-Item -ItemType Directory -Force -Path $p0CargoHome | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $p0CargoHome 'registry'))) {
    New-Item -ItemType Junction -Path (Join-Path $p0CargoHome 'registry') -Target $p0Registry | Out-Null
}
$env:CARGO_HOME = $p0CargoHome
$env:CARGO_TARGET_DIR = $p0Target
$env:RUSTC = $p0RustcBin
$p0Manifest = Join-Path $p0RustRoot 'Cargo.toml'

if ($Test) {
    & $p0CargoBin test --manifest-path $p0Manifest --offline --locked --lib
    if ($LASTEXITCODE -ne 0) { throw 'P0 Rust validation/pixel tests failed.' }
}
# Each WASM realm has an explicit 256 MiB linear-memory ceiling. This is
# distinct from estimated managed GPU/CPU reservations and from driver memory.
# Keep target flags local so native tests and the owner's shell remain intact.
$p0PreviousTargetFlags = $env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS
try {
    $env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = (($p0PreviousTargetFlags + ' -C link-arg=--max-memory=268435456').Trim())
    & $p0CargoBin build --manifest-path $p0Manifest --target wasm32-unknown-unknown --release --offline --locked
    if ($LASTEXITCODE -ne 0) { throw 'P0 WASM build failed.' }
} finally {
    $env:CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS = $p0PreviousTargetFlags
}
New-Item -ItemType Directory -Force -Path $p0Output | Out-Null
$p0Wasm = Join-Path $p0Target 'wasm32-unknown-unknown/release/art_equation_p0_app_surface.wasm'
& $p0BindgenBin $p0Wasm --target web --out-dir $p0Output --out-name p0_engine_wasm
if ($LASTEXITCODE -ne 0) { throw 'P0 wasm-bindgen generation failed.' }
Get-ChildItem -LiteralPath $p0Output | Select-Object Name,Length

