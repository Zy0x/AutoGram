$ErrorActionPreference = "Stop"
$rootDir = (Get-Item "$PSScriptRoot\..").FullName
$androidDir = Join-Path $rootDir "AutoGram App\android"
$outputDir = Join-Path $rootDir "build\output\apk"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       AUTOGRAM ANDROID APK BUILDER (GRADLE + RUST)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Root : $rootDir"
Write-Host "Android Dir  : $androidDir"
Write-Host "Output Dir   : $outputDir"
Write-Host ""

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

# 1. Check Toolchains
$toolchainSdk = Join-Path $rootDir ".toolchains\android-sdk"
$toolchainJdk = Join-Path $rootDir ".toolchains\jdk-17"

if (Test-Path $toolchainSdk) {
    $env:ANDROID_HOME = $toolchainSdk
    $env:ANDROID_SDK_ROOT = $toolchainSdk
}
if (Test-Path $toolchainJdk) {
    $env:JAVA_HOME = $toolchainJdk
    $env:PATH = "$toolchainJdk\bin;$env:PATH"
}

# 2. Generate UniFFI Kotlin Bindings
$bridgeDir = Join-Path $rootDir "AutoGram App\crates\autogram-android-bridge"
if (Test-Path (Join-Path $bridgeDir "generate_kotlin_bindings.bat")) {
    Write-Host "[1/3] Generating UniFFI Kotlin Bindings..." -ForegroundColor Yellow
    Push-Location $bridgeDir
    & cmd /c "generate_kotlin_bindings.bat"
    Pop-Location
}

# 3. Assemble Android APK
Write-Host "[2/3] Compiling Android Gradle & Cargo NDK..." -ForegroundColor Yellow
$env:CARGO_TARGET_DIR = Join-Path $rootDir "build\target\android"
$env:GRADLE_USER_HOME = Join-Path $rootDir "build\cache\gradle"
Set-Location $androidDir

if (Test-Path ".\gradlew.bat") {
    & .\gradlew.bat assembleDebug
} else {
    & gradle assembleDebug
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to assemble Android APK." -ForegroundColor Red
    exit 1
}

# 4. Copy Output APKs to build\output\apk
Write-Host "[3/3] Copying APK to build\output\apk..." -ForegroundColor Yellow
$apkSources = Get-ChildItem -Path (Join-Path $androidDir "app\build\outputs\apk") -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue

if ($apkSources) {
    foreach ($apk in $apkSources) {
        $destName = if ($apk.Name -eq "app-debug.apk") { "AutoGram-debug.apk" } else { $apk.Name }
        $destPath = Join-Path $outputDir $destName
        Copy-Item $apk.FullName -Destination $destPath -Force
        Write-Host "  -> Output APK: $destName ($([math]::Round($apk.Length / 1MB, 2)) MB)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] AutoGram Android APK Build Complete!" -ForegroundColor Green
Write-Host " Output Location: $outputDir" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
