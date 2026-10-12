# Safe, manual cache cleanup for the AutoGram workspace.
# This script deletes only explicitly allowlisted generated-cache directories.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:rootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:rootPrefix = $script:rootDir.TrimEnd('\') + '\'

$categories = [ordered]@{
    '1' = [pscustomobject]@{
        Name = 'Rust incremental cache (quick cleanup; source and final APKs are kept)'
        Paths = @(
            'build\target\desktop\debug\incremental',
            '.build-cache\cargo-target\debug\incremental',
            'AutoGram App\frontend\src-tauri\target\debug\incremental',
            'AutoGram App\crates\autogram-core\target\debug\incremental'
        )
    }
    '2' = [pscustomobject]@{
        Name = 'All Rust target build outputs (Rust must be rebuilt afterward)'
        Paths = @(
            'build\target',
            '.build-cache\cargo-target',
            'AutoGram App\frontend\src-tauri\target',
            'AutoGram App\crates\autogram-core\target',
            'AutoGram App\crates\autogram-android-bridge\target',
            'AutoGram App\target',
            'target'
        )
    }
    '3' = [pscustomobject]@{
        Name = 'Android generated build and Gradle caches (Android must be rebuilt; dependencies may download again)'
        Paths = @(
            'build\cache',
            'AutoGram App\android\.gradle',
            'AutoGram App\android\build',
            'AutoGram App\android\app\build'
        )
    }
    '4' = [pscustomobject]@{
        Name = 'Derived worker preview caches only (previews regenerate when needed)'
        Paths = @(
            'AutoGram App\worker\cache\preview',
            'AutoGram App\worker\cache\thumbs',
            'AutoGram App\worker\cache\stream_registry'
        )
    }
    '5' = [pscustomobject]@{
        Name = 'Frontend temporary Vite and coverage caches (not node_modules or distribution files)'
        Paths = @(
            'AutoGram App\frontend\node_modules\.vite',
            'AutoGram App\frontend\.vite',
            'AutoGram App\frontend\coverage'
        )
    }
}

$allowedPaths = @{}
foreach ($category in $categories.Values) {
    foreach ($relativePath in $category.Paths) {
        $allowedPaths[$relativePath.ToLowerInvariant()] = $true
    }
}

function Get-SafeExistingDirectory([string]$relativePath) {
    if (-not $allowedPaths.ContainsKey($relativePath.ToLowerInvariant())) {
        throw "Path tidak ada di daftar aman: $relativePath"
    }

    $fullPath = [IO.Path]::GetFullPath((Join-Path $script:rootDir $relativePath))
    if (-not $fullPath.StartsWith($script:rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path keluar dari folder proyek: $relativePath"
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) { return $null }

    $cursor = $script:rootDir
    foreach ($part in ($relativePath -split '[\\/]+')) {
        $cursor = Join-Path $cursor $part
        $component = Get-Item -LiteralPath $cursor -Force
        if (($component.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Path memakai junction/symlink; dilewati demi keamanan: $relativePath"
        }
    }

    # Resolve junctions/symlinks and require the exact allowlisted path inside this workspace.
    $resolvedPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $fullPath).Path)
    if (-not $resolvedPath.Equals($fullPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not $resolvedPath.StartsWith($script:rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path memakai junction/symlink atau mengarah keluar proyek; dilewati: $relativePath"
    }

    # Do not traverse or remove a cache tree containing a junction/symlink.
    foreach ($entry in Get-ChildItem -LiteralPath $resolvedPath -Recurse -Force) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Ada junction/symlink di dalam target; dilewati demi keamanan: $relativePath"
        }
    }

    return $resolvedPath
}

function Get-DirectorySizeBytes([string]$directoryPath) {
    [long]$total = 0
    foreach ($entry in Get-ChildItem -LiteralPath $directoryPath -Recurse -Force -File) {
        $total += [long]$entry.Length
    }
    return $total
}

