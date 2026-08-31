$ErrorActionPreference = "Stop"
$rootDir = (Get-Item "$PSScriptRoot\..").FullName
$frontendDir = Join-Path $rootDir "AutoGram App\frontend"
$outputDir = Join-Path $rootDir "build\output\desktop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   AUTOGRAM DESKTOP BUILDER (WINDOWS TAURI RELEASE)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Root : $rootDir"
Write-Host "Frontend Dir : $frontendDir"
Write-Host "Output Dir   : $outputDir"
Write-Host ""

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

Set-Location $frontendDir

Write-Host "[1/3] Compiling React Vite Frontend..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build Vite frontend." -ForegroundColor Red
    exit 1
}

Write-Host "[2/3] Compiling Rust Tauri Native Engine..." -ForegroundColor Yellow
& npm run tauri build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to compile Tauri desktop binary." -ForegroundColor Red
    exit 1
}

Write-Host "[3/3] Copying Production Binaries to build\output\desktop..." -ForegroundColor Yellow
$bundleDir = Join-Path $frontendDir "src-tauri\target\release\bundle"
$releaseDir = Join-Path $frontendDir "src-tauri\target\release"

if (Test-Path $bundleDir) {
    Get-ChildItem -Path $bundleDir -Recurse -Include *.msi, *.exe | ForEach-Object {
        Copy-Item $_.FullName -Destination $outputDir -Force
        Write-Host "  -> Packaged: $($_.Name)" -ForegroundColor Green
    }
}

if (Test-Path (Join-Path $releaseDir "frontend.exe")) {
    Copy-Item (Join-Path $releaseDir "frontend.exe") -Destination (Join-Path $outputDir "AutoGram.exe") -Force
    Write-Host "  -> Executable: AutoGram.exe" -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] AutoGram Desktop Build Complete!" -ForegroundColor Green
Write-Host " Output Location: $outputDir" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
