# Local-only identity provisioning. Never rotate automatically or print credentials.
function Get-AutoGramLocalSigning {
    [CmdletBinding()]
    param([switch]$Create)

    $ErrorActionPreference = 'Stop'
    if ($env:OS -ne 'Windows_NT') { throw 'Local signing credentials require Windows DPAPI.' }
    $signingAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $signingWorkspace = [IO.Path]::GetFullPath((Join-Path $signingAppRoot '../..'))
    $signingDirectory = Join-Path $signingAppRoot '.signing'
    $signingStore = Join-Path $signingDirectory 'autogram-local.p12'
    $signingCredentials = Join-Path $signingDirectory 'credentials.xml'
    $signingKeytool = Join-Path $signingWorkspace '.toolchains/jdk-17/bin/keytool.exe'
    if (-not (Test-Path -LiteralPath $signingKeytool)) { throw 'Bundled JDK keytool is missing.' }
    $hasStore = Test-Path -LiteralPath $signingStore
    $hasCredentials = Test-Path -LiteralPath $signingCredentials
    if ($hasStore -ne $hasCredentials) {
        throw 'Incomplete signing identity. Preserve existing files and restore the matching backup; do not regenerate.'
    }
    if (-not $hasStore) {
        if (-not $Create) { throw 'Local keystore missing. Provision explicitly with Get-AutoGramLocalSigning -Create.' }
        New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
        # Credentials are encrypted to this Windows user/machine; also remove inherited access.
        $signingSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $signingDirectory /inheritance:r /grant:r "*${signingSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect local signing directory.' }
        $signingAccess = (Get-Acl -LiteralPath $signingDirectory).Access
        if ($signingAccess | Where-Object {
            $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($signingSid, 'S-1-5-18')
        }) {
            Write-Warning 'This volume does not enforce private ACLs (for example exFAT). The keystore and credentials remain encrypted; protect the drive physically.'
        }
        $signingRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
        $signingBytes = New-Object byte[] 48
        try { $signingRandom.GetBytes($signingBytes) } finally { $signingRandom.Dispose() }
        $signingSecret = ConvertTo-SecureString ([Convert]::ToBase64String($signingBytes)) -AsPlainText -Force
        [Array]::Clear($signingBytes, 0, $signingBytes.Length)
        $signingCredential = New-Object Management.Automation.PSCredential('autogram-local', $signingSecret)
        # Persist encrypted credential first; a provisioning failure cannot silently discard it.
        $signingCredential | Export-Clixml -LiteralPath $signingCredentials
        $signingPreviousPassword = $env:AUTOGRAM_KEYTOOL_PASSWORD
        try {
            $env:AUTOGRAM_KEYTOOL_PASSWORD = $signingCredential.GetNetworkCredential().Password
            $signingOutput = & $signingKeytool -genkeypair -noprompt -storetype PKCS12 `
                -keystore $signingStore -alias $signingCredential.UserName `
                -storepass:env AUTOGRAM_KEYTOOL_PASSWORD -keypass:env AUTOGRAM_KEYTOOL_PASSWORD `
                -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 `
                -dname 'CN=AutoGram Local, O=AutoGram, C=ID' 2>&1
            if ($LASTEXITCODE -ne 0) { throw 'Keystore generation failed. Preserve the encrypted credential for recovery.' }
        } finally { $env:AUTOGRAM_KEYTOOL_PASSWORD = $signingPreviousPassword }
    }
    try {
        $signingCredential = Import-Clixml -LiteralPath $signingCredentials
        if ($signingCredential -isnot [Management.Automation.PSCredential] -or
            $signingCredential.UserName -ne 'autogram-local' -or $signingCredential.Password.Length -lt 32) {
            throw 'Invalid credential'
        }
    } catch { throw 'Cannot unlock local signing credentials with this Windows user/machine. Restore the matching identity securely.' }
    $signingPreviousPassword = $env:AUTOGRAM_KEYTOOL_PASSWORD
    try {
        $env:AUTOGRAM_KEYTOOL_PASSWORD = $signingCredential.GetNetworkCredential().Password
        $signingOutput = & $signingKeytool -list -v -keystore $signingStore -storetype PKCS12 `
            -alias $signingCredential.UserName -storepass:env AUTOGRAM_KEYTOOL_PASSWORD `
            '-J-Duser.language=en' '-J-Duser.country=US' 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Local keystore validation failed; no fallback signer is allowed.' }
        $signingFingerprint = [regex]::Match(($signingOutput -join "`n"), 'SHA256:\s*([0-9A-F:]{95})').Groups[1].Value
        if (-not $signingFingerprint) { throw 'Cannot verify local signing certificate fingerprint.' }
        [pscustomobject]@{
            StoreFile = $signingStore
            Alias = $signingCredential.UserName
            Password = $signingCredential.Password
            CertificateSha256 = $signingFingerprint.Replace(':', '').ToLowerInvariant()
        }
    } finally { $env:AUTOGRAM_KEYTOOL_PASSWORD = $signingPreviousPassword }
}
