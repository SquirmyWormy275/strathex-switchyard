Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:SecretName = '(?i)(^|_)(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DSN)($|_)'
$script:SecretValue = '(?i)(bearer\s+[a-z0-9._~+/-]{8,}|-----BEGIN[ A-Z]+PRIVATE KEY-----|(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*\S+)'
$script:SafeIdentifier = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
$script:RuntimeActions = @(
    'run_target', 'debug_target', 'launch_web_app', 'venv', 'rebuild_venv',
    'pipeline_local_gate', 'pipeline_clean_reproduction', 'shield_change_scan',
    'shield_codebase_audit', 'shield_supply_chain', 'release_shield', 'stop_managed_run'
)
$script:ManagedActions = @('run_target', 'launch_web_app')
$script:DisposableActions = @('pipeline_local_gate', 'pipeline_clean_reproduction', 'release_shield')

function Test-B122InsidePath {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Candidate, [switch]$AllowRoot)
    $relative = Get-B122RelativePath -Root $Root -Candidate $Candidate
    if ($relative -eq '.') { return $AllowRoot.IsPresent }
    return -not (Test-B122FullyQualifiedPath $relative) -and $relative -ne '..' -and -not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::Ordinal)
}

function Test-B122FullyQualifiedPath {
    param([Parameter(Mandatory)][string]$Path)
    return $Path -match '^[A-Za-z]:[\\/]'
}

function Get-B122RelativePath {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Candidate)
    $canonicalRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $canonicalCandidate = [IO.Path]::GetFullPath($Candidate).TrimEnd('\', '/')
    if ([StringComparer]::OrdinalIgnoreCase.Equals($canonicalRoot, $canonicalCandidate)) { return '.' }
    $prefix = "$canonicalRoot$([IO.Path]::DirectorySeparatorChar)"
    if ($canonicalCandidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $canonicalCandidate.Substring($prefix.Length) }
    return '..'
}

function ConvertTo-B122Data {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [Management.Automation.PSCustomObject]) {
        $dictionary = New-Object Collections.Specialized.OrderedDictionary
        foreach ($property in $Value.PSObject.Properties) {
            if ($dictionary.Contains($property.Name)) { throw "JSON object contains duplicate field '$($property.Name)'." }
            $dictionary.Add($property.Name, (ConvertTo-B122Data $property.Value))
        }
        return ,$dictionary
    }
    if ($Value -is [Collections.IDictionary]) {
        $dictionary = New-Object Collections.Specialized.OrderedDictionary
        foreach ($entry in $Value.GetEnumerator()) {
            if ($dictionary.Contains([string]$entry.Key)) { throw "JSON object contains duplicate field '$($entry.Key)'." }
            $dictionary.Add([string]$entry.Key, (ConvertTo-B122Data $entry.Value))
        }
        return ,$dictionary
    }
    if ($Value -is [Collections.IList] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) { $items += ,(ConvertTo-B122Data $item) }
        return ,$items
    }
    return $Value
}

function Get-B122Sha256Bytes {
    param([Parameter(Mandatory)][byte[]]$Bytes)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = $algorithm.ComputeHash($Bytes) } finally { $algorithm.Dispose() }
    return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function Skip-B122JsonWhitespace {
    param([Parameter(Mandatory)][Collections.IDictionary]$State)
    while ($State.Index -lt $State.Text.Length -and [char]::IsWhiteSpace($State.Text[$State.Index])) { $State.Index++ }
}

function Read-B122JsonString {
    param([Parameter(Mandatory)][Collections.IDictionary]$State)
    Skip-B122JsonWhitespace $State
    if ($State.Index -ge $State.Text.Length -or $State.Text[$State.Index] -ne '"') { throw 'JSON object key is not a string.' }
    $start = $State.Index
    $State.Index++
    while ($State.Index -lt $State.Text.Length) {
        $character = $State.Text[$State.Index]
        if ($character -eq '"') {
            $State.Index++
            $literal = $State.Text.Substring($start, $State.Index - $start)
            try { return [string]($literal | ConvertFrom-Json) } catch { throw 'JSON contains an invalid string.' }
        }
        if ($character -eq '\') {
            $State.Index++
            if ($State.Index -ge $State.Text.Length) { throw 'JSON contains an incomplete escape.' }
            if ($State.Text[$State.Index] -eq 'u') {
                if ($State.Index + 4 -ge $State.Text.Length) { throw 'JSON contains an incomplete Unicode escape.' }
                $hex = $State.Text.Substring($State.Index + 1, 4)
                if ($hex -notmatch '^[a-fA-F0-9]{4}$') { throw 'JSON contains an invalid Unicode escape.' }
                $State.Index += 5
                continue
            }
            if ('"\/bfnrt'.IndexOf($State.Text[$State.Index]) -lt 0) { throw 'JSON contains an invalid escape.' }
        } elseif ([int][char]$character -lt 0x20) { throw 'JSON contains an unescaped control character.' }
        $State.Index++
    }
    throw 'JSON contains an unterminated string.'
}

