param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess) { throw 'Build the native setup boundary on 64-bit Windows.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $visualStudio) { throw 'The existing Windows C++ toolchain is unavailable; no SDK was downloaded.' }
$developer = Join-Path $visualStudio 'Common7\Tools\VsDevCmd.bat'
$source = Join-Path $root 'apps\windows-setup\Setup.cpp'
$image = Join-Path $output 'Switchyard.Setup.exe'
$object = Join-Path $output 'Switchyard.Setup.obj'
$build = Join-Path $output 'build-native-setup.cmd'
# The batch is build tooling only, never shipped or invoked by the application.
@"
@echo off
call "$developer" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b 1
cl.exe /nologo /O2 /EHsc /std:c++17 /MT /W4 /WX /guard:cf /sdl /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 "$source" /Fe:"$image" /Fo:"$object" /link advapi32.lib bcrypt.lib shell32.lib ole32.lib uuid.lib delayimp.lib /DELAYLOAD:shell32.dll /DELAYLOAD:ole32.dll /DELAY:NOBIND /SUBSYSTEM:WINDOWS /ENTRY:wmainCRTStartup /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /DEPENDENTLOADFLAG:0x800 /guard:cf /Brepro
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $build -Encoding ascii
& $env:ComSpec /d /s /c "`"$build`""
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $image)) { throw 'Native setup build failed; preserve its compiler diagnostics.' }
Remove-Item -LiteralPath $object,$build -Force
[pscustomobject]@{ schema='switchyard-windows-native-setup-build/v1'; image=$image; sha256=(Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant(); sdkDownloaded=$false } | ConvertTo-Json -Compress
