# Fixed URI activation through the Windows broker. No shell command or policy override.
param([switch]$Inspect)
$ErrorActionPreference = 'Stop'
$phase = 'request-validation'
function Trace-Probe([string]$name) { if ($Inspect) { [Console]::Error.WriteLine('WINRT_PROBE ' + $name) } }
try {
    Trace-Probe 'loading-fixed-system-module'
    $env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
    $PSModuleAutoLoadingPreference = 'None'
    Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
    $utf8 = [Text.UTF8Encoding]::new($false)
    $inputPipe = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
    $outputPipe = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
    $outputPipe.AutoFlush = $true
    Trace-Probe 'reading-private-input'
    $builder = [Text.StringBuilder]::new()
    while ($builder.Length -le 4096) {
        $character = $inputPipe.Read()
        if ($character -lt 0 -or $character -eq 10) { break }
        [void]$builder.Append([char]$character)
    }
    if ($builder.Length -gt 4096) { throw 'Invalid request' }
    $request = $builder.ToString() | ConvertFrom-Json
    if ($null -eq $request -or $request -is [Array] -or $request.schema -isnot [string]) { throw 'Invalid request' }
    $fields = @($request.PSObject.Properties.Name)
    $probe = $request.schema -ceq 'switchyard-client-winrt-probe/v1'
    $targets = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $targets.Add('github-copilot-web', 'https://github.com/copilot')
    $targets.Add('microsoft-365-copilot-web', 'https://copilot.cloud.microsoft/')
    $targets.Add('cursor-cloud', 'https://cursor.com/agents')
    $targets.Add('figma-web', 'https://www.figma.com/')
    if ($probe) {
        if ($fields.Count -ne 1 -or $fields[0] -cne 'schema') { throw 'Invalid probe' }
    } elseif ($request.schema -cne 'switchyard-client-winrt/v1' -or $fields.Count -ne 3 -or @($fields | Where-Object { $_ -cne 'schema' -and $_ -cne 'id' -and $_ -cne 'targetSha256' }).Count -ne 0 -or $request.id -isnot [string] -or -not $targets.ContainsKey($request.id) -or $request.targetSha256 -isnot [string] -or $request.targetSha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw 'Invalid fixed surface'
    }
    if ($Inspect -and -not $probe) { throw 'Inspection cannot activate a URI' }
    Trace-Probe 'input-validated'
    if (-not $probe) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $targetHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($targets[$request.id]))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($request.targetSha256 -cne $targetHash) { throw 'The exact reviewed target differs' }
    }
    $phase = 'winrt-projection'
    Trace-Probe 'loading-runtime-assembly'
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Trace-Probe 'loading-launcher-metadata'
    $launcher = [Windows.System.Launcher, Windows.System, ContentType=WindowsRuntime]
    Trace-Probe 'resolving-async-projection'
    $methods = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -ceq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.IsGenericType -and $_.GetParameters()[0].ParameterType.GetGenericTypeDefinition().Name -ceq 'IAsyncOperation`1'
    })
    if ($methods.Count -ne 1 -or $null -eq $launcher) { throw 'WinRT projection unavailable' }
    if ($probe) {
        Trace-Probe 'metadata-verified'
        $outputPipe.WriteLine(([ordered]@{ schema='switchyard-client-winrt-probe-result/v1'; available=$true; activationAttempted=$false; scriptPolicyChanged=$false; runtime='Windows PowerShell WinRT projection' } | ConvertTo-Json -Compress))
        exit 0
    }
    $phase = 'broker-request'
    $operation = [Windows.System.Launcher]::LaunchUriAsync([Uri]$targets[$request.id])
    [object[]]$arguments = @($operation)
    $task = $methods[0].MakeGenericMethod([bool]).Invoke($null, $arguments)
    $status = 'outcome-unconfirmed'
    $response = $null
    if ($task.Wait(15000)) {
        if ($task.Result) { $status='accepted'; $response=0 } else { $status='rejected'; $response=2 }
    } else {
        # Cancellation cannot prove that a broker already delivered no URI.
        try { $operation.Cancel() } catch { }
    }
    $outputPipe.WriteLine(([ordered]@{ schema='switchyard-client-native-launch-result/v1'; id=$request.id; status=$status; response=$response; applicationOpenedVerified=$false; accountVerified=$false; sessionIdentified=$false } | ConvertTo-Json -Compress))
    exit 0
} catch {
    [Console]::Error.WriteLine('The fixed Windows URI request did not settle at ' + $phase + '; host script policy and native runtime requirements remain enforced.')
    exit 2
}
