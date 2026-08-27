param(
    [switch]$Watch
)

$ErrorActionPreference = "Stop"
$root = "F:\AutoGram"
$toolchainRoot = Join-Path $root ".toolchains"
$cacheRoot = Join-Path $root ".build-cache"
$jdkRoot = Join-Path $toolchainRoot "jdk-17"
$sdkRoot = Join-Path $toolchainRoot "android-sdk"
$gradleRoot = Join-Path $toolchainRoot "gradle-8.7"
$androidAppRoot = Join-Path $root "AutoGram App\android"

$env:TEMP = Join-Path $cacheRoot "temp"
$env:TMP = Join-Path $cacheRoot "temp"
$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $cacheRoot "android-user-home"
$env:GRADLE_USER_HOME = Join-Path $cacheRoot "gradle"
Remove-Item env:ANDROID_PREFS_ROOT -ErrorAction SilentlyContinue

$env:PATH = "$(Join-Path $jdkRoot 'bin');$(Join-Path $sdkRoot 'platform-tools');$env:PATH"

$gradleBat = Join-Path $gradleRoot "bin\gradle.bat"
$adbExe = Join-Path $sdkRoot "platform-tools\adb.exe"

function Reload-App {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "[AutoGram Fast-Patch] Mengompilasi perubahan Kotlin/UI inkremental..." -ForegroundColor Cyan
    
    # 1. Fast incremental install
    & $gradleBat -p $androidAppRoot :app:installDebug --configuration-cache -q
    
    # 2. Instant activity restart
    & $adbExe shell am start -n com.autogram.app/.MainActivity | Out-Null
    $sw.Stop()
    
    Write-Host "[SUKSES] Perubahan langsung aktif di Emulator dalam $($sw.Elapsed.TotalSeconds.ToString('F1')) detik! ✨`n" -ForegroundColor Green
}

# Run immediate reload
Reload-App

if ($Watch) {
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host " Mode Live-Reload Aktif!" -ForegroundColor Yellow
    Write-Host " Setiap kali Anda atau saya mengedit kode UI (.kt / .xml)," -ForegroundColor Yellow
    Write-Host " emulator akan langsung ter-update otomatis dalam 2-3 detik!" -ForegroundColor Yellow
    Write-Host " Tekan Ctrl+C untuk berhenti." -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Yellow

    $srcPath = Join-Path $androidAppRoot "app\src\main"
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $srcPath
    $watcher.IncludeSubdirectories = $true
    $watcher.EnableRaisingEvents = $true
    $watcher.Filter = "*.*"

    $lastEventTime = [DateTime]::MinValue
    while ($true) {
        $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed -bor [System.IO.WatcherChangeTypes]::Created, 1000)
        if ($change.TimedOut -eq $false) {
            $ext = [System.IO.Path]::GetExtension($change.Name)
            if ($ext -in @(".kt", ".xml", ".properties")) {
                $now = [DateTime]::Now
                if (($now - $lastEventTime).TotalMilliseconds -gt 1500) {
                    $lastEventTime = $now
                    Write-Host "[Perubahan Terdeteksi]: $($change.Name)" -ForegroundColor Magenta
                    Reload-App
                }
            }
        }
    }
}
