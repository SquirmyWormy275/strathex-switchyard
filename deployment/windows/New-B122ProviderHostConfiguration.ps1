[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$ProtectedStateRoot,
  [Parameter(Mandatory=$true)][string]$BackendPlanPath,
  [Parameter(Mandatory=$true)][string]$CertificateFile,
  [Parameter(Mandatory=$true)][string]$PrivateKeyFile,
  [Parameter(Mandatory=$true)][string]$AuthenticationTokenEnvelopeFile,
  [Parameter(Mandatory=$true)][string]$JournalAuthenticationEnvelopeFile,
  [Parameter(Mandatory=$true)][string]$DispatchLeaseAuthenticationEnvelopeFile,
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
function Local-AppData(){if($env:SXSY_TEST_MODE-ceq'1'){$test=Absolute ([string]$env:SXSY_TEST_ROOT) 'SXSY_TEST_ROOT';$candidate=Absolute ([string]$env:LOCALAPPDATA) 'LOCALAPPDATA';$prefix=$test.TrimEnd('\')+'\';if(-not$candidate.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Test LocalAppData must be a strict child of SXSY_TEST_ROOT.'};return $candidate};$value=[Environment]::GetFolderPath('LocalApplicationData');if([string]::IsNullOrWhiteSpace($value)-or-not[IO.Path]::IsPathRooted($value)){throw 'Current-user LocalApplicationData is unavailable.'};return [IO.Path]::GetFullPath($value)}
function Assert-NoReparseSegments([string]$Candidate) {
  $cursor=[IO.Path]::GetFullPath($Candidate);$segments=New-Object Collections.Generic.List[string]
  while(-not[string]::IsNullOrWhiteSpace($cursor)){$segments.Add($cursor);$parent=Split-Path -Parent $cursor;if([string]::IsNullOrWhiteSpace($parent)-or$parent-ceq$cursor){break};$cursor=$parent}
  foreach($segment in @($segments|Sort-Object{$_.Length})){if(Test-Path -LiteralPath $segment){$item=Get-Item -LiteralPath $segment -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne0){throw 'Provider-host configuration paths cannot traverse a reparse point.'}}}
}
function Exact-Keys($Value,[string[]]$Required,[string[]]$Optional=@()) {$names=@($Value.PSObject.Properties.Name);$allowed=@($Required+$Optional);return @($Required|Where-Object{$_ -notin $names}).Count -eq 0 -and @($names|Where-Object{$_ -notin $allowed}).Count -eq 0}
function Assert-RegularFile([string]$Path,[string]$Label) {if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "$Label is missing."};$item=Get-Item -LiteralPath $Path -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "$Label cannot be a reparse point."}}
function Sha([string]$Path){$stream=[IO.File]::OpenRead($Path);$hasher=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose();$stream.Dispose()}}
function Sid([string]$Identity){return ([Security.Principal.NTAccount]$Identity).Translate([Security.Principal.SecurityIdentifier]).Value}
function Assert-ProtectedAcl([string[]]$Paths) {
  $current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($current,'S-1-5-18')
  foreach($path in $Paths){$acl=Get-Acl -LiteralPath $path;$owner=Sid ([string]$acl.Owner);if($owner -cne $current){throw 'Provider-host protected storage must be owned by the current Windows user.'};if($path -ceq $Paths[0] -and -not $acl.AreAccessRulesProtected){throw 'Provider-host protected root must disable inherited access.'};$hasCurrent=$false;foreach($rule in @($acl.Access)){if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue};$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($sid -notin $allowed){throw 'Provider-host protected storage grants access outside the current user and SYSTEM.'};if($sid -ceq $current){$hasCurrent=$true}};if(-not $hasCurrent){throw 'Provider-host protected storage lacks a current-user access rule.'}}
}
function Protect-OwnedFileAcl([string]$Path){
  $current=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid,$null);$security=Get-Acl -LiteralPath $Path;$owner=([Security.Principal.NTAccount]$security.Owner).Translate([Security.Principal.SecurityIdentifier]);if($owner.Value-cne$current.Value){$security.SetOwner($current)};$security.SetAccessRuleProtection($true,$false);foreach($rule in @($security.Access)){[void]$security.RemoveAccessRuleAll($rule)};foreach($sid in @($current,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow);[void]$security.AddAccessRule($rule)};$info=New-Object IO.FileInfo($Path);if('System.IO.FileSystemAclExtensions'-as[type]){[IO.FileSystemAclExtensions]::SetAccessControl($info,$security)}else{$info.SetAccessControl($security)}
}
function Assert-Envelope([string]$Path,[string]$Label){Assert-RegularFile $Path $Label;$value=Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json;if(-not(Exact-Keys $value @('schema','version','protector','sealed')) -or $value.schema -cne 'sxsy-b122.provider-host-secret-envelope' -or $value.version -ne 1 -or $value.protector -cne 'windows-dpapi-current-user' -or [string]$value.sealed -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or ([string]$value.sealed).Length -gt 32768){throw "$Label is not one DPAPI CurrentUser secret envelope."}}
function Assert-KeyRoleSeparation([string[]]$Paths) {
  Add-Type -AssemblyName System.Security|Out-Null;$keys=New-Object Collections.Generic.List[object]
  try{
    foreach($path in $Paths){$envelope=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json;$sealed=$null;$clear=$null;try{$sealed=[Convert]::FromBase64String([string]$envelope.sealed);$clear=[Security.Cryptography.ProtectedData]::Unprotect($sealed,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);if($clear.Length-ne64){throw 'A provider-host authentication key is not exactly 256 canonical bits.'};foreach($byte in $clear){if(-not(($byte-ge48-and$byte-le57)-or($byte-ge97-and$byte-le102))){throw 'A provider-host authentication key is not canonical lowercase hexadecimal.'}};$keys.Add([pscustomobject]@{Bytes=$clear});$clear=$null}finally{if($null-ne$sealed){[Array]::Clear($sealed,0,$sealed.Length)};if($null-ne$clear){[Array]::Clear($clear,0,$clear.Length)}}}
    for($leftIndex=0;$leftIndex-lt$keys.Count;$leftIndex++){for($rightIndex=$leftIndex+1;$rightIndex-lt$keys.Count;$rightIndex++){$left=[byte[]]$keys[$leftIndex].Bytes;$right=[byte[]]$keys[$rightIndex].Bytes;$difference=0;for($offset=0;$offset-lt64;$offset++){$difference=$difference-bor($left[$offset]-bxor$right[$offset])};if($difference-eq0){throw 'Provider-host bearer, journal, and dispatch-lease authentication keys must be cryptographically independent.'}}}
  }finally{foreach($entry in $keys){$bytes=[byte[]]$entry.Bytes;[Array]::Clear($bytes,0,$bytes.Length)}}
}
function Tls-Identity([string]$CertificatePath,[string]$PrivateKeyPath) {
  $helperCandidates=@((Join-Path $PSScriptRoot 'Get-B122TlsIdentity.mjs'),(Join-Path $PSScriptRoot '..\Get-B122TlsIdentity.mjs'))
  $helper=@($helperCandidates|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})[0];if(-not $helper){throw 'The provider-host TLS identity inspector is missing.'}
  $bundledNode=Join-Path $PSScriptRoot '..\..\runtime\node.exe';$node=if(Test-Path -LiteralPath $bundledNode -PathType Leaf){[IO.Path]::GetFullPath($bundledNode)}else{(Get-Command node.exe -ErrorAction Stop).Source}
  $identity=& $node $helper --certificate $CertificatePath --private-key $PrivateKeyPath|ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $identity.schema -cne 'sxsy-b122.tls-identity' -or $identity.version -ne 1 -or [string]$identity.certificateFileSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$identity.privateKeyFileSha256 -cnotmatch '^[a-f0-9]{64}$' -or [string]$identity.tlsSpkiSha256 -cnotmatch '^[a-f0-9]{64}$' -or $identity.certificateAuthority -ne $false -or $identity.serverAuthentication -ne $true -or $identity.loopbackIdentity -ne $true -or $identity.validNow -ne $true -or $identity.privateKeyMatches -ne $true){throw 'The provider-host TLS identity could not be verified.'};return $identity
}

