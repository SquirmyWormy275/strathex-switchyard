param([Parameter(Mandatory = $true)][string]$OutputDirectory)

$ErrorActionPreference = "Stop"
$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$keymapOutput = Join-Path $resolvedOutput "b122"
New-Item -ItemType Directory -Force -Path $keymapOutput | Out-Null

foreach ($file in @("keymap.c", "rules.mk", "config.h", "b122_manifest.h")) {
    Copy-Item -LiteralPath (Join-Path $firmwareRoot "qmk\keymaps\b122\$file") -Destination $keymapOutput
}
Copy-Item -LiteralPath (Join-Path $firmwareRoot "protocol\b122_protocol.c") -Destination $keymapOutput
Copy-Item -LiteralPath (Join-Path $firmwareRoot "protocol\b122_protocol.h") -Destination $keymapOutput
Copy-Item -LiteralPath (Join-Path $firmwareRoot "vial\logical-b122-vial.json") -Destination (Join-Path $resolvedOutput "vial.json")

Write-Output "Packaged QMK keymap overlay at $keymapOutput"
Write-Output "Copy it into keyboards/<inspected-keyboard>/keymaps/b122, then compile with vial-qmk."