function Read-B122JsonValue {
    param([Parameter(Mandatory)][Collections.IDictionary]$State)
    Skip-B122JsonWhitespace $State
    if ($State.Index -ge $State.Text.Length) { throw 'JSON value is incomplete.' }
    $character = $State.Text[$State.Index]
    if ($character -eq '{') {
        $State.Index++
        $keys = @()
        Skip-B122JsonWhitespace $State
        if ($State.Index -lt $State.Text.Length -and $State.Text[$State.Index] -eq '}') { $State.Index++; return }
        while ($true) {
            $key = Read-B122JsonString $State
            if ($keys -ccontains $key) { throw "JSON object contains duplicate field '$key'." }
            $keys += $key
            Skip-B122JsonWhitespace $State
            if ($State.Index -ge $State.Text.Length -or $State.Text[$State.Index] -ne ':') { throw 'JSON object field is missing a colon.' }
            $State.Index++
            Read-B122JsonValue $State
            Skip-B122JsonWhitespace $State
            if ($State.Index -ge $State.Text.Length) { throw 'JSON object is incomplete.' }
            if ($State.Text[$State.Index] -eq '}') { $State.Index++; return }
            if ($State.Text[$State.Index] -ne ',') { throw 'JSON object fields are not comma separated.' }
            $State.Index++
        }
    }
    if ($character -eq '[') {
        $State.Index++
        Skip-B122JsonWhitespace $State
        if ($State.Index -lt $State.Text.Length -and $State.Text[$State.Index] -eq ']') { $State.Index++; return }
        while ($true) {
            Read-B122JsonValue $State
            Skip-B122JsonWhitespace $State
            if ($State.Index -ge $State.Text.Length) { throw 'JSON array is incomplete.' }
            if ($State.Text[$State.Index] -eq ']') { $State.Index++; return }
            if ($State.Text[$State.Index] -ne ',') { throw 'JSON array values are not comma separated.' }
            $State.Index++
        }
    }
    if ($character -eq '"') { Read-B122JsonString $State | Out-Null; return }
    $start = $State.Index
    while ($State.Index -lt $State.Text.Length -and -not [char]::IsWhiteSpace($State.Text[$State.Index]) -and ',}]'.IndexOf($State.Text[$State.Index]) -lt 0) { $State.Index++ }
    if ($State.Index -eq $start) { throw 'JSON contains an invalid value.' }
}

function Assert-B122NoDuplicateJsonKeys {
    param([Parameter(Mandatory)][string]$Raw)
    $state = [ordered]@{ Text = $Raw; Index = 0 }
    Read-B122JsonValue $state
    Skip-B122JsonWhitespace $state
    if ($state.Index -ne $Raw.Length) { throw 'JSON contains trailing content.' }
}

function Assert-B122NoReparseComponents {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    $current = $root
    $relative = Get-B122RelativePath -Root $root -Candidate $full
    foreach ($component in ($relative -split '[\\/]' | Where-Object { $_ })) {
        $current = Join-Path $current $component
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Path contains a reparse component: $current" }
    }
}

