# Switchyard implementation and acceptance

This branch is a partial implementation of the complete Rev2 handover. The F77
is the pilot device, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished implementation from checks needing hardware or accounts;
[verification](verification.md) identifies the exact source and practical limits
behind each accepted result.

## Active backend iteration

The Linux reviewed Run service now passes actual task-input → policy/checkpoint/
budget → Bubblewrap → owned guardian → terminal-result checks. It preserves the
original admission result, releases terminal budget claims, and removes only
unchanged, independently stopped input copies. Atomic tool replacement during
readiness cannot substitute the reviewed executable descriptor. The API,
shutdown/restart boundaries and evidence exclusions are described in the
[execution contract](reviewed-task-execution.md). The frontend is unchanged.

Normal installed Run at `ab7ceed` passed eight checks with one actual empty
Codex task and zero prompts. Actual output confirmed denied host files,
credentials and loopback, a read-only workspace and 64 MiB temporary filesystem.
The terminal receipt and original duplicate admission matched; both native
guardians independently exited, both input copies were removed, and definitions,
selection, keyboard-only validation state and the private link were restored.
Receipt: `installed-repository-execution-1793805620119.json`.

Focused evidence: 38 HTTP/runtime/staging/execution cases and 20 shared broker/
Linux runtime cases pass. The updated native input proof passes three checks
(`repository-inputs-native-1793804631743.json`) without copying a runtime.
The full `ab7ceed` Linux run passed 149/150 groups; the final native recovery
fault case exceeded its old 45-second group limit. That case then passed alone
in 51 seconds. The corrected 120-second group plus ownership/manifest checks
pass 30/30 cases (receipt `9b67cf81-8701-4344-ac05-293405d860cc`). The corrected full `24f3a77` run passes 150/150 groups: 962 tests,
952 passed and ten declared platform skips. Receipt:
`9a8c1b0e-4f45-4bbd-9954-3416b30a4774`. The disposable verification checkout was
removed after its complete receipt and exited children were verified. The additional workspace-stop
regression verifies durable cancellation before abort and released budgets while
preserving the original admission and unconfirmed program outcome.

Ubuntu CI at `ab7ceed` rejected the actual namespace tool-replacement test;
native diagnostics and an explicit runner namespace preflight are now retained.
The preflight reports `bwrap: loopback: Failed RTM_NEWADDR: Operation not
permitted`. CI now installs and loads Ubuntu's packaged, scoped bwrap AppArmor
profile on its disposable runner; production namespace restrictions and guardian
no-new-privs remain enforced. Native CI acceptance of that setup is pending.
The same actual check passes on this host. Windows backend CI at `ab7ceed`
exposed a frozen test clock: a permit appeared expired before the fake broker
ran. The fixture now uses wall time for native-bound lifetimes; production's
60-second policy permits are unchanged.
Reviewed per-run stop now has a separate approval, budget, operation and receipt,
with exact-handle ownership, duplicate rejection and receipt-only recovery. Five
service cases, four stop fault cases, HTTP and packaged imports pass. The expanded installed journey at `0151e69` verified exact stop, its distinct
receipt, duplicate handling and the unchanged original admission, then exposed a
separate defect: the next reviewed Run reused the cancelled dispatch scope.
Receipt `installed-repository-execution-1793806863845.json` records the failure;
its encrypted workspace and synthetic staging remain preserved. All observed
native owners exited, and selection/definitions/keyboard-only state were restored.
The host now binds each Run's durable operation to its protected review digest;
legacy default scopes and same-request no-replay behavior remain unchanged.
Fourteen core regression cases pass, including child-saga no-replay. Corrected
installed acceptance remains pending. Windows guest execution, writable build outputs
and remaining action integrations are unfinished implementation, not hardware
blocks.

At published `c6e8a50`, GitHub Linux release verification and the short native
Windows client-platform lane pass. The complete Windows run 41846396332 passed
backend, helper, Job Object, fresh runtime and suite packaging, then exhausted
the recovery group's 45-second harness allowance after six passing cases. The
recovery group budget is now 120 seconds on both platforms, with no effect deadline or assertions
removed; complete corrected acceptance remains pending.

## Current pilot

The normal installed command is `~/.local/bin/switchyard`. Source development uses
`mise exec node@24.14.0 -- npm run layout:studio`. Keep the printed private link
local; it contains access credentials. The frontend is frozen for review and its
exact digest/private link have survived the backend updates.

Published source `ab7ceed` is installed as release
`0a02afc39dfc8d8dbba18ab317ae38c32167e3255568e2767ea518b521f8ad64`: 477 files,
4,603,496 bytes. Six normal update checks pass (assignment-legends-1793805407570.json).
Current plus one rollback occupy about 11 MiB, bundle staging is empty, and no
extra Node/.NET/Python/model runtime was copied. Definitions, modes, keyboard
configuration, native ChatGPT voice/overlay repair and the private link remain
preserved.

## Accepted evidence

- Complete Linux source: 147/147 groups, 950 tests, 940 passed and ten declared
  platform skips; receipt 99c53747-2954-4709-ba97-b646bf07d43f. The additional
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

Current source 7012333 passes all 60 checks in six native Windows boundary
groups, including shared reviewed-input validation, exact role routing and actual
Windows PowerShell WinRT/AsTask metadata without URI activation. Run
[41826311362](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41826311362),
receipt c04c5387-af12-480c-87f3-84015b127275. Tested merge commit 7074fdf has the
exact same source tree. Artifact 13319542094 (1,573 bytes) was downloaded in memory
and SHA-256 verified; only client-platform-windows-7012333.json remains privately.
No archive or runtime copy was retained. Windows guest input staging remains
unfinished; these checks do not accept an interactive URI/account/window.

