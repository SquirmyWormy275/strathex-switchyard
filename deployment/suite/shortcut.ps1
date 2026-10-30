$ErrorActionPreference = 'Stop'
$text = [Console]::In.ReadToEnd()
if ($text.Length -gt 8192) { throw 'Shortcut request exceeds its bound.' }
$v = $text | ConvertFrom-Json
foreach ($path in @($v.path, $v.nodePath, $v.loader, $v.directory)) {
    if ($path -notmatch '^[A-Za-z]:[\\/]' -or $path -match '[\x00\r\n"]') { throw 'Unsupported exact shortcut path.' }
}
if ([IO.Path]::GetExtension($v.path) -cne '.lnk' -or [IO.File]::Exists($v.path)) { throw 'A new owned shortcut path is required.' }
$arguments = '"' + $v.loader + '" launch'
$shell = New-Object -ComObject WScript.Shell
try {
    $shortcut = $shell.CreateShortcut($v.path)
    $shortcut.TargetPath = $v.nodePath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $v.directory
    $shortcut.Description = 'Switchyard: return to the same task'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null
    $read = $shell.CreateShortcut($v.path)
    try {
        if ($read.TargetPath -ine $v.nodePath -or $read.Arguments -cne $arguments -or $read.WorkingDirectory -ine $v.directory) { throw 'Native shortcut target readback failed.' }
    } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($read) | Out-Null }
    [Console]::Out.WriteLine('VERIFIED')
} finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