function Get-B122CanonicalDirectory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Length -gt 4096 -or $Path.IndexOf([char]0) -ge 0 -or -not (Test-B122FullyQualifiedPath $Path)) {
        throw "$Label must be a bounded absolute path."
    }
    $full = [IO.Path]::GetFullPath($Path)
    $item = Get-Item -LiteralPath $full -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "$Label must be a concrete directory, not a reparse point." }
    Assert-B122NoReparseComponents -Path $full
    $resolved = (Resolve-Path -LiteralPath $full).ProviderPath
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($resolved), $full)) { throw "$Label cannot resolve through an alias or link." }
    return $full.TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Get-B122OwnedOutputPath {
    param([Parameter(Mandatory)][string]$RepositoryRoot, [Parameter(Mandatory)][string]$OutputPath)
    if (-not (Test-B122FullyQualifiedPath $OutputPath) -or [IO.Path]::GetExtension($OutputPath) -cne '.json') { throw 'OutputPath must be an absolute .json path.' }
    $full = [IO.Path]::GetFullPath($OutputPath)
    if (-not (Test-B122InsidePath -Root $RepositoryRoot -Candidate $full)) { throw 'OutputPath must be a new file strictly inside the canonical repository root.' }
    $parent = Get-B122CanonicalDirectory -Path ([IO.Path]::GetDirectoryName($full)) -Label 'Output parent'
    if (-not (Test-B122InsidePath -Root $RepositoryRoot -Candidate $parent -AllowRoot)) { throw 'Output parent escaped the canonical repository root.' }
    if ([IO.File]::Exists($full) -or [IO.Directory]::Exists($full) -or [IO.File]::Exists("$full.generation-receipt.json")) { throw 'Generator refuses to overwrite an existing manifest or receipt.' }
    return $full
}

function Read-B122Plan {
    param([Parameter(Mandatory)][string]$RepositoryRoot, [Parameter(Mandatory)][string]$PlanPath, [Parameter(Mandatory)][string]$ExpectedSchema)
    if (-not (Test-B122FullyQualifiedPath $PlanPath)) { throw 'PlanPath must be absolute.' }
    $full = [IO.Path]::GetFullPath($PlanPath)
    if (-not (Test-B122InsidePath -Root $RepositoryRoot -Candidate $full)) { throw 'PlanPath must be a regular file strictly inside the canonical repository root.' }
    $item = Get-Item -LiteralPath $full -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -le 0 -or $item.Length -gt 262144) { throw 'Plan must be a bounded regular file, not a reparse point.' }
    Assert-B122NoReparseComponents -Path $full
    $resolved = (Resolve-Path -LiteralPath $full).ProviderPath
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($resolved), $full)) { throw 'Plan cannot resolve through an alias or link.' }
    $raw = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8)
    Assert-B122NoDuplicateJsonKeys $raw
    try { $plan = ConvertTo-B122Data ($raw | ConvertFrom-Json) }
    catch { throw 'Plan is not valid bounded JSON.' }
    Assert-B122ExactKeys -Value $plan -Allowed @('schema', 'version', 'allowedHttpsUrls', 'recipes') -Required @('schema', 'version', 'allowedHttpsUrls', 'recipes') -Label 'plan'
    if ($plan.schema -cne $ExpectedSchema -or $plan.version -ne 1) { throw 'Plan schema or version is not the exact supported v1 contract.' }
    if (-not ($plan.allowedHttpsUrls -is [Collections.IList]) -or $plan.allowedHttpsUrls.Count -gt 32) { throw 'allowedHttpsUrls must be a bounded array.' }
    if (-not ($plan.recipes -is [Collections.IDictionary]) -or $plan.recipes.Count -lt 1 -or $plan.recipes.Count -gt 32) { throw 'recipes must be a bounded nonempty object.' }
    return $plan
}

function Assert-B122ExactKeys {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string[]]$Allowed,
        [Parameter(Mandatory)][string[]]$Required,
        [Parameter(Mandatory)][string]$Label
    )
    if (-not ($Value -is [Collections.IDictionary])) { throw "$Label must be an object." }
    foreach ($key in $Value.Keys) { if (-not ($Allowed -ccontains [string]$key)) { throw "$Label contains unknown field '$key'." } }
    foreach ($key in $Required) { if (-not $Value.Contains($key)) { throw "$Label requires field '$key'." } }
}

function Assert-B122BoundedString {
    param($Value, [string]$Label, [int]$MaximumBytes = 4096)
    if (-not ($Value -is [string]) -or [string]::IsNullOrEmpty($Value) -or $Value.IndexOf([char]0) -ge 0 -or $Value.Contains("`r") -or $Value.Contains("`n") -or [Text.Encoding]::UTF8.GetByteCount($Value) -gt $MaximumBytes) {
        throw "$Label must be a bounded nonempty single-line string."
    }
}

