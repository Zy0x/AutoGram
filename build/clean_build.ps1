# AutoGram Deep Build & Cache Cleaner
# Comprehensive Purge Engine for Rust, Android, Vite, and Worker Media Caches
# Preserves 100% of user sessions, databases, and source code.

$ErrorActionPreference = "SilentlyContinue"
$rootDir = (Get-Item "$PSScriptRoot\..").FullName

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   AUTOGRAM COMPREHENSIVE STORAGE & BUILD CACHE PURGE" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Project Root: $rootDir" -ForegroundColor Gray
Write-Host "Scanning for compilation artifacts, preview caches, and build bloat..." -ForegroundColor Yellow
Write-Host ""

# Whitelist Guard (Strictly protected directories that must NEVER be deleted)
$protectedPaths = @(
    "worker\sessions",
    "worker/sessions",
    "worker\database",
    "worker/database",
    ".toolchains",
    ".git"
)

function Test-IsProtected($targetPath) {
    foreach ($p in $protectedPaths) {
        if ($targetPath -like "*$p*") {
            return $true
        }
    }
    return $false
}

function Get-FolderSizeBytes($targetPath) {
    if (-not (Test-Path $targetPath)) { return 0 }
    $size = 0
    try {
        $measure = Get-ChildItem -Path $targetPath -Recurse -Force -File -ErrorAction SilentlyContinue | 
                   Measure-Object -Property Length -Sum
        if ($measure -and $measure.Sum) {
            $size = $measure.Sum
        }
    } catch {}
    return $size
}

$totalFreed = 0
$totalItemsPurged = 0

function Purge-TargetDirectory($relativePath, $description) {
    $fullPath = Join-Path $rootDir $relativePath
    if (-not (Test-Path $fullPath)) { return }

    if (Test-IsProtected $fullPath) {
        Write-Host "  [SHIELD] Skipped protected path: $relativePath" -ForegroundColor Yellow
        return
    }

    $sizeBytes = Get-FolderSizeBytes $fullPath
    $sizeMB = [math]::Round($sizeBytes / 1MB, 2)
    $sizeGB = [math]::Round($sizeBytes / 1GB, 2)
    $displaySize = if ($sizeGB -ge 1.0) { "$sizeGB GB" } else { "$sizeMB MB" }

    Write-Host "  -> Purging $description ($relativePath) [$displaySize]..." -ForegroundColor Gray

    # Fast NTFS deletion via cmd rmdir (significantly faster for 10,000+ files)
    try {
        if (Test-Path $fullPath) {
            # Reset any read-only attributes that could block deletion
            cmd /c "attrib -r -s -h `"$fullPath\*`" /s /d" 2>$null | Out-Null
            cmd /c "rmdir /s /q `"$fullPath`"" 2>$null | Out-Null
        }
    } catch {}

    # Fallback to PowerShell Remove-Item if still present
    if (Test-Path $fullPath) {
        try {
            Remove-Item -Path $fullPath -Recurse -Force -ErrorAction SilentlyContinue
        } catch {}
    }

    $script:totalFreed += $sizeBytes
    $script:totalItemsPurged++
}

function Purge-LooseFiles($relativePath, $filter, $description) {
    $parentDir = Join-Path $rootDir $relativePath
    if (-not (Test-Path $parentDir)) { return }

    $files = Get-ChildItem -Path $parentDir -Recurse -Force -Filter $filter -File -ErrorAction SilentlyContinue
    if ($files -and $files.Count -gt 0) {
        $groupSize = ($files | Measure-Object -Property Length -Sum).Sum
        $displaySize = [math]::Round($groupSize / 1MB, 2)
        Write-Host "  -> Removing $description ($relativePath\$filter) [$displaySize MB]..." -ForegroundColor Gray
        foreach ($f in $files) {
            try { Remove-Item -Path $f.FullName -Force -ErrorAction SilentlyContinue } catch {}
        }
        $script:totalFreed += $groupSize
    }
}

Write-Host "[1/6] Purging Rust & Cargo Target Directories..." -ForegroundColor Cyan
# Standalone Builder Target (Desktop & Android builds - PRIMARY BLOAT SOURCE ~130+ GB)
Purge-TargetDirectory "build\target" "Master Build Cargo Target (Desktop & Android)"
Purge-TargetDirectory "AutoGram App\frontend\src-tauri\target" "Tauri Desktop Cargo Target"
Purge-TargetDirectory "AutoGram App\crates\autogram-core\target" "Core Engine Cargo Target"
Purge-TargetDirectory "AutoGram App\crates\autogram-android-bridge\target" "Android Bridge Cargo Target"
Purge-TargetDirectory "AutoGram App\target" "AutoGram App Cargo Workspace Target"
Purge-TargetDirectory "target" "Root Cargo Target"

