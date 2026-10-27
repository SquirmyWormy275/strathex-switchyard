# Windows Release and Installation

## Plain keyboard use

The commissioned B122 must enumerate and type as a standard USB keyboard when plugged into any supported Windows computer. Ordinary typing requires **no Switchyard installer, sign-in, per-computer mapping, service, or provider setup**. The 22 advanced controls have no agent effect when the optional companion is absent. This is a physical acceptance requirement; the current logical 22-control firmware overlay does not yet include or prove the full B122 typing map. Do not flash that overlay as a replacement for the manufacturer's complete keymap. See [the host capability matrix](platform-capability-matrix.md).

Install the per-user Windows bundle only when the operator wants advanced agent functions on that machine. The installation must preserve normal typing and cannot inherit Linux credentials, personal provider accounts, or protected state. Each effectful integration still requires its own exact authorization; an unconfigured route reports unavailable.

The Windows deliverable is a per-user bundle containing the compiled companion, fixed Windows Sandbox guest helper, fixed repository-runtime Job-Object helper, fixed native Raw-HID helper, fixed native provider-desktop helper, fixed native voice helper, VS Code VSIX, a portable QMK/Vial source overlay, the runtime/sandbox/voice provisioning tools and templates, the complete repository documentation set, an exact-commit source archive, an official Node runtime with its license, the pinned self-contained .NET runtime license and third-party notices, checksums, a portable-startup receipt, a compiler-bound firmware verification receipt, and an SPDX 2.3 SBOM. The build never downloads a Node runtime implicitly: supply an official Node Windows x64 ZIP and its reviewed SHA-256 to `Build-B122Release.ps1` so its `node.exe` and `LICENSE` are captured together. Any supplied prebuilt native helper requires its reviewed SHA-256 value.

On a clean checkout, provision the repository-local .NET SDK and offline package feed before building. `Provision-B122DotnetToolchain.ps1` downloads only the exact Microsoft SDK archive and NuGet packages recorded in `dotnet-toolchain.json`, verifies their reviewed digests, and prepares the cache used by the test harness. `-VerifyExisting` performs the same identity checks without network access.

```powershell
.\deployment\windows\Provision-B122DotnetToolchain.ps1
```

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

Release output is limited to one empty, exclusive product leaf below the
repository's `artifacts` directory. The builder rejects the `artifacts` root,
an existing nonempty or reparse-point output, and any path outside that fixed
boundary. It writes a CurrentUser-DPAPI-authenticated ownership record before
staging and replaces inherited permissions with a protected current-user plus
SYSTEM DACL. Temporary build trees are identity-bound, atomically renamed to a
private quarantine, reparse-checked, and removed leaf-by-leaf; the builder never
recursively replaces or deletes an unresolved existing output tree.

The release build extracts and verifies the reviewed Node archive before any
JavaScript dependency installation, test, build, or package command. Every
such command uses that exact `node.exe` and bundled `npm-cli.js`; the release
records their digests and versions together with the exact TypeScript compiler
digest and version. Nested npm scripts run with an explicit environment rather
than the caller's profile: `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
temporary paths, and npm user/global configuration all point into the exclusive
build leaf; ambient token, credential, and tool variables are removed. A child
sentinel probe proves that an ambient secret variable is absent before any npm
command is admitted.

The release build runs the isolated test suite, TypeScript checks, both TypeScript builds, packages the portable QMK/Vial overlay, requires a real C11 compiler and portable protocol self-test, builds each native helper, runs the repository-runtime, provider-desktop, and voice typed self-tests, creates the VSIX, and launches the assembled bundle against an isolated temporary state root for an authenticated DPAPI/named-pipe health check. Its packaged provider fixture runs the copied Initialize, protected-secret, network-policy, companion-provisioning, pinned-TLS health, and managed Start/Stop entry points and proves graceful process-tree absence. The voice self-test is deliberately hardware- and network-independent and proves that startup validation does not touch the microphone or provider route. `global.json` fixes native builds to .NET SDK 8.0.424, and the self-contained runtime is pinned to 8.0.30. Native builds use only the reviewed repository-local `.tools\dotnet\dotnet.exe`, `.tools\NuGet.Config`, and digest-pinned 8.0.30 runtime/build packages recorded in `deployment/windows/dotnet-toolchain.json`; ambient `dotnet.exe` discovery is not accepted. The builder verifies the original package archives in `.tools\nuget-feed` and restores into a private build cache, so previously extracted cache contents are not a release trust input. The release copies the toolchain manifest into `build-provenance`, binds its digest and the exact host/config/runtime-package digests into `release.json`, and inventories it in the checksum manifest and SBOM. The release also records the exact source commit, immutable source-assembly method, verification/evidence status, compiler fingerprint, reviewed Node URL and archive digest, native-helper digests, payload checksums, and a structurally validated SPDX inventory.

