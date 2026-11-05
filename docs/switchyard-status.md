# Switchyard implementation and acceptance

Switchyard remains a partial implementation of the full October 29 Rev2 handover.
The F77 is the pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished software from exact device/account checks, and
[verification](verification.md) records accepted and failed source checkpoints.

## Installed pilot

Current installed source is `d2c413d`, release
`d59010f455c4202cffde4bd7fec786c817e1a721c81117ec0e76e0d4465f7933`.
It passes six update and ten actual Run/stop checks, including root/device
write denials in the program, original input protection, exact stop/replay and
independent exit/cleanup with zero prompts. Receipts
`assignment-legends-1793850275117.json` and
`installed-repository-execution-1793850446831.json` retained. Original workspace,
modes/private endpoint/frozen Home are preserved; owned stage, bundle and proof
checkout removed. The newer writable-copy mode is not yet installed.

Previous installed source `3ec0549`, release
`a170fa2163dd28062afd6ec24f65beb85fe1a0a791c09b4559f0607c3b8f8ce8`,
passes six update and eight native metadata checks. Claude 2.1.317 version,
first-party login and exact repository inventory pass through nine independently
stopped guardians. No prompt, background task or external session stop was
submitted. Receipts `assignment-legends-1793849251592.json` and
`installed-claude-commands-1793849314893.json` retained. Selection, modes,
definitions, private endpoint and exact frozen Home are preserved; owned bundle,
proof checkout and temporary metadata state are removed. The frontend stays frozen.

Earlier installed `403e0c9` passes six update and eleven fixture API checks:
atomic manifest/content accounting, revocation retaining quota, separately
approved exact removal, released quota, immutable IDs/history and duplicate
original receipt. Original workspace/private endpoint/Home were restored; only
owned synthetic packages/signing scratch were removed. Receipts
`assignment-legends-1793847745744.json` and
`installed-signed-fixtures-1793847762267.json` retained. [Fixture contract](signed-fixtures.md).

## Current backend

Linux recipes now have an explicit `temporary-build` permission for a writable
overlay copy of reviewed inputs. The overlay and `/tmp` share one 64 MiB kernel
quota; original staged/live bytes remain unchanged. Hidden setup storage is not
mapped into the task, root/dev remain read-only and further user namespaces are
disabled. A host must enable this mode; imported JSON cannot enable a direct
fallback. Review/checkpoint bind the displayed permission. Actual build, quota,
input preservation, both pipeline receipts, replay and cancellation/exit checks
pass. The new group/harness checks pass 22 cases, existing runtime/guardian/
inventory 37, and build/Run/Suite/package 33; type checking passes. Installed
acceptance is pending. [Build workspace contract](bounded-build-workspace.md).

The Linux namespace now remounts its generated root and device filesystem
read-only and disables/asserts nested user namespaces. A fresh actual test found
that the earlier `/tmp` quota did not cover regular-file writes under `/`,
`/etc` or `/dev`; those paths now refuse writes. The default temporary mount is
64 MiB, and the real guardian/namespace proof fills it across several files to
ENOSPC, refuses nested namespace creation and verifies the host namespace limit
is unchanged. Thirty-one namespace/runtime/guardian/inventory cases, thirty
actual pipeline/Suite/package regressions and type checking pass; installed
acceptance is pending. The separate bounded writable mode is connected above; its installed proof is pending.

Windows Run uses the protected LocalSystem storage service for new exchanges;
there is no privilege-enabling or direct-volume fallback in normal Run. Exact
installation/task/input mapping, stable effect IDs, read-only lost-result lookup,
kernel leases and independent guest/native exit govern creation through retirement.
Legacy assets retain their original cleanup port. Run now selects the supported
full-sandbox profile with read-only inputs, no persistent volumes and disabled
network/clipboard. [Storage](windows-storage-broker.md), [Run](windows-reviewed-run.md).

Windows local gate and clean reproduction connect task grants, exact Node
catalogs, checkpoints/budgets, owned guest/storage and freshly authenticated
reports. Signed feed hashes/versions bind without exposing signing keys or feed
files to the guest. Lost observations cannot be upgraded from native program
success or replayed on recovery. The source passes 35 policy/evidence/parser/
harness/package cases, 22 Run/owner cases, one lost-observation/restart case and
27 existing recovery/stop/output/Suite regressions, with type checking. Guest
execution is explicitly doubled. [Pipeline contract](windows-pipelines.md).

Signed fixture maintenance has compartment-local AEAD journals, one-use approval,
exact manifest pins and guarded receipts. A 64 MiB/32-allocation aggregate bound
reserves manifest plus content bytes before copying. Uncertain and revoked
allocations retain quota. Separate removal pins the original directory/files and
hashes; unfamiliar files stay preserved, partial deletion needs fresh approval,
and immutable IDs/audit history survive. The implementation passes 88 combined
checks plus two linked/legacy cases. Complete Shield execution remains unfinished.

