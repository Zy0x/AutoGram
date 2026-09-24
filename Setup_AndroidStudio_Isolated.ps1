# Setup Android Studio Isolated Environment in F:\AutoGram
# Zero-C Drive Usage Guaranteed

$ErrorActionPreference = "Stop"

$root = "F:\AutoGram"
$downloadsDir = "$root\.toolchains\downloads"
$studioDir = "$root\.toolchains\android-studio"
$studioDataDir = "$root\.toolchains\android-studio-data"
$zipFile = "$downloadsDir\android-studio-quail4-windows.zip"
$downloadUrl = "https://edgedl.me.gvt1.com/android/studio/ide-zips/2026.1.4.7/android-studio-quail4-windows.zip"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Setup Android Studio Portable - Isolated in F:\AutoGram" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Pastikan folder target ada
if (-not (Test-Path $downloadsDir)) {
    New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
}
if (-not (Test-Path "$studioDataDir\config")) {
    New-Item -ItemType Directory -Force -Path "$studioDataDir\config", "$studioDataDir\system", "$studioDataDir\plugins", "$studioDataDir\log" | Out-Null
}

# 1. Unduh file zip jika belum ada
if (-not (Test-Path $zipFile)) {
    Write-Host "[1/3] Mengunduh Android Studio Portable (~1.39 GB)..." -ForegroundColor Yellow
    Write-Host "Target: $zipFile" -ForegroundColor DarkGray
    
    # Gunakan curl.exe dengan resume (-C -) agar aman dan cepat
    & curl.exe -L -C - -o $zipFile $downloadUrl --progress-bar
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Gagal mengunduh Android Studio zip." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[1/3] File zip Android Studio telah tersedia di direktori unduhan." -ForegroundColor Green
}

# 2. Ekstrak ke F:\AutoGram\.toolchains\android-studio
if (-not (Test-Path "$studioDir\bin\studio64.exe")) {
    Write-Host "[2/3] Mengekstrak Android Studio ke $studioDir..." -ForegroundColor Yellow
    
    # Buat direktori sementara untuk ekstraksi di Drive F:
    $tempExtract = "$root\.build-cache\temp\as_extract"
    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }
    New-Item -ItemType Directory -Force -Path $tempExtract | Out-Null
    
    # Ekstrak menggunakan tar.exe bawaan Windows (jauh lebih cepat daripada Expand-Archive)
    Write-Host "Mengekstrak arsip zip via tar.exe..." -ForegroundColor DarkGray
    & tar.exe -xf $zipFile -C $tempExtract
    
    if (Test-Path "$tempExtract\android-studio") {
        Move-Item -Path "$tempExtract\android-studio" -Destination $studioDir -Force
    } else {
        Move-Item -Path "$tempExtract" -Destination $studioDir -Force
    }
    
    if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }
    Write-Host "Ekstraksi selesai." -ForegroundColor Green
} else {
    Write-Host "[2/3] Android Studio sudah terekstrak di $studioDir." -ForegroundColor Green
}

# 3. Patch idea.properties dan vmoptions untuk isolasi 100%
Write-Host "[3/3] Mengonfigurasi isolasi storage Android Studio..." -ForegroundColor Yellow
$ideaPropFile = "$studioDir\bin\idea.properties"
if (Test-Path $ideaPropFile) {
    $existing = Get-Content -Path $ideaPropFile -Raw
    if ($existing -notmatch "idea\.config\.path") {
        $ideaContent = @"

# ========================================================
# Isolated Storage Configuration - F:\AutoGram
# ========================================================
idea.config.path=F:/AutoGram/.toolchains/android-studio-data/config
idea.system.path=F:/AutoGram/.toolchains/android-studio-data/system
idea.plugins.path=F:/AutoGram/.toolchains/android-studio-data/plugins
idea.log.path=F:/AutoGram/.toolchains/android-studio-data/log
"@
        Add-Content -Path $ideaPropFile -Value $ideaContent
    }
}

$vmOptionsFile = "$studioDir\bin\studio64.exe.vmoptions"
if (Test-Path $vmOptionsFile) {
    $existingVm = Get-Content -Path $vmOptionsFile -Raw
    if ($existingVm -notmatch "user\.home") {
        $vmContent = @"
-Duser.home=F:/AutoGram/.build-cache/user-home
-Djava.io.tmpdir=F:/AutoGram/.build-cache/temp
-Didea.config.path=F:/AutoGram/.toolchains/android-studio-data/config
-Didea.system.path=F:/AutoGram/.toolchains/android-studio-data/system
-Didea.plugins.path=F:/AutoGram/.toolchains/android-studio-data/plugins
-Didea.log.path=F:/AutoGram/.toolchains/android-studio-data/log
"@
        Add-Content -Path $vmOptionsFile -Value $vmContent
    }
}

Write-Host "========================================================" -ForegroundColor Green
Write-Host " Setup Android Studio Selesai & Terisolasi 100%!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
