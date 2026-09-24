param([Parameter(Mandatory = $true)][string]$ApkDirectory)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$abis = @{
    "arm64-v8a" = @(2, 183)
    "armeabi-v7a" = @(1, 40)
    "x86_64" = @(2, 62)
    "x86" = @(1, 3)
}
$apks = @(Get-ChildItem -LiteralPath $ApkDirectory -File -Filter "*.apk")
if ($apks.Count -eq 0) { throw "No APK files to verify in $ApkDirectory" }

foreach ($apk in $apks) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
    try {
        $packagedAbis = @($archive.Entries | ForEach-Object {
            if ($_.FullName -match '^lib/([^/]+)/[^/]+\.so$') { $Matches[1] }
        } | Sort-Object -Unique)
        if ($packagedAbis.Count -eq 0) { throw "APK has no native libraries: $($apk.Name)" }
        $expectedAbis = if ($apk.Name -match '-universal-') {
            @($abis.Keys | Sort-Object)
        } else {
            @($abis.Keys | Where-Object { $apk.Name.Contains("-$_-") })
        }
        if ($expectedAbis.Count -eq 0) { throw "Unknown APK ABI naming: $($apk.Name)" }
        if (Compare-Object $expectedAbis $packagedAbis) {
            throw "APK ABI set does not match filename: $($apk.Name)"
        }
        foreach ($abi in $expectedAbis) {
            foreach ($name in @("libautogram_android_bridge.so", "libjnidispatch.so")) {
                $entry = $archive.GetEntry("lib/$abi/$name")
                if ($null -eq $entry) { throw "Missing $abi/$name in $($apk.Name)" }
                $reader = [System.IO.BinaryReader]::new($entry.Open())
                try { $header = $reader.ReadBytes(20) } finally { $reader.Dispose() }
                if ($header.Length -ne 20 -or $header[0] -ne 127 -or
                    [System.Text.Encoding]::ASCII.GetString($header, 1, 3) -ne "ELF") {
                    throw "Invalid ELF: $abi/$name in $($apk.Name)"
                }
                $machine = [int]$header[18] -bor ([int]$header[19] -shl 8)
                if ($header[4] -ne $abis[$abi][0] -or $header[5] -ne 1 -or $machine -ne $abis[$abi][1]) {
                    throw "Wrong ELF architecture: $abi/$name in $($apk.Name)"
                }
            }
        }
        Write-Host "Native APK verified: $($apk.Name) [$($expectedAbis -join ', ')]"
    } finally { $archive.Dispose() }
}
