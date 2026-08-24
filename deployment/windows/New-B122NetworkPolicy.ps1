[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubOwner,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$GitHubRepository,
  [string]$GitHubApiCredentialReference = 'github-api-token',
  [string]$GitHubGitCredentialReference = 'github-git-basic',
  [Uri]$ProviderBaseUri,
  [string]$ProviderCredentialReference = 'b122-provider-token',
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
if (-not [IO.Path]::IsPathFullyQualified($OutputPath)) { throw 'OutputPath must be absolute.' }
if ($ProviderBaseUri -and ($ProviderBaseUri.Scheme -ne 'https' -or $ProviderBaseUri.UserInfo -or $ProviderBaseUri.Fragment -or $ProviderBaseUri.Query)) { throw 'ProviderBaseUri must be an exact HTTPS base without credentials, query, or fragment.' }
function Route([string]$id,[string]$method,[string]$url,[hashtable]$headers,[hashtable]$credential,[int]$requestCap=262144,[int]$responseCap=524288) {
  $value=[ordered]@{ id=$id; method=$method; url=$url; redirects='deny'; timeoutMs=30000; maxRequestBytes=$requestCap; maxResponseBytes=$responseCap }
  if ($headers.Count) { $value.staticHeaders=$headers }
  if ($credential.Count) { $value.credential=$credential }
  return $value
}
$apiCredential=@{reference=$GitHubApiCredentialReference;purpose='github-api';header='authorization';prefix='Bearer '}
$gitCredential=@{reference=$GitHubGitCredentialReference;purpose='github-git';header='authorization';prefix='Basic '}
$routes=@(
  (Route 'github.graphql' 'POST' 'https://api.github.com/graphql' @{'content-type'='application/json';'accept'='application/vnd.github+json';'x-github-api-version'='2022-11-28';'user-agent'='SXSY-B122/1.0'} $apiCredential),
  (Route 'git.receive-pack.advertise' 'GET' ("https://github.com/$GitHubOwner/$GitHubRepository.git/info/refs?service=git-receive-pack") @{'accept'='application/x-git-receive-pack-advertisement';'user-agent'='SXSY-B122/1.0'} $gitCredential 1 4194304),
  (Route 'git.receive-pack' 'POST' ("https://github.com/$GitHubOwner/$GitHubRepository.git/git-receive-pack") @{'content-type'='application/x-git-receive-pack-request';'accept'='application/x-git-receive-pack-result';'user-agent'='SXSY-B122/1.0'} $gitCredential 4194304 4194304)
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
$policy | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ([IO.Path]::GetFullPath($OutputPath)) -Encoding utf8NoBOM
Write-Output "Wrote a secret-free exact-route policy for operator review: $OutputPath"
