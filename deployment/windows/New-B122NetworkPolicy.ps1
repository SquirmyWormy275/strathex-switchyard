[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubOwner,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubRepository,
  [ValidatePattern('^[A-Za-z0-9.-]+$')][string]$GitHubHost = 'github.com',
  [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubBaseOwner,
  [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubBaseRepository,
  [string]$GitHubApiCredentialReference = 'github-api-token',
  [string]$GitHubGitCredentialReference = 'github-git-basic',
  [ValidateRange(1048576,268435456)][int]$GitMaximumPushBytes = 67108864,
  [string[]]$GitHubActionsLogRedirectHosts = @(),
  [Uri]$ProviderBaseUri,
  [string]$ProviderConfigurationPath,
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ProviderTlsSpkiSha256,
  [string]$ProviderTlsCertificateFile,
  [string]$ProviderCredentialReference = 'b122-provider-token',
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
function Trace-Stage([string]$Stage){if($env:SXSY_PROVIDER_E2E_TRACE-ceq'1'){[Console]::Error.WriteLine("SXSY_PROVIDER_E2E_TRACE=network-$Stage")}}
Trace-Stage 'started'
if ($OutputPath -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])') { throw 'OutputPath must be absolute.' }
if($ProviderConfigurationPath -and $ProviderBaseUri){throw 'Use ProviderConfigurationPath or ProviderBaseUri, not both.'}
function Regular([string]$Path){if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $false};return ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0}
function Tls-Identity([string]$CertificatePath) {
  $helperCandidates=@((Join-Path $PSScriptRoot 'Get-B122TlsIdentity.mjs'),(Join-Path $PSScriptRoot '..\Get-B122TlsIdentity.mjs'))
  $helper=@($helperCandidates|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})[0]
  if(-not $helper){throw 'The provider-host TLS identity inspector is missing.'}
  $bundledNode=Join-Path $PSScriptRoot '..\runtime\node.exe';$node=if(Test-Path -LiteralPath $bundledNode -PathType Leaf){[IO.Path]::GetFullPath($bundledNode)}else{(Get-Command node.exe -ErrorAction Stop).Source}
  $identity=& $node $helper --certificate $CertificatePath|ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $identity.schema -cne 'sxsy-b122.tls-identity' -or $identity.version -ne 1 -or [string]$identity.tlsSpkiSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'The provider-host TLS identity could not be verified.'};return $identity
}
if($ProviderConfigurationPath){
  if($ProviderConfigurationPath -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])'){throw 'ProviderConfigurationPath must be absolute.'}
  $providerConfigPath=[IO.Path]::GetFullPath($ProviderConfigurationPath);if(-not(Regular $providerConfigPath)){throw 'ProviderConfigurationPath must be one regular non-reparse file.'}
  $providerValidatorCandidates=@((Join-Path $PSScriptRoot 'Test-B122ProviderHostConfiguration.ps1'),(Join-Path $PSScriptRoot 'provisioning\Test-B122ProviderHostConfiguration.ps1'))
  $providerValidator=@($providerValidatorCandidates|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})[0];if(-not $providerValidator){throw 'The provider-host configuration validator is missing.'}
  Trace-Stage 'configuration-validation-started'
  $providerValidation=& $providerValidator -ConfigurationPath $providerConfigPath|ConvertFrom-Json
  Trace-Stage 'configuration-validated'
  if($providerValidation.schema -cne 'sxsy-b122.provider-host-configuration-validation' -or $providerValidation.status -cne 'passed'){throw 'The provider-host configuration did not validate.'}
  $providerConfig=Get-Content -LiteralPath $providerConfigPath -Raw|ConvertFrom-Json
  if([string]$providerConfig.listen.host -cnotin @('127.0.0.1','::1')){throw 'An installed provider-host configuration must use an exact literal loopback listener.'}
  $providerHost=if([string]$providerConfig.listen.host -ceq '::1'){'[::1]'}else{'127.0.0.1'}
  $ProviderBaseUri=[Uri]("https://{0}:{1}" -f $providerHost,[int]$providerConfig.listen.port)
  $ProviderTlsSpkiSha256=[string]$providerConfig.tls.tlsSpkiSha256
  $ProviderTlsCertificateFile=[string]$providerConfig.tls.certificateFile
  Trace-Stage 'configuration-loaded'
}
if ($ProviderBaseUri -and ($ProviderBaseUri.Scheme -ne 'https' -or $ProviderBaseUri.UserInfo -or $ProviderBaseUri.Fragment -or $ProviderBaseUri.Query)) { throw 'ProviderBaseUri must be an exact HTTPS base without credentials, query, or fragment.' }
if(-not $ProviderBaseUri -and ($ProviderTlsSpkiSha256 -or $ProviderTlsCertificateFile)){throw 'Provider TLS identity values require one exact ProviderBaseUri or ProviderConfigurationPath.'}
$providerSecurity=$null
if($ProviderBaseUri){
  $providerHostName=$ProviderBaseUri.Host.ToLowerInvariant();$parsedIp=$null;$isIp=[Net.IPAddress]::TryParse($providerHostName,[ref]$parsedIp)
  $isLoopback=$providerHostName -cin @('127.0.0.1','::1')
  if($isIp -and -not $isLoopback){throw 'ProviderBaseUri cannot target an arbitrary private, reserved, or public IP literal; use an exact reviewed DNS host.'}
  if($isLoopback){
    Trace-Stage 'tls-validation-started'
    if($ProviderBaseUri.IsDefaultPort -or [string]$ProviderTlsSpkiSha256 -cnotmatch '^[a-f0-9]{64}$' -or -not $ProviderTlsCertificateFile){throw 'Loopback provider routes require an explicit non-default port, exact lower-case SPKI SHA-256 pin, and CA certificate.'}
    if($ProviderTlsCertificateFile -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])'){throw 'ProviderTlsCertificateFile must be absolute.'}
    $providerCertificate=[IO.Path]::GetFullPath($ProviderTlsCertificateFile);if(-not(Regular $providerCertificate)){throw 'ProviderTlsCertificateFile must be one regular non-reparse file.'}
    $certificateItem=Get-Item -LiteralPath $providerCertificate;if($certificateItem.Length -lt 1 -or $certificateItem.Length -gt 65536){throw 'ProviderTlsCertificateFile is empty or oversized.'}
    $identity=Tls-Identity $providerCertificate;if([string]$identity.tlsSpkiSha256 -cne $ProviderTlsSpkiSha256){throw 'The loopback provider certificate does not match ProviderTlsSpkiSha256.'}
    Trace-Stage 'tls-validated'
    # Windows PowerShell 5.1 decorates Get-Content strings with file-provider
    # properties. ConvertTo-Json recursively walks that provider graph, so read
    # the public certificate as one undecorated CLR string instead.
    $certificatePem=[IO.File]::ReadAllText($providerCertificate)
    if($certificatePem -cnotmatch '^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$'){throw 'ProviderTlsCertificateFile must contain a PEM certificate.'}
    $providerSecurity=[ordered]@{boundary='provider-host-loopback';tlsSpkiSha256=$ProviderTlsSpkiSha256;tlsCaCertificatePem=$certificatePem}
  }else{
    if($ProviderTlsCertificateFile){throw 'A public provider route cannot replace system TLS trust material.'}
    if($ProviderTlsSpkiSha256){$providerSecurity=[ordered]@{tlsSpkiSha256=$ProviderTlsSpkiSha256}}
  }
}
if ($GitHubHost.StartsWith('.') -or $GitHubHost.EndsWith('.') -or -not $GitHubHost.Contains('.') -or @($GitHubHost.Split('.') | Where-Object { $_ -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$' }).Count) { throw 'GitHubHost must be one exact canonical DNS host.' }
if ($GitHubActionsLogRedirectHosts.Count -gt 8 -or @($GitHubActionsLogRedirectHosts | Where-Object { $_.StartsWith('.') -or $_.EndsWith('.') -or -not $_.Contains('.') -or @($_.Split('.') | Where-Object { $_ -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$' }).Count }).Count -or @($GitHubActionsLogRedirectHosts | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique).Count -ne $GitHubActionsLogRedirectHosts.Count) { throw 'GitHubActionsLogRedirectHosts must contain no more than eight unique exact canonical DNS hosts.' }
if (-not $GitHubBaseOwner) { $GitHubBaseOwner = $GitHubOwner }
if (-not $GitHubBaseRepository) { $GitHubBaseRepository = $GitHubRepository }
function Route([string]$id,[string]$method,[string]$url,[hashtable]$headers,[hashtable]$credential,[int]$requestCap=262144,[int]$responseCap=524288) {
  $value=[ordered]@{ id=$id; method=$method; url=$url; redirects='deny'; timeoutMs=30000; maxRequestBytes=$requestCap; maxResponseBytes=$responseCap }
  if ($headers.Count) { $value.staticHeaders=$headers }
  if ($credential.Count) { $value.credential=$credential }
  return $value
}
function Provider-Route([string]$id,[string]$method,[string]$url,[hashtable]$headers,[hashtable]$credential,[int]$requestCap=262144,[int]$responseCap=524288) {
  $value=Route $id $method $url $headers $credential $requestCap $responseCap
  if($providerSecurity){foreach($key in $providerSecurity.Keys){$value[$key]=$providerSecurity[$key]}}
  return $value
}
$apiCredential=@{reference=$GitHubApiCredentialReference;purpose='github-api';header='authorization';prefix='Bearer '}
$gitCredential=@{reference=$GitHubGitCredentialReference;purpose='github-git';header='authorization';prefix='Basic '}
$graphqlUrl = if ($GitHubHost -ceq 'github.com') { 'https://api.github.com/graphql' } else { "https://$GitHubHost/api/graphql" }
$actionsLogUrl = if ($GitHubHost -ceq 'github.com') { "https://api.github.com/repos/$GitHubOwner/$GitHubRepository/actions/jobs/" } else { "https://$GitHubHost/api/v3/repos/$GitHubOwner/$GitHubRepository/actions/jobs/" }
$actionsLogRoute = Route 'github.actions-job-log' 'GET' $actionsLogUrl @{'accept'='application/vnd.github+json';'x-github-api-version'='2022-11-28';'user-agent'='SXSY-B122/1.0'} $apiCredential 1 8388608
$actionsLogRoute.pathParameter = [ordered]@{ name='jobId'; pattern='unsigned-decimal'; suffix='/logs' }
if ($GitHubActionsLogRedirectHosts.Count) {
  $actionsLogRoute.redirects = 'single-use-signed-download'
  $actionsLogRoute.redirectHosts = @($GitHubActionsLogRedirectHosts | ForEach-Object { $_.ToLowerInvariant() })
}
$routes=@(
  (Route 'github.graphql' 'POST' $graphqlUrl @{'content-type'='application/json';'accept'='application/vnd.github+json';'x-github-api-version'='2022-11-28';'user-agent'='SXSY-B122/1.0'} $apiCredential),
  $actionsLogRoute,
  (Route 'github.repository' 'HEAD' ("https://$GitHubHost/$GitHubBaseOwner/$GitHubBaseRepository") @{'accept'='application/vnd.github+json';'user-agent'='SXSY-B122/1.0'} $apiCredential 1 4096),
  (Route 'git.receive-pack.advertise' 'GET' ("https://$GitHubHost/$GitHubOwner/$GitHubRepository.git/info/refs?service=git-receive-pack") @{'accept'='application/x-git-receive-pack-advertisement';'user-agent'='SXSY-B122/1.0'} $gitCredential 1 4194304),
  (Route 'git.receive-pack' 'POST' ("https://$GitHubHost/$GitHubOwner/$GitHubRepository.git/git-receive-pack") @{'content-type'='application/x-git-receive-pack-request';'accept'='application/x-git-receive-pack-result';'user-agent'='SXSY-B122/1.0'} $gitCredential $GitMaximumPushBytes 4194304)
)
Trace-Stage 'base-routes-ready'
if ($ProviderBaseUri) {
  $providerCredential=@{reference=$ProviderCredentialReference;purpose='provider-api';header='authorization';prefix='Bearer '}
  $base=$ProviderBaseUri.AbsoluteUri.TrimEnd('/')
  $actions=@('reanchor','proof','proof_adversarial','option_provider','option_packet','plan_expander','plan_approval','handoff','handoff_queue','handoff_immediate','focus_blocked_agent','focus_finished_agent','authority_refresh','authority_broadcast','bind_voice_session')
  foreach ($action in $actions) { $routes += Provider-Route ("provider.$action") 'POST' ("$base/v1/b122/command/$action") @{'content-type'='application/json'} $providerCredential }
  Trace-Stage 'provider-actions-ready'
  foreach ($provider in @('claude','codex')) {
    $routes += Provider-Route ("provider.handshake.$provider") 'POST' ("$base/v1/b122/handshake/$provider") @{'content-type'='application/json'} $providerCredential
    $routes += Provider-Route ("provider.council.$provider") 'POST' ("$base/v1/b122/council/$provider") @{'content-type'='application/json'} $providerCredential
    $routes += Provider-Route ("provider.council-cleanup.$provider") 'POST' ("$base/v1/b122/council/cleanup/$provider") @{'content-type'='application/json'} $providerCredential
  }
  Trace-Stage 'provider-council-ready'
  foreach ($provider in @('claude','codex')) {
    $routes += Provider-Route ("provider.observe-session.$provider") 'POST' ("$base/v1/b122/observe/session/$provider") @{'content-type'='application/json'} $providerCredential
    $routes += Provider-Route ("provider.observe-operation.$provider") 'POST' ("$base/v1/b122/observe/operation/$provider") @{'content-type'='application/json'} $providerCredential
    $routes += Provider-Route ("provider.cancel.$provider") 'POST' ("$base/v1/b122/cancel/$provider") @{'content-type'='application/json'} $providerCredential
  }
  Trace-Stage 'provider-observation-ready'
  $routes += Provider-Route 'provider.health' 'GET' ("$base/v1/b122/health") @{} $providerCredential 1 65536
  $routes += Provider-Route 'provider.reconcile' 'POST' ("$base/v1/b122/reconcile") @{'content-type'='application/json'} $providerCredential 1024 65536
  Trace-Stage 'provider-health-ready'
  foreach ($action in @('compound_capture','compound_refresh','lfg','repair_mission')) { $routes += Provider-Route ("automation.$action") 'POST' ("$base/v1/b122/automation/$action") @{'content-type'='application/json'} $providerCredential }
  Trace-Stage 'provider-automation-ready'
}
$policy=[ordered]@{version=1;proxy='direct';routes=$routes}
Trace-Stage 'policy-ready'
$directory=Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath)); New-Item -ItemType Directory -Path $directory -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
Trace-Stage 'write-started'
function Assert-ExactDictionary([object]$Value,[string[]]$Allowed,[string[]]$Required,[string]$Label) {
  if($Value-isnot[Collections.IDictionary]){throw "$Label must be one exact dictionary."}
  $names=@($Value.Keys|ForEach-Object{[string]$_})
  if(@($names|Where-Object{$Allowed-cnotcontains$_}).Count-ne0-or@($Required|Where-Object{$names-cnotcontains$_}).Count-ne0){throw "$Label has an unsupported shape."}
}
function Assert-StringDictionary([object]$Value,[string]$Label) {
  if($Value-isnot[Collections.IDictionary]-or$Value.Count-gt32){throw "$Label must be one bounded string dictionary."}
  foreach($entry in $Value.GetEnumerator()){
    if($entry.Key-isnot[string]-or$entry.Value-isnot[string]-or[string]::IsNullOrWhiteSpace([string]$entry.Key)-or[string]$entry.Key -match '[\x00\r\n]' -or [string]$entry.Value -match '[\x00\r\n]'){throw "$Label contains an unsupported value."}
  }
}
function Assert-NetworkRoute([object]$RouteValue) {
  $allowed=@('id','method','url','redirects','timeoutMs','maxRequestBytes','maxResponseBytes','staticHeaders','credential','pathParameter','redirectHosts','boundary','tlsSpkiSha256','tlsCaCertificatePem')
  $required=@('id','method','url','redirects','timeoutMs','maxRequestBytes','maxResponseBytes')
  Assert-ExactDictionary $RouteValue $allowed $required 'Network route'
  foreach($name in @('id','method','url','redirects')){if($RouteValue[$name]-isnot[string]-or[string]$RouteValue[$name] -match '[\x00\r\n]'){throw "Network route $name must be one exact string."}}
  foreach($name in @('timeoutMs','maxRequestBytes','maxResponseBytes')){if($RouteValue[$name]-isnot[int]-or[int]$RouteValue[$name]-lt1-or[int64]$RouteValue[$name]-gt268435456){throw "Network route $name must be one bounded integer."}}
  if($RouteValue.Contains('staticHeaders')){Assert-StringDictionary $RouteValue['staticHeaders'] 'Network route staticHeaders'}
  if($RouteValue.Contains('credential')){
    Assert-ExactDictionary $RouteValue['credential'] @('reference','purpose','header','prefix') @('reference','purpose','header') 'Network route credential'
    foreach($name in @($RouteValue['credential'].Keys)){if($RouteValue['credential'][$name]-isnot[string]-or[string]$RouteValue['credential'][$name] -match '[\x00\r\n]'){throw 'Network route credential contains an unsupported value.'}}
  }
  if($RouteValue.Contains('pathParameter')){
    Assert-ExactDictionary $RouteValue['pathParameter'] @('name','pattern','suffix') @('name','pattern','suffix') 'Network route pathParameter'
    foreach($name in @('name','pattern','suffix')){if($RouteValue['pathParameter'][$name]-isnot[string]-or[string]$RouteValue['pathParameter'][$name] -match '[\x00\r\n]'){throw 'Network route pathParameter contains an unsupported value.'}}
  }
  if($RouteValue.Contains('redirectHosts')){
    $hosts=@($RouteValue['redirectHosts']);if($RouteValue['redirectHosts']-is[string]-or$hosts.Count-lt1-or$hosts.Count-gt8-or@($hosts|Where-Object{$_-isnot[string]-or[string]::IsNullOrWhiteSpace([string]$_)-or[string]$_ -match '[\x00\r\n]'}).Count-ne0){throw 'Network route redirectHosts must be one bounded string list.'}
  }
  foreach($name in @('boundary','tlsSpkiSha256','tlsCaCertificatePem')){if($RouteValue.Contains($name)-and($RouteValue[$name]-isnot[string]-or[string]$RouteValue[$name] -match '\x00')){throw "Network route $name must be one exact string."}}
  if($RouteValue.Contains('tlsCaCertificatePem')-and([string]$RouteValue['tlsCaCertificatePem']).Length-gt65536){throw 'Network route TLS certificate is oversized.'}
}
$routeDocuments=New-Object 'Collections.Generic.List[string]'
foreach($routeValue in @($policy.routes)){
  Assert-NetworkRoute $routeValue
  $routeDocument=ConvertTo-Json -InputObject $routeValue -Depth 6 -Compress
  if([string]::IsNullOrWhiteSpace($routeDocument)-or$routeDocument.Length-gt262144){throw "Serialized network route $($routeValue['id']) is empty or oversized ($($routeDocument.Length) bytes)."}
  $routeDocuments.Add($routeDocument)|Out-Null
}
$policyJson='{"version":1,"proxy":"direct","routes":['+($routeDocuments -join ',')+']}'
Trace-Stage 'json-ready'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $policyJson, $utf8NoBom)
Trace-Stage 'complete'
Write-Output "Wrote a secret-free exact-route policy for operator review: $OutputPath"
