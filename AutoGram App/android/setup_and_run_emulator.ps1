param(
    [switch]$ForceReinstall
)

$ErrorActionPreference = "Stop"
$root = "F:\AutoGram"
$toolchainRoot = Join-Path $root ".toolchains"
$cacheRoot = Join-Path $root ".build-cache"
$jdkRoot = Join-Path $toolchainRoot "jdk-17"
$sdkRoot = Join-Path $toolchainRoot "android-sdk"
$avdHome = Join-Path $cacheRoot "android-avd"
$emulatorHome = Join-Path $cacheRoot "android-emulator"
$tempDir = Join-Path $cacheRoot "temp"

New-Item -ItemType Directory -Force -Path $avdHome, $emulatorHome, $tempDir | Out-Null

$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $cacheRoot "android-user-home"
$env:ANDROID_AVD_HOME = $avdHome
$env:ANDROID_EMULATOR_HOME = $emulatorHome
Remove-Item env:ANDROID_PREFS_ROOT -ErrorAction SilentlyContinue

$env:PATH = "$(Join-Path $jdkRoot 'bin');$(Join-Path $sdkRoot 'platform-tools');$(Join-Path $sdkRoot 'emulator');$(Join-Path $sdkRoot 'cmdline-tools\latest\bin');$env:PATH"

$sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
$avdManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\avdmanager.bat"
$emulatorExe = Join-Path $sdkRoot "emulator\emulator.exe"
$adbExe = Join-Path $sdkRoot "platform-tools\adb.exe"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " AutoGram Android Native - Real Emulator Provisioning" -ForegroundColor Cyan
Write-Host " 100% Isolated on Drive F:\AutoGram" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Install Emulator & System Image if not present
if (-not (Test-Path $emulatorExe) -or $ForceReinstall) {
    Write-Host "[1/4] Mengunduh Google Android Emulator resmi ke Drive F:..." -ForegroundColor Yellow
    $process = Start-Process -FilePath $sdkManager -ArgumentList "--sdk_root=`"$sdkRoot`"", "emulator", "system-images;android-34;google_apis;x86_64" -NoNewWindow -PassThru -Wait
}

# Auto-accept all licenses
Write-Host "[2/4] Menyetujui lisensi SDK Android di Drive F:..." -ForegroundColor Yellow
$yesProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "echo y | `"$sdkManager`" --sdk_root=`"$sdkRoot`" --licenses" -NoNewWindow -PassThru -Wait

# 2. Create AVD Device if not created
$avdName = "AutoGram_Native_Device"
$avdList = & $avdManager list avd
if ($avdList -notmatch $avdName) {
    Write-Host "[3/4] Membuat Virtual Device AVD: $avdName di $avdHome..." -ForegroundColor Yellow
    $createArgs = @("create", "avd", "-n", $avdName, "-k", "system-images;android-34;google_apis;x86_64", "--device", "pixel_8", "--force")
    $createProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "echo no | `"$avdManager`" $($createArgs -join ' ')" -NoNewWindow -PassThru -Wait
} else {
    Write-Host "[3/4] AVD Virtual Device '$avdName' sudah tersedia di Drive F:." -ForegroundColor Green
}

Write-Host "[4/4] Menjalankan Emulator Android Nyata di Jendela Desktop..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
Write-Host " Emulator sedang booting... Mohon tunggu jendela muncul." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

# 3. Launch Emulator in Background / Native Window
$emuArgs = "-avd", $avdName, "-gpu", "host", "-no-snapshot-load"
Start-Process -FilePath $emulatorExe -ArgumentList $emuArgs

# 4. Wait for ADB device and boot completion
Write-Host "Menunggu sistem Android selesai booting (sys.boot_completed)..." -ForegroundColor Yellow
& $adbExe wait-for-device

$bootComplete = ""
$retries = 0
while ($bootComplete -ne "1" -and $retries -lt 60) {
    Start-Sleep -Seconds 2
    $bootComplete = ((& $adbExe shell getprop sys.boot_completed) 2>$null).Trim()
    $retries++
    Write-Host "Booting OS Android... ($retries)" -ForegroundColor Gray
}

Write-Host "Memasang AutoGram Native APK ke Emulator..." -ForegroundColor Yellow
$apkPath = Join-Path $PSScriptRoot "app\build\outputs\apk\debug\app-universal-debug.apk"
if (-not (Test-Path $apkPath)) {
    $apkPath = Join-Path $PSScriptRoot "app\build\outputs\apk\debug\app-x86_64-debug.apk"
}

if (Test-Path $apkPath) {
    & $adbExe install -r $apkPath
    & $adbExe shell am start -n com.autogram.app/com.autogram.app.MainActivity
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host " AutoGram Berhasil Terbuka dan Berjalan di Emulator Android Nyata!" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    Write-Host "[INFO] APK belum ada di $apkPath. Jalankan build_android.bat terlebih dahulu." -ForegroundColor Yellow
}
