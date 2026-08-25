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
  [string]$ProviderCredentialReference = 'b122-provider-token',
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
if ($OutputPath -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])') { throw 'OutputPath must be absolute.' }
if ($ProviderBaseUri -and ($ProviderBaseUri.Scheme -ne 'https' -or $ProviderBaseUri.UserInfo -or $ProviderBaseUri.Fragment -or $ProviderBaseUri.Query)) { throw 'ProviderBaseUri must be an exact HTTPS base without credentials, query, or fragment.' }
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
if ($ProviderBaseUri) {
  $providerCredential=@{reference=$ProviderCredentialReference;purpose='provider-api';header='authorization';prefix='Bearer '}
  $base=$ProviderBaseUri.AbsoluteUri.TrimEnd('/')
  $actions=@('reanchor','proof','proof_adversarial','option_provider','option_packet','plan_expander','plan_approval','handoff','handoff_queue','focus_blocked_agent','focus_finished_agent','authority_refresh','authority_broadcast','bind_voice_session')
  foreach ($action in $actions) { $routes += Route ("provider.$action") 'POST' ("$base/v1/b122/command/$action") @{'content-type'='application/json'} $providerCredential }
  foreach ($provider in @('claude','codex','generic','voice')) {
    $routes += Route ("provider.handshake.$provider") 'POST' ("$base/v1/b122/handshake/$provider") @{'content-type'='application/json'} $providerCredential
    $routes += Route ("provider.council.$provider") 'POST' ("$base/v1/b122/council/$provider") @{'content-type'='application/json'} $providerCredential
  }
  foreach ($action in @('compound_capture','compound_refresh','lfg','repair_mission')) { $routes += Route ("automation.$action") 'POST' ("$base/v1/b122/automation/$action") @{'content-type'='application/json'} $providerCredential }
}
$policy=[ordered]@{version=1;proxy='direct';routes=$routes}
$directory=Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath)); New-Item -ItemType Directory -Path $directory -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($policy | ConvertTo-Json -Depth 8), $utf8NoBom)
Write-Output "Wrote a secret-free exact-route policy for operator review: $OutputPath"
