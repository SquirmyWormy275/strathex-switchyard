param(
    [Parameter(Mandatory = $true)][string]$QmkRoot,
    [Parameter(Mandatory = $true)][string]$Keyboard,
    [Parameter(Mandatory = $true)][string]$ReviewedFullTypingKeymap
)

$ErrorActionPreference = "Stop"
$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Keyboard -notmatch '^[A-Za-z0-9_-]+([\\/][A-Za-z0-9_-]+)*$') { throw "Keyboard must be an exact QMK target name beneath keyboards/." }
$resolvedQmk = (Resolve-Path -LiteralPath $QmkRoot).Path
if (-not (Test-Path -LiteralPath $ReviewedFullTypingKeymap -PathType Leaf)) { throw "Reviewed full typing keymap not found: $ReviewedFullTypingKeymap" }
$resolvedKeymap = (Resolve-Path -LiteralPath $ReviewedFullTypingKeymap).Path
$overlayKeymap = (Resolve-Path -LiteralPath (Join-Path $firmwareRoot "qmk\keymaps\b122\keymap.c")).Path
if ([string]::Equals($resolvedKeymap, $overlayKeymap, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The repository's 22-control logical overlay is not a full typing keymap. Supply a reviewed full-matrix B122 keymap."
}
$keymapSource = Get-Content -LiteralPath $resolvedKeymap -Raw
foreach ($marker in @("keymaps", "process_record_user", "b122_device_signal", "B122_REANCHOR", "B122_SANDBOX")) {
    if (-not $keymapSource.Contains($marker)) { throw "Reviewed full typing keymap is missing the B122 integration marker: $marker" }
}
$destination = Join-Path $resolvedQmk ("keyboards\{0}\keymaps" -f $Keyboard)
if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw "Unknown inspected QMK keyboard target: $destination" }
$targetKeymap = Join-Path $destination "b122"
$backupKeymap = Join-Path $destination ("b122.backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
if ((Test-Path -LiteralPath $targetKeymap) -and -not (Test-Path -LiteralPath $targetKeymap -PathType Container)) { throw "B122 keymap target is not a directory: $targetKeymap" }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("b122-qmk-{0}" -f [guid]::NewGuid().ToString("N"))
try {
    & (Join-Path $firmwareRoot "package-qmk.ps1") -OutputDirectory $stage
    Copy-Item -LiteralPath $resolvedKeymap -Destination (Join-Path $stage "b122\keymap.c") -Force
    $hadTarget = Test-Path -LiteralPath $targetKeymap -PathType Container
    if ($hadTarget) {
        if (Test-Path -LiteralPath $backupKeymap) { throw "Dated keymap backup already exists: $backupKeymap" }
        Copy-Item -LiteralPath $targetKeymap -Destination $backupKeymap -Recurse
        Write-Output "Saved existing B122 keymap at $backupKeymap before build."
    }
    try {
        if ($hadTarget) { Remove-Item -LiteralPath $targetKeymap -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $stage "b122") -Destination $destination -Recurse
        Push-Location $resolvedQmk
        try { qmk compile -kb $Keyboard -km b122; if ($LASTEXITCODE -ne 0) { throw "QMK compilation failed with exit code $LASTEXITCODE" } } finally { Pop-Location }
    } catch {
        Remove-Item -LiteralPath $targetKeymap -Recurse -Force -ErrorAction SilentlyContinue
        if ($hadTarget) { Copy-Item -LiteralPath $backupKeymap -Destination $targetKeymap -Recurse }
        throw
    }
} finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedStage = [System.IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force -ErrorAction SilentlyContinue }
}
