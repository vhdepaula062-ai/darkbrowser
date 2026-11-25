param([switch]$RebuildFrontend, [string]$ToolchainRoot, [string]$LlvmBin, [string]$BuildCache)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$projectRoot = (Get-Location).Path
$toolchain = if (Test-Path 'tools/mingw64/bin/gcc.exe') { Join-Path $projectRoot 'tools/mingw64' } else { 'G:\DARKBROWSER_TOOLCHAINS\winlibs-mingw-16.2.0\mingw64' }
$llvm = if (Test-Path 'tools/llvm/bin/libclang.dll') { Join-Path $projectRoot 'tools/llvm/bin' } else { 'G:\DARKBROWSER_TOOLCHAINS\llvm-runtime\clang+llvm-23.1.6-x86_64-pc-windows-msvc\bin' }
if ($ToolchainRoot) { $toolchain = (Resolve-Path -LiteralPath $ToolchainRoot).Path }
if ($LlvmBin) { $llvm = (Resolve-Path -LiteralPath $LlvmBin).Path }
if (!(Test-Path "$toolchain/bin/gcc.exe") -or !(Test-Path "$llvm/libclang.dll")) {
    throw 'Use o ZIP completo com tools ou informe -ToolchainRoot e -LlvmBin para seu MinGW e LLVM.'
}
if (Test-Path 'tools/node/node.exe') { $env:PATH = (Join-Path $projectRoot 'tools/node') + ';' + $env:PATH }
if (Test-Path 'tools/rust/bin/cargo.exe') { $env:PATH = (Join-Path $projectRoot 'tools/rust/bin') + ';' + $env:PATH }
if (Test-Path 'tools/cargo/registry') { $env:CARGO_HOME = Join-Path $projectRoot 'tools/cargo' }
$env:PATH = "$llvm;$toolchain\bin;" + $env:PATH
$env:CC = "$toolchain\bin\gcc.exe"
$env:CXX = "$toolchain\bin\g++.exe"
$env:CC_x86_64_pc_windows_gnu = $env:CC
$env:CXX_x86_64_pc_windows_gnu = $env:CXX
$env:CARGO_TARGET_DIR = if (Test-Path 'tools/rust') { Join-Path $projectRoot '.build' } else { 'G:\DARKBROWSER_BUILD_TARGET' }
if ($BuildCache) { $env:CARGO_TARGET_DIR = [IO.Path]::GetFullPath($BuildCache) }
$env:LIBCLANG_PATH = $llvm
$env:BINDGEN_EXTRA_CLANG_ARGS = "--target=x86_64-w64-windows-gnu -isystem $toolchain/x86_64-w64-mingw32/include"
# Reuse the libraries compiled from this dependency's patched source.
$bssl = Join-Path $env:CARGO_TARGET_DIR 'x86_64-pc-windows-gnu\release\build\btls-sys\96ee1704b1a2e2d7\out'
if (Test-Path 'tools/bssl/build/libssl.a') { $bssl = Join-Path $projectRoot 'tools/bssl' }
if ((Test-Path "$bssl\build\libssl.a") -and (Test-Path "$bssl\build\libcrypto.a")) {
    $env:BORING_BSSL_PATH = "$bssl\build"
    $env:BORING_BSSL_INCLUDE_PATH = "$bssl\boringssl\include"
}
$frontendStale = !(Test-Path 'dist\index.html')
if (!$frontendStale) {
    $builtAt = (Get-Item 'dist\index.html').LastWriteTimeUtc
    $inputs = @(Get-ChildItem src,public -Recurse -File) + @(Get-Item package.json,package-lock.json,index.html,vite.config.ts,tsconfig.json)
    $frontendStale = @($inputs | Where-Object LastWriteTimeUtc -gt $builtAt).Count -gt 0
}
if ($RebuildFrontend -or $frontendStale) {
    npm --prefix ui-kit run build:lib
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    npm run build --ignore-scripts
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
# A file avoids Windows PowerShell's native-command JSON quoting differences.
New-Item -ItemType Directory -Path $env:CARGO_TARGET_DIR -Force | Out-Null
$fastConfig = Join-Path $env:CARGO_TARGET_DIR 'tauri-fast-config.json'
'{"build":{"beforeBuildCommand":""}}' | Set-Content -LiteralPath $fastConfig -Encoding ascii
npx tauri build --no-bundle --target x86_64-pc-windows-gnu --config $fastConfig
exit $LASTEXITCODE
