param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or -not [Environment]::Is64BitProcess) { throw 'Build this test-only probe on the disposable Windows CI host.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $visualStudio) { throw 'The existing C++ toolchain is unavailable; no SDK was downloaded.' }
$developer = Join-Path $visualStudio 'Common7\Tools\VsDevCmd.bat'
$source = Join-Path $PSScriptRoot 'ColdRandom.cpp'
$image = Join-Path $output 'Switchyard.ColdRandom.exe'
$object = Join-Path $output 'Switchyard.ColdRandom.obj'
$build = Join-Path $output 'build-cold-random.cmd'
$imports = Join-Path $output 'node-imports.txt'
$importReport = Join-Path $output 'Switchyard.NodeRngImports.json'
$node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$nodeHash = (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Test-Path -LiteralPath $image) -or (Test-Path -LiteralPath $object) -or (Test-Path -LiteralPath $build) -or (Test-Path -LiteralPath $imports) -or (Test-Path -LiteralPath $importReport)) { throw 'Preserve pre-existing diagnostic build output.' }
@"
@echo off
call "$developer" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
dumpbin.exe /nologo /imports "$node" > "$imports"
if errorlevel 1 exit /b 1
cl.exe /nologo /O2 /EHsc /std:c++17 /MT /W4 /WX /guard:cf /sdl /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 "$source" /Fe:"$image" /Fo:"$object" /link bcrypt.lib /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /DEPENDENTLOADFLAG:0x800 /guard:cf /Brepro
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $build -Encoding ascii
& $env:ComSpec /d /s /c "`"$build`""
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $image)) { throw 'Cold-process probe build failed; preserve diagnostics.' }
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -cne $nodeHash) { throw 'The original Node image changed during import inspection.' }
& $node (Join-Path $env:GITHUB_WORKSPACE 'scripts\inspect-windows-node-imports.mjs') --fixed-ci-dump $imports $nodeHash
if ($LASTEXITCODE -ne 0) { throw 'The bounded Node import observation failed; preserve diagnostic output.' }
Remove-Item -LiteralPath $object,$build,$imports -Force
[pscustomobject]@{ schema='switchyard-cold-random-build/v1'; sha256=(Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant(); sdkDownloaded=$false } | ConvertTo-Json -Compress
