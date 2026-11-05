# Switchyard implementation and acceptance

Switchyard is a partial implementation of the full October 29 Rev2 handover.
The F77 is the pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
tracks implementation separately from hardware/account acceptance; [verification](verification.md)
records exact source checkpoints and receipts.

## Current backend

Aggregate signed-fixture storage and separately reviewed removal are implemented.
Each compartment reserves manifest plus content bytes atomically before copying,
with a 64 MiB/32-allocation bound. Unknown and revoked allocations keep consuming
quota. Exact directory/file identities and hashes bind removal; unfamiliar or
changed files remain preserved. Partial deletion needs a fresh approval and never
upgrades the original uncertain request. Immutable IDs and audit history survive
cleanup. The change passes 88 combined checks, two additional linked/legacy
registry cases and type checking; installed and focused native Windows checks
are pending. [Contract](signed-fixtures.md).

The Suite now exposes separately reviewed signed scanner/advisory trust,
installation and revocation, with compartment-local AEAD journals, one-use
approvals, exact manifest pins, guarded receipts and kernel ownership. HTTP
policy/privacy, changed/expired source, cancellation and lost-acknowledgement
checks pass. Both Linux pipeline actions now bind verified signed feed metadata;
revoked/changed feeds keep results incomplete. Seven actual namespace pipeline
checks and 59 combined controller/registry/HTTP/privacy/harness/package checks
pass; type checking passes. The package includes the actual registry and runs
under normal Node flags. The installed demonstration now passes ten checks; native Windows controller
acceptance remains pending. [Fixture boundary](signed-fixtures.md) records the
remaining Shield execution and frontend work.

Normal Windows Run now uses the protected System storage service for new
exchanges. The desktop client does not elevate or enable volume privilege.
A read-only capability check precedes staging; unavailable service consumes
that operation as unavailable, with no direct-volume fallback. Each image binds
the original installation, task and reviewed input manifest. Stable effect UUIDs
are protected before dispatch; lost replies use read-only lookup and never
resend an absent/reserved effect. Original uncertain Run outcomes stay uncertain.

A kernel host lease excludes setup through preparation and retirement. A separate
consumer lease prevents cleanup before a guest exists; independent original
guest/native exit is still required for detach and retirement. Only the exact
native-derived disk directory is admitted to the backend. Existing direct images
keep their original cleanup port. Private ownership is omitted from snapshots.
See the [storage contract](windows-storage-broker.md).

The connection passes seventy owner/runner/HTTP/privacy/package/inventory checks
at `a1e71b0`. The subsequent preparation-race correction passes 73 checks and
type checking: duplicate calls are fenced before native identity, retired
capabilities fail before I/O, and a failed pre-effect read releases its unused
host lease. Its sixteen-case owner file now passes on native Windows. The complete 166-group
Linux lane at immutable `a1e71b0` now passes, with the separate race correction
covered by its 73 focused checks.

## Accepted native storage

The corrected workflow at `fc1fc27` now passes all nine jobs, including every
independently bounded contract file. Eight contract archive digests verified;
all downloaded contract children independently exited. The owner file passes
sixteen checks, the Run owner seventeen and the harness seventeen. The actual
JavaScript owner repeats eight native checks, alongside 31 restricted-client
and thirty filesystem checks. Their archive digests also verified; small JSON
receipts retained. This supersedes the earlier combined-batch failure without
changing its failed outcome or any production/per-file deadline. The newer
fixture controller is a separate pending native checkpoint; focused registry and maintenance jobs now cover it independently.

Complete Windows workflow [41948972575](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41948972575)
at `1f4e8e5` passes all thirty filesystem checks, 112 compiled portable checks,
sixteen protected-file checks, both service/setup lifecycles and 31 restricted-client
exchange checks. Four archive digests verified; JSON receipts retained. The
restricted token has Administrators deny-only and no volume-management privilege.
Actual data writes, kernel exhaustion, five mount mutation denials, substituted
mapping refusal, detach, retirement and independent native exit pass. Earlier
failed access/removal receipts remain failed.

The native JavaScript-owner proof at `b0f29ae` passes all eight checks against
the real service/helper: exact task/input mapping, mounted write/readback,
consumer lease, guest-exit refusal, retirement, replay refusal and native exits.
Its artifact digest verified; `windows-broker-owner-b0f-native.json` retained.
It uses an administrative worker token, creates no account and launches no guest
or setup. The separate 31-check restricted-token proof passes again.

