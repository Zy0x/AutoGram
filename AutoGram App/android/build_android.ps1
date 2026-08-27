param(
    [ValidateSet("Debug", "Release")]
    [string]$Variant = "Debug",
    [switch]$SkipBootstrap,
    [switch]$SkipNative
)

$ErrorActionPreference = "Stop"

$androidRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$toolchainRoot = Join-Path $androidRoot ".toolchains"
$cacheRoot = Join-Path $androidRoot ".build-cache"
$jdkRoot = Join-Path $toolchainRoot "jdk-17"
$sdkRoot = Join-Path $toolchainRoot "android-sdk"
$cargoRoot = Join-Path $toolchainRoot "cargo"
$cargoTools = Join-Path $toolchainRoot "cargo-tools"
$bridgeRoot = Resolve-Path (Join-Path $PSScriptRoot "..\crates\autogram-android-bridge")
$jniRoot = Join-Path $PSScriptRoot "app\src\main\jniLibs"

if (-not $SkipBootstrap) {
    & (Join-Path $PSScriptRoot "bootstrap_toolchain.ps1")
}

$tempDir = Join-Path $cacheRoot "temp"
$gradleHome = Join-Path $cacheRoot "gradle"
$androidUserHome = Join-Path $cacheRoot "android-user-home"
New-Item -ItemType Directory -Force -Path $tempDir, $gradleHome, $androidUserHome | Out-Null

$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_NDK_HOME = Join-Path $sdkRoot "ndk\27.0.12077973"
$env:ANDROID_USER_HOME = $androidUserHome
Remove-Item env:ANDROID_PREFS_ROOT -ErrorAction SilentlyContinue
$env:ANDROID_EMULATOR_HOME = Join-Path $cacheRoot "android-emulator"
$env:ANDROID_AVD_HOME = Join-Path $cacheRoot "android-avd"
$env:GRADLE_USER_HOME = $gradleHome
$env:RUSTUP_HOME = Join-Path $toolchainRoot "rustup"
$env:CARGO_HOME = $cargoRoot
$env:CARGO_TARGET_DIR = Join-Path $cacheRoot "cargo-target"
$env:GRADLE_OPTS = "-Djava.io.tmpdir=`"$tempDir`" -Dorg.gradle.user.home=`"$gradleHome`""
$fDriveToolchain = Get-ChildItem -LiteralPath (Join-Path $env:RUSTUP_HOME "toolchains") -Directory |
    Where-Object { $_.Name -like "autogram-stable-*-windows-msvc" } |
    Select-Object -First 1
if (-not $fDriveToolchain) { throw "F-drive Rust toolchain is missing; run bootstrap_toolchain.ps1 first" }
$fDriveToolchainBin = Join-Path $fDriveToolchain.FullName "bin"
$env:RUSTUP_TOOLCHAIN = $fDriveToolchain.Name
$env:RUSTC = Join-Path $fDriveToolchainBin "rustc.exe"
$cargoCompat = Join-Path $env:RUSTUP_HOME "toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe"
$env:CARGO = if (Test-Path -LiteralPath $cargoCompat) { $cargoCompat } else { Join-Path $fDriveToolchainBin "cargo.exe" }
$cargoCompatBin = Split-Path -Parent $env:CARGO
$env:PATH = "$(Join-Path $jdkRoot 'bin');$(Join-Path $sdkRoot 'platform-tools');$(Join-Path $sdkRoot 'cmdline-tools\latest\bin');$cargoCompatBin;$fDriveToolchainBin;$(Join-Path $cargoTools 'bin');$env:PATH"

if (-not $SkipNative) {
    Write-Host "[1/4] Building host bridge and generating Kotlin bindings..."
    Push-Location $bridgeRoot
    try {
        & $env:CARGO build --lib
        if ($LASTEXITCODE -ne 0) { throw "Host UniFFI bridge build failed" }
        $hostLibrary = Join-Path $env:CARGO_TARGET_DIR "debug\autogram_android_bridge.dll"
        & $env:CARGO run --bin uniffi-bindgen -- generate --library $hostLibrary --language kotlin --out-dir bindings/kotlin --no-format
        if ($LASTEXITCODE -ne 0) { throw "Kotlin binding generation failed" }
    } finally {
        Pop-Location
    }

    Copy-Item -LiteralPath (Join-Path $bridgeRoot "bindings\kotlin\uniffi\autogram_android_bridge\autogram_android_bridge.kt") `
        -Destination (Join-Path $PSScriptRoot "app\src\main\java\uniffi\autogram_android_bridge\autogram_android_bridge.kt") -Force

    Write-Host "[2/4] Building Rust shared libraries for Android ABIs..."
    New-Item -ItemType Directory -Force -Path $jniRoot | Out-Null
    Push-Location $bridgeRoot
    try {
        $nativeArgs = @("-o", $jniRoot, "-t", "arm64-v8a", "-t", "armeabi-v7a", "-t", "x86_64", "-t", "x86")
        if ($Variant -eq "Release") { $nativeArgs += @("build", "--release") } else { $nativeArgs += @("build") }
        & $env:CARGO ndk @nativeArgs
        if ($LASTEXITCODE -ne 0) { throw "Android Rust library build failed" }
    } finally {
        Pop-Location
    }
}

Push-Location $PSScriptRoot
try {
    Write-Host "[3/4] Running Android unit tests and lint..."
    $gradleWrapper = Join-Path $PSScriptRoot "gradlew.bat"
    & $gradleWrapper --no-daemon --project-dir $PSScriptRoot --stacktrace testDebugUnitTest lintDebug
    if ($LASTEXITCODE -ne 0) { throw "Android tests or lint failed" }

    Write-Host "[4/4] Assembling Android APK..."
    $assembleTask = if ($Variant -eq "Release") { "assembleRelease" } else { "assembleDebug" }
    & $gradleWrapper --no-daemon --project-dir $PSScriptRoot --stacktrace $assembleTask
    if ($LASTEXITCODE -ne 0) { throw "Android APK assembly failed" }

    $apkFolder = Join-Path $PSScriptRoot "app\build\outputs\apk\$($Variant.ToLowerInvariant())"
    Get-ChildItem -LiteralPath $apkFolder -Filter "*.apk" | ForEach-Object {
        Write-Host "APK: $($_.FullName) ($([math]::Round($_.Length / 1MB, 2)) MB)"
    }
} finally {
    Pop-Location
}
