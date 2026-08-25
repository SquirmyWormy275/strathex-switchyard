$ErrorActionPreference = 'Stop'
$build = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Build-B122Release.ps1') -Raw
$portable = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122PortableBundle.ps1') -Raw
$artifact = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Test-B122ReleaseArtifact.ps1') -Raw
$integritySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1') -Raw
$companionPackage = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\windows-companion\package.json') -Raw | ConvertFrom-Json

$requiredBuildTokens = @(
  'ProviderDesktopHelperPath',
  'ProviderDesktopHelperSha256',
  'provider-desktop-helper\Sxsy.B122.ProviderDesktopHelper.csproj',
  'sxsy-b122-provider-desktop-helper.exe',
  'providerDesktopHelperSha256',
  'New-B122ProviderDesktopPaths.ps1'
)
foreach ($token in $requiredBuildTokens) {
  if ($build.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release build is missing provider-desktop integration token: $token"
  }
}

foreach ($content in @($portable, $artifact)) {
  foreach ($token in @('provider-desktop', 'sxsy-b122-provider-desktop-helper.exe')) {
    if ($content.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
      throw "Release validation is missing provider-desktop integration token: $token"
    }
  }
}
if ($portable.IndexOf('sxsy-b122.provider-desktop-self-test', [StringComparison]::Ordinal) -lt 0) {
  throw 'Portable smoke does not validate the native provider-desktop self-test receipt.'
}
if ($artifact.IndexOf('providerDesktopHelperSha256', [StringComparison]::Ordinal) -lt 0) {
  throw 'Release provenance validation does not bind the provider-desktop helper digest.'
}
$hasProgramSource = $artifact.IndexOf('apps/windows-companion/provider-desktop-helper/Program.cs', [StringComparison]::Ordinal) -ge 0
$hasProjectSource = $artifact.IndexOf('apps/windows-companion/provider-desktop-helper/Sxsy.B122.ProviderDesktopHelper.csproj', [StringComparison]::Ordinal) -ge 0
if (-not $hasProgramSource -or -not $hasProjectSource) {
  throw 'The exact source archive validation omits the provider-desktop helper source.'
}

foreach ($token in @(
  'Get-B122ReleaseSourceCommit',
  'Assert-B122ReleaseSourceState',
  'archive --format=zip --output $sourceSnapshotArchive $sourceCommit',
  'Expand-Archive -LiteralPath $sourceSnapshotArchive -DestinationPath $buildRoot',
  "Invoke-B122PinnedNpm -Arguments @('ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline')",
  "Invoke-B122PinnedNpm -Arguments @('run','typecheck')",
  "Invoke-B122IsolatedCapture -Executable `$node.FullName -Arguments @(`$tscCli,'--version')",
  '& $node.FullName $npmCli.FullName @Arguments',
  "sourceAssembly='git-archive'",
  'verificationSkipped=$verificationSkipped',
  'evidenceEligible=$evidenceEligible',
  'package-qmk.ps1'
)) {
  if ($build.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release build is missing immutable-source/evidence token: $token"
  }
}
foreach ($token in @('--porcelain=v1', '--untracked-files=all', 'HEAD changed', 'worktree is not clean')) {
  if ($integritySource.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release source guard is missing state-rejection token: $token"
  }
}
if ([regex]::Matches($build, 'Assert-B122ReleaseSourceState').Count -lt 3) {
  throw 'Release build must check the pinned HEAD/worktree at entry and again around final validation.'
}
foreach ($token in @('AllowDevelopmentArtifact', 'verificationSkipped', 'evidenceEligible', 'development-only', 'firmware/b122/keymap.c', 'firmware/vial.json')) {
  if ($artifact.IndexOf($token, [StringComparison]::Ordinal) -lt 0) {
    throw "Release artifact validation is missing evidence/QMK token: $token"
  }
}
if ($companionPackage.b122Distribution.scope -cne 'javascript-companion-only' -or
    $companionPackage.b122Distribution.nativeHelpersIncluded -ne $false -or
    $companionPackage.b122Distribution.releaseEvidenceEligible -ne $false -or
    $companionPackage.b122Distribution.verifiedWindowsBundleBuilder -cne 'deployment/windows/Build-B122Release.ps1') {
  throw 'The npm package must explicitly identify itself as JavaScript-only and evidence-ineligible.'
}

