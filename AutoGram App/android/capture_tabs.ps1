$adb = "F:\AutoGram\.toolchains\android-sdk\platform-tools\adb.exe"
$artDir = "C:\Users\aliri\.gemini\antigravity\brain\beef29b3-645c-4daf-b9fe-83bb4237bab2"

function Save-Screen([string]$name) {
    $remotePath = "/sdcard/screen.png"
    $localPath = Join-Path $artDir $name
    & $adb shell screencap -p $remotePath
    & $adb pull $remotePath $localPath | Out-Null
    Write-Host "Captured: $name"
}

# Start MainActivity and ensure focus
& $adb shell am start -n com.autogram.app/.MainActivity
Start-Sleep -Seconds 2

# 1. Drive
& $adb shell input tap 108 2260
Start-Sleep -Seconds 1
Save-Screen "cyber_dark_drive.png"

# 2. Transfers
& $adb shell input tap 324 2260
Start-Sleep -Seconds 1
Save-Screen "cyber_dark_transfers.png"

# 3. Studio
& $adb shell input tap 540 2260
Start-Sleep -Seconds 1
Save-Screen "cyber_dark_studio.png"

# 4. Remote
& $adb shell input tap 756 2260
Start-Sleep -Seconds 1
Save-Screen "cyber_dark_remote.png"

# 5. Settings
& $adb shell input tap 972 2260
Start-Sleep -Seconds 1
Save-Screen "cyber_dark_settings.png"

# Back to Drive
& $adb shell input tap 108 2260

Write-Host "All Cyber Dark screenshots captured successfully!"