$output=Absolute $OutputPath 'OutputPath';$protectedRoot=Absolute $ProtectedStateRoot 'ProtectedStateRoot';$planPath=Absolute $BackendPlanPath 'BackendPlanPath'
$certificate=Absolute $CertificateFile 'CertificateFile';$privateKey=Absolute $PrivateKeyFile 'PrivateKeyFile';$tokenEnvelope=Absolute $AuthenticationTokenEnvelopeFile 'AuthenticationTokenEnvelopeFile';$journalEnvelope=Absolute $JournalAuthenticationEnvelopeFile 'JournalAuthenticationEnvelopeFile';$dispatchLeaseEnvelope=Absolute $DispatchLeaseAuthenticationEnvelopeFile 'DispatchLeaseAuthenticationEnvelopeFile';$state=Absolute $StateFile 'StateFile'
$local=Local-AppData;$base=[IO.Path]::GetFullPath((Join-Path $local 'STRATHEX\switchyard\provider-host'))
if(-not(Inside $base $protectedRoot)){throw 'ProtectedStateRoot must remain beneath the dedicated current-user provider-host directory.'}
foreach($owned in @($output,$privateKey,$tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope,$state)){if(-not(Inside $protectedRoot $owned)){throw 'Provider-host configuration, secret, key, and state paths must remain beneath ProtectedStateRoot.'}}
if(-not(Test-Path -LiteralPath $protectedRoot -PathType Container)){throw 'ProtectedStateRoot must already exist with current-user-only ACLs.'}
foreach($candidate in @($base,$protectedRoot,$output,$planPath,$certificate,$privateKey,$tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope,$state)){Assert-NoReparseSegments $candidate}
Assert-RegularFile $planPath 'Backend plan';Assert-RegularFile $certificate 'TLS certificate';Assert-RegularFile $privateKey 'TLS private key';Assert-Envelope $tokenEnvelope 'Authentication token envelope';Assert-Envelope $journalEnvelope 'Journal authentication envelope';Assert-Envelope $dispatchLeaseEnvelope 'Dispatch-lease authentication envelope';Assert-KeyRoleSeparation @($tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope)
Assert-ProtectedAcl @($protectedRoot,$tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope);Protect-OwnedFileAcl $privateKey;Assert-ProtectedAcl @($protectedRoot,$privateKey,$tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope)
$tlsIdentity=Tls-Identity $certificate $privateKey
if($ListenHost -cnotin @('127.0.0.1','::1')){throw 'ListenHost must be one exact loopback address.'}

