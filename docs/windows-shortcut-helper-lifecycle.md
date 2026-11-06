# Windows shortcut helper ownership and recovery

The Suite retains its exact shortcut helper until native exit is confirmed.
A logical driver close, failed initialization or partial registration restore
cannot discard that owner and start another process. Concurrent initialization
joins one hydration attempt; overlapping retirement joins one exact-child stop.
Unconfirmed exit uses a fixed diagnostic and blocks replacement. Closing the
bridge invalidates pending reviews and reports an unconfirmed helper instead of
declaring shutdown successful.

Each operation captures its helper identity. Native registration, status,
unregistration and rollback cannot switch to a newly created helper after an
await. A late reply from a retired process therefore cannot mutate its replacement.
A native kill exception still rejects pending protocol requests and clears their
timers; it does not establish process exit.

An unsuccessful registration must verify exact absence before being labelled
rolled back. If that readback fails, the bridge joins exact helper retirement.
Confirmed exit preserves the saved previous configuration for restoration;
uncertain exit records `recovery-pending` and retains the exact transaction and
potential binding. It cannot be silently promoted to success.

Restart hydration restores only `applied` and `kept` registrations. Uncertain
records remain visible for deliberate **Restore**, without being registered on
a fresh helper. All retained transaction IDs still reserve their native IDs,
preventing reuse. Existing occupied-chord, exact-target, trial, replay and
unrelated-registration protections remain.

Six new regressions cover retained ownership, shared hydration failure, uncertain
registration recovery, late replies across helper replacement, native kill
exceptions and two controlled real Node child exits. The ownership regression
fails before correction. Eight source groups pass 89 checks; typecheck, the
original full package budget and exact child/tree/temporary cleanup pass.
[Source evidence](evidence/hotkey-owner-source-summary.json).

The tests use encrypted temporary workspaces and synthetic shortcut drivers.
They register no actual Windows shortcuts and make no hardware/account changes.
Installed synthetic ownership and pending-registration hydration checks pass.
Native Windows interaction remains separate. Exact direct-child
retirement does not by itself establish arbitrary descendant containment or
abrupt-parent-loss cleanup.

The normal installed `f06674d` update passes 33 metadata/synthetic checks,
including nine exact tested module hashes, both helper ownership paths and a
field-for-field comparison of the compact provenance index. This starts no
native helper, registration, recording or user task. All 54 workspace semantic
snapshots and frozen frontend bytes remain intact.
[Installed evidence](evidence/installed-helper-ownership-summary.json).
