[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Install','Remove')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateSet('claude','chatgpt')][string]$Provider,
  [string]$Endpoint,
  [string]$Model
)
$ErrorActionPreference = 'Stop'
$bundleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$helper = Join-Path $bundleRoot 'app\dist\apps\windows-companion\voice\sxsy-b122-voice-helper.exe'
$validator = Join-Path $bundleRoot 'scripts\Test-B122ReleaseArtifact.ps1'
$releasePath = Join-Path $bundleRoot 'release.json'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'The fixed packaged SXSY-B122 voice helper is missing.' }
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'The installed release-integrity validator is missing.' }
$validation = & $validator -BundleRoot $bundleRoot | ConvertFrom-Json
if ($validation.schema -cne 'sxsy-b122.release-validation' -or $validation.version -ne 1 -or $validation.status -cne 'passed') { throw 'Voice route administration requires a verified installed release.' }
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
function Assert-VoiceHelperIdentity {
  $item = Get-Item -LiteralPath $helper -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $release.voiceHelperSha256 -notmatch '^[0-9a-f]{64}$') { throw 'The installed voice-helper identity is unsafe or unbound.' }
  $actual = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $release.voiceHelperSha256) { throw 'The installed voice helper changed after release validation.' }
}
Assert-VoiceHelperIdentity
$providerRoute = if ($Provider -ceq 'claude') { 'provider.claude.voice' } else { 'provider.chatgpt.voice' }
$authorizationReference = if ($Provider -ceq 'claude') { 'credential-ref:claude-current-user' } else { 'credential-ref:chatgpt-current-user' }
$expectedPhrase = if ($Action -ceq 'Install') { 'PROVISION B122 VOICE ROUTE' } else { 'REMOVE B122 VOICE ROUTE' }
$confirmation = Read-Host "Type exactly '$expectedPhrase' to $($Action.ToLowerInvariant()) the current-user $Provider voice route"
if ($confirmation -cne $expectedPhrase) { throw 'Exact current-user confirmation was not supplied; no voice route changed.' }
if (-not $PSCmdlet.ShouldProcess("current-user $Provider voice route", $Action)) { return }
$operatorMaterial = [Text.Encoding]::UTF8.GetBytes([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$operatorDigest = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($operatorMaterial)).Replace('-','').ToLowerInvariant()
$inputRecord = [ordered]@{
  currentUserConfirmed = $true
  confirmation = $expectedPhrase
  operatorPresenceId = "operator-$operatorDigest"
  authorizationReference = $authorizationReference
}
$mode = '--remove-route-v1'
$clearSecret = $null
$secretPointer = [IntPtr]::Zero
try {
  if ($Action -ceq 'Install') {
    if ([string]::IsNullOrWhiteSpace($Endpoint) -or [string]::IsNullOrWhiteSpace($Model)) { throw 'Install requires an exact HTTPS endpoint and model identifier.' }
    $uri = [Uri]$Endpoint
    if ($uri.Scheme -cne 'https' -or $uri.Port -ne 443 -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw 'Voice route endpoint must be exact HTTPS on port 443 with no query, fragment, or user information.' }
    $secureSecret = Read-Host 'Enter the provider-route secret (input is hidden and never placed in argv)' -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    $clearSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    if ([string]::IsNullOrWhiteSpace($clearSecret) -or $clearSecret.Length -gt 16384) { throw 'The provider-route secret is empty or oversized.' }
    $inputRecord.provider = $Provider
    $inputRecord.routeId = $providerRoute
    $inputRecord.endpoint = $uri.AbsoluteUri
    $inputRecord.model = $Model
    $inputRecord.secret = $clearSecret
    $mode = '--provision-route-v1'
  }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $helper
  $start.Arguments = $mode
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WorkingDirectory = [IO.Path]::GetDirectoryName($helper)
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables.Clear()
    $start.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
    $start.EnvironmentVariables['WINDIR'] = $env:WINDIR
    # Recheck after hidden input and immediately before the plaintext secret
    # crosses the child boundary.
    Assert-VoiceHelperIdentity
    $process = [Diagnostics.Process]::Start($start)
  if (-not $process) { throw 'The fixed voice helper could not be started.' }
  $process.StandardInput.WriteLine(($inputRecord | ConvertTo-Json -Compress))
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'The fixed voice route administration operation timed out.' }
  # The helper contract emits one bounded JSON line, so reading after the
  # bounded process exit cannot fill a pipe or defeat the timeout above.
  $output = $process.StandardOutput.ReadToEnd()
  $diagnostic = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0) { throw $(if ($diagnostic.Trim()) { 'The fixed voice helper rejected route administration.' } else { 'The fixed voice helper failed closed.' }) }
  $receipt = $output | ConvertFrom-Json
  if ($receipt.schema -cne 'sxsy-b122.voice-route-admin' -or $receipt.version -ne 1 -or $receipt.authorizationReference -cne $authorizationReference) { throw 'The voice helper returned an invalid route-administration receipt.' }
  $receipt | ConvertTo-Json -Compress
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
  $clearSecret = $null
  if ($inputRecord.Contains('secret')) { $inputRecord.secret = $null; $inputRecord.Remove('secret') }
}
