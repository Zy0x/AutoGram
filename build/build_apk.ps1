param(
    [ValidateSet("Debug", "Release")]
    [string]$Variant = "Debug",
    [switch]$SkipBootstrap,
    [switch]$SkipNative
)

$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidDir = Join-Path $rootDir "AutoGram App\android"
$outputDir = Join-Path $rootDir "build\output\apk"

# One canonical pipeline: bindings -> Rust ABI libraries -> tests -> verified APK.
& (Join-Path $androidDir "build_android.ps1") -Variant $Variant `
    -SkipBootstrap:$SkipBootstrap -SkipNative:$SkipNative

$apkFolder = Join-Path $androidDir "app\build\outputs\apk\$($Variant.ToLowerInvariant())"
$apks = @(Get-ChildItem -LiteralPath $apkFolder -Filter "*.apk" -File)
if ($apks.Count -eq 0) { throw "No APK was produced for $Variant" }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
foreach ($apk in $apks) {
    Copy-Item -LiteralPath $apk.FullName -Destination (Join-Path $outputDir $apk.Name) -Force
    Write-Host "APK: $(Join-Path $outputDir $apk.Name)"
}
