$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "windows-hid-helper\Program.cs")
Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
Write-Output "Windows Raw HID helper C# compile passed"
