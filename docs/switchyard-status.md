# Switchyard implementation and acceptance

Switchyard is a partial implementation of the full October 29 Rev2 handover.
The F77 is the pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
tracks implementation separately from hardware/account acceptance; [verification](verification.md)
records exact source checkpoints and receipts.

## Current backend

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
host lease. Native CI is required for that correction. The complete 166-group
Linux lane at immutable `a1e71b0` now passes, with the separate race correction
covered by its 73 focused checks.

## Accepted native storage

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
production deadline changed. Native rerun is pending. A complete native
application/guest journey and interactive UAC remain unaccepted.

## Installed Linux and F77

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

The last accepted complete Linux checkpoint, `a1e71b0`, passes 166/166 groups:
1,101 tests, 1,091 passed, ten declared skips. Receipt
`f2749065-cd67-4d3e-9a10-c78b86b901c6` retained, every child cleanup verified,
owned fixtures and checkout removed. Installed Run and pipeline demonstrations
at their earlier exact sources remain recorded in [verification](verification.md).

## Remaining implementation and external checks

The signed scanner/advisory registry now pins the reviewed manifest across the
user-presence prompt, refusing even another valid signed package substituted
before installation. Authority enrollment checks and append share one protected
transaction, so concurrent approvals cannot introduce two active keys under one
authority identity. Seven actual filesystem/cryptographic registry tests and type
checking pass. This hardens the existing companion administration; connecting it
to the normal Suite's compartment API and pipelines remains implementation work.

Windows pipelines, scanner/advisory application connections, writable build
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

Verify the preparation race correction and separated contract jobs on native
Windows. The latest normal Linux backend, full Linux checkpoint and native owner
receipt are now recorded above. Continue the
independently executable backend requirements above. Keep small source/JSON
evidence locally, remove successful scratch and publish GitHub checkpoints.

Historical notes: [archive 3](switchyard-status-history-3.md),
[archive 2](switchyard-status-history-2.md), [archive 1](switchyard-status-history-1.md).
