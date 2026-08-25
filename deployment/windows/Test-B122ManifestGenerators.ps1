[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "sxsy-b122-generator-test-$([Guid]::NewGuid().ToString('N'))"
$repository = Join-Path $testRoot 'repository'
$tools = Join-Path $repository 'tools'
$output = Join-Path $repository '.b122'

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "ASSERTION FAILED: $Message" } }
function Write-Json([string]$Path, $Value) { $utf8 = New-Object Text.UTF8Encoding -ArgumentList (,$false); [IO.File]::WriteAllText($Path, "$(($Value | ConvertTo-Json -Depth 32 -Compress))`n", $utf8) }
function Test-FullyQualified([string]$Path) { return $Path -match '^[A-Za-z]:[\\/]' }

try {
    [IO.Directory]::CreateDirectory($tools) | Out-Null
    [IO.Directory]::CreateDirectory($output) | Out-Null
    $sourceExecutable = 'C:\Windows\System32\where.exe'
    if (-not [IO.File]::Exists($sourceExecutable)) { throw 'The fixed inbox where.exe test fixture is unavailable.' }
    $executable = Join-Path $tools 'fixed-runner.exe'
    [IO.File]::Copy($sourceExecutable, $executable, $false)

    $runtimePlanPath = Join-Path $repository 'runtime-plan.json'
    $runtimePlan = [ordered]@{
        schema = 'sxsy-b122.repository-runtime-plan'; version = 1; allowedHttpsUrls = @()
        recipes = [ordered]@{
            run_target = [ordered]@{ executable = $executable; args = @('fixed'); cwd = '.'; environment = [ordered]@{ B122_MODE = 'test' }; lifecycle = 'managed'; isolation = 'repository'; timeoutMs = 1000; maxOutputBytes = 4096 }
            debug_target = [ordered]@{ configuration = 'B122: Test Debug' }
            launch_web_app = [ordered]@{ executable = $executable; args = @('web'); cwd = '.'; environment = @{}; lifecycle = 'managed'; isolation = 'repository'; timeoutMs = 1000; maxOutputBytes = 4096; web = [ordered]@{ url = 'http://127.0.0.1:3000/'; healthUrl = 'http://127.0.0.1:3000/health'; healthTimeoutMs = 1000; healthIntervalMs = 100 } }
            venv = [ordered]@{ executable = $executable; args = @('venv'); cwd = '.'; environment = @{}; lifecycle = 'foreground'; isolation = 'repository'; timeoutMs = 1000; maxOutputBytes = 4096 }
            pipeline_local_gate = [ordered]@{ executable = $executable; args = @('gate'); cwd = '.'; environment = @{}; lifecycle = 'foreground'; isolation = 'disposable'; timeoutMs = 1000; maxOutputBytes = 4096 }
            stop_managed_run = [ordered]@{ managedActions = @('run_target', 'debug_target', 'launch_web_app'); gracefulTimeoutMs = 100; forceTimeoutMs = 200 }
        }
    }
    Write-Json $runtimePlanPath $runtimePlan
    $runtimeOutput = Join-Path $output 'repository-runtime.json'
    $runtimeResult = & (Join-Path $PSScriptRoot 'New-B122RepositoryRuntimeManifest.ps1') -RepositoryRoot $repository -PlanPath $runtimePlanPath -OutputPath $runtimeOutput
    $runtime = Get-Content -LiteralPath $runtimeOutput -Raw | ConvertFrom-Json
    Assert-True ($runtime.schema -ceq 'sxsy-b122.repository-runtime') 'runtime schema'
    Assert-True ($runtime.recipes.debug_target.kind -ceq 'vscode_debug') 'VS Code debug recipe'
    Assert-True (@($runtime.recipes.stop_managed_run.managedActions) -contains 'debug_target') 'Alt Run stop recipe includes durable VS Code debug sessions'
    Assert-True ($runtime.recipes.venv.python.interpreter -ceq '.venv/Scripts/python.exe') 'venv postcondition'
    Assert-True (Test-FullyQualified $runtime.recipes.run_target.executable) 'absolute runtime executable'
    $runtimeEnvironmentNames = @($runtime.recipes.run_target.environment.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-True ($runtimeEnvironmentNames.Count -eq 3 -and $runtimeEnvironmentNames -notcontains 'PATH') 'complete nonambient environment'
    Assert-True ([IO.File]::Exists($runtimeResult.ReceiptPath)) 'runtime receipt'
    $sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath
    $runtimeModule = (New-Object Uri -ArgumentList (,(Join-Path $sourceRoot 'apps\windows-companion\src\repository-runtime.ts'))).AbsoluteUri
    $loaderProbe = "import { loadVerifiedRepositoryRuntimeManifest } from '$runtimeModule'; const [filePath, expectedSha256, repositoryRoot] = process.argv.slice(1); const loaded = await loadVerifiedRepositoryRuntimeManifest({ filePath, expectedSha256, repositoryRoot }); if (loaded.manifest.recipes.debug_target?.kind !== 'vscode_debug' || loaded.manifest.recipes.venv?.python?.interpreter !== '.venv/Scripts/python.exe') process.exit(9);"
    & node --experimental-transform-types --input-type=module --eval $loaderProbe $runtimeOutput $runtimeResult.Sha256 $repository
    if ($LASTEXITCODE -ne 0) { throw "Generated runtime manifest failed the production loader probe ($LASTEXITCODE)." }

    $sandboxPlanPath = Join-Path $repository 'sandbox-plan.json'
    $sandboxPlan = [ordered]@{
        schema = 'sxsy-b122.windows-sandbox-catalog-plan'; version = 1; allowedHttpsUrls = @()
        recipes = [ordered]@{
            full_sandbox = [ordered]@{ executable = $executable; arguments = @('fixed', '{WORK_ROOT}'); workingRoot = 'work'; workingDirectory = '.'; environment = @{}; timeoutMs = 1000; maxOutputBytes = 4096; artifacts = @() }
        }
    }
    Write-Json $sandboxPlanPath $sandboxPlan
    $sandboxOutput = Join-Path $output 'sandbox-catalog.json'
    $sandboxResult = & (Join-Path $PSScriptRoot 'New-B122WindowsSandboxCatalog.ps1') -RepositoryRoot $repository -PlanPath $sandboxPlanPath -OutputPath $sandboxOutput
    $catalog = Get-Content -LiteralPath $sandboxOutput -Raw | ConvertFrom-Json
    $expectedDigest = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($catalog.schema -ceq 'sxsy-b122.windows-sandbox-catalog') 'sandbox schema'
    Assert-True ($catalog.recipes[0].executableSha256 -ceq $expectedDigest) 'sandbox executable digest'
    Assert-True ($catalog.recipes[0].executable -ceq 'C:\B122\input\tools\fixed-runner.exe') 'sandbox guest executable mapping'
    $sandboxEnvironmentNames = @($catalog.recipes[0].environment.PSObject.Properties | ForEach-Object { $_.Name })
    Assert-True ($sandboxEnvironmentNames -notcontains 'PATH') 'sandbox environment excludes PATH'
    Assert-True ([IO.File]::Exists($sandboxResult.ReceiptPath)) 'sandbox receipt'

    $badPlanPath = Join-Path $repository 'bad-plan.json'
    $badPlan = [ordered]@{
        schema = 'sxsy-b122.windows-sandbox-catalog-plan'; version = 1; allowedHttpsUrls = @()
        recipes = [ordered]@{
            full_sandbox = [ordered]@{ executable = $executable; arguments = @('fixed'); workingRoot = 'work'; workingDirectory = '.'; environment = [ordered]@{ API_TOKEN = 'not-allowed' }; timeoutMs = 1000; maxOutputBytes = 4096; artifacts = @() }
        }
    }
    Write-Json $badPlanPath $badPlan
    $badOutput = Join-Path $output 'must-not-exist.json'
    $rejected = $false
    try { & (Join-Path $PSScriptRoot 'New-B122WindowsSandboxCatalog.ps1') -RepositoryRoot $repository -PlanPath $badPlanPath -OutputPath $badOutput | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'secret-bearing environment rejected'
    Assert-True (-not [IO.File]::Exists($badOutput)) 'rejected plan produced no output'

    $duplicatePlanPath = Join-Path $repository 'duplicate-plan.json'
    [IO.File]::WriteAllText($duplicatePlanPath, '{"schema":"sxsy-b122.windows-sandbox-catalog-plan","schema":"sxsy-b122.windows-sandbox-catalog-plan","version":1,"allowedHttpsUrls":[],"recipes":{}}', (New-Object Text.UTF8Encoding -ArgumentList (,$false)))
    $duplicateOutput = Join-Path $output 'duplicate-must-not-exist.json'
    $duplicateRejected = $false
    try { & (Join-Path $PSScriptRoot 'New-B122WindowsSandboxCatalog.ps1') -RepositoryRoot $repository -PlanPath $duplicatePlanPath -OutputPath $duplicateOutput | Out-Null } catch { $duplicateRejected = $_.Exception.Message -match 'duplicate field' }
    Assert-True $duplicateRejected 'exact duplicate JSON field rejected before conversion'
    Assert-True (-not [IO.File]::Exists($duplicateOutput)) 'duplicate-key plan produced no output'

    $networkOutput = Join-Path $output 'network-policy.json'
    & (Join-Path $PSScriptRoot 'New-B122NetworkPolicy.ps1') -GitHubOwner 'contributor' -GitHubRepository 'project' -GitHubBaseOwner 'acme' -GitHubBaseRepository 'project' -OutputPath $networkOutput | Out-Null
    $network = Get-Content -LiteralPath $networkOutput -Raw | ConvertFrom-Json
    $networkRoutes = @{}; foreach ($route in $network.routes) { $networkRoutes[$route.id] = $route }
    Assert-True ($networkRoutes['github.graphql'].url -ceq 'https://api.github.com/graphql') 'public GitHub API host'
    Assert-True ($networkRoutes['github.repository'].url -ceq 'https://github.com/acme/project') 'fork base repository identity'
    Assert-True ($networkRoutes['github.actions-job-log'].url -ceq 'https://api.github.com/repos/contributor/project/actions/jobs/') 'exact Actions job-log base'
    Assert-True ($networkRoutes['github.actions-job-log'].pathParameter.name -ceq 'jobId' -and $networkRoutes['github.actions-job-log'].pathParameter.pattern -ceq 'unsigned-decimal' -and $networkRoutes['github.actions-job-log'].pathParameter.suffix -ceq '/logs') 'bounded Actions job ID binding'
    Assert-True ($networkRoutes['github.actions-job-log'].redirects -ceq 'deny' -and [int]$networkRoutes['github.actions-job-log'].maxResponseBytes -eq 8388608) 'default log redirects denied and response bounded'
    Assert-True ($networkRoutes['git.receive-pack'].url -ceq 'https://github.com/contributor/project.git/git-receive-pack') 'fork head repository push identity'
    Assert-True ([int]$networkRoutes['git.receive-pack'].maxRequestBytes -eq 67108864) 'bounded configurable Git push cap'

    $providerOutput = Join-Path $output 'network-policy-provider.json'
    & (Join-Path $PSScriptRoot 'New-B122NetworkPolicy.ps1') -GitHubOwner 'contributor' -GitHubRepository 'project' -ProviderBaseUri 'https://adapter.example.test/root/' -OutputPath $providerOutput | Out-Null
    $providerPolicy = Get-Content -LiteralPath $providerOutput -Raw | ConvertFrom-Json
    $providerRoutes = @{}; foreach ($route in $providerPolicy.routes) { $providerRoutes[$route.id] = $route }
    Assert-True ($providerRoutes['provider.handoff_immediate'].url -ceq 'https://adapter.example.test/root/v1/b122/command/handoff_immediate') 'complete provider workflow route set'
    Assert-True ($providerRoutes['provider.health'].method -ceq 'GET' -and $providerRoutes['provider.health'].url -ceq 'https://adapter.example.test/root/v1/b122/health') 'authenticated provider health route'
    Assert-True ($providerRoutes['provider.observe-session.codex'].url -ceq 'https://adapter.example.test/root/v1/b122/observe/session/codex') 'exact Codex session observation route'
    Assert-True ($providerRoutes['provider.observe-workflow-context.claude'].method -ceq 'POST' -and $providerRoutes['provider.observe-workflow-context.claude'].url -ceq 'https://adapter.example.test/root/v1/b122/observe/workflow-context/claude') 'exact Claude workflow-context observation route'
    Assert-True ($providerRoutes['provider.observe-workflow-context.codex'].method -ceq 'POST' -and $providerRoutes['provider.observe-workflow-context.codex'].url -ceq 'https://adapter.example.test/root/v1/b122/observe/workflow-context/codex') 'exact Codex workflow-context observation route'
    Assert-True ($providerRoutes['provider.observe-operation.claude'].url -ceq 'https://adapter.example.test/root/v1/b122/observe/operation/claude') 'exact Claude operation observation route'
    Assert-True ($providerRoutes['provider.cancel.codex'].url -ceq 'https://adapter.example.test/root/v1/b122/cancel/codex') 'exact Codex cancellation route'
    Assert-True ($providerRoutes['provider.reconcile'].url -ceq 'https://adapter.example.test/root/v1/b122/reconcile') 'exact provider restart reconciliation route'
    Assert-True ($providerRoutes['github.actions-job-log'].pathParameter.suffix -ceq '/logs' -and [int]$providerRoutes['git.receive-pack'].maxRequestBytes -eq 67108864) 'provider policy preserves Actions log and Git push bounds'

    $enterpriseOutput = Join-Path $output 'network-policy-enterprise.json'
    & (Join-Path $PSScriptRoot 'New-B122NetworkPolicy.ps1') -GitHubHost 'ghe.example.test' -GitHubOwner 'contributor' -GitHubRepository 'project' -GitHubBaseOwner 'acme' -GitHubBaseRepository 'project' -OutputPath $enterpriseOutput | Out-Null
    $enterprise = Get-Content -LiteralPath $enterpriseOutput -Raw | ConvertFrom-Json
    $enterpriseRoutes = @{}; foreach ($route in $enterprise.routes) { $enterpriseRoutes[$route.id] = $route }
    Assert-True ($enterpriseRoutes['github.graphql'].url -ceq 'https://ghe.example.test/api/graphql') 'Enterprise GraphQL host'
    Assert-True ($enterpriseRoutes['github.repository'].url -ceq 'https://ghe.example.test/acme/project') 'Enterprise base repository identity'
    Assert-True ($enterpriseRoutes['github.actions-job-log'].url -ceq 'https://ghe.example.test/api/v3/repos/contributor/project/actions/jobs/') 'Enterprise Actions REST base'
    Assert-True ($enterpriseRoutes['git.receive-pack'].url -ceq 'https://ghe.example.test/contributor/project.git/git-receive-pack') 'Enterprise fork head repository push identity'

    $redirectOutput = Join-Path $output 'network-policy-actions-redirect.json'
    & (Join-Path $PSScriptRoot 'New-B122NetworkPolicy.ps1') -GitHubOwner 'contributor' -GitHubRepository 'project' -GitHubActionsLogRedirectHosts @('results.example.test') -OutputPath $redirectOutput | Out-Null
    $redirect = Get-Content -LiteralPath $redirectOutput -Raw | ConvertFrom-Json
    $redirectRoute = @($redirect.routes | Where-Object { $_.id -ceq 'github.actions-job-log' })[0]
    Assert-True ($redirectRoute.redirects -ceq 'single-use-signed-download' -and @($redirectRoute.redirectHosts).Count -eq 1 -and $redirectRoute.redirectHosts[0] -ceq 'results.example.test') 'exact signed log redirect allowlist'

    # The VSIX archive identity is semantic release evidence, not merely a set
    # of present entry names. Exercise both an exact package and a manifest
    # version drift with otherwise valid archive structure.
    Import-Module (Join-Path $PSScriptRoot 'B122ReleaseIntegrity.psm1') -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    function New-VsixFixture([string]$Name,[string]$ManifestVersion){
        $fixtureRoot=Join-Path $testRoot $Name;$extensionRoot=Join-Path $fixtureRoot 'extension\dist';New-Item -ItemType Directory -Force -Path $extensionRoot|Out-Null
        Write-Json (Join-Path $fixtureRoot 'extension\package.json') ([ordered]@{name='strathex-switchyard-b122';publisher='SquirmyWormy275';version='1.2.3';main='./dist/extension.js'})
        [IO.File]::WriteAllText((Join-Path $extensionRoot 'extension.js'),'module.exports={};',(New-Object Text.UTF8Encoding($false)))
        [IO.File]::WriteAllText((Join-Path $fixtureRoot '[Content_Types].xml'),'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',(New-Object Text.UTF8Encoding($false)))
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'extension.vsixmanifest'),("<?xml version=`"1.0`"?><PackageManifest Version=`"2.0.0`" xmlns=`"http://schemas.microsoft.com/developer/vsx-schema/2011`"><Metadata><Identity Language=`"en-US`" Id=`"strathex-switchyard-b122`" Version=`"$ManifestVersion`" Publisher=`"SquirmyWormy275`" /></Metadata></PackageManifest>"),(New-Object Text.UTF8Encoding($false)))
        $archivePath=Join-Path $testRoot ($Name+'.vsix');$archive=[IO.Compression.ZipFile]::Open($archivePath,[IO.Compression.ZipArchiveMode]::Create);try{foreach($sourceFile in @(Get-ChildItem -LiteralPath $fixtureRoot -File -Recurse|Sort-Object FullName)){$entryName=$sourceFile.FullName.Substring($fixtureRoot.Length+1).Replace('\','/');[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$sourceFile.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal)|Out-Null}}finally{$archive.Dispose()};return $archivePath
    }
    $exactVsix=New-VsixFixture 'vsix-exact' '1.2.3';$vsixIdentity=Assert-B122VsixIdentity -VsixPath $exactVsix -ExpectedVersion '1.2.3';Assert-True ($vsixIdentity.version-ceq'1.2.3') 'exact VSIX package identity'
    $driftVsix=New-VsixFixture 'vsix-drift' '1.2.4';$driftRejected=$false;try{Assert-B122VsixIdentity -VsixPath $driftVsix -ExpectedVersion '1.2.3'|Out-Null}catch{$driftRejected=$_.Exception.Message-match'identity'};Assert-True $driftRejected 'VSIX manifest version drift rejected'

    "B122 manifest generator tests: PASS`nRuntime SHA-256: $($runtimeResult.Sha256)`nSandbox SHA-256: $($sandboxResult.Sha256)"
} finally {
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedTest = [IO.Path]::GetFullPath($testRoot)
    $tempPrefix = "$tempBase$([IO.Path]::DirectorySeparatorChar)"
    $insideTemp = $resolvedTest.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)
    if ((Test-Path -LiteralPath $resolvedTest) -and $insideTemp) {
        Remove-Item -LiteralPath $resolvedTest -Recurse -Force
    }
}