function Test-B122BoundedInteger {
    param($Value, [long]$Minimum, [long]$Maximum)
    $integer = $Value -is [sbyte] -or $Value -is [byte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64]
    return $integer -and [long]$Value -ge $Minimum -and [long]$Value -le $Maximum
}

function Assert-B122SafeText {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Label, [switch]$AllowPath)
    Assert-B122BoundedString -Value $Value -Label $Label -MaximumBytes 8192
    if ($Value -match $script:SecretValue) { throw "$Label contains secret-like material." }
    if (-not $AllowPath -and $Value -match '(^|[\\/])\.\.([\\/]|$)') { throw "$Label contains traversal." }
}

function Test-B122SafeRelativePath {
    param([Parameter(Mandatory)][string]$Value, [switch]$AllowDot)
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 1024 -or (Test-B122FullyQualifiedPath $Value) -or $Value -match '[\x00\r\n<>:"|?*]') { return $false }
    $parts = $Value -split '[\\/]'
    foreach ($part in $parts) { if (-not $part -or $part -eq '..' -or ($part -eq '.' -and -not $AllowDot)) { return $false } }
    return $true
}

function Get-B122ExecutableAttestation {
    param([Parameter(Mandatory)][string]$Path)
    Assert-B122BoundedString -Value $Path -Label 'Executable path' -MaximumBytes 2048
    if (-not (Test-B122FullyQualifiedPath $Path) -or $Path.StartsWith('\\') -or [IO.Path]::GetExtension($Path) -ine '.exe') { throw 'Executable must be an exact absolute local .exe path; UNC/device paths are forbidden.' }
    $full = [IO.Path]::GetFullPath($Path)
    $item = Get-Item -LiteralPath $full -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -le 0 -or $item.Length -gt 268435456) { throw 'Executable must be a bounded concrete file.' }
    Assert-B122NoReparseComponents -Path $full
    $resolved = (Resolve-Path -LiteralPath $full).ProviderPath
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($resolved), $full)) { throw 'Executable cannot resolve through an alias or link.' }
    return [ordered]@{
        path = $full
        sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
        length = [long]$item.Length
        lastWriteUtc = $item.LastWriteTimeUtc.ToString('O', [CultureInfo]::InvariantCulture)
    }
}

function Assert-B122ExecutableUnchanged {
    param([Parameter(Mandatory)][Collections.IDictionary]$Expected)
    $current = Get-B122ExecutableAttestation -Path $Expected.path
    if ($current.sha256 -cne $Expected.sha256 -or $current.length -ne $Expected.length -or $current.lastWriteUtc -cne $Expected.lastWriteUtc) { throw 'Executable changed during manifest generation.' }
}

function ConvertTo-B122Arguments {
    param($Value, [string]$Label)
    if (-not ($Value -is [Collections.IList]) -or $Value.Count -gt 128) { throw "$Label must be a bounded array." }
    $result = @()
    foreach ($argument in $Value) {
        Assert-B122BoundedString -Value $argument -Label "$Label argument" -MaximumBytes 4096
        Assert-B122SafeText -Value $argument -Label "$Label argument"
        $result += [string]$argument
    }
    return ,$result
}

function ConvertTo-B122Environment {
    param($Value, [string]$Label, [switch]$Sandbox)
    if (-not ($Value -is [Collections.IDictionary]) -or $Value.Count -gt 60) { throw "$Label environment must be a bounded object." }
    $result = [ordered]@{}
    if (-not $Sandbox) {
        $result.SystemRoot = 'C:\Windows'
        $result.WINDIR = 'C:\Windows'
    }
    foreach ($entry in $Value.GetEnumerator()) {
        $name = [string]$entry.Key
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,127}$' -or $name -match $script:SecretName -or $name -ieq 'PATH' -or $result.Contains($name) -or ($Sandbox -and $name -in @('SystemRoot', 'WINDIR', 'TEMP', 'TMP'))) {
            throw "$Label environment contains a forbidden, ambient, or duplicate name."
        }
        Assert-B122BoundedString -Value $entry.Value -Label "$Label environment value" -MaximumBytes 8192
        Assert-B122SafeText -Value $entry.Value -Label "$Label environment value" -AllowPath
        $result[$name] = [string]$entry.Value
    }
    return $result
}