That workflow still fails its later portable contract batch: the timeout inventory
missed the new owner group, and the enlarged serial batch reached six minutes.
`windows-storage-contracts-b0f-failed.json` preserves that failure. The timeout
inventory is corrected and the eight complete contract files now use independent
Windows jobs with their original isolated per-file bounds. No assertion or
production deadline changed. The later `fc1fc27` rerun above passes. A complete native
application/guest journey and interactive UAC remain unaccepted.

## Installed Linux and F77

Normal installed `27e0eb3`, release
`6fdc54437d76707a04ff4daa303565df3e145bc1314aff49b61dd89fec0e3193`,
passes six update and ten signed-fixture API checks. A fresh synthetic Personal
compartment enrolled its public key, imported/read back its signed package,
rejected duplicate effects, omitted private maintenance data and separately
revoked the fixture/key. Original selection, definitions/modes, private endpoint
and frozen Home were restored. Only the known synthetic package, signing scratch,
bundle and proof checkout were removed. Receipts
`assignment-legends-1793846107230.json` and
`installed-signed-fixtures-1793846351612.json` retained. No model/account, hardware
or microphone operation. The complete Linux lane at immutable `27e0eb3` passes 168/168 groups: 1,117
tests, 1,107 passed, ten declared skips. Receipt
`df4c7c97-bddc-41b3-8cde-a92fdf1e5822` retained, all child cleanup verified and
owned fixture parent/checkouts removed.

The normal installed application at `e1a1f30`, release
`ed5b058f76ad93ab75dc3e3ebd787291de27b6b1b4165fa0db30d9b9ede59143`,
passes six update checks and five F77 API checks. Linux uses the pinned runtime's
existing `hidraw` backend: exact FF60/61 configuration discovery, VIA 9 / Vial 4,
three 8 × 11 layers and the complete pinned source definition match. Keymap and
macro hashes match the independent 90-query guarded capture. Case identity,
ordinary typing, hotplug and physical writes are separate unaccepted checks.
No unlock, configuration write, flash, reset or electrical command was sent.

Receipts `assignment-legends-1793843467065.json` and
`installed-f77-readout-1793843529512.json` are retained. Definitions, selection,
modes, private endpoint and exact frozen Home were preserved; HID transports
exited and temporary bundle/checkout were removed. The frontend stays frozen.

The previous complete Linux checkpoint, `a1e71b0`, passes 166/166 groups:
1,101 tests, 1,091 passed, ten declared skips. Receipt
`f2749065-cd67-4d3e-9a10-c78b86b901c6` retained, every child cleanup verified,
owned fixtures and checkout removed. Installed Run and pipeline demonstrations
at their earlier exact sources remain recorded in [verification](verification.md).

## Remaining implementation and external checks

The signed scanner/advisory registry now pins the reviewed manifest across the
user-presence prompt, refusing even another valid signed package substituted
before installation. Authority enrollment checks and append share one protected
transaction, so concurrent approvals cannot introduce two active keys under one
authority identity. Eight actual filesystem/cryptographic registry tests and type
checking pass. The normal Suite's compartment API and Linux pipeline connection
are now implemented above; their installed and native Windows acceptance remain
separate pending checks.

Windows pipelines, complete Shield/scanner execution, writable build
preparation, exact desktop/IDE/terminal attachments and the remaining frontend
controls are unfinished implementation. The task requirement remains the full
suite. Claude Code is only a token-limit contingency; no delegated coding job
was launched.

Interactive Windows Sandbox/UAC and device/account/focus checks need an authorized
Windows host. Approved Microsoft tenant acceptance remains unavailable; no work
laptop or tenant is probed. The connected F77 still needs typing/hotplug and
separately authorized physical transactions. B122 hardware and all 27 physical
acceptance gates remain unaccepted. Microphone UI, printing/cap fit and independent
assessment remain separate checks. No public release, merge or licensing change
is authorized by these checkpoints.

## Continuation

Verify the new fixture registry/maintenance contracts on native Windows. The latest normal Linux backend, full Linux checkpoint and native owner
receipt are now recorded above. Continue the
independently executable backend requirements above. Keep small source/JSON
evidence locally, remove successful scratch and publish GitHub checkpoints.

Historical notes: [archive 3](switchyard-status-history-3.md),
[archive 2](switchyard-status-history-2.md), [archive 1](switchyard-status-history-1.md).
