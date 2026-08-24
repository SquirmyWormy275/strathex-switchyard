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
            stop_managed_run = [ordered]@{ managedActions = @('run_target', 'launch_web_app'); gracefulTimeoutMs = 100; forceTimeoutMs = 200 }
        }
    }
    Write-Json $runtimePlanPath $runtimePlan
    $runtimeOutput = Join-Path $output 'repository-runtime.json'
    $runtimeResult = & (Join-Path $PSScriptRoot 'New-B122RepositoryRuntimeManifest.ps1') -RepositoryRoot $repository -PlanPath $runtimePlanPath -OutputPath $runtimeOutput
    $runtime = Get-Content -LiteralPath $runtimeOutput -Raw | ConvertFrom-Json
    Assert-True ($runtime.schema -ceq 'sxsy-b122.repository-runtime') 'runtime schema'
    Assert-True ($runtime.recipes.debug_target.kind -ceq 'vscode_debug') 'VS Code debug recipe'
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
