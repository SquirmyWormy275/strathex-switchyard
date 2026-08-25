# Windows Release and Installation

The Windows deliverable is a per-user bundle containing the compiled companion, fixed Windows Sandbox guest helper, fixed repository-runtime Job-Object helper, fixed native Raw-HID helper, fixed native provider-desktop helper, fixed native voice helper, VS Code VSIX, a portable QMK/Vial source overlay, the runtime/sandbox/voice provisioning tools and templates, the complete repository documentation set, an exact-commit source archive, an official Node runtime with its license, the pinned self-contained .NET runtime license and third-party notices, checksums, a portable-startup receipt, a compiler-bound firmware verification receipt, and an SPDX 2.3 SBOM. The build never downloads a Node runtime implicitly: supply an official Node Windows x64 ZIP and its reviewed SHA-256 to `Build-B122Release.ps1` so its `node.exe` and `LICENSE` are captured together. Any supplied prebuilt native helper requires its reviewed SHA-256 value.

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
  -ProviderDesktopHelperSha256 <reviewed-64-character-sha256> `
  -VoiceHelperPath C:\reviewed\sxsy-b122-voice-helper.exe `
  -VoiceHelperSha256 <reviewed-64-character-sha256>
```

The builder pins one exact `HEAD` commit at entry and rejects every staged, unstaged, or untracked worktree change. It creates an immutable Git archive for that commit, expands it into isolated staging, installs the lockfile-pinned dependencies there, and builds and copies only from that snapshot. It checks both `HEAD` and the complete worktree status again before and after final artifact validation, so a concurrent edit or commit aborts the build rather than mixing source identities.

The release build runs the isolated test suite, TypeScript checks, both TypeScript builds, packages the portable QMK/Vial overlay, requires a real C11 compiler and portable protocol self-test, builds each native helper, runs the repository-runtime, provider-desktop, and voice typed self-tests, creates the VSIX, and launches the assembled bundle against an isolated temporary state root for an authenticated DPAPI/named-pipe health check. The voice self-test is deliberately hardware- and network-independent and proves that startup validation does not touch the microphone or provider route. `global.json` fixes native builds to .NET SDK 8.0.424, and the self-contained runtime is pinned to 8.0.30. The release records the exact source commit, immutable source-assembly method, verification/evidence status, compiler fingerprint, reviewed Node URL and archive digest, native-helper digests, payload checksums, and a structurally validated SPDX inventory.

`-SkipVerification` exists only for iterative packaging. Such a bundle records `verificationSkipped: true` and `evidenceEligible: false`; normal artifact validation, installation, update, rollback, and startup reject it. The builder may finish its internal structural check only by explicitly allowing the development-only status, and its receipt is `development-only`, never `passed`. Skipping verification does not skip native-helper self-tests, the portable-bundle smoke, or payload-integrity construction.

The installed companion uses `%LOCALAPPDATA%\STRATHEX\switchyard` for the authenticated journal, DPAPI-sealed endpoint record, runtime/network/sandbox pins, receipts, and bounded logs. Product bytes live separately under `%LOCALAPPDATA%\STRATHEX\switchyard-product`. The companion has a strict single-instance record and mutual authenticated named-pipe health probe. Repository files cannot choose either location.

`Start-B122.ps1` revalidates the complete payload checksum and SPDX/VSIX inventory before launching the companion. A missing, added, or modified product file prevents startup rather than falling through to an unverified binary.

Repository-runtime, Windows Sandbox, credential, network-policy, and provider-handshake installation are explicit VS Code commands. Each trust-changing installation requires Windows user presence. Missing proprietary providers, credentials, network routes, Windows Sandbox, or hardware remain unavailable; no weaker fallback is selected.

The provider-desktop helper is a native focus/launch boundary only. Its presence
in the bundle does not prove that Claude Desktop or ChatGPT Desktop is installed,
authenticated, responsive, or accepted on the target machine. A provider is
usable only after its exact executable path and digest are installed through the
current-user-attested registry; missing or changed installations fail closed.

The voice helper is a real native conversation boundary: WinMM captures bounded
PCM only after exact consent and managed-session binding, SAPI speaks the
locally redacted response, and the helper calls only the explicitly provisioned
Claude or ChatGPT HTTPS route. It has no browser fallback and never substitutes
one provider for another. Provision or remove one current-user route with an
exact typed confirmation; the secret is read as hidden input, sent over the
child's standard input rather than argv, and sealed with DPAPI CurrentUser:

```powershell
.\scripts\provisioning\Manage-B122VoiceRoute.ps1 -Action Install -Provider claude `
  -Endpoint https://voice-adapter.example.invalid/v1/turn -Model <reviewed-model>
.\scripts\provisioning\Manage-B122VoiceRoute.ps1 -Action Remove -Provider claude
```

The companion keeps redacted transcript text outside the append-only authority
journal. Each retained entry has an independent AES-GCM key wrapped by the
CurrentUser protector. Expiry or explicit deletion removes keys before
ciphertext and records the deletion tombstone only afterward, so a crash can
lose already-deleted content but cannot truthfully report deletion while a key
remains. This is application-level cryptographic erasure, not a forensic claim
about storage-media remanence. Live microphone permission, provider credentials,
the external provider's deletion acknowledgement, and cross-task routing still
require target-host acceptance evidence.

The npm workspace package is intentionally the JavaScript companion control
plane only. Its package metadata declares that native helpers, including the
voice helper, are absent and
that the npm archive is not release evidence. The verified Windows bundle is
the complete distributable: it includes the compiled helper executables,
binds their digests into `release.json`, exercises their self-tests, and checks
their presence in the payload manifest.

Release checksums cover every payload file. The SBOM describes the B122 and Node packages plus payload digests. Hardware acceptance and high-consequence acceptance remain false in `release.json`; those statuses cannot be changed by packaging.
