# B122 nonpersistent manifest generators

These PowerShell 7 generators create reviewable files only. They do not install,
pin, attest, start, schedule, or persist the companion, helper, or any recipe.
Installation remains a separate current-user-presence operation in the companion.

1. Copy the matching `*.template.json` to a new plan inside the target repository.
2. Replace every placeholder with an existing absolute `.exe` path and fixed
   structured arguments. Do not use `cmd.exe`, PowerShell, wrapper scripts, or PATH.
3. Run the matching generator with absolute repository, plan, and output paths.
4. Review the generated manifest and `.generation-receipt.json`, then separately
   use the companion's user-attested provisioning path to pin the exact digest.

```powershell
pwsh -NoProfile -File .\deployment\windows\New-B122RepositoryRuntimeManifest.ps1 `
  -RepositoryRoot C:\src\project `
  -PlanPath C:\src\project\b122-runtime-plan.json `
  -OutputPath C:\src\project\.b122\repository-runtime.json

pwsh -NoProfile -File .\deployment\windows\New-B122WindowsSandboxCatalog.ps1 `
  -RepositoryRoot C:\src\project `
  -PlanPath C:\src\project\b122-sandbox-plan.json `
  -OutputPath C:\src\project\.b122\windows-sandbox-catalog.json
```

Both generators require new output paths inside the canonical repository and
refuse overwrite, aliases, reparse points, relative executables, ambient PATH,
secret-bearing names or values, traversal, invalid action semantics, and
oversized fields. Executable identity and SHA-256 are captured and rechecked
before atomic output. Runtime manifests add only the fixed `SystemRoot` and
`WINDIR` base environment, emit `debug_target` as a VS Code configuration, and
add the exact `.venv/Scripts/python.exe` postcondition to both venv actions.
Sandbox catalogs include the executable SHA-256 required by the fixed guest
helper. A sandbox plan's executable is a concrete source file inside the host
repository; the generator emits its exact `C:\B122\input\...` guest mapping and
hashes the host source. HTTPS and process execution are not performed by these
generators.