$plan=Get-Content -LiteralPath $planPath -Raw|ConvertFrom-Json
if(-not(Exact-Keys $plan @('schema','version','providers') @('effectDrivers')) -or $plan.schema -cne 'sxsy-b122.provider-host-backend-plan' -or $plan.version -ne 1){throw 'The provider-host backend plan schema is invalid.'}
$entries=@($plan.providers);if($entries.Count -lt 1 -or $entries.Count -gt 2){throw 'The provider-host backend plan must contain one or two providers.'}
$providers=@();$seen=@{};$providerModules=@{};$protectedFiles=New-Object Collections.Generic.List[string];$protectedFiles.Add($privateKey);$protectedFiles.Add($tokenEnvelope);$protectedFiles.Add($journalEnvelope);$protectedFiles.Add($dispatchLeaseEnvelope)
foreach($entry in $entries){
  if($entry.provider -cnotin @('claude','codex') -or $entry.kind -cnotin @('fixture','module') -or $seen.ContainsKey([string]$entry.provider)){throw 'The provider-host backend plan has an invalid or duplicate provider.'};$seen[[string]$entry.provider]=$true
  if($entry.kind -ceq 'fixture'){
    if(-not(Exact-Keys $entry @('provider','kind')) -or -not $AllowFixtureBackends -or $ListenHost -cnotin @('127.0.0.1','::1')){throw 'Fixture providers require explicit diagnostic authorization and an exact loopback listener.'}
    $providers+=,[ordered]@{provider=[string]$entry.provider;kind='fixture'};continue
  }
  if(-not(Exact-Keys $entry @('provider','kind','modulePath','moduleSha256','credentialEnvelopeFile') @('options')) -or [string]$entry.moduleSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'A module provider plan must contain one exact pinned module and protected credential-envelope reference.'}
  $module=Absolute ([string]$entry.modulePath) 'Provider modulePath';$credential=Absolute ([string]$entry.credentialEnvelopeFile) 'Provider credentialEnvelopeFile'
  Assert-NoReparseSegments $module;Assert-NoReparseSegments $credential
  if(-not(Inside $protectedRoot $credential)){throw 'Provider credential envelopes must remain beneath ProtectedStateRoot.'};Assert-RegularFile $module 'Provider module';Assert-Envelope $credential 'Provider credential envelope';$protectedFiles.Add($credential)
  if((Sha $module) -cne [string]$entry.moduleSha256){throw 'The provider module does not match its reviewed SHA-256 pin.'}
  $options=[ordered]@{};if(@($entry.PSObject.Properties.Name)-contains'options'){foreach($property in @($entry.options.PSObject.Properties)){if($property.Name -notmatch '^[A-Za-z0-9_.-]{1,80}$' -or $property.Value -isnot [string] -or ([string]$property.Value).Length -gt 1024 -or [string]$property.Value -match '[\0\r\n]'){throw 'Provider module options are invalid.'};$options[$property.Name]=[string]$property.Value}}
  $provider=[ordered]@{provider=[string]$entry.provider;kind='module';modulePath=$module;moduleSha256=[string]$entry.moduleSha256;credentialEnvelopeFile=$credential};if($options.Count){$provider.options=$options};$providers+=,$provider;$providerModules[[string]$entry.provider]=$provider
}
$driverEntries=@();if(@($plan.PSObject.Properties.Name)-contains'effectDrivers'){$driverEntries=@($plan.effectDrivers)};if($driverEntries.Count -gt 2){throw 'The provider-host backend plan contains too many host effect drivers.'}
$effectDrivers=@();$seenDrivers=@{}
foreach($entry in $driverEntries){
  if(-not(Exact-Keys $entry @('provider','kind','modulePath','moduleSha256')) -or $entry.provider -cnotin @('claude','codex') -or $entry.kind -cne 'module' -or $seenDrivers.ContainsKey([string]$entry.provider) -or [string]$entry.moduleSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'A host effect driver plan entry must contain one exact provider, module kind, canonical path, and SHA-256 pin.'}
  $seenDrivers[[string]$entry.provider]=$true;$provider=$providerModules[[string]$entry.provider]
  if($null-eq$provider){throw 'A host effect driver requires the exact configured module provider identity.'}
  $driverModule=Absolute ([string]$entry.modulePath) 'Host effect driver modulePath';Assert-NoReparseSegments $driverModule;Assert-RegularFile $driverModule 'Host effect driver module'
  if($driverModule-ceq[string]$provider.modulePath -or [string]$entry.moduleSha256-ceq[string]$provider.moduleSha256){throw 'The host effect driver must be independently selected and pinned from the provider runtime module.'}
  if((Sha $driverModule)-cne[string]$entry.moduleSha256){throw 'The host effect driver module does not match its reviewed SHA-256 pin.'}
  $effectDrivers+=,[ordered]@{provider=[string]$entry.provider;kind='module';modulePath=$driverModule;moduleSha256=[string]$entry.moduleSha256}
}
$effectDrivers=@($effectDrivers|Sort-Object{[string]$_.provider})
Assert-ProtectedAcl (@($protectedRoot)+@($protectedFiles))
$document=[ordered]@{
  schema='sxsy-b122.provider-host-config';version=1;protectedStateRoot=$protectedRoot;listen=[ordered]@{host=$ListenHost.ToLowerInvariant();port=$ListenPort}
  tls=[ordered]@{certificateFile=$certificate;privateKeyFile=$privateKey;certificateSha256=[string]$tlsIdentity.certificateFileSha256;privateKeySha256=[string]$tlsIdentity.privateKeyFileSha256;tlsSpkiSha256=[string]$tlsIdentity.tlsSpkiSha256}
  authenticationTokenEnvelopeFile=$tokenEnvelope;journalAuthenticationEnvelopeFile=$journalEnvelope;dispatchLeaseAuthenticationEnvelopeFile=$dispatchLeaseEnvelope;stateFile=$state;providers=$providers
}
if($AllowFixtureBackends){$document.allowFixtureBackends=$true}
if($effectDrivers.Count){$document.effectDrivers=$effectDrivers}
$parent=Split-Path -Parent $output;if(-not(Inside $protectedRoot $parent)){throw 'The configuration parent escaped ProtectedStateRoot.'};New-Item -ItemType Directory -Force -Path $parent|Out-Null
if((Test-Path -LiteralPath $output) -and -not $Replace){throw 'The provider-host configuration already exists; use -Replace for an atomic rollback-preserving update.'}
$temporary=Join-Path $parent ('.provider-host-config-'+[guid]::NewGuid().ToString('N')+'.tmp');$backup=$output+'.previous'
try{[IO.File]::WriteAllText($temporary,($document|ConvertTo-Json -Depth 10),$utf8NoBom);Protect-OwnedFileAcl $temporary;if(Test-Path -LiteralPath $output){Copy-Item -LiteralPath $output -Destination $backup -Force;Protect-OwnedFileAcl $backup};Move-Item -LiteralPath $temporary -Destination $output -Force;Protect-OwnedFileAcl $output}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
Assert-ProtectedAcl (@($protectedRoot,$output,$privateKey,$tokenEnvelope,$journalEnvelope,$dispatchLeaseEnvelope)+@($protectedFiles))
[ordered]@{schema='sxsy-b122.provider-host-configuration-created';version=1;status='created';configurationPath=$output;configurationSha256=(Sha $output);protectedStateRoot=$protectedRoot;providerCount=$providers.Count;effectDriverCount=$effectDrivers.Count;mediatedConfigurationPresent=($effectDrivers.Count-gt0);fixtureAuthorized=[bool]$AllowFixtureBackends;authenticationKeyRolesDistinct=$true;cleartextCredentialRead=$false;previousPreserved=(Test-Path -LiteralPath $backup -PathType Leaf)}|ConvertTo-Json -Compress
