param([string]$Node = "node")
$root = Split-Path -Parent $PSScriptRoot; $logs = Join-Path $root ".sxsy-verification"; New-Item -ItemType Directory -Force $logs | Out-Null
$out = Join-Path $logs "windows-test.stdout.log"; $err = Join-Path $logs "windows-test.stderr.log"
$child = Start-Process -FilePath $Node -ArgumentList @("scripts/run-isolated-tests.mjs") -WorkingDirectory $root -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
Get-Content $out; if (Test-Path $err) { Get-Content $err }; exit $child.ExitCode
