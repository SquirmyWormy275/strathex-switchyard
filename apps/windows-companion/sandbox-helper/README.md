# B122 Windows Sandbox guest helper

This folder builds the fixed `b122-sandbox-worker.exe` launched inside the
network-disabled Windows Sandbox configured by `windows-sandbox.ts`. The helper
is intentionally not a general command runner.

## Boundary

The only accepted command line is:

```text
b122-sandbox-worker.exe --catalog C:\B122\input\<safe-relative-path> --request C:\B122\exchange\request.json --output C:\B122\exchange
```

The helper validates exact, bounded JSON rather than relying only on the JSON
Schema assets. It verifies the catalog digest and its own published executable
digest against the host request, selects one fixed recipe ID, verifies the
recipe executable SHA-256 immediately before launch, clears the inherited
environment, and starts the executable with `UseShellExecute=false` and a
structured argument list. `cmd.exe`, PowerShell, and other shell interpolation
are never used by the helper.

Recipes have the exact properties shown in `catalog.schema.json`. Executables
must be absolute `.exe` files with a pinned digest. `workingRoot` is either the
read-only mapped repository (`input`) or the helper-owned disposable directory
(`work`). The only supported substitutions in arguments and environment values
are `{INPUT_ROOT}`, `{EXCHANGE_ROOT}`, `{WORK_ROOT}`, and `{OUTPUT_ROOT}`.
Environment variable names associated with credentials and secret-like values
are rejected. Traversal, UNC/device paths, duplicate JSON keys, reparse points,
and undeclared fields fail closed.

The child has a fixed timeout and a shared stdout/stderr byte budget. Timeout or
Ctrl+C terminates the owned process tree. Only declared regular files below the
disposable work root are collected. Successful output is placed under
`C:\B122\exchange\output`, hashed, and bound to the request in an atomically
renamed exact-v1 `result-manifest.json` consumed by `WindowsSandboxBackend`.

## Reproducible build

Use an installed .NET 8 SDK on Windows:

```powershell
dotnet restore .\Sxsy.B122.SandboxHelper.csproj
dotnet publish .\Sxsy.B122.SandboxHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
Get-FileHash .\bin\Release\net8.0\win-x64\publish\b122-sandbox-worker.exe -Algorithm SHA256
```

The helper has no NuGet package dependencies. The published executable and its
SHA-256 are host-owned installation inputs; the digest must be supplied in each
request. This checkout had .NET runtimes but no .NET SDK, so compilation was not
claimed here.
