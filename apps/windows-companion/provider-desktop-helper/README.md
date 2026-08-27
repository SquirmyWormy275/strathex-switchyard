# SXSY-B122 provider desktop helper

This Windows-only helper is the native effect boundary used by the companion's
`WindowsProviderDesktopProcessPort`. It is intended to be published as a
self-contained `win-x64` executable and pinned by absolute path and SHA-256 in
the host bootstrap configuration.

It accepts only `--stdio-v1` (one bounded request) and `--self-test`. The stdio
protocol never accepts a command, working directory, URL, PATH lookup, or
arbitrary process-control request. Focus and launch pause after native identity
handles are held; the companion must complete its final policy barrier and
return the helper's one-time token before the effect occurs.

Example release build:

```powershell
dotnet publish .\Sxsy.B122.ProviderDesktopHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

`deployment/windows/Build-B122Release.ps1` builds this helper by default, runs
its typed self-test, places it under the companion's `provider-desktop`
directory, and binds its SHA-256 into the release checksum/SBOM inventory and
`release.json`. A prebuilt helper is accepted only with an explicit reviewed
SHA-256. Packaging is not evidence that Claude Desktop or ChatGPT Desktop is
installed, signed in, reachable, or independently accepted on a target host.

The helper uses a kill-on-close Job Object until a newly launched process has
produced a new, exact-identity top-level window. If the helper is cancelled or
terminated before that proof, Windows kills only that task-owned launch tree.
