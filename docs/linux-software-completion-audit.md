# B122 Linux software completion audit

**Scope:** repository-owned Linux software that can be built and verified
without the physical keyboard or proprietary provider/account credentials.
This is not acceptance evidence. All 27 gates remain **NOT ACCEPTED**.

## Implemented boundary

| Area | Linux implementation | Fail-closed edge |
| --- | --- | --- |
| Protected state | Secret Service stores one random 256-bit current-user master key; cross-process `flock` serializes first-use creation; B122 values use authenticated AES-256-GCM envelopes. | Locked/missing `/usr/bin/secret-tool`, invalid output, unsafe XDG bases, or authentication failure stops startup. No plaintext fallback. |
| Local IPC | Mutual challenge/proof protocol over a mode-`0600` Unix-domain socket below private `XDG_RUNTIME_DIR`; endpoint metadata contains only a sealed token. | No TCP, workspace-selected endpoint, clear token, unsafe stale path replacement, or swapped-path unlink. |
| Single instance | Current PID, `/proc` start ticks, and executable identity are held in a private lease. | A live exact owner blocks a second process; stale/unsafe records are not trusted. |
| Repository processes | Protected reservation/start/terminal records, private verified-executable staging for mutable tools, persisted deadlines, cwd/execution-root validation, process-group termination, and systemd `KillMode=control-group`. | Missing terminal evidence remains ambiguous and is not replayed; duplicate or expired work is terminated rather than relaunched. |
| Isolation | Fixed `/usr/bin/bwrap`, deny-network namespaces, clear environment, read-only target or private quota/time-bounded disposable copy, bounded output, typed report, and authenticated host receipt. | Missing namespace support, runtime pin, typed coverage, or signed scanner/advisory fixture is unavailable/incomplete. |
| User presence | Fixed `/usr/bin/pkcheck` with exact PID/start-time/UID tuple and the reviewed `auth_self` policy. | Refusal, output, identity drift, or unavailable polkit denies trust-changing work. |
| Git | Exact `/usr/bin/git`, canonical target checks, private-index local commit, final TargetSnapshot guard, and reviewed remote routes shared with Windows. | PATH lookup, hooks, default-branch mutation, stale target, unreviewed push/PR/merge, or missing credentials fails closed. |
| Voice | Fixed PipeWire `pw-record`/`pw-play`, 16 kHz mono PCM capture starting at sequence zero, and fixed local `espeak-ng` synthesis of gateway-redacted response text; audio stays bounded and in memory. | Provider audio is discarded, helper shutdown is deadline-bounded, and no audio persistence or cross-binding use exists. Live microphone/provider acceptance remains external. |
| Raw HID | Exact `/dev/hidrawN`, character-device/VID/PID/serial/report-descriptor pin, canonical 32-byte handshake, connection epochs/counters/CRC, journal-before-ACK. | No broad device glob or `0666` rule. Physical identity, hot-plug, suspend/resume, and firmware acceptance remain external. |
| Provider host | Linux Secret Service envelopes, current-UID mode-`0700` path proof, exact TLS/module digests, mediated final-current callback, and an optional separate systemd unit. | The unit is not enabled without reviewed configuration. Proprietary modules, accounts, routes, and credentials are not bundled. |
| Packaging | Digest-pinned official Node x64 archive, compiled companion/provider host, real VSIX, complete SHA-256 manifest, versioned install/update/rollback, recoverable uninstall, systemd hardening. | Local build is not a signed distribution; hosted Linux workflow is required for release evidence. |

## Platform-specific nonclaims

- Desktop foreground activation differs across X11 and Wayland compositors.
  The VS Code-hosted actions work inside the extension; no universal ambient
  Linux window-forcing fallback is claimed.
- A repository supplies an explicitly reviewed, current-user-attested runtime
  manifest. Linux Pipeline/Shield recipes must emit the exact typed report
  documented in `linux-release-and-installation.md`. Signed scanner/advisory
  fixtures and their freshness remain required for complete Shield receipts.
- Bubblewrap policy source and hosted tests do not prove adversarial isolation
  on every distribution/kernel. Actual target-host behavior remains gate 12
  evidence.
- The udev and polkit files require a separately reviewed administrator install.
  The release installer does not silently elevate or install them.
- Physical keyboard, provider/account behavior, cloud authorization, scanner
  feeds, signed distribution, licensing, and high-consequence activation remain
  genuine external or governance work.

## Verification authority

The authoritative hosted check is `.github/workflows/b122-linux.yml` on the
exact commit. It runs the shared and native Linux test files, TypeScript typecheck, all package
builds/dry-runs, ShellCheck, official Node digest verification, release
structure/manifest tests, install-update-rollback-uninstall lifecycle tests,
and an installed companion smoke inside a real D-Bus Secret Service session.
Windows-local skips are not Linux evidence; a merged Linux completion claim
requires the exact Linux workflow to pass on `main`.

The local `npm test` Linux lane now records the shared and native Linux groups in one isolated receipt. The October 2026 source-lane repair aligned the runtime's injected clock with its budget and cancellation registries, supplied a private `XDG_RUNTIME_DIR` to isolated tests, and added the loader's `/lib64` path to the fixed Bubblewrap mount set. The real namespace proof passed on the owner's Omarchy host after that mount correction. This is still local host evidence, not hardware, adversarial isolation, or merged release acceptance. Windows-only runtime tests remain in the Windows lane and in `npm run test:all` for cross-host diagnostics.