if (-not (Test-Path -LiteralPath (Join-Path $script:rootDir '.git'))) {
    Write-Host 'Pembersihan dibatalkan: folder ini tidak terverifikasi sebagai workspace AutoGram.' -ForegroundColor Red
    exit 2
}

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '        PEMBERSIH CACHE AUTOGRAM (PILIHAN MANUAL)' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "Workspace: $script:rootDir"
Write-Host 'Tutup AutoGram, Android Studio, dan proses build sebelum menghapus cache.' -ForegroundColor Yellow
Write-Host 'File source, database, sesi Telegram, signing, toolchain, APK/installer, dan WebView2 tidak menjadi target.' -ForegroundColor Green
Write-Host ''
foreach ($key in $categories.Keys) {
    Write-Host "[$key] $($categories[$key].Name)"
}
Write-Host '[0] Keluar tanpa menghapus'
Write-Host ''
$choice = Read-Host 'Pilih satu kategori yang ingin dibersihkan'
if ($choice -eq '0') { exit 0 }
if (-not $categories.Contains($choice)) {
    Write-Host 'Pilihan tidak dikenal. Tidak ada file yang dihapus.' -ForegroundColor Yellow
    exit 1
}

$selected = $categories[$choice]
$candidates = @()
foreach ($relativePath in $selected.Paths) {
    try {
        $safePath = Get-SafeExistingDirectory $relativePath
        if ($null -eq $safePath) { continue }
        $sizeBytes = Get-DirectorySizeBytes $safePath
        $candidates += [pscustomobject]@{ RelativePath = $relativePath; FullPath = $safePath; SizeBytes = $sizeBytes }
    } catch {
        Write-Host "[DILEWATI] $relativePath - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if ($candidates.Count -eq 0) {
    Write-Host 'Tidak ada target aman yang tersedia. Tidak ada file yang dihapus.' -ForegroundColor Yellow
    exit 0
}

[long]$estimatedBytes = ($candidates | Measure-Object -Property SizeBytes -Sum).Sum
Write-Host ''
Write-Host "Kategori: $($selected.Name)" -ForegroundColor Cyan
foreach ($item in $candidates) {
    $size = [math]::Round($item.SizeBytes / 1GB, 2)
    $unit = 'GB'
    if ($size -lt 1) { $size = [math]::Round($item.SizeBytes / 1MB, 1); $unit = 'MB' }
    Write-Host ("  {0}  [{1} {2}]" -f $item.RelativePath, $size, $unit)
}
Write-Host ("Perkiraan ruang yang dapat dibebaskan: {0:N2} GB" -f ($estimatedBytes / 1GB)) -ForegroundColor Cyan
Write-Host 'Periksa daftar di atas. Tidak ada perubahan sebelum konfirmasi.' -ForegroundColor Yellow
$confirmation = Read-Host 'Ketik HAPUS untuk melanjutkan'
if ($confirmation -cne 'HAPUS') {
    Write-Host 'Dibatalkan. Tidak ada file yang dihapus.' -ForegroundColor Yellow
    exit 0
}

[long]$deletedBytes = 0
$failed = 0
foreach ($item in $candidates) {
    try {
        # Revalidate immediately before deletion; no wildcard or caller-supplied path is used.
        $safePath = Get-SafeExistingDirectory $item.RelativePath
        if ($null -eq $safePath -or
            -not $safePath.Equals($item.FullPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Target berubah setelah pemindaian awal.'
        }
        Remove-Item -LiteralPath $safePath -Recurse -Force -ErrorAction Stop
        $deletedBytes += $item.SizeBytes
        Write-Host "[OK] Cache dihapus: $($item.RelativePath)" -ForegroundColor Green
    } catch {
        $failed++
        Write-Host "[GAGAL/DILEWATI] $($item.RelativePath) - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ''
Write-Host ("Selesai. Ruang yang diperkirakan dibebaskan: {0:N2} GB. Target gagal/dilewati: {1}." -f ($deletedBytes / 1GB), $failed) -ForegroundColor Cyan
Write-Host 'APK/installer di build\output, node_modules, .toolchains, .signing, database, sesi, dan source tetap dipertahankan.' -ForegroundColor Green
