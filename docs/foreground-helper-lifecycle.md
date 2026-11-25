# Foreground observation helper ownership

Windows foreground observation uses a dedicated read-only helper. Explicit
consent, selected sources, exclusions and pause/stop fences control sampling;
only a broad application category crosses the adapter boundary. Window titles,
content and task identities are not recorded.

Stopping observation now retains its exact helper until exit is confirmed.
Overlapping stops and reads join the same retirement attempt. A closed driver,
failed initialization or invalid response cannot cause a replacement while its
native child is still uncertain. Later independent close evidence allows a new
helper after fresh authorization. No PID search, privilege change or broader
process termination is used.

Generation and ownership checks discard replies that arrive after pause or
shutdown. A driver close request is not treated as exit evidence. If stopping
throws or remains uncertain, the observer returns a fixed diagnostic and retains
ownership. Suite shutdown reports that uncertainty instead of declaring success;
another close can settle the exact retained owner. This is direct-child ownership,
not proof of arbitrary descendant containment or abrupt-parent-loss cleanup.

Six new tests cover overlapping stops, late replies, failed initialization,
invalid frames, closed drivers, uncertain shutdown and recovery after exact exit.
Two controlled real Node children verify retirement before replacement and final
shutdown. Ten focused groups pass 87 checks, including catalog identities,
source-backed haptic metadata, package and surrounding integration contracts.
An eleven-check final foreground pass adds the exact-close replacement assertion.
Typecheck and the unchanged catalog generator pass. These are source checks on
Linux, with native driver behavior doubled; actual Windows and interactive
desktop acceptance remain separate.

Packaging retains the original 5 MiB full-bundle limit. The first candidate's
test bundle exceeded it by 1,401 bytes. The builder now copies the first-party
catalog provenance index as compact JSON: 108,160 to 98,367 bytes, retaining every
field, source revision, hash and notice. Repository formatting, pinned upstream
files and frozen frontend bytes remain unchanged. The corrected complete test
bundle is 5,234,949 bytes. Both initial failures and verified cleanup remain in
the [source evidence](evidence/foreground-owner-source-summary.json).

The normal installed `f06674d` update passes 33 metadata/synthetic checks,
including nine exact tested module hashes, both helper ownership paths and a
field-for-field comparison of the compact provenance index. This starts no
native helper, registration, recording or user task. All 54 workspace semantic
snapshots and frozen frontend bytes remain intact.
[Installed evidence](evidence/installed-helper-ownership-summary.json).
