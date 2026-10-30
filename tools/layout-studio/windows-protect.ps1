$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$utf8 = [Text.UTF8Encoding]::new($false)
$inputPipe = [IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8)
$outputPipe = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$outputPipe.AutoFlush = $true
$request = $inputPipe.ReadToEnd() | ConvertFrom-Json
$entropy = [Text.Encoding]::UTF8.GetBytes('Switchyard/suite/DPAPI/v1')
if ($request.operation -eq 'protect') {
    $clear = [Text.Encoding]::UTF8.GetBytes($request.value)
    try { $outputPipe.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($clear, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser))) }
    finally { [Array]::Clear($clear, 0, $clear.Length) }
} elseif ($request.operation -eq 'unprotect') {
    $clear = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($request.value), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $outputPipe.Write([Text.Encoding]::UTF8.GetString($clear)) }
    finally { [Array]::Clear($clear, 0, $clear.Length) }
} else { throw 'Unsupported credential operation' }
