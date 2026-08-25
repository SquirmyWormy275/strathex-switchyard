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
$config=Join-Path $root 'provider-host.json';$certificate=Join-Path $root 'loopback-certificate.pem';$privateKey=Join-Path $root 'loopback-private-key.pem';$tokenEnvelope=Join-Path $root 'authentication-token.envelope.json';$journalEnvelope=Join-Path $root 'journal-authentication.envelope.json';$backendPlan=Join-Path $root 'backend-plan.json';$state=Join-Path $root 'provider-state.jsonl';$networkPolicyPath=Join-Path $root 'network-policy.json';$provisioning=Join-Path $root 'companion-provisioning.json'
if((Test-Path -LiteralPath $config)-and-not$Replace){throw 'The provider-host instance is already configured; use -Replace for rollback-preserving rotation.'}
& $secretTool -Action GenerateAuthenticationToken -ProtectedStateRoot $root -EnvelopePath $tokenEnvelope -ConfirmCurrentUser -Replace:$Replace|Out-Null
if($LASTEXITCODE-ne0){throw 'The DPAPI provider-host authentication token could not be generated.'}
Trace-Stage 'authentication-token-ready'
if(Test-Path -LiteralPath $journalEnvelope -PathType Leaf){& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null}
else{& $secretTool -Action GenerateJournalAuthenticationKey -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null}
if($LASTEXITCODE-ne0){throw 'The stable DPAPI provider-host journal authentication key could not be established.'}
Trace-Stage 'journal-key-ready'
if(-not(Test-Path -LiteralPath $certificate)-and-not(Test-Path -LiteralPath $privateKey)){& $node $tlsTool --certificate $certificate --private-key $privateKey|Out-Null;if($LASTEXITCODE-ne0){throw 'The loopback TLS identity could not be generated.'}}
elseif(-not(Test-Path -LiteralPath $certificate)-or-not(Test-Path -LiteralPath $privateKey)){throw 'The provider-host TLS identity is incomplete and was not replaced.'}
Trace-Stage 'tls-identity-ready'
$utf8NoBom=New-Object Text.UTF8Encoding($false)
$plan=[ordered]@{schema='sxsy-b122.provider-host-backend-plan';version=1;providers=@([ordered]@{provider='claude';kind='fixture'},[ordered]@{provider='codex';kind='fixture'})}
[IO.File]::WriteAllText($backendPlan,($plan|ConvertTo-Json -Depth 5),$utf8NoBom)
& $configTool -OutputPath $config -ProtectedStateRoot $root -BackendPlanPath $backendPlan -CertificateFile $certificate -PrivateKeyFile $privateKey -AuthenticationTokenEnvelopeFile $tokenEnvelope -JournalAuthenticationEnvelopeFile $journalEnvelope -StateFile $state -ListenHost '127.0.0.1' -ListenPort $ListenPort -AllowFixtureBackends -Replace:$Replace|Out-Null
if($LASTEXITCODE-ne0){throw 'The provider-host configuration could not be generated.'}
Trace-Stage 'configuration-created'
Trace-Stage 'configuration-validation-started'
$validation=& $validateTool -ConfigurationPath $config|ConvertFrom-Json;if($validation.status-cne'passed'-or$validation.startReady-ne$true-or$validation.protectedAcl-ne$true){throw 'The generated provider-host configuration did not validate.'}
Trace-Stage 'configuration-validated'
Trace-Stage 'network-policy-started'
& $networkTool -GitHubOwner 'unconfigured' -GitHubRepository 'unconfigured' -ProviderConfigurationPath $config -OutputPath $networkPolicyPath|Out-Null
if($LASTEXITCODE-ne0){throw 'The exact provider-host network policy could not be generated.'}
Trace-Stage 'network-policy-ready'
$envelope=Get-Content -LiteralPath $tokenEnvelope -Raw|ConvertFrom-Json
$artifact=[ordered]@{
  schema='sxsy-b122.provider-host-companion-provisioning';version=1;reference='b122-provider-token';repositoryRoot=$repo
  purposes=@('provider-api');sealedSecret=[string]$envelope.sealed;protector='windows-dpapi-current-user';networkPolicyPath=$networkPolicyPath
  providerConfigurationPath=$config;tlsSpkiSha256=[string](Get-Content -LiteralPath $config -Raw|ConvertFrom-Json).tls.tlsSpkiSha256
}
[IO.File]::WriteAllText($provisioning,($artifact|ConvertTo-Json -Depth 6),$utf8NoBom)
Trace-Stage 'provisioning-ready'
& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $tokenEnvelope -ConfirmCurrentUser|Out-Null
& $secretTool -Action Validate -ProtectedStateRoot $root -EnvelopePath $journalEnvelope -ConfirmCurrentUser|Out-Null
Trace-Stage 'secrets-validated'
Trace-Stage 'complete'
[ordered]@{schema='sxsy-b122.provider-host-bootstrap';version=1;status='ready-to-provision';fixtureDiagnosticOnly=$true;providerEffectsEnabled=$false;protectedStateRoot=$root;configurationPath=$config;networkPolicyPath=$networkPolicyPath;companionProvisioningPath=$provisioning;journalAuthenticationStable=$true;authenticationTokenExposed=$false;proprietaryCredentialsAccessed=$false}|ConvertTo-Json -Compress
