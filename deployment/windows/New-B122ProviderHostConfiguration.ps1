[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$ProtectedStateRoot,
  [Parameter(Mandatory=$true)][string]$BackendPlanPath,
  [Parameter(Mandatory=$true)][string]$CertificateFile,
  [Parameter(Mandatory=$true)][string]$PrivateKeyFile,
  [Parameter(Mandatory=$true)][string]$AuthenticationTokenEnvelopeFile,
  [Parameter(Mandatory=$true)][string]$JournalAuthenticationEnvelopeFile,
  [Parameter(Mandatory=$true)][string]$StateFile,
  [ValidatePattern('^(?:[A-Za-z0-9.-]+|::1)$')][string]$ListenHost='127.0.0.1',
  [ValidateRange(1,65535)][int]$ListenPort=4747,
  [switch]$AllowFixtureBackends,
  [switch]$Replace
)
$ErrorActionPreference='Stop'
$utf8NoBom=New-Object Text.UTF8Encoding($false)

function Absolute([string]$Value,[string]$Label) {
  if($Value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])' -or $Value -match '[\0\r\n]'){throw "$Label must be one absolute path."}
  return [IO.Path]::GetFullPath($Value)
}
function Inside([string]$Root,[string]$Candidate){$prefix=$Root.TrimEnd('\')+'\';return $Candidate.Equals($Root,[StringComparison]::OrdinalIgnoreCase)-or $Candidate.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)}
function Exact-Keys($Value,[string[]]$Required,[string[]]$Optional=@()) {$names=@($Value.PSObject.Properties.Name);$allowed=@($Required+$Optional);return @($Required|Where-Object{$_ -notin $names}).Count -eq 0 -and @($names|Where-Object{$_ -notin $allowed}).Count -eq 0}
function Assert-RegularFile([string]$Path,[string]$Label) {if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "$Label is missing."};$item=Get-Item -LiteralPath $Path -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "$Label cannot be a reparse point."}}
function Sha([string]$Path){$stream=[IO.File]::OpenRead($Path);$hasher=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose();$stream.Dispose()}}
function Sid([string]$Identity){return ([Security.Principal.NTAccount]$Identity).Translate([Security.Principal.SecurityIdentifier]).Value}
function Assert-ProtectedAcl([string[]]$Paths) {
  $current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($current,'S-1-5-18')
  foreach($path in $Paths){$acl=Get-Acl -LiteralPath $path;$owner=Sid ([string]$acl.Owner);if($owner -cne $current){throw 'Provider-host protected storage must be owned by the current Windows user.'};if($path -ceq $Paths[0] -and -not $acl.AreAccessRulesProtected){throw 'Provider-host protected root must disable inherited access.'};$hasCurrent=$false;foreach($rule in @($acl.Access)){if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue};$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($sid -notin $allowed){throw 'Provider-host protected storage grants access outside the current user and SYSTEM.'};if($sid -ceq $current){$hasCurrent=$true}};if(-not $hasCurrent){throw 'Provider-host protected storage lacks a current-user access rule.'}}
}
function Assert-Envelope([string]$Path,[string]$Label){Assert-RegularFile $Path $Label;$value=Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json;if(-not(Exact-Keys $value @('schema','version','protector','sealed')) -or $value.schema -cne 'sxsy-b122.provider-host-secret-envelope' -or $value.version -ne 1 -or $value.protector -cne 'windows-dpapi-current-user' -or [string]$value.sealed -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or ([string]$value.sealed).Length -gt 32768){throw "$Label is not one DPAPI CurrentUser secret envelope."}}
function Tls-Identity([string]$CertificatePath,[string]$PrivateKeyPath) {
  $helperCandidates=@((Join-Path $PSScriptRoot 'Get-B122TlsIdentity.mjs'),(Join-Path $PSScriptRoot '..\Get-B122TlsIdentity.mjs'))
  $helper=@($helperCandidates|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})[0];if(-not $helper){throw 'The provider-host TLS identity inspector is missing.'}
  $bundledNode=Join-Path $PSScriptRoot '..\..\runtime\node.exe';$node=if(Test-Path -LiteralPath $bundledNode -PathType Leaf){[IO.Path]::GetFullPath($bundledNode)}else{(Get-Command node.exe -ErrorAction Stop).Source}
  $identity=& $node $helper --certificate $CertificatePath --private-key $PrivateKeyPath|ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $identity.schema -cne 'sxsy-b122.tls-identity' -or $identity.version -ne 1 -or [string]$identity.certificateFileSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$identity.privateKeyFileSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$identity.tlsSpkiSha256 -cnotmatch '^[a-f0-9]{64}$' -or $identity.certificateAuthority -ne $false -or $identity.serverAuthentication -ne $true -or $identity.loopbackIdentity -ne $true -or $identity.validNow -ne $true -or $identity.privateKeyMatches -ne $true){throw 'The provider-host TLS identity could not be verified.'};return $identity
}

