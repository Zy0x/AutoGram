$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
$pluginDir = (Get-Item "$scriptDir\..").FullName
$binDir = Join-Path $pluginDir "bin"
$runtimeDir = Join-Path $pluginDir "runtime"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       AUTOGRAM FFMPEG PLUGIN INSTALLER / UPDATER" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }
if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null }

$zipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$tempZip = Join-Path $env:TEMP "ffmpeg_autogram_temp.zip"

Write-Host "Downloading latest Windows FFmpeg static build..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing

Write-Host "Extracting ffmpeg.exe and ffprobe.exe..." -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($tempZip)
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.Name -eq "ffmpeg.exe" -or $entry.Name -eq "ffprobe.exe") {
            $dest = Join-Path $binDir $entry.Name
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
            Write-Host "  -> Installed: $($entry.Name)" -ForegroundColor Green
        }
    }
} finally {
    $zip.Dispose()
    if (Test-Path $tempZip) { Remove-Item -Path $tempZip -Force }
}

$stateJson = @{
    version = "latest-gpl"
    installedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
} | ConvertTo-Json

Set-Content -Path (Join-Path $runtimeDir "state.json") -Value $stateJson -Encoding UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " [SUCCESS] FFmpeg runtime plugin installed to $binDir" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
