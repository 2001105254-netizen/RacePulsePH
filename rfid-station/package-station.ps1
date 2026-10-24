<#!
.SYNOPSIS
Creates the files used by the RacePulse Timing Station Windows installer.

.DESCRIPTION
Run this on the Windows timing laptop after installing Node.js, Visual Studio
Build Tools/.NET Framework 4.8 Developer Pack, and Inno Setup. It builds the
web console plus the desktop RFID utility, then stages everything under
release\RacePulseTimingStation. The resulting installer works without a
separate npm command on race day.
#>
[CmdletBinding()]
param(
    [string]$NodeRuntime
)

$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repository "release\RacePulseTimingStation"
$stationProject = Join-Path $PSScriptRoot "RacePulseTimingStation.csproj"
$bridgeProject = Join-Path $repository "rfid-bridge\RacePulseRfidBridge.csproj"

if (-not (Test-Path (Join-Path $repository "rfid-bridge\vendor\Vup.dll"))) {
    throw "Missing rfid-bridge\vendor\Vup.dll. Copy the three VF-787P SDK DLLs there first."
}
if (-not (Test-Path (Join-Path $repository "rfid-bridge\vendor\rfid.dll"))) {
    throw "Missing rfid-bridge\vendor\rfid.dll. Copy the three VF-787P SDK DLLs there first."
}
if (-not (Test-Path (Join-Path $repository "rfid-bridge\vendor\rfid_core.dll"))) {
    throw "Missing rfid-bridge\vendor\rfid_core.dll. Copy the three VF-787P SDK DLLs there first."
}

if ([string]::IsNullOrWhiteSpace($NodeRuntime)) {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $NodeRuntime = $nodeCommand.Source
}
if (-not (Test-Path $NodeRuntime)) { throw "node.exe was not found. Install Node.js LTS or pass -NodeRuntime C:\path\node.exe." }

Push-Location $repository
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit code $LASTEXITCODE)." }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "RacePulse web build failed (exit code $LASTEXITCODE)." }
    dotnet build $stationProject -c Release
    if ($LASTEXITCODE -ne 0) { throw "Timing Station build failed (exit code $LASTEXITCODE)." }
    dotnet build $bridgeProject -c Release
    if ($LASTEXITCODE -ne 0) { throw "RFID Bridge build failed (exit code $LASTEXITCODE)." }

    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage "runtime"), (Join-Path $stage "app"), (Join-Path $stage "tools") | Out-Null

    Copy-Item (Join-Path $PSScriptRoot "bin\Release\net48\*") $stage -Recurse -Force
    Copy-Item $NodeRuntime (Join-Path $stage "runtime\node.exe") -Force
    Copy-Item (Join-Path $repository "dist\server.cjs") (Join-Path $stage "app\server.cjs") -Force
    Copy-Item (Join-Path $repository "dist") (Join-Path $stage "app\dist") -Recurse -Force
    Copy-Item (Join-Path $repository "node_modules") (Join-Path $stage "app\node_modules") -Recurse -Force
    Copy-Item (Join-Path $repository "rfid-bridge\bin\Release\net48\*") (Join-Path $stage "tools") -Recurse -Force

    Write-Host "Timing Station staged at: $stage" -ForegroundColor Green
    Write-Host "Next: open rfid-station\RacePulseTimingStation.iss in Inno Setup and click Build." -ForegroundColor Yellow
}
finally {
    Pop-Location
}
