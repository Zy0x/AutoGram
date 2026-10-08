param([Parameter(Mandatory = $true)][string]$Ffmpeg)
$ErrorActionPreference = 'Stop'
$fixtureAssets = Join-Path $PSScriptRoot '../app/src/androidTest/assets'
New-Item -ItemType Directory -Force -Path $fixtureAssets | Out-Null
# Synthetic media exclusively in the test APK. No network or production media is read.
& $Ffmpeg -hide_banner -loglevel error -y `
    -f lavfi -i 'testsrc2=size=320x180:rate=6' `
    -f lavfi -i 'sine=frequency=440:sample_rate=22050' `
    -f lavfi -i 'sine=frequency=660:sample_rate=22050' `
    -i (Join-Path $PSScriptRoot '../app/src/androidTest/fixtures/gesture-captions.srt') `
    -t 120 -map 0:v -map 1:a -map 2:a -map 3:s `
    -c:v libx264 -preset ultrafast -crf 38 -g 12 -pix_fmt yuv420p `
    -c:a aac -b:a 16k -c:s mov_text `
    -metadata:s:a:0 language=eng -metadata:s:a:1 language=jpn -metadata:s:s:0 language=eng `
    -movflags +faststart (Join-Path $fixtureAssets 'video-gestures.mp4')
if ($LASTEXITCODE -ne 0) { throw 'Synthetic preview fixture generation failed' }
Get-Item -LiteralPath (Join-Path $fixtureAssets 'video-gestures.mp4') | Select-Object Name, Length
