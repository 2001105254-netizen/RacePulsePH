param([string]$Project = 'racepulseph')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $projectRoot 'functions/.secret.local'
if (!(Test-Path -LiteralPath $secretPath)) {
  throw 'The private functions/.secret.local file is missing. Create it with SMTP_APP_PASSWORD and AUTH_CODE_SECRET before running this setup.'
}
$npxCommand = Join-Path (Split-Path (Get-Command node).Source) 'npx.cmd'
if (!(Test-Path -LiteralPath $npxCommand)) { $npxCommand = (Get-Command npx).Source }
$values = @{}
foreach ($line in [System.IO.File]::ReadAllLines($secretPath)) {
  if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
}
foreach ($name in @('SMTP_APP_PASSWORD', 'AUTH_CODE_SECRET')) {
  if (!$values[$name]) { throw "Missing $name in the private secret file." }
}
foreach ($name in @('SMTP_APP_PASSWORD', 'AUTH_CODE_SECRET')) {
  # Pass a file path to Firebase so secret values never appear in process
  # arguments, command history or console output. Remove the temporary copy.
  $temporaryPath = Join-Path $projectRoot "functions/.secret-$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllText($temporaryPath, $values[$name], [System.Text.UTF8Encoding]::new($false))
    & $npxCommand --yes firebase-tools functions:secrets:set $name --data-file $temporaryPath --project $Project
    if ($LASTEXITCODE -ne 0) { throw "Firebase could not save $name. Sign in with Firebase and retry." }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
  }
}
Write-Output 'Account email secrets saved to Firebase. Deploy accountApi and the updated app and rules to enable the flow.'
