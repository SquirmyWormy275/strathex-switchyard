# Windows Release and Installation

The Windows deliverable is a per-user bundle containing the compiled companion, fixed Windows Sandbox guest helper, fixed repository-runtime Job-Object helper, fixed native Raw-HID helper, fixed native provider-desktop helper, VS Code VSIX, the runtime/sandbox manifest generators and templates, the complete repository documentation set, an exact-commit source archive, an official Node runtime with its license, the pinned self-contained .NET runtime license and third-party notices, checksums, a portable-startup receipt, and an SPDX 2.3 SBOM. The build never downloads a Node runtime implicitly: supply an official Node Windows x64 ZIP and its reviewed SHA-256 to `Build-B122Release.ps1` so its `node.exe` and `LICENSE` are captured together. Any supplied prebuilt native helper requires its reviewed SHA-256 value.

```powershell
.\deployment\windows\Build-B122Release.ps1 `
  -NodeRuntimeZip C:\reviewed\node-v24-win-x64.zip `
  -NodeRuntimeSha256 <reviewed-64-character-sha256> `
  -NodeRuntimeSourceUri https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip `
  -SandboxHelperPath C:\reviewed\b122-sandbox-worker.exe `
  -SandboxHelperSha256 <reviewed-64-character-sha256> `
  -RawHidHelperPath C:\reviewed\strathex-b122-hid-helper.exe `
  -RawHidHelperSha256 <reviewed-64-character-sha256> `
  -ProviderDesktopHelperPath C:\reviewed\sxsy-b122-provider-desktop-helper.exe `
  -ProviderDesktopHelperSha256 <reviewed-64-character-sha256>
```

The release build runs the isolated test suite, TypeScript checks, both TypeScript builds, builds each native helper, runs the repository-runtime and provider-desktop typed self-tests, creates the VSIX, and launches the assembled bundle against an isolated temporary state root for an authenticated DPAPI/named-pipe health check. `global.json` fixes native builds to .NET SDK 8.0.424, and the self-contained runtime is pinned to 8.0.30. The release records the exact source commit, reviewed Node URL and archive digest, native-helper digests, payload checksums, and a structurally validated SPDX inventory. `-SkipVerification` exists only for iterative packaging and is not release evidence; it does not skip those helper self-tests, final portable-bundle smoke, or artifact-integrity checks.

The installed companion uses `%LOCALAPPDATA%\STRATHEX\switchyard` for the authenticated journal, DPAPI-sealed endpoint record, runtime/network/sandbox pins, receipts, and bounded logs. Product bytes live separately under `%LOCALAPPDATA%\STRATHEX\switchyard-product`. The companion has a strict single-instance record and mutual authenticated named-pipe health probe. Repository files cannot choose either location.

`Start-B122.ps1` revalidates the complete payload checksum and SPDX/VSIX inventory before launching the companion. A missing, added, or modified product file prevents startup rather than falling through to an unverified binary.

Repository-runtime, Windows Sandbox, credential, network-policy, and provider-handshake installation are explicit VS Code commands. Each trust-changing installation requires Windows user presence. Missing proprietary providers, credentials, network routes, Windows Sandbox, or hardware remain unavailable; no weaker fallback is selected.

The provider-desktop helper is a native focus/launch boundary only. Its presence
in the bundle does not prove that Claude Desktop or ChatGPT Desktop is installed,
authenticated, responsive, or accepted on the target machine. A provider is
usable only after its exact executable path and digest are installed through the
current-user-attested registry; missing or changed installations fail closed.

Release checksums cover every payload file. The SBOM describes the B122 and Node packages plus payload digests. Hardware acceptance and high-consequence acceptance remain false in `release.json`; those statuses cannot be changed by packaging.
