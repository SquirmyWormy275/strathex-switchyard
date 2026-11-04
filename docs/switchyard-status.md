# Switchyard implementation and acceptance

This branch is a partial implementation of the complete Rev2 handover. The F77
is the pilot device, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished implementation from checks needing hardware or accounts;
[verification](verification.md) identifies the exact source and practical limits
behind each accepted result.

## Current pilot

The normal installed command is `~/.local/bin/switchyard`. Source development uses
`mise exec node@24.14.0 -- npm run layout:studio`. Keep the printed private link
local; it contains access credentials. The frontend is frozen for review and its
exact digest/private link have survived the backend updates.

Published source `6039e7f` is installed as release
`59f2fd1b887dc0f11e903fca4158074da4aa1bc1bc3aceee1525f33b433a2d30`: 468 files,
4,411,098 bytes. Six normal update checks pass (assignment-legends-1793790716942.json).
Current plus one rollback occupy about 11 MiB, bundle staging is empty, and no
extra Node/.NET/Python/model runtime was copied. Definitions, modes, keyboard
configuration, native ChatGPT voice/overlay repair and the private link remain
preserved.

## Accepted evidence

- Complete Linux source: 147/147 groups, 947 tests, 937 passed and ten declared
  platform skips; receipt 1b505309-6e94-421c-bdac-0de08b075a38. The additional
  Windows metadata probe is explicitly skipped on Linux. Type checking passes.
- Normal installed reviewed commit: seven checks with one actual empty Codex
  task, zero prompts, exact binary bytes/author, preserved unowned edit, shared
  index reconciliation and durable duplicate/receipt readback. Receipt
  installed-repository-commit-1793784076954.json.
- Normal installed metadata recovery: eight checks after a deliberate native
  lost-readback fault. One commit, unchanged original outcomes, separate recovery
  approval/receipt, 36 independently stopped Git guardians and 13 retained
  inspection guardians. Receipt installed-repository-recovery-1793787873360.json.
- Distinct client launch: five versioned recipes and eight ownership/lifecycle
  tests. Five actual Python/Gio private-bus cases passed again with exact native
  URL hash witnesses, without opening a browser. The normal installed Linux API
  then passed six checks with one actual fixed GitHub Copilot homepage request,
  no prompt or repository/session selection, independent helper exit and
  duplicate/scope rejection. Current witness proof:
  installed-client-launch-1793790877401.json. Validation records/staging were
  removed and keyboard-only validation mode/selection restored. The external
  browser was not closed; visual page/account/plan acceptance is not claimed.
- Complete corrected Windows release: 250/250 groups at PR head cda0327,
  1,657 tests, 1,615 passed and 42 reviewed skips. Run
  [41807554404](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41807554404),
  receipt 6fa0410b-85ba-4dd5-a7f9-69b7b112767f. Its tested merge commit has exactly
  the same source tree. Bounded artifact 13313323640 was downloaded and SHA-256
  verified; no archive/installer bundle was retained locally. This predates the
  newer retained-ownership/recovery/client-launch source.

## Windows client verification

The fixed WinRT URI transport passes all 41 checks in four native Windows groups
at source ea96ffe, including actual Windows PowerShell WinRT/AsTask metadata
without URI activation. Run [41820186124](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41820186124),
receipt 36694c71-9a72-4d40-9254-a5625bbdf762. The tested merge commit af900d6 has
exactly the same source tree as ea96ffe. Bounded artifact 13317375091 (1,321 bytes)
was downloaded and verified against SHA-256
`58750425922e5b5654326fa1c8efde6065f22674ba3d76dc4bdbf73225e93a37`; its complete
receipt is retained privately as client-platform-windows-ea96ffe.json. No ZIP or
Windows installer/runtime was retained locally.

The initial run passed 40/41 but timed out in metadata startup. Native UTF-8
streams and a fixed system Utility module, matching the working DPAPI contract,
corrected that path; the 15-second deadline was preserved. This is accepted
software/native metadata evidence, not an interactive Windows URI, account,
window or device check. The complete newer Windows release remains pending.

## Client roles and physical intent connection

Exact `client-surface` role bindings now connect summon to the fixed HTTPS
transport, with a fresh local binding identity and recipe digest. The Linux CLI
and Windows hotkey sender attach an invocation UUID. The protected launch record
binds that UUID to its exact role, so retries do not launch again and rebinding
cannot reuse an old result. Binding changes before native acknowledgement reject
the request; late changes retain an uncertain outcome. Client bindings accept no
prompt/context or invented session and do not change the active conversation.
Work dispatch follows the persisted active workspace and permits only Microsoft
work Copilot, regardless of a caller's Personal compartment field.

Five focused groups pass: 47 tests, 46 passed and the one declared native Windows
metadata skip on Linux; receipt f0d42bbb-0858-4b23-9ae0-bcc08b1409c0. Six physical
intent cases include authenticated HTTP, actual gateway receipt correlation,
stale/late role changes and synthetic Work-only routing. Native client responses
in these cases are fixtures, not browser/account acceptance. The changed Windows C# sender compiles from isolated tracked sources; its actual
dispatch method sent two authenticated HTTP packets with distinct matching UUIDs
on Linux/.NET 8.0.30 (native-hotkey-dispatch-20261104-034142.json). No build files
were retained. Normal installed role demonstration and fresh Windows source
acceptance remain pending.

## Work still required

General execution effects, exact native desktop/IDE/terminal attachment, remaining
controller controls and the accumulated frontend/guided role controls remain
implementation work. An API launch request does not establish a provider
account, native conversation, task completion, exact resume, submission or
mediation. Microsoft work Copilot remains distinct from GitHub Copilot; no
personal fallback or employer approval is inferred.

Installed discovery returned zero configuration interfaces at
2026-11-04T09:24:06Z. Actual F77/B122 identity, typing/unlock/hot-plug, physical
transactions, printer/cap fit, interactive Windows accounts/windows, microphone
and approved tenant behavior require their actual environments. No flash/reset,
bootloader, solenoid operation, public release, merge or license change occurred.

## Preserved implementation history

The previous append-only status log is preserved in full, in order, across
[history part 1](switchyard-status-history-1.md) and
[history part 2](switchyard-status-history-2.md). Their byte-for-byte concatenation
matches the original 137,472-byte log; SHA-256: `43ac555a5b970cf4e918af5578b09396309ce858e7872257fc1eb9231cca87f0`.
Relative documentation links retain their original directory. This page is the
current entry point; older pending statements in the history are superseded by
the explicit source/receipt evidence above.
