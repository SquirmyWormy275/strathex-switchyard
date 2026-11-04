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

- Complete Linux source: 147/147 groups, 944 tests, 934 passed and ten declared
  platform skips; receipt 11e1038b-73dd-4bdf-9493-549a792fb586. The additional
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

## Active Windows verification

The new WinRT URI transport is implemented with fixed targets, native URL hash
witnesses, protected ownership and no script-policy override. Its short native
run 41819226971 passed 40/41 checks; the metadata child exceeded its 15-second
startup deadline. This is a software failure, not an unavailable account/device.
No newer native Windows success is claimed.

The correction uses native UTF-8 stdin/stdout and a fixed system Utility module,
matching the working DPAPI helper. A metadata-only inspection mode emits bounded
constant startup phases. Four local groups pass (41 tests, 40 passed, one native
Windows skip); receipt a3346e67-be87-43a5-a412-ff321cd155b5. The correction changes
only Windows startup/metadata diagnostics; native verification is still pending.
The short workflow is independent of the long complete release queue.

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
