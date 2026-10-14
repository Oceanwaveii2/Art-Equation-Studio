param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\tools\nvidia'))
$ErrorActionPreference = 'Stop'
$runtimeRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$baseUrl = 'https://developer.download.nvidia.com/compute/cuda/redist/'
$packages = @(
    @{ name='cuda_cudart'; path='cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-13.0.96-archive.zip'; hash='a2ed875f9997aa24904fb70cc9db3acd9308433cde99bc8e63ec1271c9da31b4' },
    @{ name='libnvjpeg'; path='libnvjpeg/windows-x86_64/libnvjpeg-windows-x86_64-13.0.1.86-archive.zip'; hash='b8d64f9fb90632e33685529e2b8baee245ca3dcaecab4b8998815ae0f44c5171' }
)
$binRoot = Join-Path $runtimeRoot 'bin'
New-Item -ItemType Directory -Path $binRoot -Force | Out-Null
foreach ($package in $packages) {
    $archive = Join-Path $runtimeRoot ($package.name + '.zip')
    if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri ($baseUrl + $package.path) -OutFile $archive }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.hash) { throw "Hash mismatch: $archive" }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
    $directory = Join-Path $runtimeRoot ([System.IO.Path]::GetFileNameWithoutExtension($package.path))
    Get-ChildItem -LiteralPath (Join-Path $directory 'bin') -Filter '*.dll' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $binRoot -Force }
    Copy-Item -LiteralPath (Join-Path $directory 'LICENSE') -Destination (Join-Path $runtimeRoot ($package.name + '-LICENSE.txt')) -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath (Join-Path $directory 'LICENSE.txt') -Destination (Join-Path $runtimeRoot ($package.name + '-LICENSE.txt')) -ErrorAction SilentlyContinue
}
$packages | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'package-receipt.json') -Encoding UTF8
Write-Host 'Optional NVIDIA runtime installed locally. System drivers and registry were not changed.'