$integrityModule = Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1'
Import-Module -Name $integrityModule -Force
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$testRepository = [IO.Path]::GetFullPath((Join-Path $temporaryBase ('sxsy-b122-release-integrity-' + [guid]::NewGuid().ToString('N'))))
$pinnedArchive = $testRepository + '-source.zip'
if (-not $testRepository.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe release-integrity test root.' }
function Invoke-TestGit([string[]]$Arguments) {
  & git.exe -C $testRepository -c core.excludesFile= @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Release-integrity fixture Git command failed: $($Arguments -join ' ')" }
}
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $_.Exception.Message -match $Pattern }
  if (-not $rejected) { throw "Release source guard did not reject: $Pattern" }
}
try {
  New-Item -ItemType Directory -Path $testRepository | Out-Null
  Invoke-TestGit @('init', '--initial-branch=main')
  Invoke-TestGit @('config', 'user.email', 'release-integrity@example.invalid')
  Invoke-TestGit @('config', 'user.name', 'Release Integrity Test')
  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "version one`n", (New-Object Text.UTF8Encoding($false)))
  Invoke-TestGit @('add', '--', 'payload.txt')
  Invoke-TestGit @('commit', '-m', 'fixture')
  $pinnedCommit = Get-B122ReleaseSourceCommit -RepositoryRoot $testRepository
  Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit | Out-Null
  & git.exe -C $testRepository -c core.excludesFile= archive --format=zip --output $pinnedArchive $pinnedCommit
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the pinned-commit fixture archive.' }

  [IO.File]::WriteAllText((Join-Path $testRepository 'untracked.txt'), "untracked`n", (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Remove-Item -LiteralPath (Join-Path $testRepository 'untracked.txt') -Force

  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "unstaged`n", (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Invoke-TestGit @('restore', '--', 'payload.txt')

  [IO.File]::WriteAllText((Join-Path $testRepository 'payload.txt'), "staged`n", (New-Object Text.UTF8Encoding($false)))
  Invoke-TestGit @('add', '--', 'payload.txt')
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'not clean'
  Invoke-TestGit @('commit', '-m', 'concurrent source change')
  Assert-Rejected { Assert-B122ReleaseSourceState -RepositoryRoot $testRepository -ExpectedCommit $pinnedCommit } 'HEAD changed'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($pinnedArchive)
  try {
    $entry = $archive.GetEntry('payload.txt')
    if ($null -eq $entry) { throw 'Pinned source archive omitted its reviewed payload.' }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $archivedPayload = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($archivedPayload.Trim() -cne 'version one') { throw 'Pinned source archive mixed in a later worktree or HEAD change.' }
  } finally { $archive.Dispose() }
} finally {
  if (Test-Path -LiteralPath $testRepository) { Remove-Item -LiteralPath $testRepository -Recurse -Force }
  if (Test-Path -LiteralPath $pinnedArchive) { Remove-Item -LiteralPath $pinnedArchive -Force }
}

$developmentBundle = [IO.Path]::GetFullPath((Join-Path $temporaryBase ('sxsy-b122-development-artifact-' + [guid]::NewGuid().ToString('N'))))
if (-not $developmentBundle.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe development-artifact test root.' }
try {
  $developmentScripts = Join-Path $developmentBundle 'scripts'
  New-Item -ItemType Directory -Path $developmentScripts | Out-Null
  foreach ($name in @('B122InstallTools.psm1','B122ReleaseIntegrity.psm1','Bootstrap-B122Install.ps1','Invoke-B122Current.ps1','Install-B122.ps1','Update-B122.ps1','Rollback-B122.ps1','Uninstall-B122.ps1','Manage-B122ProviderHost.ps1','Test-B122ProviderHostHealth.mjs')) {
    [IO.File]::WriteAllText((Join-Path $developmentScripts $name), '', (New-Object Text.UTF8Encoding($false)))
  }
  $developmentRelease = [ordered]@{
    schema='sxsy-b122.windows-release'; version=1; sourceCommit=('a' * 40); sourceAssembly='git-archive';
    companion='0.1.0'; providerAdapterHost='0.1.0'; providerHostLifecycle='configured-or-disabled'; vscodeExtension='0.1.0';
    verificationSkipped=$true; evidenceEligible=$false; hardwareAcceptance=$false; highConsequenceAcceptance=$false;
    nodeRuntime=[ordered]@{executableSha256=('1'*64);npmCliSha256=('2'*64);tscSha256=('3'*64);npmVersion='11.0.0';tscVersion='Version 5.8.0'};
    sandboxHelperSha256=('b' * 64); sandboxLifecycleHelperSha256=('a'*64); repositoryRuntimeHelperSha256=('c' * 64); companionLifecycleHelperSha256=('9'*64); rawHidHelperSha256=('d' * 64); providerDesktopHelperSha256=('e' * 64); voiceHelperSha256=('f' * 64)
  }
  [IO.File]::WriteAllText((Join-Path $developmentBundle 'release.json'), ($developmentRelease | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Assert-Rejected { & (Join-Path $PSScriptRoot 'Test-B122ReleaseArtifact.ps1') -BundleRoot $developmentBundle } 'ineligible for release evidence or installation'
} finally {
  if (Test-Path -LiteralPath $developmentBundle) { Remove-Item -LiteralPath $developmentBundle -Recurse -Force }
}

# Exercise the exact packaged provider bootstrap and lifecycle layout. The
# instance is a unique current-user DPAPI/ACL fixture beneath the production
# Known Folder boundary; no provider credential or non-loopback network is used.
$providerBundle = [IO.Path]::GetFullPath((Join-Path $temporaryBase ('sxsy-b122-provider-package-' + [guid]::NewGuid().ToString('N'))))
$instanceName = 'release-e2e-' + [guid]::NewGuid().ToString('N').Substring(0,20)
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$providerBase = [IO.Path]::GetFullPath((Join-Path $localAppData 'STRATHEX\switchyard\provider-host')).TrimEnd('\')
$providerState = [IO.Path]::GetFullPath((Join-Path $providerBase $instanceName))
if (-not $providerState.StartsWith($providerBase + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing an unsafe packaged provider fixture root.' }
$providerLifecycle = Join-Path $providerBundle 'scripts\Manage-B122ProviderHost.ps1'
$providerConfiguration = $null
$providerRunning = $false
$companionFixture = $null
$companionFixtureIdentity = $null
$companionFixtureConfiguration = $null
$providerFixturePowerShell=(Get-Command powershell.exe -ErrorAction Stop).Source
function Write-B122ProviderReleaseTrace([string]$Message){if($env:SXSY_B122_RELEASE_TRACE-ceq'1'){[Console]::Error.WriteLine("SXSY_B122_RELEASE_TRACE=$Message")}}
function ConvertTo-B122FixtureArgumentLine([string[]]$Arguments) {
  return (@($Arguments|ForEach-Object{$value=[string]$_;if($value.IndexOf([char]0)-ge0-or$value.Contains('"')-or$value-match'[\r\n]'){throw 'A packaged provider fixture argument is invalid.'};if($value-match'\s'){"`"$value`""}else{$value}})-join' ')
}
function Invoke-B122ProviderFixtureProcess([string]$Executable,[string[]]$Arguments,[hashtable]$Environment=@{},[int]$TimeoutSeconds=60){
  $start=New-Object Diagnostics.ProcessStartInfo;$start.FileName=$Executable;$start.Arguments=ConvertTo-B122FixtureArgumentLine $Arguments;$start.WorkingDirectory=$providerBundle;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  foreach($name in $Environment.Keys){$start.EnvironmentVariables[[string]$name]=[string]$Environment[$name]}
  $child=New-Object Diagnostics.Process;$child.StartInfo=$start;if(-not$child.Start()){throw "The packaged provider fixture command could not start: $Executable"}
  $stdoutTask=$child.StandardOutput.ReadToEndAsync();$stderrTask=$child.StandardError.ReadToEndAsync()
  if(-not$child.WaitForExit($TimeoutSeconds*1000)){
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID ([string]$child.Id) /T /F *> $null;$child.WaitForExit(10000)|Out-Null
    throw "The packaged provider fixture command exceeded its $TimeoutSeconds-second bound: $Executable"
  }
  $child.WaitForExit();$output=$stdoutTask.GetAwaiter().GetResult();$detail=$stderrTask.GetAwaiter().GetResult();$exitCode=$child.ExitCode
  if($exitCode-ne0){throw "The packaged provider fixture command failed ($exitCode): $Executable :: $detail"}
  return $output
}
function Invoke-B122ProviderFixturePowerShell([string]$Script,[string[]]$Arguments,[int]$TimeoutSeconds=60){
  return Invoke-B122ProviderFixtureProcess -Executable $providerFixturePowerShell -Arguments (@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$Script)+@($Arguments)) -TimeoutSeconds $TimeoutSeconds
}
function Get-B122FixtureProcessIdentity([Diagnostics.Process]$Process) {
  $record=Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $Process.Id) -ErrorAction Stop
  if($null-eq$record){throw 'The authenticated companion fixture exited before its identity could be captured.'}
  return [pscustomobject]@{processId=[int]$record.ProcessId;creationDate=([DateTime]$record.CreationDate).ToUniversalTime().ToString('o')}
}
function Test-B122FixtureProcessIdentityAlive([object]$Identity) {
  $record=Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$Identity.processId) -ErrorAction SilentlyContinue
  if($null-eq$record){return $false}
  $created=([DateTime]$record.CreationDate).ToUniversalTime().ToString('o')
  return $created-ceq[string]$Identity.creationDate
}
function Remove-B122ProviderFixtureTree([string]$Path) {
  $deadline=[DateTime]::UtcNow.AddSeconds(10);$last=$null
  do{
    try{if(Test-Path -LiteralPath $Path){Remove-Item -LiteralPath $Path -Recurse -Force};if(-not(Test-Path -LiteralPath $Path)){return}}catch{$last=$_}
    Start-Sleep -Milliseconds 200
  }while([DateTime]::UtcNow-lt$deadline)
  if($null-ne$last){throw $last};throw "The exact packaged provider fixture path survived cleanup: $Path"
}
$providerFixtureFailure=$null
try {
  Write-B122ProviderReleaseTrace 'fixture-copy-start'
  New-Item -ItemType Directory -Force -Path (Join-Path $providerBundle 'runtime'),(Join-Path $providerBundle 'provider-adapter-host'),(Join-Path $providerBundle 'scripts\provisioning'),(Join-Path $providerBundle 'app'),(Join-Path $providerBundle 'extension') | Out-Null
  Copy-Item -LiteralPath (Get-Command node.exe -ErrorAction Stop).Source -Destination (Join-Path $providerBundle 'runtime\node.exe')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\provider-adapter-host\dist') -Destination (Join-Path $providerBundle 'provider-adapter-host\dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\provider-adapter-host\package.json') -Destination (Join-Path $providerBundle 'provider-adapter-host\package.json')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\windows-companion\dist') -Destination (Join-Path $providerBundle 'app\dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\windows-companion\package.json') -Destination (Join-Path $providerBundle 'app\package.json')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\vscode-extension\dist') -Destination (Join-Path $providerBundle 'extension\dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\apps\vscode-extension\package.json') -Destination (Join-Path $providerBundle 'extension\package.json')
  foreach ($name in @('Manage-B122ProviderHost.ps1','Test-B122ProviderHostHealth.mjs','Test-B122Health.mjs','New-B122NetworkPolicy.ps1','Get-B122TlsIdentity.mjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $providerBundle 'scripts') }
  foreach ($name in @('Initialize-B122ProviderHost.ps1','Protect-B122ProviderHostSecret.ps1','New-B122LoopbackTlsIdentity.mjs','Get-B122TlsIdentity.mjs','Provision-B122ProviderHostCompanion.mjs','New-B122ProviderHostConfiguration.ps1','Test-B122ProviderHostConfiguration.ps1','Restore-B122ProviderHostConfiguration.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $providerBundle 'scripts\provisioning') }
  [IO.File]::WriteAllText((Join-Path $providerBundle 'release.json'),([ordered]@{schema='sxsy-b122.windows-release';version=1;sourceCommit=('a'*40)}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  Write-B122ProviderReleaseTrace 'fixture-copy-complete'
  $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0);$listener.Start();try{$listenPort=([Net.IPEndPoint]$listener.LocalEndpoint).Port}finally{$listener.Stop()}
  $initialize=Join-Path $providerBundle 'scripts\provisioning\Initialize-B122ProviderHost.ps1'
  $bootstrapRaw=Invoke-B122ProviderFixturePowerShell -Script $initialize -Arguments @('-RepositoryRoot',[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')),'-InstanceName',$instanceName,'-ListenPort',[string]$listenPort,'-BundleRoot',$providerBundle)
  Write-B122ProviderReleaseTrace 'initialize-complete'
  $bootstrap=$bootstrapRaw|Select-Object -Last 1|ConvertFrom-Json
  if($bootstrap.schema-cne'sxsy-b122.provider-host-bootstrap'-or$bootstrap.status-cne'ready-to-provision'-or$bootstrap.fixtureDiagnosticOnly-ne$true-or$bootstrap.authenticationTokenExposed-ne$false-or$bootstrap.proprietaryCredentialsAccessed-ne$false){throw 'The packaged provider bootstrap returned an invalid or unsafe receipt.'}
  $providerConfiguration=[IO.Path]::GetFullPath([string]$bootstrap.configurationPath)
  if(-not$providerConfiguration.StartsWith($providerState+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'The packaged provider bootstrap escaped its exact current-user instance.'}
  $fixtureLocalAppData=Join-Path $providerBundle 'current user data'
  $fixtureCompanionState=Join-Path $fixtureLocalAppData 'STRATHEX\switchyard'
  $fixtureReady=Join-Path $fixtureCompanionState 'release-fixture-ready.json'
  $fixtureSource=Join-Path $providerBundle 'fixture-companion.mjs'
  [IO.File]::WriteAllText($fixtureSource,@'
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuthenticatedPipeServer, createPipeConfiguration, savePipeConfiguration } from "./app/dist/apps/windows-companion/src/authenticated-pipe.js";
import { WindowsDpapiCurrentUserProtector } from "./app/dist/apps/windows-companion/src/windows-secret.js";

const stateDirectory = resolve(process.argv[2]);
const readyPath = resolve(process.argv[3]);
await mkdir(stateDirectory, { recursive: true });
const protector = new WindowsDpapiCurrentUserProtector();
const configuration = await createPipeConfiguration(stateDirectory, protector, `release-${process.pid}`);
const configurationPath = join(stateDirectory, "authenticated-pipe.json");
await savePipeConfiguration(configurationPath, configuration);
let server;
let stopping = false;
const handler = {
  async handle(request) {
    if (request.method === "credential.provision") {
      return { version: 1, id: request.id, ok: true, result: { credential: { reference: request.payload?.reference } } };
    }
    if (request.method === "network-policy.install") {
      return { version: 1, id: request.id, ok: true, result: { policy: { status: "active" } } };
    }
    if (request.method === "ping" && request.payload?.lifecycle === "shutdown") {
      if (!stopping) {
        stopping = true;
        setTimeout(async () => {
          try { await server.stop(); process.exitCode = 0; }
          catch { process.exitCode = 1; }
        }, 100);
      }
      return { version: 1, id: request.id, ok: true, result: { state: "stopping" } };
    }
    if (request.method === "ping") return { version: 1, id: request.id, ok: true, result: { state: "ready" } };
    return { version: 1, id: request.id, ok: false, error: { code: "invalid_request", message: "The release fixture rejected an unsupported method." } };
  }
};
server = new AuthenticatedPipeServer(configuration, protector, handler);
await server.start();
await writeFile(readyPath, JSON.stringify({ schema: "sxsy-b122.release-companion-fixture", version: 1, status: "ready", configurationPath }), { encoding: "utf8", mode: 0o600 });
'@,(New-Object Text.UTF8Encoding($false)))
  $fixtureStart=New-Object Diagnostics.ProcessStartInfo
  $fixtureStart.FileName=Join-Path $providerBundle 'runtime\node.exe'
  $fixtureStart.Arguments=ConvertTo-B122FixtureArgumentLine @($fixtureSource,$fixtureCompanionState,$fixtureReady)
  $fixtureStart.WorkingDirectory=$providerBundle;$fixtureStart.UseShellExecute=$false;$fixtureStart.CreateNoWindow=$true
  $fixtureStart.EnvironmentVariables['LOCALAPPDATA']=$fixtureLocalAppData
  $companionFixture=New-Object Diagnostics.Process;$companionFixture.StartInfo=$fixtureStart
  if(-not$companionFixture.Start()){throw 'The authenticated packaged companion fixture could not start.'}
  $fixtureDeadline=[DateTime]::UtcNow.AddSeconds(20)
  while(-not(Test-Path -LiteralPath $fixtureReady)){
    if($companionFixture.HasExited){throw "The authenticated packaged companion fixture exited during startup ($($companionFixture.ExitCode))."}
    if([DateTime]::UtcNow-ge$fixtureDeadline){throw 'The authenticated packaged companion fixture did not become ready within its bound.'}
    Start-Sleep -Milliseconds 100
  }
  $companionFixtureIdentity=Get-B122FixtureProcessIdentity $companionFixture
  $fixtureReceipt=Get-Content -LiteralPath $fixtureReady -Raw|ConvertFrom-Json
  $companionFixtureConfiguration=[IO.Path]::GetFullPath([string]$fixtureReceipt.configurationPath)
  if($fixtureReceipt.schema-cne'sxsy-b122.release-companion-fixture'-or$fixtureReceipt.status-cne'ready'-or$companionFixtureConfiguration-cne[IO.Path]::GetFullPath((Join-Path $fixtureCompanionState 'authenticated-pipe.json'))){throw 'The authenticated packaged companion fixture returned an invalid readiness receipt.'}
  $provisioningScript=Join-Path $providerBundle 'scripts\provisioning\Provision-B122ProviderHostCompanion.mjs'
  $provisioningRaw=Invoke-B122ProviderFixtureProcess -Executable (Join-Path $providerBundle 'runtime\node.exe') -Arguments @($provisioningScript,'--artifact',[string]$bootstrap.companionProvisioningPath,'--bundle-root',$providerBundle,'--configuration',$companionFixtureConfiguration) -Environment @{LOCALAPPDATA=$fixtureLocalAppData}
  $provisioningReceipt=$provisioningRaw|Select-Object -Last 1|ConvertFrom-Json
  if($provisioningReceipt.schema-cne'sxsy-b122.provider-host-companion-provisioning-receipt'-or$provisioningReceipt.status-cne'provisioned'-or$provisioningReceipt.authenticatedPipe-ne$true-or$provisioningReceipt.currentUserPresenceRequired-ne$true-or$provisioningReceipt.sealedSecretTransferred-ne$true-or$provisioningReceipt.cleartextSecretRead-ne$false){throw 'The packaged provider companion provisioning receipt is invalid.'}
  Write-B122ProviderReleaseTrace 'companion-provisioning-complete'
  $shutdownRaw=Invoke-B122ProviderFixtureProcess -Executable (Join-Path $providerBundle 'runtime\node.exe') -Arguments @((Join-Path $providerBundle 'scripts\Test-B122Health.mjs'),'--shutdown','--configuration',$companionFixtureConfiguration) -Environment @{LOCALAPPDATA=$fixtureLocalAppData}
  $shutdownReceipt=$shutdownRaw|Select-Object -Last 1|ConvertFrom-Json
  if($shutdownReceipt.schema-cne'sxsy-b122.install-shutdown'-or$shutdownReceipt.status-cne'stopping'){throw 'The packaged companion did not acknowledge authenticated graceful shutdown.'}
  if(-not$companionFixture.WaitForExit(10000)){throw 'The packaged companion survived its graceful-shutdown bound.'}
  if($companionFixture.ExitCode-ne0-or(Test-B122FixtureProcessIdentityAlive $companionFixtureIdentity)){throw 'The packaged companion did not prove zero survivors after graceful shutdown.'}
  $companionFixture=$null
  Write-B122ProviderReleaseTrace 'companion-shutdown-complete'
  $startedRaw=Invoke-B122ProviderFixturePowerShell -Script $providerLifecycle -Arguments @('-Action','Start','-BundleRoot',$providerBundle,'-ConfigurationPath',$providerConfiguration,'-WaitForHealth')
  Write-B122ProviderReleaseTrace 'managed-start-complete'
  $started=$startedRaw|Select-Object -Last 1|ConvertFrom-Json
  if($started.schema-cne'sxsy-b122.provider-host-lifecycle'-or$started.status-cne'running'-or$started.authenticated-ne$true-or$started.tlsIdentityPinned-ne$true-or[int]$started.processId-lt1){throw 'The packaged provider host did not establish authenticated pinned-TLS health.'}
  $providerRunning=$true
  $healthRaw=Invoke-B122ProviderFixturePowerShell -Script $providerLifecycle -Arguments @('-Action','Health','-BundleRoot',$providerBundle,'-ConfigurationPath',$providerConfiguration)
  Write-B122ProviderReleaseTrace 'managed-health-complete'
  $healthReceipt=$healthRaw|Select-Object -Last 1|ConvertFrom-Json
  if($healthReceipt.schema-cne'sxsy-b122.provider-host-health-check'-or$healthReceipt.status-cne'passed'-or$healthReceipt.authenticated-ne$true-or$healthReceipt.tlsIdentityPinned-ne$true){throw 'The packaged provider lifecycle health receipt is invalid.'}
  $stoppedRaw=Invoke-B122ProviderFixturePowerShell -Script $providerLifecycle -Arguments @('-Action','Stop','-BundleRoot',$providerBundle,'-ConfigurationPath',$providerConfiguration)
  Write-B122ProviderReleaseTrace 'managed-stop-complete'
  $stopped=$stoppedRaw|Select-Object -Last 1|ConvertFrom-Json;$providerRunning=$false
  if($stopped.status-cne'stopped'-or[int]$stopped.survivorCount-ne0-or@($stopped.processes).Count-ne1-or$stopped.processes[0].gracefulShutdownAcknowledged-ne$true-or@($stopped.processes[0].treeSurvivors).Count-ne0){throw 'The packaged provider lifecycle did not prove graceful no-survivor shutdown.'}
} catch {
  $providerFixtureFailure=$_
} finally {
  Write-B122ProviderReleaseTrace 'cleanup-start'
  $cleanupErrors=New-Object Collections.Generic.List[string]
  if($providerConfiguration){try{Invoke-B122ProviderFixturePowerShell -Script $providerLifecycle -Arguments @('-Action','Stop','-BundleRoot',$providerBundle,'-ConfigurationPath',$providerConfiguration)|Out-Null}catch{$cleanupErrors.Add("provider stop: $($_.Exception.Message)")}}
  if($null -ne $companionFixture -and -not $companionFixture.HasExited){try{& (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID ([string]$companionFixture.Id) /T /F *> $null;$companionFixture.WaitForExit(10000)|Out-Null;if(-not$companionFixture.HasExited){throw 'exact companion fixture survived taskkill'}}catch{$cleanupErrors.Add("companion stop: $($_.Exception.Message)")}}
  try{Remove-B122ProviderFixtureTree $providerBundle}catch{$cleanupErrors.Add("bundle cleanup: $($_.Exception.Message)")}
  try{Remove-B122ProviderFixtureTree $providerState}catch{$cleanupErrors.Add("state cleanup: $($_.Exception.Message)")}
  Write-B122ProviderReleaseTrace 'cleanup-complete'
  if($cleanupErrors.Count){$primaryDetail=if($null-eq$providerFixtureFailure){''}else{" Primary failure: $($providerFixtureFailure.Exception.Message)."};throw "The packaged provider fixture cleanup was incomplete.$primaryDetail Cleanup errors: $($cleanupErrors -join '; ')"}
}
if($null-ne$providerFixtureFailure){throw $providerFixtureFailure}

[ordered]@{
  schema = 'sxsy-b122.provider-desktop-release-test'
  version = 1
  status = 'passed'
  helperPackaged = $true
  selfTestRequired = $true
  provenanceBound = $true
  sourceIncluded = $true
  immutableCommitArchive = $true
  laterSourceChangeExcluded = $true
  dirtyStateRejected = $true
  concurrentHeadChangeRejected = $true
  skippedVerificationEvidenceRejected = $true
  qmkOverlayPackaged = $true
  npmScopeDeclared = $true
  packagedProviderInitialize = $true
  packagedProviderCompanionProvisioning = $true
  packagedProviderAuthenticatedCompanionPipe = $true
  packagedProviderCompanionGracefulShutdown = $true
  packagedProviderCompanionProcessSurvivors = 0
  packagedProviderDpapiCurrentUser = $true
  packagedProviderPinnedTlsHealth = $true
  packagedProviderGracefulShutdown = $true
  packagedProviderProcessTreeSurvivors = 0
} | ConvertTo-Json -Compress