The published role source 15cd19b passes all 47 checks in five native Windows
client groups, including actual Windows PowerShell WinRT/AsTask metadata without
URI activation. Run [41823579833](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41823579833),
receipt 9097bbd9-ec2b-4dc3-ae9d-8619c6fc4993. Its tested merge commit f4c37b2 has
exactly the same source tree. Bounded artifact 13317249676 (1,424 bytes) was
downloaded and SHA-256 verified; the complete receipt is retained privately as
client-platform-windows-15cd19b.json. No ZIP or installer/runtime was retained.

The earlier WinRT source ea96ffe passed 41 checks after correcting native UTF-8
startup and the fixed Utility module; the original 40/41 timeout remains in the
verification history. The 15-second metadata deadline was preserved. These are
accepted software/native metadata checks, not interactive Windows URI, account,
window or device acceptance. The complete newer Windows release remains pending. Run 41823818569 at source
38eb56d has passed backend, native helper build, owner-loss, optional-runtime and
suite packaging steps; complete bundle verification was still running at the
last check. The newer 7012333 full run is queued behind it. Track fresh runs after
subsequent documentation checkpoints; do not relabel queueing as a hardware block.

## Complete Windows failure corrected in the native boundary test

Complete run 41823818569 at 38eb56d reached all groups but failed the client group:
its Python-only negative test tried `python` in the deliberately restricted
copied-source PATH. Nine other client cases, including native WinRT metadata,
passed. Receipt b7410441-17c0-494d-930b-a8363d0df29f preserves that failure.
The negative test now invokes each platform's actual fixed helper: Windows
PowerShell on Windows and system Python/Gio on Linux. Four malformed requests
must fail before broker activation. No test was skipped, no ambient PATH added
and no script policy changed. Six focused groups pass locally (60 tests, 59
passed plus the declared native Windows metadata skip), receipt
286739b9-26e1-4100-8a8c-ef4d2165655c. Fresh Windows/full acceptance is pending.

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
were retained. The normal installed role demonstration then passed seven checks
at 15cd19b (installed-client-launch-1793792795748.json): one real fixed homepage
request through a temporary workflow role and the actual CLI physical-intent
gateway, matching invocation/receipt, no duplicate helper, zero prompts and
independently verified exit. It restored validation definitions, keyboard-only
mode and selection and removed only its own successful launch record. A small
private dated definition backup remains. No physical key, browser visual/account
or interactive Windows acceptance is claimed. Fresh native Windows source
acceptance remains pending.

## Reviewed disposable execution inputs

The older Linux execution-root provider copied an entire repository, potentially
including ignored credentials. It now requires exact host-pinned non-production
input paths, SHA-256 values and sizes. Descriptor-bound reads, bounded buffers,
source/staging identities and replacement-preserving cleanup enforce the file
boundary; unselected files are not copied. The namespace no longer mounts the
host's whole `/etc`. Old disposable pins without reviewed inputs fail closed and
need deliberate repinning. See [the input contract](reviewed-execution-inputs.md).

Nineteen focused Linux/runtime checks and type checking pass. The final complete
Linux run passes all 147 groups (950 tests: 940 passed, ten declared platform
skips; receipt 99c53747-2954-4709-ba97-b646bf07d43f). A real Bubblewrap
proof passed three checks (repository-inputs-native-1793793697536.json): exactly
one file staged; host home, host `/etc/passwd`, unselected synthetic credentials,
ambient credential variables and a live host loopback listener inaccessible;
original files unchanged and temporary staging removed. No runtime was copied.
This is an execution prerequisite, not completion of general execution effects,
Windows guest staging, output disk quotas or the frozen frontend connection.

## Work still required

General execution effects, exact native desktop/IDE/terminal attachment, remaining
controller controls and the accumulated frontend/guided role controls remain
implementation work. An API launch request does not establish a provider
account, native conversation, task completion, exact resume, submission or
mediation. Microsoft work Copilot remains distinct from GitHub Copilot; no
personal fallback or employer approval is inferred.

Installed discovery again returned zero configuration interfaces; latest receipt
device-enumeration-1793793796030.json. No HID interface was opened or written. Actual F77/B122 identity, typing/unlock/hot-plug, physical
transactions, printer/cap fit, interactive Windows accounts/windows, microphone
and approved tenant behavior require their actual environments. No flash/reset,
bootloader, solenoid operation, public release, merge or license change occurred.

## Next executable work

1. Connect host-pinned general execution recipes to the task authority, durable
   operation/budget and owned-guardian paths, reusing the reviewed input provider.
   Finish Windows guest staging, output quotas and restart staging recovery; the
   older direct process-group launcher is not the desktop readiness/exit protocol.
2. Complete exact native desktop/IDE/terminal attachments and the remaining
   source-verified controller controls, without substituting homepage launch for
   session identity or inferring electrical capabilities.
3. Check fresh Windows CI for each new native change and continue integrated
   acceptance. Preserve the frozen frontend until its review resumes; its task,
   role, recovery and controller controls remain unfinished implementation.

## Preserved implementation history

The previous append-only status log is preserved in full, in order, across
[history part 1](switchyard-status-history-1.md) and
[history part 2](switchyard-status-history-2.md). Their byte-for-byte concatenation
matches the original 137,472-byte log; SHA-256: `43ac555a5b970cf4e918af5578b09396309ce858e7872257fc1eb9231cca87f0`.
Relative documentation links retain their original directory. This page is the
current entry point; older pending statements in the history are superseded by
the explicit source/receipt evidence above.
