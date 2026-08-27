[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RepositoryRoot,
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$')][string]$InstanceName='default',
  [ValidateRange(1024,65535)][int]$ListenPort=4747,
  [string]$BundleRoot,
  [switch]$Replace
)
$ErrorActionPreference='Stop'
function Trace-Stage([string]$Stage){if($env:SXSY_PROVIDER_E2E_TRACE-ceq'1'){[Console]::Error.WriteLine("SXSY_PROVIDER_E2E_TRACE=initialize-$Stage")}}
$repo=[IO.Path]::GetFullPath($RepositoryRoot);if(-not(Test-Path -LiteralPath $repo -PathType Container)){throw 'RepositoryRoot must be one existing absolute directory.'}
$bundle=if($BundleRoot){[IO.Path]::GetFullPath($BundleRoot)}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))}
$node=if(Test-Path -LiteralPath (Join-Path $bundle 'runtime\node.exe') -PathType Leaf){Join-Path $bundle 'runtime\node.exe'}else{(Get-Command node.exe -ErrorAction Stop).Source}
function Tool([string]$Name){$paths=@((Join-Path $bundle "scripts\$Name"),(Join-Path $bundle "scripts\provisioning\$Name"),(Join-Path $PSScriptRoot $Name));$tool=@($paths|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})[0];if(-not$tool){throw "Required provider-host bootstrap tool is missing: $Name"};return [IO.Path]::GetFullPath($tool)}
$secretTool=Tool 'Protect-B122ProviderHostSecret.ps1';$tlsTool=Tool 'New-B122LoopbackTlsIdentity.mjs';$configTool=Tool 'New-B122ProviderHostConfiguration.ps1';$validateTool=Tool 'Test-B122ProviderHostConfiguration.ps1';$networkTool=Tool 'New-B122NetworkPolicy.ps1'
Trace-Stage 'tools-resolved'
$local=[Environment]::GetFolderPath('LocalApplicationData');if([string]::IsNullOrWhiteSpace($local)){throw 'Current-user LocalApplicationData is unavailable.'}
$providerBaseRoot=[IO.Path]::GetFullPath((Join-Path $local 'STRATHEX\switchyard\provider-host'));$root=if($InstanceName -ceq 'default'){$providerBaseRoot}else{[IO.Path]::GetFullPath((Join-Path $providerBaseRoot $InstanceName))}
$config=Join-Path $root 'provider-host.json';$certificate=Join-Path $root 'loopback-certificate.pem';$privateKey=Join-Path $root 'loopback-private-key.pem';$tokenEnvelope=Join-Path $root 'authentication-token.envelope.json';$journalEnvelope=Join-Path $root 'journal-authentication.envelope.json';$dispatchLeaseEnvelope=Join-Path $root 'dispatch-lease-authentication.envelope.json';$backendPlan=Join-Path $root 'backend-plan.json';$state=Join-Path $root 'provider-state.jsonl';$networkPolicyPath=Join-Path $root 'network-policy.json';$provisioning=Join-Path $root 'companion-provisioning.json'
$priorProfile=$null;if(Test-Path -LiteralPath $provisioning -PathType Leaf){$priorArtifact=Get-Content -LiteralPath $provisioning -Raw|ConvertFrom-Json;if($priorArtifact.schema-ceq'sxsy-b122.provider-host-companion-provisioning'-and$priorArtifact.version-eq2){$candidate=$priorArtifact.profile;$generation=0;if($candidate.schema-cne'sxsy-b122.provider-host-dispatch-profile'-or$candidate.version-ne1-or-not[int]::TryParse([string]$candidate.generation,[ref]$generation)-or$generation-lt1-or[string]$candidate.configurationSha256-cnotmatch'^[a-f0-9]{64}$'-or[string]$candidate.profileDigest-cnotmatch'^[a-f0-9]{64}$'){throw 'The prior provider-host profile generation is malformed.'};$priorProfile=$candidate}elseif($priorArtifact.schema-cne'sxsy-b122.provider-host-companion-provisioning'-or$priorArtifact.version-ne1){throw 'The prior provider-host companion provisioning artifact is malformed.'}}
if((Test-Path -LiteralPath $config)-and-not$Replace){throw 'The provider-host instance is already configured; use -Replace for rollback-preserving rotation.'}
& $secretTool -Action GenerateAuthenticationToken -ProtectedStateRoot $root -EnvelopePath $tokenEnvelope -ConfirmCurrentUser -Replace:$Replace|Out-Null
Trace-Stage 'authentication-token-ready'
if(Test-Path -LiteralPath $journalEnvelope -PathType Leaf){& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null}
else{& $secretTool -Action GenerateJournalAuthenticationKey -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null}
Trace-Stage 'journal-key-ready'
if(Test-Path -LiteralPath $dispatchLeaseEnvelope -PathType Leaf){& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $dispatchLeaseEnvelope -ConfirmCurrentUser|Out-Null}
else{& $secretTool -Action GenerateDispatchLeaseAuthenticationKey -ProtectedStateRoot $root -EnvelopePath $dispatchLeaseEnvelope -ConfirmCurrentUser|Out-Null}
Trace-Stage 'dispatch-lease-key-ready'
if(-not(Test-Path -LiteralPath $certificate)-and-not(Test-Path -LiteralPath $privateKey)){& $node $tlsTool --certificate $certificate --private-key $privateKey|Out-Null;if($LASTEXITCODE-ne0){throw 'The loopback TLS identity could not be generated.'}}
elseif(-not(Test-Path -LiteralPath $certificate)-or-not(Test-Path -LiteralPath $privateKey)){throw 'The provider-host TLS identity is incomplete and was not replaced.'}
Trace-Stage 'tls-identity-ready'
$utf8NoBom=New-Object Text.UTF8Encoding($false)
$plan=[ordered]@{schema='sxsy-b122.provider-host-backend-plan';version=1;providers=@([ordered]@{provider='claude';kind='fixture'},[ordered]@{provider='codex';kind='fixture'})}
[IO.File]::WriteAllText($backendPlan,($plan|ConvertTo-Json -Depth 5),$utf8NoBom)
& $configTool -OutputPath $config -ProtectedStateRoot $root -BackendPlanPath $backendPlan -CertificateFile $certificate -PrivateKeyFile $privateKey -AuthenticationTokenEnvelopeFile $tokenEnvelope -JournalAuthenticationEnvelopeFile $journalEnvelope -DispatchLeaseAuthenticationEnvelopeFile $dispatchLeaseEnvelope -StateFile $state -ListenHost '127.0.0.1' -ListenPort $ListenPort -AllowFixtureBackends -Replace:$Replace|Out-Null
if($LASTEXITCODE-ne0){throw 'The provider-host configuration could not be generated.'}
Trace-Stage 'configuration-created'
Trace-Stage 'configuration-validation-started'
$validation=& $validateTool -ConfigurationPath $config|ConvertFrom-Json;if($validation.status-cne'passed'-or$validation.startReady-ne$true-or$validation.protectedAcl-ne$true){throw 'The generated provider-host configuration did not validate.'}
Trace-Stage 'configuration-validated'
Trace-Stage 'network-policy-started'
function Sha-Text([string]$Value){$bytes=[Text.Encoding]::UTF8.GetBytes($Value);$hasher=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{[Array]::Clear($bytes,0,$bytes.Length);$hasher.Dispose()}}
$canonicalRepoIdentity=$repo.Replace('/','\').TrimEnd('\').ToLowerInvariant();$referenceDigest=Sha-Text ($canonicalRepoIdentity+[char]0+[string]$validation.configurationSha256);$bearerReference="b122-provider-bearer-$referenceDigest";$dispatchLeaseReference="b122-provider-dispatch-lease-$referenceDigest"
& $networkTool -GitHubOwner 'unconfigured' -GitHubRepository 'unconfigured' -ProviderConfigurationPath $config -ProviderCredentialReference $bearerReference -OutputPath $networkPolicyPath|Out-Null
if($LASTEXITCODE-ne0){throw 'The exact provider-host network policy could not be generated.'}
Trace-Stage 'network-policy-ready'
$envelope=Get-Content -LiteralPath $tokenEnvelope -Raw|ConvertFrom-Json;$dispatchEnvelope=Get-Content -LiteralPath $dispatchLeaseEnvelope -Raw|ConvertFrom-Json;$configuration=Get-Content -LiteralPath $config -Raw|ConvertFrom-Json
$profileProviders=@();foreach($provider in @($configuration.providers)){$adapterId=if($provider.kind-ceq'fixture'){"sxsy-b122.fixture.$([string]$provider.provider)"}else{"sxsy-b122.module.$([string]$provider.provider)"};$moduleSha=if($provider.kind-ceq'fixture'){Sha-Text "$adapterId.v1"}else{[string]$provider.moduleSha256};$profileProviders+=,[ordered]@{provider=[string]$provider.provider;adapterId=$adapterId;moduleSha256=$moduleSha}}
$profileProviders=@($profileProviders|Sort-Object{[string]$_.provider});$nul=[char]0;$providerMaterial='';foreach($provider in $profileProviders){$providerMaterial+=[string]$provider.provider+$nul+[string]$provider.adapterId+$nul+[string]$provider.moduleSha256+$nul};$canonicalConfigIdentity=$config.Replace('/','\').TrimEnd('\').ToLowerInvariant();$profileMaterial='sxsy-b122.provider-host-dispatch-profile'+$nul+'v1'+$nul+$canonicalRepoIdentity+$nul+$canonicalConfigIdentity+$nul+[string]$validation.configurationSha256+$nul+[string]$configuration.tls.tlsSpkiSha256+$nul+$bearerReference+$nul+$dispatchLeaseReference+$nul+$providerMaterial;$profileDigest=Sha-Text $profileMaterial
$profileGeneration=1;$expectedPriorConfigurationSha256=$null;$expectedPriorProfileDigest=$null;if($null-ne$priorProfile){if([string]$priorProfile.profileDigest-ceq$profileDigest){$profileGeneration=[int]$priorProfile.generation;$expectedPriorConfigurationSha256=$priorProfile.expectedPriorConfigurationSha256;$expectedPriorProfileDigest=$priorProfile.expectedPriorProfileDigest}else{$profileGeneration=[int]$priorProfile.generation+1;$expectedPriorConfigurationSha256=[string]$priorProfile.configurationSha256;$expectedPriorProfileDigest=[string]$priorProfile.profileDigest}}
$artifact=[ordered]@{
  schema='sxsy-b122.provider-host-companion-provisioning';version=2
  credentials=@(
    [ordered]@{role='bearer';reference=$bearerReference;scopes=@([ordered]@{repositoryRoot=$repo;adapterId='configured-network';purpose='provider-api'});sealedSecret=[string]$envelope.sealed;protector='windows-dpapi-current-user'},
    [ordered]@{role='dispatch-lease';reference=$dispatchLeaseReference;scopes=@([ordered]@{repositoryRoot=$repo;adapterId='provider-dispatch-lease-issuer';purpose='provider-dispatch-lease'});sealedSecret=[string]$dispatchEnvelope.sealed;protector='windows-dpapi-current-user'}
  )
  networkPolicyPath=$networkPolicyPath
  profile=[ordered]@{schema='sxsy-b122.provider-host-dispatch-profile';version=1;generation=$profileGeneration;expectedPriorConfigurationSha256=$expectedPriorConfigurationSha256;expectedPriorProfileDigest=$expectedPriorProfileDigest;repositoryRoot=$repo;configurationPath=$config;configurationSha256=[string]$validation.configurationSha256;tlsSpkiSha256=[string]$configuration.tls.tlsSpkiSha256;bearerCredentialReference=$bearerReference;dispatchLeaseCredentialReference=$dispatchLeaseReference;profileDigest=$profileDigest;providers=$profileProviders}
}
[IO.File]::WriteAllText($provisioning,($artifact|ConvertTo-Json -Depth 6),$utf8NoBom)
Trace-Stage 'provisioning-ready'
& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $tokenEnvelope -ConfirmCurrentUser|Out-Null
& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null
& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $dispatchLeaseEnvelope -ConfirmCurrentUser|Out-Null
Trace-Stage 'secrets-validated'
Trace-Stage 'complete'
[ordered]@{schema='sxsy-b122.provider-host-bootstrap';version=1;status='ready-to-provision';fixtureDiagnosticOnly=$true;providerEffectsEnabled=$false;protectedStateRoot=$root;configurationPath=$config;networkPolicyPath=$networkPolicyPath;companionProvisioningPath=$provisioning;journalAuthenticationStable=$true;dispatchLeaseAuthenticationStable=$true;authenticationTokenExposed=$false;dispatchLeaseKeyExposed=$false;proprietaryCredentialsAccessed=$false}|ConvertTo-Json -Compress
