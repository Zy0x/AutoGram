$ErrorActionPreference = "SilentlyContinue"
$rootDir = (Get-Item "$PSScriptRoot\..").FullName

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   AUTOGRAM DEEP BUILD CLEANER (PURGE ALL BUILD CACHES)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Purging intermediate compile artifacts and release binaries..." -ForegroundColor Yellow

# 1. Desktop Tauri & Cargo target
$tauriTarget = Join-Path $rootDir "AutoGram App\frontend\src-tauri\target"
if (Test-Path $tauriTarget) {
    Write-Host "  -> Removing $tauriTarget..." -ForegroundColor Gray
    Remove-Item -Path $tauriTarget -Recurse -Force
}

# 2. Frontend Vite dist
$viteDist = Join-Path $rootDir "AutoGram App\frontend\dist"
if (Test-Path $viteDist) {
    Write-Host "  -> Removing $viteDist..." -ForegroundColor Gray
    Remove-Item -Path $viteDist -Recurse -Force
}

# 3. Android Gradle build caches
$androidBuild = Join-Path $rootDir "AutoGram App\android\app\build"
$androidRootBuild = Join-Path $rootDir "AutoGram App\android\build"
$androidGradle = Join-Path $rootDir "AutoGram App\android\.gradle"
if (Test-Path $androidBuild) { Remove-Item -Path $androidBuild -Recurse -Force }
if (Test-Path $androidRootBuild) { Remove-Item -Path $androidRootBuild -Recurse -Force }
if (Test-Path $androidGradle) { Remove-Item -Path $androidGradle -Recurse -Force }

# 4. Build output binaries
$buildOutput = Join-Path $rootDir "build\output"
if (Test-Path $buildOutput) {
    Write-Host "  -> Cleaning build\output..." -ForegroundColor Gray
    Get-ChildItem -Path $buildOutput -Recurse -File | Remove-Item -Force
}

# 5. Local build caches
$buildCache = Join-Path $rootDir ".build-cache"
if (Test-Path $buildCache) { Remove-Item -Path $buildCache -Recurse -Force }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] All build artifacts cleaned. Source code 100% untouched!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