function Test-B122ExactUrl {
    param([Parameter(Mandatory)][string]$Value, [switch]$HttpsOnly)
    if (-not [Uri]::IsWellFormedUriString($Value, [UriKind]::Absolute)) { return $false }
    try { $uri = New-Object Uri -ArgumentList (,$Value) } catch { return $false }
    if ($uri.AbsoluteUri -cne $Value -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Fragment)) { return $false }
    if ($HttpsOnly) { return $uri.Scheme -ceq 'https' }
    $loopback = $uri.Host -in @('localhost', '127.0.0.1', '[::1]', '::1')
    return ($loopback -and $uri.Scheme -in @('http', 'https')) -or $uri.Scheme -ceq 'https'
}

function ConvertTo-B122RuntimeDocument {
    param([Parameter(Mandatory)][string]$RepositoryRoot, [Parameter(Mandatory)][Collections.IDictionary]$Plan)
    $allowedUrls = @()
    foreach ($url in $Plan.allowedHttpsUrls) {
        Assert-B122BoundedString -Value $url -Label 'Allowed HTTPS URL' -MaximumBytes 2048
        if (-not (Test-B122ExactUrl -Value $url -HttpsOnly) -or $allowedUrls -ccontains $url) { throw 'Allowed HTTPS URLs must be exact, unique HTTPS URLs without credentials or fragments.' }
        $allowedUrls += [string]$url
    }
    $recipes = [ordered]@{}
    $attestations = [ordered]@{}
    foreach ($entry in $Plan.recipes.GetEnumerator()) {
        $action = [string]$entry.Key
        $recipe = $entry.Value
        if ($script:RuntimeActions -cnotcontains $action) { throw "Unsupported repository runtime action '$action'." }
        if ($action -eq 'debug_target') {
            Assert-B122ExactKeys -Value $recipe -Allowed @('configuration') -Required @('configuration') -Label $action
            Assert-B122BoundedString -Value $recipe.configuration -Label 'debug configuration' -MaximumBytes 256
            $recipes[$action] = [ordered]@{ kind = 'vscode_debug'; configuration = [string]$recipe.configuration }
            continue
        }
        if ($action -eq 'stop_managed_run') {
            Assert-B122ExactKeys -Value $recipe -Allowed @('managedActions', 'gracefulTimeoutMs', 'forceTimeoutMs') -Required @('managedActions', 'gracefulTimeoutMs', 'forceTimeoutMs') -Label $action
            if (-not ($recipe.managedActions -is [Collections.IList]) -or $recipe.managedActions.Count -lt 1 -or $recipe.managedActions.Count -gt 2) { throw 'stop_managed_run requires one or two managed process actions.' }
            $managed = @()
            foreach ($name in $recipe.managedActions) { if ($script:ManagedActions -cnotcontains $name -or $managed -ccontains $name) { throw 'stop_managed_run contains an invalid or duplicate action.' }; $managed += [string]$name }
            foreach ($name in @('gracefulTimeoutMs', 'forceTimeoutMs')) { if (-not (Test-B122BoundedInteger -Value $recipe[$name] -Minimum 10 -Maximum 60000)) { throw "$action.$name is outside its bound." } }
            $recipes[$action] = [ordered]@{ kind = 'stop'; managedActions = $managed; gracefulTimeoutMs = $recipe.gracefulTimeoutMs; forceTimeoutMs = $recipe.forceTimeoutMs }
            continue
        }
        $allowedKeys = @('executable', 'args', 'cwd', 'environment', 'lifecycle', 'isolation', 'timeoutMs', 'maxOutputBytes', 'web')
        Assert-B122ExactKeys -Value $recipe -Allowed $allowedKeys -Required @('executable', 'args', 'cwd', 'environment', 'lifecycle', 'isolation', 'timeoutMs', 'maxOutputBytes') -Label $action
        $attestation = Get-B122ExecutableAttestation -Path $recipe.executable
        $attestations[$attestation.path.ToLowerInvariant()] = $attestation
        $args = ConvertTo-B122Arguments -Value $recipe.args -Label $action
        if (-not (Test-B122SafeRelativePath -Value $recipe.cwd -AllowDot)) { throw "$action cwd must be a safe relative path." }
        $expectedLifecycle = if ($script:ManagedActions -ccontains $action) { 'managed' } else { 'foreground' }
        if ($recipe.lifecycle -cne $expectedLifecycle) { throw "$action lifecycle must be '$expectedLifecycle'." }
        if ($recipe.isolation -notin @('repository', 'disposable') -or ($script:DisposableActions -ccontains $action) -and $recipe.isolation -cne 'disposable' -or ($action -in @('venv', 'rebuild_venv')) -and $recipe.isolation -cne 'repository') { throw "$action isolation is not valid for its semantics." }
        if (-not (Test-B122BoundedInteger -Value $recipe.timeoutMs -Minimum 50 -Maximum 86400000) -or -not (Test-B122BoundedInteger -Value $recipe.maxOutputBytes -Minimum 1 -Maximum 1048576)) { throw "$action timeout or output bound is invalid." }
        $documentRecipe = [ordered]@{
            kind = 'process'; executable = $attestation.path; args = $args; cwd = [string]$recipe.cwd
            environment = ConvertTo-B122Environment -Value $recipe.environment -Label $action
            lifecycle = $expectedLifecycle; isolation = [string]$recipe.isolation
            timeoutMs = $recipe.timeoutMs; maxOutputBytes = $recipe.maxOutputBytes
        }
        if ($action -eq 'launch_web_app') {
            if (-not $recipe.Contains('web')) { throw 'launch_web_app requires exact web configuration.' }
            Assert-B122ExactKeys -Value $recipe.web -Allowed @('url', 'healthUrl', 'healthTimeoutMs', 'healthIntervalMs') -Required @('url', 'healthUrl', 'healthTimeoutMs', 'healthIntervalMs') -Label 'launch_web_app.web'
            foreach ($name in @('url', 'healthUrl')) { Assert-B122BoundedString -Value $recipe.web[$name] -Label $name -MaximumBytes 2048; if (-not (Test-B122ExactUrl -Value $recipe.web[$name])) { throw "launch_web_app.$name is not an exact safe URL." } }
            foreach ($name in @('healthTimeoutMs', 'healthIntervalMs')) { if (-not (Test-B122BoundedInteger -Value $recipe.web[$name] -Minimum 10 -Maximum 120000)) { throw "launch_web_app.$name is outside its bound." } }
            $documentRecipe.web = [ordered]@{ url = $recipe.web.url; healthUrl = $recipe.web.healthUrl; healthTimeoutMs = $recipe.web.healthTimeoutMs; healthIntervalMs = $recipe.web.healthIntervalMs }
        } elseif ($recipe.Contains('web')) { throw "$action cannot declare web configuration." }
        if ($action -in @('venv', 'rebuild_venv')) { $documentRecipe.python = [ordered]@{ interpreter = '.venv/Scripts/python.exe' } }
        $recipes[$action] = $documentRecipe
    }
    return [ordered]@{
        document = [ordered]@{ schema = 'sxsy-b122.repository-runtime'; version = 1; repositoryRoot = $RepositoryRoot; allowedHttpsUrls = $allowedUrls; recipes = $recipes }
        executables = @($attestations.Values)
    }
}

