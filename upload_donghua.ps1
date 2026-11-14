# =============================================================================
# AutoGram Smart Media Uploader - PowerShell Script
# Target: 'U8542241823/D-1003214112048/T8' (Topik Donghua NSFW)
# Source: E:\Data\Upload\Dong | Limit: 500 media per run
# =============================================================================

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgsList
)

$Host.UI.RawUI.WindowTitle = "AutoGram Smart Media Uploader - Topic Donghua NSFW"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonScript = Join-Path $ScriptDir "tools\upload_donghua\upload_donghua.py"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python tidak terdeteksi di PATH sistem." -ForegroundColor Red
    exit 1
}

& python $PythonScript $ArgsList
exit $LASTEXITCODE
