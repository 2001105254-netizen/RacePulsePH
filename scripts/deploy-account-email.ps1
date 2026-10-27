param([string]$Project = 'racepulseph')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$functionsRoot = Join-Path $projectRoot 'functions'
$stagingName = ".secret-account-release-$([guid]::NewGuid().ToString('N'))"
$stagingRoot = Join-Path $functionsRoot $stagingName
$configPath = Join-Path $functionsRoot "$stagingName.json"
$nodeCommand = (Get-Command node).Source
$npxCommand = Join-Path (Split-Path $nodeCommand) 'npx.cmd'
$previousDiscoveryTimeout = $env:FUNCTIONS_DISCOVERY_TIMEOUT
try {
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  foreach ($file in @('auth-api.js', 'account-security.js', 'account-email.js', 'package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $functionsRoot $file) -Destination $stagingRoot
  }
  # Firebase inspects every export before selecting functions. Package the email
  # entry point alone so its deployment never requires unrelated payment secrets.
  [System.IO.File]::WriteAllText((Join-Path $stagingRoot 'index.js'), "require('firebase-admin').initializeApp();`nexports.accountApi = require('./auth-api').accountApi;`n")
  $deploymentConfig = @{ functions = @{ source = $stagingName; runtime = 'nodejs22'; ignore = @('node_modules', '.secret*', '.env*', '*.log') } }
  [System.IO.File]::WriteAllText($configPath, ($deploymentConfig | ConvertTo-Json -Depth 5))
  $env:FUNCTIONS_DISCOVERY_TIMEOUT = '60'
  & $npxCommand --offline --yes firebase-tools@15.34.1 deploy --config $configPath --only functions:accountApi --project $Project --non-interactive
  if ($LASTEXITCODE -ne 0) { throw 'Account email deployment failed.' }
} finally {
  $env:FUNCTIONS_DISCOVERY_TIMEOUT = $previousDiscoveryTimeout
  # The stage contains only the fixed list of copied source files above.
  foreach ($file in @('index.js', 'auth-api.js', 'account-security.js', 'account-email.js', 'package.json', 'package-lock.json')) {
    $stagedFile = Join-Path $stagingRoot $file
    if (Test-Path -LiteralPath $stagedFile) { Remove-Item -LiteralPath $stagedFile }
  }
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot }
  if (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath }
}
