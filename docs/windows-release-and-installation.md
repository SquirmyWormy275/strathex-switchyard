# Windows Release and Installation

The Windows deliverable is a per-user bundle containing the compiled companion, fixed Windows Sandbox guest helper, VS Code VSIX, an official Node runtime with its license, checksums, and an SPDX 2.3 SBOM. The build never downloads a runtime implicitly: supply an official Node Windows x64 ZIP to `Build-B122Release.ps1` so its `node.exe` and `LICENSE` are captured together.

```powershell
.\deployment\windows\Build-B122Release.ps1 -NodeRuntimeZip C:\reviewed\node-v24-win-x64.zip
```

The release build runs the isolated test suite, TypeScript checks, both builds, the sandbox-helper build, and creates the VSIX. `-SkipVerification` exists only for iterative packaging and is not release evidence.

The installed companion uses `%LOCALAPPDATA%\STRATHEX\switchyard` for the authenticated journal, DPAPI-sealed endpoint record, runtime/network/sandbox pins, receipts, and bounded logs. Product bytes live separately under `%LOCALAPPDATA%\STRATHEX\switchyard-product`. The companion has a strict single-instance record and mutual authenticated named-pipe health probe. Repository files cannot choose either location.

Repository-runtime, Windows Sandbox, credential, network-policy, and provider-handshake installation are explicit VS Code commands. Each trust-changing installation requires Windows user presence. Missing proprietary providers, credentials, network routes, Windows Sandbox, or hardware remain unavailable; no weaker fallback is selected.

Release checksums cover every payload file. The SBOM describes the B122 and Node packages plus payload digests. Hardware acceptance and high-consequence acceptance remain false in `release.json`; those statuses cannot be changed by packaging.
