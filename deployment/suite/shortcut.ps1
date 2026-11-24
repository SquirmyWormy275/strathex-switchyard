$ErrorActionPreference = 'Stop'
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 script-started')
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$PSModuleAutoLoadingPreference = 'None'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$inputPipe = [Console]::OpenStandardInput()
$outputPipe = [IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
$outputPipe.AutoFlush = $true
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 runtime-ready')
$buffer = [byte[]]::new(8193)
$length = 0
while ($length -lt $buffer.Length) {
    $count = $inputPipe.Read($buffer, $length, $buffer.Length - $length)
    if ($count -eq 0) { break }
    $length += $count
}
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 input-read')
if ($length -gt 8192) { throw 'Shortcut request exceeds its bound.' }
$lines = $utf8.GetString($buffer, 0, $length).Split([char]10)
if ($lines.Length -ne 6 -or $lines[0] -cne 'SXSY-SHORTCUT/2' -or $lines[5] -cne '') { throw 'Unsupported shortcut request framing.' }
$fields = @('path', 'nodePath', 'loader', 'directory')
$v = @{}
for ($index = 0; $index -lt $fields.Length; $index++) {
    $encoded = $lines[$index + 1]
    if ($encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'Unsupported shortcut path encoding.' }
    $bytes = [Convert]::FromBase64String($encoded)
    if ([Convert]::ToBase64String($bytes) -cne $encoded) { throw 'Noncanonical shortcut path encoding.' }
    $v[$fields[$index]] = $utf8.GetString($bytes)
}
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 input-decoded')
foreach ($candidate in @($v.path, $v.nodePath, $v.loader, $v.directory)) {
    if ($candidate -notmatch '^[A-Za-z]:[\\/]' -or $candidate -match '[\x00\r\n"]') { throw 'Unsupported exact shortcut path.' }
}
if ([IO.Path]::GetExtension($v.path) -cne '.lnk' -or [IO.File]::Exists($v.path)) { throw 'A new owned shortcut path is required.' }
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 input-validated')
$arguments = '"' + $v.loader + '" launch'
$shell = [Activator]::CreateInstance([type]::GetTypeFromProgID('WScript.Shell', $true))
[Console]::Out.WriteLine('SXSY-SHORTCUT/2 com-created')
$shortcut = $null
try {
    $shortcut = $shell.CreateShortcut($v.path)
    $shortcut.TargetPath = $v.nodePath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $v.directory
    $shortcut.Description = 'Switchyard: return to the same task'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    $outputPipe.WriteLine('SXSY-SHORTCUT/2 shortcut-saved')
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    $shortcut = $null
    $read = $shell.CreateShortcut($v.path)
    try {
        if ($read.TargetPath -ine $v.nodePath -or $read.Arguments -cne $arguments -or $read.WorkingDirectory -ine $v.directory) { throw 'Native shortcut target readback failed.' }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($read) }
    $outputPipe.WriteLine('SXSY-SHORTCUT/2 readback-verified')
    $outputPipe.WriteLine('VERIFIED')
} finally {
    if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}