$output=Absolute $OutputPath 'OutputPath';$protectedRoot=Absolute $ProtectedStateRoot 'ProtectedStateRoot';$planPath=Absolute $BackendPlanPath 'BackendPlanPath'
$certificate=Absolute $CertificateFile 'CertificateFile';$privateKey=Absolute $PrivateKeyFile 'PrivateKeyFile';$tokenEnvelope=Absolute $AuthenticationTokenEnvelopeFile 'AuthenticationTokenEnvelopeFile';$journalEnvelope=Absolute $JournalAuthenticationEnvelopeFile 'JournalAuthenticationEnvelopeFile';$state=Absolute $StateFile 'StateFile'
$local=[Environment]::GetFolderPath('LocalApplicationData');if([string]::IsNullOrWhiteSpace($local)){throw 'Current-user LocalApplicationData is unavailable.'};$base=[IO.Path]::GetFullPath((Join-Path $local 'STRATHEX\switchyard\provider-host'))
if(-not(Inside $base $protectedRoot)){throw 'ProtectedStateRoot must remain beneath the dedicated current-user provider-host directory.'}
foreach($owned in @($output,$privateKey,$tokenEnvelope,$journalEnvelope,$state)){if(-not(Inside $protectedRoot $owned)){throw 'Provider-host configuration, secret, key, and state paths must remain beneath ProtectedStateRoot.'}}
if(-not(Test-Path -LiteralPath $protectedRoot -PathType Container)){throw 'ProtectedStateRoot must already exist with current-user-only ACLs.'}
Assert-RegularFile $planPath 'Backend plan';Assert-RegularFile $certificate 'TLS certificate';Assert-RegularFile $privateKey 'TLS private key';Assert-Envelope $tokenEnvelope 'Authentication token envelope';Assert-Envelope $journalEnvelope 'Journal authentication envelope'
Assert-ProtectedAcl @($protectedRoot,$privateKey,$tokenEnvelope,$journalEnvelope)
$tlsIdentity=Tls-Identity $certificate $privateKey
if($ListenHost -cnotin @('127.0.0.1','::1')){throw 'ListenHost must be one exact loopback address.'}

