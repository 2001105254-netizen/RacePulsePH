<#!
.SYNOPSIS
Interactively configures GitHub Actions Android release signing secrets for RacePulsePH.

.DESCRIPTION
Reads the local Android release keystore (.jks) and optional google-services.json,
validates keystore credentials locally with Java keytool without exposing secrets in
command-line arguments, uploads encrypted secrets via GitHub CLI (or copies base64
values step by step for GitHub Settings if gh is unavailable), and optionally
re-runs the CI/CD release workflow.
#>
[CmdletBinding()]
param(
    [string]$Repo = 'Patkik/RacePulsePH',
    [string]$Branch = 'QA',
    [string]$KeystorePath = (Join-Path $env:USERPROFILE '.android\racepulseph-release.jks'),
    [string]$GoogleServicesPath = '',
    [switch]$ClipboardOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($GoogleServicesPath)) {
    $GoogleServicesPath = Join-Path $projectRoot 'android\app\google-services.json'
}

function ConvertFrom-SecureStringPlain {
    param([Parameter(Mandatory)][System.Security.SecureString]$SecureValue)
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

function Resolve-Keytool {
    $cmd = Get-Command keytool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
    $gradleProps = Join-Path $env:USERPROFILE '.gradle\gradle.properties'
    if (Test-Path -LiteralPath $gradleProps) {
        $line = Get-Content -LiteralPath $gradleProps | Where-Object { $_ -match '^\s*org\.gradle\.java\.home\s*=' } | Select-Object -First 1
        if ($line -match '^\s*org\.gradle\.java\.home\s*=\s*(.+)$') {
            $javaHome = $Matches[1].Trim().Replace('\\', '\')
            $candidates += (Join-Path $javaHome 'bin\keytool.exe')
        }
    }
    $jdkDirs = Get-ChildItem -Path 'C:\Program Files\Java' -Filter 'jdk*' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    foreach ($d in $jdkDirs) { $candidates += (Join-Path $d.FullName 'bin\keytool.exe') }

    return ($candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)
}

if (!(Test-Path -LiteralPath $KeystorePath)) {
    throw "Release keystore not found at: $KeystorePath. Pass -KeystorePath with the valid .jks path."
}

$keystoreB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($KeystorePath))
$googleServicesB64 = $null
if (Test-Path -LiteralPath $GoogleServicesPath) {
    $googleServicesB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($GoogleServicesPath))
} else {
    Write-Warning "google-services.json was not found at $GoogleServicesPath; GOOGLE_SERVICES_JSON_BASE64 will be skipped."
}

$ghCmd = if ($ClipboardOnly) { $null } else { Get-Command gh -ErrorAction SilentlyContinue }
if (!$ghCmd) {
    Write-Host ''
    Write-Host 'GitHub CLI (gh) was not detected. Falling back to clipboard-guided GitHub UI setup.' -ForegroundColor Yellow
    Write-Host "Tip: install gh anytime with: winget install --id GitHub.cli -e" -ForegroundColor DarkGray
    Write-Host "Open: https://github.com/$Repo/settings/secrets/actions" -ForegroundColor Cyan
    Write-Host ''
    Set-Clipboard -Value $keystoreB64
    Write-Host 'Copied ANDROID_KEYSTORE_BASE64 to clipboard. Paste it into GitHub Secrets.' -ForegroundColor Green
    if ($googleServicesB64) {
        [void](Read-Host 'Press Enter after saving ANDROID_KEYSTORE_BASE64 to copy GOOGLE_SERVICES_JSON_BASE64')
        Set-Clipboard -Value $googleServicesB64
        Write-Host 'Copied GOOGLE_SERVICES_JSON_BASE64 to clipboard. Paste it into GitHub Secrets.' -ForegroundColor Green
    }
    Write-Host ''
    Write-Host 'Add your remaining 3 keystore secrets directly in GitHub UI:' -ForegroundColor Yellow
    Write-Host '  1. ANDROID_KEYSTORE_PASSWORD'
    Write-Host '  2. ANDROID_KEYSTORE_ALIAS'
    Write-Host '  3. ANDROID_KEY_PASSWORD'
    Write-Host "Then re-run RacePulsePH CI/CD Release on branch '$Branch' in GitHub Actions." -ForegroundColor Cyan
    exit 0
}

& $ghCmd.Source auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Run "gh auth login" first, then re-run this script.'
}

$alias = Read-Host 'Enter ANDROID_KEYSTORE_ALIAS'
if ([string]::IsNullOrWhiteSpace($alias)) { throw 'ANDROID_KEYSTORE_ALIAS is required.' }
$storeSec = Read-Host 'Enter ANDROID_KEYSTORE_PASSWORD' -AsSecureString
$keySec = Read-Host 'Enter ANDROID_KEY_PASSWORD (press Enter if same as keystore password)' -AsSecureString

$storePass = ConvertFrom-SecureStringPlain $storeSec
$keyPass = ConvertFrom-SecureStringPlain $keySec
if ([string]::IsNullOrEmpty($keyPass)) { $keyPass = $storePass }

try {
    $keytool = Resolve-Keytool
    if ($keytool) {
        $env:RP_VERIFY_STOREPASS = $storePass
        $env:RP_VERIFY_KEYPASS = $keyPass
        try {
            & $keytool -list -keystore $KeystorePath -alias $alias -storepass:env RP_VERIFY_STOREPASS | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw 'keytool validation failed. Check your keystore password or alias before uploading secrets.'
            }
            Write-Host "Verified keystore '$KeystorePath' with alias '$alias'." -ForegroundColor Green
        } finally {
            Remove-Item Env:RP_VERIFY_STOREPASS -ErrorAction SilentlyContinue
            Remove-Item Env:RP_VERIFY_KEYPASS -ErrorAction SilentlyContinue
        }
    }

    $secretMap = [ordered]@{
        ANDROID_KEYSTORE_BASE64   = $keystoreB64
        ANDROID_KEYSTORE_PASSWORD = $storePass
        ANDROID_KEYSTORE_ALIAS    = $alias.Trim()
        ANDROID_KEY_PASSWORD      = $keyPass
    }
    if ($googleServicesB64) {
        $secretMap['GOOGLE_SERVICES_JSON_BASE64'] = $googleServicesB64
    }

    foreach ($entry in $secretMap.GetEnumerator()) {
        $entry.Value | & $ghCmd.Source secret set $entry.Key --repo $Repo
        if ($LASTEXITCODE -ne 0) {
            throw "Failed setting GitHub secret $($entry.Key) on $Repo."
        }
        Write-Host "Saved GitHub secret: $($entry.Key) -> $Repo" -ForegroundColor Green
    }

    $trigger = Read-Host "Trigger workflow ci-cd-release.yml on $Repo ($Branch) now? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($trigger) -or $trigger -match '^[Yy]') {
        & $ghCmd.Source workflow run ci-cd-release.yml --repo $Repo --ref $Branch -f publish_release=true
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Triggered RacePulsePH CI/CD Release on $Repo ($Branch)." -ForegroundColor Green
        }
    }
} finally {
    $storePass = $null
    $keyPass = $null
    $keystoreB64 = $null
    $googleServicesB64 = $null
}