function ConvertTo-B122SandboxDocument {
    param([Parameter(Mandatory)][string]$RepositoryRoot, [Parameter(Mandatory)][Collections.IDictionary]$Plan)
    if ($Plan.allowedHttpsUrls.Count -ne 0) { throw 'Windows Sandbox catalog plans do not accept network URLs.' }
    $recipes = @()
    $attestations = [ordered]@{}
    foreach ($entry in $Plan.recipes.GetEnumerator()) {
        $id = [string]$entry.Key
        $recipe = $entry.Value
        if ($id -notmatch $script:SafeIdentifier) { throw 'Sandbox recipe ID is invalid.' }
        Assert-B122ExactKeys -Value $recipe -Allowed @('executable', 'arguments', 'workingRoot', 'workingDirectory', 'environment', 'timeoutMs', 'maxOutputBytes', 'artifacts') -Required @('executable', 'arguments', 'workingRoot', 'workingDirectory', 'environment', 'timeoutMs', 'maxOutputBytes', 'artifacts') -Label $id
        $attestation = Get-B122ExecutableAttestation -Path $recipe.executable
        if (-not (Test-B122InsidePath -Root $RepositoryRoot -Candidate $attestation.path)) { throw "$id executable source must be a concrete file strictly inside the mapped repository." }
        $guestRelative = Get-B122RelativePath -Root $RepositoryRoot -Candidate $attestation.path
        if (-not (Test-B122SafeRelativePath -Value $guestRelative)) { throw "$id executable cannot be represented safely inside the guest mapping." }
        $guestExecutable = 'C:\B122\input\' + $guestRelative.Replace('/', '\')
        $attestations[$attestation.path.ToLowerInvariant()] = $attestation
        if ($recipe.workingRoot -notin @('input', 'work') -or -not (Test-B122SafeRelativePath -Value $recipe.workingDirectory -AllowDot)) { throw "$id working root or directory is invalid." }
        if (-not (Test-B122BoundedInteger -Value $recipe.timeoutMs -Minimum 50 -Maximum 86400000) -or -not (Test-B122BoundedInteger -Value $recipe.maxOutputBytes -Minimum 1 -Maximum 1048576)) { throw "$id timeout or output bound is invalid." }
        if (-not ($recipe.artifacts -is [Collections.IList]) -or $recipe.artifacts.Count -gt 128) { throw "$id artifacts must be a bounded array." }
        $artifacts = @()
        foreach ($artifact in $recipe.artifacts) { if (-not (Test-B122SafeRelativePath -Value $artifact) -or $artifacts -ccontains $artifact) { throw "$id artifact path is unsafe or duplicated." }; $artifacts += ([string]$artifact).Replace('\', '/') }
        $recipes += [ordered]@{
            id = $id; executable = $guestExecutable; executableSha256 = $attestation.sha256
            arguments = ConvertTo-B122Arguments -Value $recipe.arguments -Label $id
            workingRoot = [string]$recipe.workingRoot; workingDirectory = [string]$recipe.workingDirectory
            environment = ConvertTo-B122Environment -Value $recipe.environment -Label $id -Sandbox
            timeoutMs = $recipe.timeoutMs; maxOutputBytes = $recipe.maxOutputBytes; artifacts = $artifacts
        }
    }
    return [ordered]@{
        document = [ordered]@{ schema = 'sxsy-b122.windows-sandbox-catalog'; version = 1; recipes = $recipes }
        executables = @($attestations.Values)
    }
}

function Write-B122GeneratedDocument {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][string]$Kind,
        [Parameter(Mandatory)][Collections.IDictionary]$Generated
    )
    foreach ($attestation in $Generated.executables) { Assert-B122ExecutableUnchanged -Expected $attestation }
    $json = ($Generated.document | ConvertTo-Json -Depth 32 -Compress)
    $utf8 = New-Object Text.UTF8Encoding -ArgumentList (,$false)
    $bytes = $utf8.GetBytes("$json`n")
    if ($bytes.Length -le 0 -or $bytes.Length -gt 262144) { throw 'Generated manifest exceeds its fixed bound.' }
    $digest = Get-B122Sha256Bytes -Bytes $bytes
    $receipt = [ordered]@{
        schema = 'sxsy-b122.provisioning-generator-receipt'; version = 1; kind = $Kind
        repositoryRoot = $RepositoryRoot; documentPath = $OutputPath; documentSha256 = $digest
        executables = @($Generated.executables); generatedAt = [DateTime]::UtcNow.ToString('O', [CultureInfo]::InvariantCulture)
    }
    $receiptBytes = $utf8.GetBytes("$(($receipt | ConvertTo-Json -Depth 16 -Compress))`n")
    $receiptPath = "$OutputPath.generation-receipt.json"
    $documentTemp = "$OutputPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $receiptTemp = "$receiptPath.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllBytes($documentTemp, $bytes)
        [IO.File]::WriteAllBytes($receiptTemp, $receiptBytes)
        [IO.File]::Move($receiptTemp, $receiptPath)
        [IO.File]::Move($documentTemp, $OutputPath)
    } finally {
        if ([IO.File]::Exists($documentTemp)) { [IO.File]::Delete($documentTemp) }
        if ([IO.File]::Exists($receiptTemp)) { [IO.File]::Delete($receiptTemp) }
    }
    return [pscustomobject]@{ Path = $OutputPath; Sha256 = $digest; ReceiptPath = $receiptPath; ExecutableCount = $Generated.executables.Count }
}

Export-ModuleMember -Function Get-B122CanonicalDirectory, Get-B122OwnedOutputPath, Read-B122Plan, ConvertTo-B122RuntimeDocument, ConvertTo-B122SandboxDocument, Write-B122GeneratedDocument