`-SkipVerification` exists only for iterative packaging. Such a bundle records `verificationSkipped: true` and `evidenceEligible: false`; normal artifact validation, installation, update, rollback, and startup reject it. The builder may finish its internal structural check only by explicitly allowing the development-only status, and its receipt is `development-only`, never `passed`. Skipping verification does not skip native-helper self-tests, the portable-bundle smoke, or payload-integrity construction.

The installed companion uses `%LOCALAPPDATA%\STRATHEX\switchyard` as its
current-user state root for the authenticated journal, DPAPI-sealed endpoint
record, runtime/network/sandbox pins, receipts, and bounded logs. Versioned
product bytes live under
`%LOCALAPPDATA%\STRATHEX\switchyard\install\versions\<source-commit>`, while
`%LOCALAPPDATA%\STRATHEX\switchyard\install\install-state.json` atomically
selects the current and previous versions for update and rollback. Uninstalling
product bytes does not silently claim to purge protected operational state;
state removal is a separate explicit operation. The companion has a strict
single-instance record and mutual authenticated named-pipe health probe.
Repository files cannot choose any of these locations.

An explicitly supplied custom install root may contain spaces, but it must be
an empty exclusive leaf. A custom state root is supported only with
`-SkipVsCode` for an isolated test installation; the shipped VS Code extension
uses the canonical `%LOCALAPPDATA%\STRATHEX\switchyard` state root and the
installer rejects any custom-state/VS Code combination. Drive roots, the
user-profile and application-data roots themselves, the repository or release
source and their ancestors, reparse/junction components, and nonempty unowned
roots are rejected. On first use, the installer creates a CurrentUser-DPAPI-
authenticated ownership sentinel and exact root manifest. Later operations
require both records and only operate on the canonical files recorded there.
One source commit is idempotent only when its complete immutable bundle digest
is identical; the same commit with different bytes is rejected.

First install and externally supplied updates begin at the independently
reviewed `Bootstrap-B122Install.ps1`, not at a script taken on faith from the
candidate bundle. The builder writes an adjacent `*.bootstrap-trust.json`
receipt containing the candidate source commit and trust digest. Transfer the
bootstrap script and those two expected values through the reviewed channel,
then invoke it with `-ExpectedTrustDigest`, `-ExpectedSourceCommit`, and
`-OperationKindOverride install` or `update`. The bootstrap verifies the three
release trust-root documents and every manifest byte before copying a private
staging capsule and starting the installer in a fresh, Job-contained PowerShell
process. The bootstrap file plus the expected digest/commit are the initial
trust anchor; this distribution does not claim a signed publisher chain.

Install, update, rollback, start recovery, and uninstall share an authenticated,
atomically replaced, write-through lifecycle journal. It binds the operation to
the source commit, immutable bundle digest, prior pointer, candidate, and effects.
Recovery runs before a new lifecycle operation. Candidate import, root-tool
installation, process start, health, VS Code installation, autostart, activation,
candidate stop, prior restoration, uninstall, and completion are separate durable
boundaries. Failure or interruption stops the candidate and provider host first,
proves no recorded process-tree survivors, restores the prior pointer and effects,
and only then permits the prior version to restart.

The Run-key autostart command points at the immutable, checksummed bootstrap in
the selected version. The two convenience files at the install root are also
digest-pinned in the authenticated root manifest and transactionally restored;
they cannot silently replace candidate shutdown or recovery logic.

`Uninstall-B122.ps1` removes the versioned product installation and preserves
the protected state by default. `-PurgeState` is the separate, destructive
request that also removes the `%LOCALAPPDATA%\STRATHEX\switchyard` state root;
the uninstall receipt states whether that state was preserved. Purge additionally
requires `-ConfirmStateRoot` to equal the exact canonical state root and
`-PurgeConfirmation` to include its authenticated root identifier. Unknown
top-level state, any reparse content, or incomplete deletion preserves state and
fails closed. A durable tombstone outside the state root records the request and
is marked complete only after absence is proven; `statePreserved: false` is never
reported earlier.

Uninstall first requests authenticated graceful companion shutdown through the
DPAPI-sealed local pipe and stops the exact configured provider host. If graceful
shutdown is unavailable, only the DPAPI-authenticated executable, hashes,
arguments, parent, session, creation time, and captured process tree are eligible
for a bounded forced stop. Product removal does not begin while a survivor exists.
VS Code removal must return success and a subsequent extension inventory must
prove absence; otherwise a protected partial-uninstall receipt is written and
product bytes remain for deterministic retry. File removal is manifest-only,
changed or unowned files are retained and reported, and directories are removed
only after they are empty.

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

The DPAPI ownership, journal, and build-output proofs provide current-user
sealing and accidental/cross-user tamper detection. They are not an
unforgeable boundary against another process already running as the same
Windows user; same-user hostile-process acceptance remains outside this
software-only release until an OS-separated service or hardware/NCrypt-backed
authority is independently accepted.