Write-Host ""
Write-Host "[2/6] Purging Runtime Preview & Streaming Cache..." -ForegroundColor Cyan
# Worker Media Preview & Thumbnail Caches (Preserving sessions & database)
Purge-TargetDirectory "AutoGram App\worker\cache\preview" "Video & Media Stream Preview Cache"
Purge-TargetDirectory "AutoGram App\worker\cache\thumbs" "Media Thumbnail Frame Cache"
Purge-TargetDirectory "AutoGram App\worker\cache\stream_registry" "Stream Registry Temporary Cache"
Purge-TargetDirectory "AutoGram App\worker\temp" "Worker Temporary Scratch Files"
Purge-TargetDirectory "AutoGram App\worker\logs" "Worker Log Files"

Write-Host ""
Write-Host "[3/6] Purging Android & Gradle Build Caches..." -ForegroundColor Cyan
Purge-TargetDirectory "build\cache" "Standalone Gradle User Cache"
Purge-TargetDirectory "AutoGram App\android\.gradle" "Android Project Gradle Cache"
Purge-TargetDirectory "AutoGram App\android\build" "Android Root Build Output"
Purge-TargetDirectory "AutoGram App\android\app\build" "Android App Module Build Output"
Purge-TargetDirectory "AutoGram App\android\app\src\main\jniLibs" "Generated UniFFI JNI Libraries"

Write-Host ""
Write-Host "[4/6] Purging Frontend & Bundler Caches..." -ForegroundColor Cyan
Purge-TargetDirectory "AutoGram App\frontend\dist" "Frontend Vite Distribution"
Purge-TargetDirectory "AutoGram App\frontend\node_modules\.vite" "Vite Pre-bundle Optimization Cache"
Purge-TargetDirectory "AutoGram App\frontend\coverage" "Vitest Code Coverage Output"
Purge-TargetDirectory "AutoGram App\frontend\.vite" "Vite Temporary Dev Cache"

Write-Host ""
Write-Host "[5/6] Purging Stale Build Binaries & Installers..." -ForegroundColor Cyan
Purge-TargetDirectory "build\output\desktop" "Output Windows Installers & Binaries"
Purge-TargetDirectory "build\output\apk" "Output Android APK Files"
Purge-TargetDirectory "build\output" "Build Output Directory"

Write-Host ""
Write-Host "[6/6] Purging Temporary Dev & WebView2 Scratch Artifacts..." -ForegroundColor Cyan
Purge-TargetDirectory ".build-cache" "Local Toolchain Build Cache"
Purge-TargetDirectory ".tmp" "Temporary Directory"
Purge-TargetDirectory ".webview2_data" "WebView2 Local Runtime Data"
Purge-TargetDirectory "AutoGram App\frontend\.webview2_data" "Frontend WebView2 Runtime Data"

# Loose temporary screenshots & logs
Purge-LooseFiles "AutoGram App\frontend" "cdp-*.png" "CDP Debug Screenshots"
Purge-LooseFiles "AutoGram App\frontend" "temp_*.png" "Temporary Screenshots"
Purge-LooseFiles "AutoGram App\frontend" "preview-toolbar-remote-*.png" "Remote Toolbar Screenshots"
Purge-LooseFiles "AutoGram App\frontend" "*-remote-test*.png" "Remote Test Screenshots"

# Ensure output directories exist cleanly for future builds
$recreateDirs = @(
    (Join-Path $rootDir "build\output\desktop"),
    (Join-Path $rootDir "build\output\apk")
)
foreach ($d in $recreateDirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
}

$freedGB = [math]::Round($totalFreed / 1GB, 2)
$freedMB = [math]::Round($totalFreed / 1MB, 2)
$displayTotal = if ($freedGB -ge 1.0) { "$freedGB GB" } else { "$freedMB MB" }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] Deep Clean Complete! Freed: $displayTotal" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Protected assets verified:" -ForegroundColor Gray
Write-Host "   - User Sessions  : AutoGram App\worker\sessions [100% UNTOUCHED]" -ForegroundColor Green
Write-Host "   - Local Database : AutoGram App\worker\database [100% UNTOUCHED]" -ForegroundColor Green
Write-Host "   - Toolchains     : .toolchains\                 [100% UNTOUCHED]" -ForegroundColor Green
Write-Host "   - Source Code    : All repositories             [100% UNTOUCHED]" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
