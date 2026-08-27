param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$DotNetPath
)

$ErrorActionPreference = "Stop"
$firmwareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $firmwareRoot "windows-hid-helper\Strathex.B122.RawHidHelper.csproj"
$resolvedDotNet = (Resolve-Path -LiteralPath $DotNetPath).Path
if ([System.IO.Path]::GetFileName($resolvedDotNet) -ne "dotnet.exe") { throw "DotNetPath must resolve to the exact dotnet.exe." }
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

& $resolvedDotNet publish $project --configuration Release --runtime win-x64 --self-contained true --output $resolvedOutput --nologo
if ($LASTEXITCODE -ne 0) { throw "Raw HID helper publish failed." }
$helper = Join-Path $resolvedOutput "strathex-b122-hid-helper.exe"
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw "Raw HID helper output is missing." }
$digest = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
$receipt = [ordered]@{ schema = "sxsy-b122-raw-hid-helper/v1"; relativePath = "strathex-b122-hid-helper.exe"; sha256 = $digest }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolvedOutput "raw-hid-helper.json") -Encoding UTF8
Write-Output "Published digest-bound Raw HID helper: $digest"