Claude designer/task text accepts explicitly reviewed 2.1.308 and 2.1.317.
Approval binds the exact version; switching between supported versions requires
fresh approval. Account/session, tools-disabled/plan and cancellation checks
remain enforced. Thirty-four agent/submission checks and 23 Suite/package
regressions pass; real 2.1.317 model execution remains unaccepted. Claude Code
is an implementation contingency for token limits; no coding job was delegated.

## Latest verification and correction

The corrected complete Linux lane at immutable `238592b` now passes all 172
groups: 1,131 tests, 1,121 passed and ten declared skips. Receipt
`9cc25902-466d-4ff1-a5a7-7a6bdcfb8c5d` retained; every child cleanup verified
and owned fixtures/checkout removed. It predates the separate namespace quota
closure, covered by the focused checks above. Current inventory is 175 groups.

Native Windows `5d398d2`, workflow
[41960677205](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41960677205),
passes all sixteen jobs. Six pipeline policy/evidence/recovery cases have
verified archive digests and child cleanup, with small
`windows-pipeline-{policy,evidence,recovery}-5d3.json` receipts retained.
Native registry, split maintenance/removal and the 34-case backend contract also
pass at their recorded sources. Interactive guest/UAC/account acceptance is separate.

The later `14aae78` native service-removal run fails specifically during
`service-absence-configuration`, after the original delete was accepted.
Digest-verified `windows-service-removal-14a-configuration-failed.json` is retained.
The correction rechecks full original configuration before deletion, then allows
only an absent original registry environment during deletion polling; present
metadata still must match. It still requires stopped SCM state and error 1060
before removing files, with the same ten-second bound. Finer query/environment
phases preserve any further failure. Both actual C# targets compile without
warnings and 112 portable checks pass; fresh native acceptance is pending.
Stopped PIDs are not used as exit proof; the captured original process handle is.

The later `238592b` native failure identifies the configuration query itself.
Native query failures now retain their Win32 code. Only recognized missing,
key-deleted or delete-pending errors after the original accepted deletion cause
another bounded observation; any present mismatch, access denial or unknown
handle error still preserves the installation. A pending query never establishes
absence: only a new OpenService error 1060 does. Both actual C# targets compile
with zero warnings and 112 portable checks pass; fresh native acceptance is pending.

Last accepted complete Linux is `403e0c9`: 168/168 groups, 1,121 tests,
1,111 passed and ten declared skips. Receipt
`13be1a30-2e93-4b87-8a94-9a1953285b9f` retained with all child cleanup verified.
The `5d398d2` lane attempted 172 groups: 171 passed; its sole failure was a stale
authority capability assertion expecting only Run. Receipt
`43d14c61-5e5b-4f96-96b7-35795fa88afa` remains failed. The test now distinguishes
the exact Run-only grant from all three connected capabilities, while retaining
unsupported-action and Work denials; all nine authority cases pass. Every child
cleanup verified and failed checkout/fixtures are removed. The corrected complete
172-group rerun above passes; no assertion, platform skip or deadline was waived.

## F77 and remaining work

The connected F77 passes guarded read-only discovery and complete definition,
keymap/macro/settings readout: Linux hidraw, VIA 9 / Vial 4, three 8 × 11 layers
and pinned source definition `wcass:f77`. Installed readout at `e1a1f30` matches
the independent 90-query capture; receipts are in verification. Source identity
does not authenticate the hardware or select its physical case. No unlock,
configuration write, reset, flash or electrical command was sent.

Complete Shield/scanner execution, exact
desktop/IDE/terminal attachments and remaining frontend controls are unfinished
implementation. The frozen UI still needs owner visual review and the remaining
omakase flows. Continue every independently executable backend requirement.

Actual Windows Sandbox/UAC, Microsoft tenant/account and device/focus checks need
their exact authorized environments. The work laptop/tenant is not probed.
F77 typing/hotplug and separately authorized physical transactions, B122 hardware
and all 27 physical gates remain unaccepted. Microphone UI, print/cap fit and
independent assessment remain separate. No public release, merge or licensing
change is authorized by these checkpoints.

Keep source and small JSON evidence locally, remove successful scratch and
publish regular checkpoints. Preserve the Dvorak/Omarchy setup and the frozen
frontend. Historical notes: [archive 4](switchyard-status-history-4.md),
[archive 3](switchyard-status-history-3.md), [archive 2](switchyard-status-history-2.md),
[archive 1](switchyard-status-history-1.md).
