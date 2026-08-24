param(
    [Parameter(Mandatory = $true)][string]$QmkRoot,
    [Parameter(Mandatory = $true)][string]$Keyboard
)

$ErrorActionPreference = "Stop"
$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedQmk = (Resolve-Path -LiteralPath $QmkRoot).Path
$destination = Join-Path $resolvedQmk ("keyboards\{0}\keymaps" -f $Keyboard)
if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw "Unknown inspected QMK keyboard target: $destination" }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("b122-qmk-{0}" -f [guid]::NewGuid().ToString("N"))
try {
    & (Join-Path $firmwareRoot "package-qmk.ps1") -OutputDirectory $stage
    Copy-Item -LiteralPath (Join-Path $stage "b122") -Destination $destination -Recurse -Force
    Push-Location $resolvedQmk
    try { qmk compile -kb $Keyboard -km b122 } finally { Pop-Location }
} finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedStage = [System.IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force -ErrorAction SilentlyContinue }
}
