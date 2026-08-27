param(
    [switch]$SkipAndroidPackages
)

$ErrorActionPreference = "Stop"

$androidRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$toolchainRoot = Join-Path $androidRoot ".toolchains"
$cacheRoot = Join-Path $androidRoot ".build-cache"
$downloads = Join-Path $toolchainRoot "downloads"
$jdkRoot = Join-Path $toolchainRoot "jdk-17"
$sdkRoot = Join-Path $toolchainRoot "android-sdk"
$gradleRoot = Join-Path $toolchainRoot "gradle-8.7"
$rustupRoot = Join-Path $toolchainRoot "rustup"
$cargoRoot = Join-Path $toolchainRoot "cargo"
$cargoTools = Join-Path $toolchainRoot "cargo-tools"

New-Item -ItemType Directory -Force -Path $downloads, $cacheRoot, $sdkRoot, $rustupRoot, $cargoRoot, $cargoTools | Out-Null

function Get-VerifiedArchive {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Output,
        [string]$Sha256 = ""
    )

    if (-not (Test-Path -LiteralPath $Output)) {
        Write-Host "Downloading $Url"
        Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing
    }

    if ((Get-Item -LiteralPath $Output).Length -lt 1MB) {
        throw "Downloaded archive is unexpectedly small: $Output"
    }

    if ($Sha256) {
        $actual = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Sha256.ToLowerInvariant()) {
            throw "SHA-256 mismatch for $Output. Expected $Sha256, got $actual"
        }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $jdkRoot "bin\java.exe"))) {
    $jdkArchive = Join-Path $downloads "temurin-jdk17-windows-x64.zip"
    Get-VerifiedArchive `
        -Url "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" `
        -Output $jdkArchive
    $jdkExtract = Join-Path $toolchainRoot "jdk-17-extract"
    if (Test-Path -LiteralPath $jdkExtract) { Remove-Item -LiteralPath $jdkExtract -Recurse -Force }
    Expand-Archive -LiteralPath $jdkArchive -DestinationPath $jdkExtract -Force
    $jdkCandidate = Get-ChildItem -LiteralPath $jdkExtract -Directory | Select-Object -First 1
    if (-not $jdkCandidate) { throw "Temurin JDK archive did not contain a JDK directory" }
    Move-Item -LiteralPath $jdkCandidate.FullName -Destination $jdkRoot
    Remove-Item -LiteralPath $jdkExtract -Recurse -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"))) {
    $commandLineArchive = Join-Path $downloads "commandlinetools-win-15859902_latest.zip"
    Get-VerifiedArchive `
        -Url "https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip" `
        -Output $commandLineArchive `
        -Sha256 "90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a"
    $commandLineExtract = Join-Path $toolchainRoot "android-commandline-extract"
    if (Test-Path -LiteralPath $commandLineExtract) { Remove-Item -LiteralPath $commandLineExtract -Recurse -Force }
    Expand-Archive -LiteralPath $commandLineArchive -DestinationPath $commandLineExtract -Force
    $latestRoot = Join-Path $sdkRoot "cmdline-tools\latest"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $latestRoot) | Out-Null
    Move-Item -LiteralPath (Join-Path $commandLineExtract "cmdline-tools") -Destination $latestRoot
    Remove-Item -LiteralPath $commandLineExtract -Recurse -Force
}

if (-not (Test-Path -LiteralPath (Join-Path $gradleRoot "bin\gradle.bat"))) {
    $gradleArchive = Join-Path $downloads "gradle-8.7-bin.zip"
    $gradleShaFile = Join-Path $downloads "gradle-8.7-bin.zip.sha256"
    if (-not (Test-Path -LiteralPath $gradleShaFile)) {
        Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-8.7-bin.zip.sha256" -OutFile $gradleShaFile -UseBasicParsing
    }
    $gradleSha = (Get-Content -LiteralPath $gradleShaFile -Raw).Trim().Split(' ')[0]
    Get-VerifiedArchive -Url "https://services.gradle.org/distributions/gradle-8.7-bin.zip" -Output $gradleArchive -Sha256 $gradleSha
    Expand-Archive -LiteralPath $gradleArchive -DestinationPath $toolchainRoot -Force
}

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:GRADLE_USER_HOME = Join-Path $cacheRoot "gradle"
$env:RUSTUP_HOME = $rustupRoot
$env:CARGO_HOME = $cargoRoot
$env:CARGO_TARGET_DIR = Join-Path $cacheRoot "cargo-target"
$env:PATH = "$(Join-Path $jdkRoot 'bin');$(Join-Path $sdkRoot 'platform-tools');$(Join-Path $sdkRoot 'cmdline-tools\latest\bin');$(Join-Path $cargoRoot 'bin');$(Join-Path $cargoTools 'bin');$env:PATH"

function Repair-RustupProxyCopies {
    $rustupExe = Join-Path $cargoRoot "bin\rustup.exe"
    if (-not (Test-Path -LiteralPath $rustupExe)) {
        throw "rustup executable was not installed in the F-drive toolchain"
    }

    # Some removable/exFAT-style volumes do not implement Windows hard links.
    # rustup normally hard-links these proxies; byte-for-byte copies provide the
    # same argv[0]-selected proxy behavior while keeping every tool on F:.
    @(
        "cargo.exe",
        "cargo-clippy.exe",
        "cargo-fmt.exe",
        "clippy-driver.exe",
        "rust-analyzer.exe",
        "rustc.exe",
        "rustdoc.exe",
        "rustfmt.exe"
    ) | ForEach-Object {
        $proxy = Join-Path $cargoRoot "bin\$_"
        if (-not (Test-Path -LiteralPath $proxy)) {
            Copy-Item -LiteralPath $rustupExe -Destination $proxy
        }
    }
}

function Import-ExistingHostRustToolchain {
    $sourceRoot = Join-Path $env:USERPROFILE ".rustup\toolchains"
    $source = Get-ChildItem -LiteralPath $sourceRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "stable-*-windows-msvc" } |
        Select-Object -First 1
    if (-not $source) {
        throw "No existing Windows Rust toolchain is available to import onto F:"
    }

    # Use a dedicated name so an interrupted rustup installation can never be
    # mistaken for the complete imported host compiler.
    $destinationName = "autogram-$($source.Name)"
    $destination = Join-Path $rustupRoot "toolchains\$destinationName"
    if (-not (Test-Path -LiteralPath (Join-Path $destination "bin\rustc.exe"))) {
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        Write-Host "Importing the existing host Rust toolchain to $destination"
        & robocopy.exe $source.FullName $destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) {
            throw "Failed to import the existing Rust toolchain onto F: (robocopy exit $LASTEXITCODE)"
        }
    }
}

function Remove-ToolchainTemporaryDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $allowedRoot = [System.IO.Path]::GetFullPath($toolchainRoot).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a temporary directory outside the AutoGram toolchain root: $fullPath"
    }
    if (-not (Test-Path -LiteralPath $fullPath)) { return }

    1..5 | ForEach-Object {
        if (-not (Test-Path -LiteralPath $fullPath)) { return }
        try {
            Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (Test-Path -LiteralPath $fullPath) {
        Write-Warning "Temporary extraction directory will be reclaimed on a later bootstrap: $fullPath"
    }
}

function Import-ExistingCargoRegistry {
    $sourceRegistry = Join-Path $env:USERPROFILE ".cargo\registry"
    $destinationRegistry = Join-Path $cargoRoot "registry"
    $marker = Join-Path $destinationRegistry ".autogram-byte-copy-complete-v1"
    if ((Test-Path -LiteralPath $marker) -or -not (Test-Path -LiteralPath $sourceRegistry)) { return }

    Write-Host "Importing the existing Cargo registry to F: using data-only copies"
    $sourcePrefix = [System.IO.Path]::GetFullPath($sourceRegistry).TrimEnd('\') + '\'
    $files = Get-ChildItem -LiteralPath $sourceRegistry -Recurse -File
    $copied = 0
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($sourcePrefix.Length)
        $destination = Join-Path $destinationRegistry $relative
        $destinationParent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationParent)) {
            [System.IO.Directory]::CreateDirectory($destinationParent) | Out-Null
        }
        $needsCopy = -not (Test-Path -LiteralPath $destination)
        if (-not $needsCopy) {
            $needsCopy = (Get-Item -LiteralPath $destination).Length -ne $file.Length
        }
        if ($needsCopy) {
            [System.IO.File]::Copy($file.FullName, $destination, $true)
            $copied++
        }
        if (($copied -gt 0) -and (($copied % 2500) -eq 0)) {
            Write-Host "  Copied $copied Cargo registry files..."
        }
    }
    Set-Content -LiteralPath $marker -Value "Imported without timestamps or attributes." -Encoding ASCII
}

if (-not $SkipAndroidPackages) {
    $sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
    1..64 | ForEach-Object { "y" } | & $sdkManager --sdk_root=$sdkRoot --licenses | Out-Host
    & $sdkManager --sdk_root=$sdkRoot "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;27.0.12077973"
    if ($LASTEXITCODE -ne 0) { throw "Android SDK package installation failed" }
}

if (-not (Test-Path -LiteralPath (Join-Path $cargoRoot "bin\rustup.exe"))) {
    $rustupInit = Join-Path $downloads "rustup-init.exe"
    if (-not (Test-Path -LiteralPath $rustupInit)) {
        Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit -UseBasicParsing
    }
    & $rustupInit -y --profile minimal --default-toolchain stable
    $rustupInitExit = $LASTEXITCODE
    if ($rustupInitExit -ne 0 -and -not (Test-Path -LiteralPath (Join-Path $cargoRoot "bin\rustup.exe"))) {
        throw "F-drive rustup bootstrap failed"
    }
}

Repair-RustupProxyCopies
Import-ExistingHostRustToolchain

$fDriveToolchain = Get-ChildItem -LiteralPath (Join-Path $rustupRoot "toolchains") -Directory |
    Where-Object { $_.Name -like "autogram-stable-*-windows-msvc" } |
    Select-Object -First 1
if (-not $fDriveToolchain) { throw "Imported F-drive Rust toolchain is missing" }
$env:RUSTUP_TOOLCHAIN = $fDriveToolchain.Name
$fDriveToolchainBin = Join-Path $fDriveToolchain.FullName "bin"
$env:RUSTC = Join-Path $fDriveToolchainBin "rustc.exe"
$cargoCompat = Join-Path $rustupRoot "toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe"
$env:CARGO = if (Test-Path -LiteralPath $cargoCompat) { $cargoCompat } else { Join-Path $fDriveToolchainBin "cargo.exe" }
$cargoCompatBin = Split-Path -Parent $env:CARGO
$env:PATH = "$cargoCompatBin;$fDriveToolchainBin;$env:PATH"
Import-ExistingCargoRegistry
$rustupSettings = @"
version = "12"
default_toolchain = "$($fDriveToolchain.Name)"
profile = "minimal"

[overrides]
"@
Set-Content -LiteralPath (Join-Path $rustupRoot "settings.toml") -Value $rustupSettings -Encoding ASCII

function Install-AndroidRustStdComponent {
    param([Parameter(Mandatory = $true)][string]$Target)

    $targetLib = Join-Path $fDriveToolchain.FullName "lib\rustlib\$Target\lib"
    if (Test-Path -LiteralPath $targetLib) { return }

    $versionOutput = & $env:RUSTC -Vv
    if ($LASTEXITCODE -ne 0) { throw "F-drive rustc cannot report its version" }
    $release = (($versionOutput | Where-Object { $_ -like "release:*" }) -split ':', 2)[1].Trim()
    if (-not $release) { throw "Unable to identify the imported Rust release" }

    $archiveName = "rust-std-$release-$Target.tar.xz"
    $archive = Join-Path $downloads $archiveName
    $manifest = Join-Path $downloads "channel-rust-$release.toml"
    if (-not (Test-Path -LiteralPath $manifest)) {
        Invoke-WebRequest -Uri "https://static.rust-lang.org/dist/channel-rust-$release.toml" -OutFile $manifest -UseBasicParsing
    }
    $manifestText = Get-Content -LiteralPath $manifest -Raw
    $sectionPattern = "(?ms)^\[pkg\.rust-std\.target\." + [regex]::Escape($Target) + "\]\s*(.*?)(?=^\[|\z)"
    $sectionMatch = [regex]::Match($manifestText, $sectionPattern)
    if (-not $sectionMatch.Success) { throw "Rust manifest has no std component for $Target" }
    $targetSection = $sectionMatch.Groups[1].Value
    $urlMatch = [regex]::Match($targetSection, '(?m)^xz_url\s*=\s*"([^"]+)"')
    $hashMatch = [regex]::Match($targetSection, '(?m)^xz_hash\s*=\s*"([^"]+)"')
    if (-not $urlMatch.Success -or -not $hashMatch.Success) {
        throw "Rust manifest did not provide a verified xz package for $Target"
    }
    Get-VerifiedArchive -Url $urlMatch.Groups[1].Value -Output $archive -Sha256 $hashMatch.Groups[1].Value

    $extract = Join-Path $toolchainRoot "rust-target-extract-$Target-$PID"
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    & tar.exe -xf $archive -C $extract
    if ($LASTEXITCODE -ne 0) { throw "Failed to extract Rust target $Target" }
    $component = Get-ChildItem -LiteralPath $extract -Recurse -Directory |
        Where-Object { $_.FullName -like "*\lib\rustlib\$Target" } |
        Select-Object -First 1
    if (-not $component) { throw "Rust target archive did not contain $Target" }
    Copy-Item -LiteralPath $component.FullName -Destination (Join-Path $fDriveToolchain.FullName "lib\rustlib") -Recurse -Force
    Remove-ToolchainTemporaryDirectory -Path $extract
}

@(
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "x86_64-linux-android",
    "i686-linux-android"
) | ForEach-Object { Install-AndroidRustStdComponent -Target $_ }

if (-not (Test-Path -LiteralPath (Join-Path $cargoTools "bin\cargo-ndk.exe"))) {
    # Use the upstream signed release asset. `cargo install` attempts to apply
    # archive mtimes that are unsupported by this F: filesystem.
    $cargoNdkArchive = Join-Path $downloads "cargo-ndk-x86_64-pc-windows-msvc-v4.1.2.zip"
    Get-VerifiedArchive `
        -Url "https://github.com/bbqsrc/cargo-ndk/releases/download/v4.1.2/cargo-ndk-x86_64-pc-windows-msvc-v4.1.2.zip" `
        -Output $cargoNdkArchive `
        -Sha256 "e2687c647748a8fb1c06981a4fc39376a5b5f640474db3f73de7ae247b7c55e0"
    $cargoNdkExtract = Join-Path $toolchainRoot "cargo-ndk-extract-$PID"
    New-Item -ItemType Directory -Force -Path $cargoNdkExtract | Out-Null
    Expand-Archive -LiteralPath $cargoNdkArchive -DestinationPath $cargoNdkExtract -Force
    $cargoNdkExe = Get-ChildItem -LiteralPath $cargoNdkExtract -Recurse -File -Filter "cargo-ndk.exe" | Select-Object -First 1
    if (-not $cargoNdkExe) { throw "cargo-ndk release archive did not contain cargo-ndk.exe" }
    New-Item -ItemType Directory -Force -Path (Join-Path $cargoTools "bin") | Out-Null
    Copy-Item -LiteralPath $cargoNdkExe.FullName -Destination (Join-Path $cargoTools "bin\cargo-ndk.exe") -Force
    Remove-ToolchainTemporaryDirectory -Path $cargoNdkExtract
}

$localProperties = Join-Path $PSScriptRoot "local.properties"
$escapedSdk = $sdkRoot.Replace('\', '\\').Replace(':', '\:')
Set-Content -LiteralPath $localProperties -Value "sdk.dir=$escapedSdk" -Encoding ASCII

$gradleBat = Join-Path $gradleRoot "bin\gradle.bat"
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "gradlew.bat"))) {
    & $gradleBat -p $PSScriptRoot wrapper --gradle-version 8.7 --distribution-type bin
    if ($LASTEXITCODE -ne 0) { throw "Gradle wrapper generation failed" }
}

Write-Host "AutoGram Android toolchain is ready."
Write-Host "JAVA_HOME=$jdkRoot"
Write-Host "ANDROID_SDK_ROOT=$sdkRoot"
Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
Write-Host "CARGO_HOME=$cargoRoot"
Write-Host "RUSTUP_HOME=$rustupRoot"