$plan=Get-Content -LiteralPath $planPath -Raw|ConvertFrom-Json
if(-not(Exact-Keys $plan @('schema','version','providers')) -or $plan.schema -cne 'sxsy-b122.provider-host-backend-plan' -or $plan.version -ne 1){throw 'The provider-host backend plan schema is invalid.'}
$entries=@($plan.providers);if($entries.Count -lt 1 -or $entries.Count -gt 2){throw 'The provider-host backend plan must contain one or two providers.'}
$providers=@();$seen=@{};$protectedFiles=New-Object Collections.Generic.List[string];$protectedFiles.Add($privateKey);$protectedFiles.Add($tokenEnvelope);$protectedFiles.Add($journalEnvelope)
foreach($entry in $entries){
  if($entry.provider -cnotin @('claude','codex') -or $entry.kind -cnotin @('fixture','module') -or $seen.ContainsKey([string]$entry.provider)){throw 'The provider-host backend plan has an invalid or duplicate provider.'};$seen[[string]$entry.provider]=$true
  if($entry.kind -ceq 'fixture'){
    if(-not(Exact-Keys $entry @('provider','kind')) -or -not $AllowFixtureBackends -or $ListenHost -cnotin @('127.0.0.1','::1')){throw 'Fixture providers require explicit diagnostic authorization and an exact loopback listener.'}
    $providers+=,[ordered]@{provider=[string]$entry.provider;kind='fixture'};continue
  }
  if(-not(Exact-Keys $entry @('provider','kind','modulePath','moduleSha256','credentialEnvelopeFile') @('options')) -or [string]$entry.moduleSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'A module provider plan must contain one exact pinned module and protected credential-envelope reference.'}
  $module=Absolute ([string]$entry.modulePath) 'Provider modulePath';$credential=Absolute ([string]$entry.credentialEnvelopeFile) 'Provider credentialEnvelopeFile'
  if(-not(Inside $protectedRoot $credential)){throw 'Provider credential envelopes must remain beneath ProtectedStateRoot.'};Assert-RegularFile $module 'Provider module';Assert-Envelope $credential 'Provider credential envelope';$protectedFiles.Add($credential)
  if((Sha $module) -cne [string]$entry.moduleSha256){throw 'The provider module does not match its reviewed SHA-256 pin.'}
  $options=[ordered]@{};if($null -ne $entry.options){foreach($property in @($entry.options.PSObject.Properties)){if($property.Name -notmatch '^[A-Za-z0-9_.-]{1,80}$' -or $property.Value -isnot [string] -or ([string]$property.Value).Length -gt 1024 -or [string]$property.Value -match '[\0\r\n]'){throw 'Provider module options are invalid.'};$options[$property.Name]=[string]$property.Value}}
  $provider=[ordered]@{provider=[string]$entry.provider;kind='module';modulePath=$module;moduleSha256=[string]$entry.moduleSha256;credentialEnvelopeFile=$credential};if($options.Count){$provider.options=$options};$providers+=,$provider
}
Assert-ProtectedAcl (@($protectedRoot)+@($protectedFiles))
$document=[ordered]@{
  schema='sxsy-b122.provider-host-config';version=1;protectedStateRoot=$protectedRoot;listen=[ordered]@{host=$ListenHost.ToLowerInvariant();port=$ListenPort}
  tls=[ordered]@{certificateFile=$certificate;privateKeyFile=$privateKey;certificateSha256=[string]$tlsIdentity.certificateFileSha256;privateKeySha256=[string]$tlsIdentity.privateKeyFileSha256;tlsSpkiSha256=[string]$tlsIdentity.tlsSpkiSha256}
  authenticationTokenEnvelopeFile=$tokenEnvelope;journalAuthenticationEnvelopeFile=$journalEnvelope;stateFile=$state;providers=$providers
}
if($AllowFixtureBackends){$document.allowFixtureBackends=$true}
$parent=Split-Path -Parent $output;if(-not(Inside $protectedRoot $parent)){throw 'The configuration parent escaped ProtectedStateRoot.'};New-Item -ItemType Directory -Force -Path $parent|Out-Null
if((Test-Path -LiteralPath $output) -and -not $Replace){throw 'The provider-host configuration already exists; use -Replace for an atomic rollback-preserving update.'}
$temporary=Join-Path $parent ('.provider-host-config-'+[guid]::NewGuid().ToString('N')+'.tmp');$backup=$output+'.previous'
try{[IO.File]::WriteAllText($temporary,($document|ConvertTo-Json -Depth 10),$utf8NoBom);if(Test-Path -LiteralPath $output){Copy-Item -LiteralPath $output -Destination $backup -Force};Move-Item -LiteralPath $temporary -Destination $output -Force}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
Assert-ProtectedAcl (@($protectedRoot,$output,$privateKey,$tokenEnvelope,$journalEnvelope)+@($protectedFiles))
[ordered]@{schema='sxsy-b122.provider-host-configuration-created';version=1;status='created';configurationPath=$output;configurationSha256=(Sha $output);protectedStateRoot=$protectedRoot;providerCount=$providers.Count;fixtureAuthorized=[bool]$AllowFixtureBackends;cleartextCredentialRead=$false;previousPreserved=(Test-Path -LiteralPath $backup -PathType Leaf)}|ConvertTo-Json -Compress
