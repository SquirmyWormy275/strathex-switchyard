# Switchyard implementation and evidence

This branch is a **partial full-suite implementation**. The revised handover is
being implemented across independent requirements; the F77 is the pilot, not a
scope limit. [The ledger](switchyard-requirements.md) separates implementation
from validation. Missing hardware or accounts do not excuse missing code.

## Run and explore

```sh
mise exec node@24.14.0 -- npm run layout:studio
```

Open the private loopback link printed by the server. Home explains the product
and offers **Keep my place**, a four-control setup with an editable workflow.
The Model F Labs selector includes 19 manufacturer-listed model/case/round combinations and
104 named source references. Three proposed designs have development geometry;
five proposed designs lack verified final geometry and cannot be selected as
hardware presets. Customize contains the detailed editor. Existing Typing and
firmware remain unchanged by selecting or exporting a preset.

[Catalog guide and sources](model-f-standard-configurations.md). The 126-profile
bundle was generated at `artifacts/model-f-standard-configurations/`; each file
and checksum is listed in its manifest. It includes the 104 named source
references and 22 recommended Dvorak references. Reference profiles explicitly
fail host connection until actual typing evidence is read/imported.

The F77 saved-snapshot importer preserves recorded Dvorak keycodes. It now renders
ISO Enter shapes, rotated split thumb keys and displaced alternatives in their
physical positions. Importing an actual typing layer can carry planned intents
through unique matching keycodes; absent or ambiguous positions become unassigned.

## Backend checkpoint: physical intents

The physical path now enters the running suite's authenticated active-workspace
policy on every invocation. It restores the persisted selection before the first
physical request, even if the UI has not bootstrapped. A caller cannot redirect a
physical intent to Personal by supplying another compartment in its request.
Missing, stale, unsupported or prohibited exact role targets fail without fallback.
Native ChatGPT's CLI entry also uses this policy path.

The Windows bridge is wired into the server. Its native helper reads back the
exact closed intent as well as modifiers/key, closes partial hydration on failure,
and avoids reusing recovery IDs. Software tests cover restart, occupied chords,
wrong-target readback, replay and interruption. Windows interactive acceptance is
still open; the reviewed offline CI toolchain now builds the native helper too.

A real Omarchy host check at `2026-10-30T06:12:45Z` registered Super+Ctrl+2 for an
exact authenticated custom-agent status intent, invoked its owned named Lua
callback, obtained a local receipt, then restored the full original bindings
file. SHA-256 before and after was
`ed787c4063c0d7150c9288227ce451be87bc2be968e707073e92e035360434f0`.
The check also selected a separate Copilot-only Work policy and verified rejection
of the personal native-app intent. No tenant was contacted. Native ChatGPT had no
mapped window, so its focus scenario was recorded as unavailable, not passed.
No F77 input, hardware write or external task completion is claimed. Dated private
transaction baselines and redacted local acceptance receipts remain outside Git.

Hyprland's numeric `__lua` callback IDs cannot be invoked through its public CLI.
The adapter uses an owned named function passed to the binding and invokes that
same function through documented `hyprctl eval`, then requires an authenticated
receipt. See the [official CLI documentation](https://wiki.hypr.land/configuring/core/advanced-configuration/using-hyprctl/)
and [upstream callback discussion](https://github.com/hyprwm/Hyprland/discussions/15059).
The callback launches an external process and does no blocking network work in
the compositor. Restoration removes its owned function too.

## Software evidence

- Node 24.14.0; clean dependency installation with `npm ci --ignore-scripts`.
- Integrated native Linux run: **108/108 groups passed; 763 tests, 754 passed and 9
  expected platform skips**. Receipt:
  `.sxsy-verification/isolated-test-2b3abb60-fa51-4bce-91ee-7a2f425588a8.json`.
  Coverage includes all 104 named catalog configurations, physical options,
  protected state locks, device recovery and SDK/OAuth contracts.
- `npm run catalog:check` verifies local source SHA-256 values and deterministic
  generated catalog data. `npm run catalog:export` built 126 portable profiles.
- TypeScript typecheck passed. The Windows native hotkey helper cross-builds as a
  self-contained win-x64 executable under .NET 8.0.424. This is build evidence,
  not proof of Windows runtime behavior.

Tests use synthetic/fault transports unless identified below. The older B122
27-gate acceptance record is unchanged; every gate remains NOT ACCEPTED.

## Actual local host checks

- Installed Codex 0.165.0 completed a real schema-constrained configuration design
  request using its existing account. The installed app-server rejected one
  newer documented sandbox field; the adapter uses its supported read-only
  contract. Proposals never apply themselves.
- Its effective MCP configuration is now inspected without creating a thread,
  then every enabled server is disabled and the resulting restrictions read
  back before design. The installed CLI passed this startup check with zero
  enabled MCP servers. Concurrent requests share one initialized runtime.
- Installed Claude Code 2.1.308 completed a real configuration design request
  with tools/hooks/MCP disabled for that session and its existing account.
- Real custom Node and Python LangChain Runnable examples registered distinct
  sessions, received an authenticated review intent and acknowledged completion.
  An example's acknowledgement is self-report, not verified coding-task evidence.
- Both actual examples passed the v2 contract over authenticated local HTTP at
  `2026-10-30T08:35:08Z`, then their owned processes stopped in keyboard-only mode.
  Requests and responses bind exact raw bytes, route, sequence and session. The
  counter and effect commit atomically; a replaced session cannot poll new work.
  Tests reject route substitution, replay and unauthenticated/mis-scoped responses.
  [The SDK contract](../integrations/README.md) documents upgrades and uncertain
  claims; v1 receives HTTP 426. No model prompt or keyboard interface was used.
- A second actual HTTP check started each example with simultaneous requests,
  observed one process/session per example and completed both review exchanges.
  It exposed an atomic-replacement read race, which now retries only newly named
  safe private files with a strict bound. The same demonstration passed after
  the fix. Both real Node and Python/LangChain children also exited after abrupt
  parent loss through their private stdin lifeline. These are owned synthetic
  examples; no external coding process or task-cancellation claim is made.
- Local CPU faster-whisper transcribed synthetic speech without an external API.
  Recognition was imperfect; transcript correction remains part of the flow.
  A live microphone conversation has not yet been accepted.
- The real CPU/HTTP voice recovery demonstration also passed at
  `2026-10-30T09:53:20Z`: concurrent duplicates shared a result, later text kept
  the corrected prefix and required review, and saved audio was removed.
  The actual Python worker released its inherited pipe 17 ms after abrupt
  owner exit. Temporary synthetic audio and the test session were deleted;
  the validation workspace returned to keyboard-only. No microphone was opened.
  [Repeatable demonstration and recovery behavior](voice-recovery.md).
- The optional runtime now has a hash-locked installer and verifier. The existing
  48-package runtime matched all pins without extra packages. A fresh disposable
  Linux environment installed from the lock and loaded the CPU model; it was
  removed after verification. Windows binary-wheel resolution passed a dry run.
  See [setup, evidence and remaining lifecycle work](optional-runtime.md).
- The restarted backend served the exact frozen Home HTML and both real bundled
  examples completed authenticated synthetic review exchanges with duplicate
  prevention under the isolated runtime environment. This is example acknowledgement,
  not verified external coding-task completion. No HID interface was opened.
- A new exact coding-task backend created one empty thread through the installed
  Codex daemon over authenticated HTTP, verified its directory/local-login binding,
  prevented duplicate creation and read back `idle`. No model prompt was sent;
  no coding outcome was inferred. [Task scope and remaining controls](coding-task-bindings.md)
  are separate from configuration conversations.
- That same owned read-only coding thread passed an actual daemon-resume HTTP
  check. Exact directory/login/permissions were verified, history excluded from
  the response and no model prompt submitted. Window focus, interactive client
  resumption and verified task completion remain separate unaccepted capabilities.
- Claude Code 2.1.308 has a separate native task API. Actual authenticated HTTP
  acceptance created an empty tools-disabled/plan background task, retained its
  native identities, prevented a duplicate, read exact status, consumed a reviewed
  stop and rejected confirmation replay. No model prompt was submitted. The live
  trial caught the CLI's changing `startedAt` field; the returned UUID/job ID and
  exact directory/account bind the task instead. See [scope and remaining
  controls](claude-task-bindings.md).
- A real native Foot/Claude trial at `2026-10-30T09:11:50Z` focused the same
  interactive session twice through authenticated HTTP. Executable/user/root,
  foreground process group, PID start identity, terminal ancestry, current native
  session and compositor readback were verified. The owned terminal exited and
  the original desktop focus was restored. No model prompt or terminal text was
  submitted; task resumption and completion were explicitly not claimed. Shared
  or multiplexed terminals, background attachment windows and Windows focus stay
  unavailable rather than selecting a guessed window.
- Linux Secret Service protected the local smoke-test compartment and credentials.
  No work tenant was contacted. The repaired native ChatGPT main window was
  discovered without altering its launcher, voice repair or overlay guard.

## Checks still awaiting a real surface

The tab available to automation still showed Brave’s blocked-page error after the user reported a manual refresh. Brave
blocked automated navigation/reloads with ERR_BLOCKED_BY_CLIENT; the user was
asked to refresh the new Home page manually and leave it open. No internal
browser setting or protection was changed. New catalog/Home visual and click
acceptance remains pending until the refreshed page is visible. The morning
review front end is frozen at digest
`24100ef601b810efb0cda95e4fe0842d2944560734b02c4cf482c25e19150543`
and served at `http://127.0.0.1:43177/` with the current local backend.
`npm run review:serve -- --port 43177` verifies every frozen asset. Backend work
can continue without changing this review screen. A same-review restart now keeps
the private access code within the login session, preserving an already-open tab's
connection; live endpoint owners and invalid saved endpoints are rejected.

Early native Windows CI exposed overly strict string comparison of real paths
against DOS/case aliases. The corrected storage boundary checks every ancestor
for links and verifies filesystem identity while accepting those native aliases.
Network/device paths and traversal remain rejected, as do Unix path aliases.
Linux regression checks pass. The native Windows backend step passed on CI run
`41020239038` at source checkpoint `bfe4efe` and again on `41021780480` at
`77c098b`, and again on `41025130927` at `7812082`, including daemon-resume logic;
its larger release build is still in progress.
the general Codex Unix transport is Linux-only and Windows task transport remains
unfinished implementation.

Native Windows run `41028247696` later exposed open-file sharing behavior in the
new atomic-read test. Windows can deny replacement while a reader holds the
destination. Promotion now retries only bounded Windows sharing/lock failures,
without unlinking old state; tests retain the prior file on persistent failure
and exercise a real held reader on Windows. The read-race case distinguishes
Windows's prevention of that rename from Unix's allowed atomic replacement.
Checkpoints `6dcb776` and `d1c5d43` carry this fix. The native backend step
passed at `d1c5d43` on run `41030056076`, including the actual reader-held
Windows promotion case. Its full release build remains separate; the newer
Claude adapter still needs its own native Windows rerun.
The Claude backend's native Windows software step subsequently passed at
`c8a6ffd` on run `41030491650`. Its actual Windows CLI/account/window acceptance
remains open. The newer Linux focus logic also passed the native Windows software
step at `cbfd69c` on run `41031976085`; it still rejects actual Windows window
focus as unimplemented.

The complete Windows release run at `f8f6965` failed after its separate native
backend step passed. Its isolated test harness inherited the temporary SUBST
build drive, which protected storage correctly refused. The harness now resolves
the actual local temporary directory before creating private state. Platform
skip declarations were corrected, and an older integration fixture now issues
current wall-clock permits rather than expired August ones. Its actual local
effect check passed after the change. The next complete Windows CI run must
verify those fixes; unresolved failures remain implementation work.

F77 is absent from USB/input inventory; no unrelated HID device was opened. Live
identity, physical option agreement, key read/write/restore, unplug/replug and
ordinary typing must be checked when it is reconnected. Historical snapshots are
not live evidence. B122 hardware has not arrived. Actual Windows device/shortcut/
DPAPI/lifecycle checks need a Windows host. Actual Microsoft 365 Graph account,
license and permissions acceptance needs an approved tenant/account.

## Unfinished implementation

New workspaces and legacy state without an explicit mode now default to keyboard-only.
Portable imports cannot turn providers on. Companion selections must match the
workspace's Personal or Work policy. Switching back pauses backend observation and
voice, closes that compartment's owned design clients and example processes, and
blocks pending native connection work from restarting after the stop. A real HTTP
check started both bundled examples, switched the dedicated validation workspace
to keyboard-only, verified both owned processes exited, and rejected another
provider start. No keyboard interface or microphone was opened. Shared external
coding runtimes are not killed by this cleanup; they remain outside its ownership.

Workflow text edits now retain role/step identities through reordering. A renamed
role gets a new identity rather than inheriting its old session authority. Saving
a workflow updates its active profile, saved library entry and history atomically.

The device backend now includes semantic macro/layer/modifier assignments,
bounded onboard macro editing and documented physical layout options. Combined
transactions capture encrypted baselines, guard macro execution during partial
writes, read back and restore across restart, and reject unrelated changes before
recovery writes. Kernel locks coordinate Switchyard device access across processes.
See the [device contract and remaining UI/settings work](device-configuration-contract.md).
Standard Vial 4+ QMK settings now use that same protected transaction path, with
advertised-ID discovery, verified field widths/ranges, preserved unowned bits,
versioned recovery and bounded query loops. Unknown/vendor IDs and reset,
calibration or solenoid commands are excluded. All 17 device checks use fault
transports; no hardware write is claimed. A fresh actual USB configuration
inventory still returned zero candidates, without opening an interface.

These are code/product work, not hardware/account blockers: physical role shortcut controls in the next frontend iteration; general coding-task
session control beyond configuration conversations; expanded layer/macro editing UI and device settings
editing; complete Windows release correction and interactive acceptance;
automatic connection restoration during uninstall; broader child supervision;
profile-library visual acceptance; runtime update/recovery lifecycle; assignment legend export.
The Home example is explicitly sample work, never presented as a live agent result.

The integrated suite now has a small, manifest-verified bundle builder and a
standalone runner independent of VS Code or the source checkout. Frozen frontend
bytes are reproducible from commit `e052a88` with the original review digest;
backend modules remain separate. The actual bundled server runs in tests, and
changed/missing/extra files and platform/content mismatches are rejected. Only
selected tracked source enters the bundle. Accounts, protected state, models,
Python environments and npm dependencies are excluded. Both CI lanes now build
private platform packages; the Windows package requires its built native hotkey
helper and includes its source/runtime licenses. This is unsigned development
packaging; the installed path and remaining lifecycle work are described below.
See [build/run details](suite-installation.md).

Managed CLI startup now holds a short startup lock and a separate lifetime lease,
reuses one authenticated instance for concurrent launches, verifies exact build
and process identity, and stops through a signed instance request with exit
readback. Request/response proofs bind fresh nonce, route, origin and generation;
the browser access token is never disclosed during instance discovery. Actual
Linux subprocess tests cover three parallel launches, abrupt-owner recovery,
different-build preservation and occupied ports. The persistent installer,
desktop entry and installed updates/rollback/uninstall are implemented in the next
checkpoint below; broader child containment remains required. These are not marked blocked by absent hardware.

The clean bundle from `6a17a24` also ran outside the checkout with the pilot's
actual protected store: frozen Home hash matched, an unauthenticated API call was
rejected, the dedicated validation workspace remained keyboard-only and the owned
process exited. Its 339 program/source/license files total 2,080,079 bytes.
Private receipt: `runtime-verification/suite-package-1793354686608.json`.
The earlier prototype bundle was removed after verification.

Persistent installation/update/rollback/removal now has code for Linux and
Windows, dated exact-entry backups, complete copy/readback before activation,
current-plus-one-rollback retention and a durable installation journal. Seven
Linux scenarios pass, including actual installed processes across update and
rollback, failed writes, forced owner exit and all-file recovery preflight.
Installed host commands use a verified stable loader rather than a retired
version path. Uninstall retains protected data/runtime and refuses active host
connections until they are restored, so automatic connection restoration remains
unfinished. Pre-promotion crash cleanup and broader provider containment remain
implementation work. Actual pilot installation is recorded below.

Windows CI at `880d1f2` failed the three managed-application startup cases before
the complete release step. Existing backend cases continued to pass. Startup now
emits only bounded allowlisted stage labels over a separate private pipe, and
temporary fixture cleanup tolerates a bounded delay for released Windows handles.
The next native run must identify and fix the actual startup failure. It is a
software defect, separate from unavailable interactive Windows hardware/accounts.

At `2026-10-30T10:29:30Z`, the private pilot installation from `215f351` passed
actual command launch, desktop-file validation, protected validation-workspace
access, verified stop, restart and parallel-launch reuse. It serves the original
frozen frontend at the same private review URL. Program release
`009a13bacd20beea3c35b683a4444df786e641346973aa89068c11382442fd03`
contains 347 files totaling 2,126,459 bytes. Only the installed working version
was retained; the two source bundle copies were removed. Dated launcher evidence
is under `application/installation-backups/2026-10-30T10-28-44.050Z-81b17b5f-f9cb-4ddf-835b-28bb6b895a08/`;
the private host receipt is `runtime-verification/installed-suite-1793356170285.json`.
Browser visual/click and actual keyboard acceptance remain open.

Pre-promotion copy recovery now has a private exact-inventory descriptor and
checks complete hashes or verified source prefixes before removing an interrupted
copy. A forced-copy-exit test preserves unrelated content, then recovers the
known partial copy without changing the active installation.
The latest Windows run at `215f351` narrowed startup to the ownership handshake
and exposed permission-field recovery and lossy numeric file-ID checks. Helpers
now use explicit UTF-8 raw pipes, exact 64-bit file identities and platform-aware
permission metadata. A detached/no-console kernel-lock test was added. Those
Windows fixes still require the next native run; no pass is inferred.

The next native run at `b732ebb` passed exact file-ID handling, permission-field
recovery and detached pipe-only locking. Four application-startup cases still
failed before ownership acknowledgement. The restricted application environment
now retains standard Windows system coordinates while excluding provider keys
and runtime/module injection. Helpers explicitly import only the built-in
PowerShell utility by its absolute system path, avoiding discovery of user or
third-party modules. Allowlisted progress stages now distinguish file setup,
helper input, native sharing errors and lock readiness. Native rerun is required.

The actual installed updater also passed upgrade, rollback and restoration to
`b732ebb`, creating a new verified process generation each time. Saved workflow,
profile/library definitions and the original review URL matched before/after.
Private receipt: `runtime-verification/installed-update-1793356842041.json`.
Only current and one rollback program version remain locally; source bundles
were removed after readback.

## Branch and handover

`feat/switchyard-configuration-loop` starts from Omarchy foundation `25824cc` and
cherry-picks the four existing Studio commits while retaining both original
worktrees. Integrated checkpoints precede the current continuation. Revision 2
handover SHA-256:
`8c3bee6c378548dedab7fed7e959b426d2d9bb7609835d88d354c37cb9e80adb`.
No upstream merge, public release, firmware flash, reset, bootloader action,
solenoid adjustment has been performed here. The private pilot application entry
and its dated installation backups are described above.

## Next three executable tasks

1. Implement verified task-window focus and native terminal attachment/resume;
   retain exact Codex/Claude identities, process ownership and explicit missing
   capabilities. Connect approved task submissions to the existing authority
   machinery without foreground typing or accidental background copies.
2. Complete remaining controller capabilities: key-override and alternate-repeat
   transactions, exact source/model reconciliation and their failure/recovery
   tests. Keep all physical F77/B122 checks separately pending.
3. Finish complete Windows release verification, automatic connection restoration
   and runtime maintenance. Complete portable metadata UI and dynamic assignment
   legends. The frontend remains frozen for the user's morning review;
   task/device/role UI work is still required in the next frontend iteration.

## GitHub and local footprint

All source checkpoints are pushed to `feat/switchyard-configuration-loop` and
[draft PR #20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
Continue committing and pushing tested working increments; keep the ledger and
PR body current. The frozen morning frontend remains unchanged during backend
work. Runtime credentials, models, local hardware snapshots and compiled binaries
are excluded from source control. About 211 MiB of duplicate SDK download,
redundant generated profiles and temporary research staging was removed after
checksum/readback verification. Keep the installed SDK and local transcription
runtime only while required for development/demo; retain small recovery receipts.

## Protected-state concurrency checkpoint

Compartment initialization and mutations now use cross-process kernel locks:
Linux `flock` and Windows exclusive FileStream access. A second process cannot
replace the storage key while another initializes the compartment or lose a
concurrent profile/state write. Lock-holder exit releases the kernel lock; no
stale PID record is deleted based on a guess. Tests exercise two independent
store instances, concurrent updates and an abruptly killed owner. Linux checks
passed; Windows execution remains part of remote CI, not interactive acceptance.
Private file helpers are shared and reject links, foreign/writable state and
oversized reads. The morning frontend is unchanged.

The Windows helper also built successfully on GitHub's Windows runner at the PR
merge revision `69b75f5f2229fbe5d644626cf71b543b52af9945`. Its downloadable artifact
was checked against `SHA256SUMS` and the exact C# source, then local duplicate
verification/publish files were removed. Artifact retention is seven days. This
adds Windows build evidence, not interactive native-window/device acceptance.

## Current Windows verification and category observation

At `5405fa3`, the native Windows backend step passed on run `41043775967`,
including managed application startup, installation/update/rollback, exclusive
state leases and exact file identity handling. The complete release failed four
groups: a stable installed runtime path comparison under the release build's
SUBST drive, two trusted-bootstrap PowerShell fixtures and the installed
Compound Refresh effect. These are software failures, not hardware/account gates.
The next checkpoint canonicalizes the runtime executable before comparing its
identity, shortens owned fixtures for deep release exports and includes protected
synthetic journal errors in the failing effect assertion. A bounded bootstrap
output reader now permits its still-running owned writer. Native rerun is required.

Windows foreground observation now has a native read-only helper contract.
Only broad categories cross its pipe; it does not read window titles, arguments,
URLs or text. Read-only helpers reject registration before any hotkey/layout
operation. Explicit observation consent and workspace policy are checked before
and after each sample. Pause/off/switch closes the owned helper; unavailable
sources stop sampling with truthful state. Other deliberate sources can continue.
Five software tests pass. The actual Windows helper check passed at `29b8e47`
on run `41047167365`, including native registration rejection and process exit. The actual C# source compiled locally with .NET 8.0.424
without warnings/errors; private receipt
`runtime-verification/windows-observer-build-1793358542437.json`.
The Windows workflow now exercises the built helper's read-only handshake,
category response, native registration rejection and process exit. This is distinct from interactive Windows acceptance.

## Portable profile metadata and reviewed migration

The additive v2 package API carries exact geometry/matrix references, recorded
base-layer completeness/digest, US-host-layout assumptions, preferred mode,
stable role/action intent meanings and required capabilities. Legacy Studio
plans/profiles become explicit migration candidates; unknown versions leave
saved state untouched. Revisions detect changes without claiming a signature.
Import review binds current definitions and local role connections. A concurrent
edit invalidates review; adoption clears colliding local role connections and
preserves local accounts, policy and explicitly selected mode. A fresh host
remains keyboard-only. Work export restrictions apply to the new route too.

Seven tests pass, including authenticated HTTP review/import/export and protected
store restart. Portable output excludes credentials, paths, task/session IDs,
local account references and connection authority. The frozen v1 frontend keeps
working; v2 metadata/review UI and second-machine/hardware acceptance remain open.
See [portable profiles](portable-profiles.md).


The v2 path also passed an actual normal installed-application demonstration at
`2026-10-30T11:26:00.935Z` on source `fc298e8`, release `4e39a88c4bef…`.
Eight checks cover migration, stale review, preferred-mode nonactivation,
metadata round-trip, unknown-version preservation, unauthenticated rejection,
normal restart and unchanged Personal definitions. The private review link was
retained; the validation workspace remained keyboard-only. No HID, microphone,
provider or browser visual acceptance is claimed. Private receipt:
`runtime-verification/profile-1793359560936.json`. The reproducible developer
script is `scripts/verify-profile-host.mjs --synthetic`. The verified disposable
bundle was removed; current plus rollback installed copies total about 6 MiB.

The installer now distinguishes an omitted start preference (preserve the prior
running state) from explicit `--no-start` (leave a changed installation stopped).
A native fixture checks this transition without altering the live pilot.


## Owned Windows Codex task transport

The Windows task backend now uses a restricted native app-server over stdio,
with private per-compartment children, metadata-only inventory/read, current-login
fingerprints and exact read-only create/resume checks. It never submits a model
turn or grants tool approval. Effective restrictions and returned permissions are
checked before accepting capability. Mode-off fences pending startup and stops
only that compartment's child; unconfirmed exit blocks a replacement. A thread
ID returned before mode-off or later failure is retained for exact recovery.
The existing Linux shared daemon is preserved.

Eight focused tests pass, including actual JSON-lines subprocess framing,
Windows service composition, durable duplicate prevention and stop isolation.
A real installed Linux Codex 0.166.0 check identified login/read inventory and
verified the native owned app-server exited 31 ms after abrupt owner loss. It
created no thread and submitted no model prompt. Private receipt:
`runtime-verification/codex-stdio-parent-loss-1793360373712.json`.
Windows CI for this source, actual Windows installed-CLI/account acceptance,
window focus and broader task execution controls remain separate open checks.
See [exact task bindings](coding-task-bindings.md).


## Complete Windows release and current installed pilot

The **complete Windows release passed** at `29b8e47` on run `41047167365`:
208 passing test/build groups, zero failed groups. Receipt ID:
`530d5d62-e31f-47c6-8a7e-b0d7f1be9333`. This includes the formerly failing
installed-runtime alias, Windows PowerShell 5.1/pwsh bootstrap and installed
Compound Refresh effect checks. The native read-only helper also verified a real
foreground category (`other`), rejected registration and exited with zero owned
bindings. This is software/native-runner evidence, not interactive Windows device,
account, microphone or user-window acceptance. The newer profile and Codex
transport checkpoints require their own native rerun; the next run is queued.

At `2026-10-30T11:44:02.867495+00:00`, the normal pilot command updated to source `036c70e`,
release `4fdac2c7d43449404662488a1e65cecf58b11f45ceb808bc053dd670370ade40`. Mutual instance proof, v2 package preservation,
keyboard-only validation mode, unchanged Personal definitions and the exact
frozen Home hash all passed. The existing private review URL was retained.
Live configuration-interface inventory returned **zero**; no HID write was
attempted. Private receipt:
`runtime-verification/installed-update-1793360642868.json`.
The verified disposable bundle was removed. Only the current program and one
rollback copy remain; optional runtime and protected data were reused.


## Dynamic controller entries

Vial 4–6 tap-dance/combo advertisement, exact readout, bounded proposals,
physical-unlock writes, acknowledgement/readback and before/after restoration are
implemented. Combined TD/key changes retain the ordinary tap fallback and restore
key references before table entries. Unedited opaque slots are preserved. Nine
new fault tests pass, including interrupted entry bytes, unplug/reconnect,
unrelated-edit preflight, failed backups, old protocols and bad readback.
No hardware writes occurred; the F77 remains absent. Encoder, key-override,
alternate-repeat and broader verified controller features remain implementation
work, alongside their frontend controls. [Protocol guide](device-configuration-contract.md).


Definition-advertised encoder direction read/write/recovery is now implemented.
Nine additional tests pass, including sparse indices, KLE normalization, exact BE
packets, retained unowned directions, partial words, unplug and TD reference
restoration order. The shared test transport is explicitly excluded from release
bundles. Physical encoder behavior and UI controls remain open. Key-override,
alternate-repeat and remaining source-verified controller capabilities are still
implementation work.


The next complete Windows run also passed: source `fe34548`, run `41048512916`,
**209 passing groups**, zero failed groups, receipt
`31e0ac57-0549-447b-8cb6-2c79113d5be2`. It includes portable v2 and the explicit
no-start installer behavior. Source `4cab102` subsequently passed the native
Windows backend step, including the owned stdio task and controller fault tests;
its complete release is still running. Interactive Windows acceptance remains open.

Release/model verification now compares full 64-bit file IDs and refuses
no-follow link substitutions before reading. Two fault tests use distinct IDs
that collide as JavaScript Numbers, plus valid-file controls. Actual shared
runtime verification passed Python 3.12.14, all 48 package pins, no extra
distributions and offline model load with the exact-ID reader. Private receipt:
`runtime-verification/runtime-files-1793362554804.json`. It reused the existing
runtime/model; no software copy, device or microphone was created/opened.

## Runtime lifecycle checkpoint

Source `a650f39` added native acknowledged runtime guardians. The integrated
Linux receipt `10e64199-c29f-4497-9540-25b5371a71d2` passed **103 groups, 716 tests:
707 pass and 9 expected skips**. The complete Windows release at `4cab102` also
finished successfully: **212 groups, zero failures**, run
[41052752221](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41052752221),
receipt `d282b001-6ab9-424c-b6da-290e157320a5`. This includes native task/controller
software checks; interactive hardware/account acceptance remains open.

Versioned optional-runtime storage, shared components, exact specification
selection, current/previous retention, normal CLI maintenance, durable
promotion/cleanup recovery and exact installed-owner stop/restart coordination
are now implemented. Voice, HID and the Python example resolve selected runtime
paths and disable bytecode writes. Focused software/fault checks cover these
paths; the actual pilot adoption and new Windows guardian execution are pending
separate acceptance. Existing pilot environment/model inventories were read
successfully without creating another runtime or downloading a model.

The integrated runtime-lifecycle source check now passes **106/106 Linux groups,
737 tests: 728 passed and 9 expected platform skips**, receipt
`fd1917bc-155d-4a7f-a4a1-a036756f3975`. TypeScript typecheck passed. The C# runtime
guardian and read-only recovery status mode build with zero warnings/errors.
Compiler bin/obj staging was removed; no additional environment/model was built.

## Installed runtime acceptance — October 30, 2026

Normal installed source **7fe13c0**, release
`3eca9a019e950a25d24fbc40d9cb7283924f3cd336ffbdf22f9d8086df58dfb1`,
passed the repeatable `scripts/verify-runtime-host.mjs --adopt` demonstration.
Private receipt `runtime-lifecycle-1793365729575.json` records six checks:
normal verified app update; adoption of the existing `venv` and `base.en` in
place; 48 exact dependencies/no extras and offline CPU model load; exact
installed-owner stop/restart; unchanged update with no downloads/rebuild/restart;
selected voice paths/HID enumeration and preserved definitions/package/mode,
private review URL and exact frozen Home bytes. Runtime record:
`0607bac6765ed3570ddaa614f7d058e4cdab479c2f873c52b1c998d56d867faf`.
Configuration-interface inventory remains **zero**. No physical write or UI
acceptance is claimed.

Two actual-setup issues were fixed before acceptance: the owned legacy `0755`
software root needed a dated `0700` migration, and native target hashing must
preserve Python's venv invocation alias. Earlier failed receipts remain private;
these were software defects, not hardware/account blockers. Both have regression
coverage, and the actual pilot interpreter retained its expected venv prefix.

The selected runtime also passed the actual synthetic CPU/HTTP voice checks
again (`voice-1793365765570.json`): duplicate prevention, correction continuity,
audio erasure after successful saving, explicit review of later text and worker
exit **14 ms** after abrupt owner loss. Temporary audio was removed and the
validation workspace returned to keyboard-only. No microphone was opened.

Integrated source **7fe13c0** passes **106 groups, 738 tests: 729 pass, 9 expected
skips**, receipt `a5d29a59-0497-43b6-a680-1826cf2af743`. Typecheck and the native
C# build passed. All disposable suite bundles and compiler bin/obj staging were
removed. The installed current/rollback program pair is about 6.2 MiB; runtime
inventories/journals occupy about 1.2 MiB. The existing shared runtime/model and
one development SDK remain; no duplicate environment or model was created.

Native Windows runtime guardian execution and dependency imports remain distinct
acceptance items. Automatic host-connection restoration during application
uninstall and broader provider containment remain implementation work.

## Connection restoration during removal

Host operations now use a kernel lease instead of an abandoned-PID-file lock.
Restoration saves a dated copy of the complete current bindings and its reason.
Batch removal preflights all baselines/blocks before writing, journals exact
before/after states and verifies live shortcut/callback removal. Actual forced
process loss after the batch write recovers through a fresh lease in isolated
fault tests; unrelated edits outside both states preserve the configuration.

The installer now stops the exact authenticated generation, blocks other
registered instances, holds application start/owner leases and the host lease
through restoration and program removal. Windows preference restoration
preflights all protected compartments, clears only exact owned re-registration
entries after helper exit, and retains baselines. Missing keys and unowned
bindings prevent removal. Restoration/write/restart failures preserve/recover
the program. A dated verified recovery entry works outside the checkout even
when an interrupted removal deleted the primary loader. These new paths have
focused software/process tests; integrated Linux and native Windows follow-up
checks are running. No live desktop or hardware removal is claimed.

Integrated removal source passes **107/107 Linux groups, 754 tests: 745 passed
and 9 expected platform skips**, receipt
`786042b0-bd8e-4bfb-8422-57c20264af4d`. TypeScript typecheck passed. These checks
include a real forced installer exit and invocation of the dated verified
recovery entry from an unrelated working directory after primary-loader removal.
The pilot app remains installed; no live user installation was removed.

The normal installed backend was then updated to source **7dec739**, release
`c58c2ea5d8068cca5ed08dfd0a1989371fed6cb9aa50ddd9ad2a199be97ffe0f`.
Private receipt `runtime-lifecycle-1793367143958.json` passed five reuse/update
checks: no runtime rebuild/download/restart for matching maintenance, zero
configuration interfaces, preserved definitions/package/modes/private URL and
exact frozen Home hash. Its disposable bundle was removed. Automatic uninstall
remains accepted through isolated software/process tests; the user's live
review installation was not removed.

The Windows `7efce3a` full-release run failed only its isolated Claude group,
although all nine assertions passed in 44.99 seconds. That sits against the
45-second whole-process budget, consistent with a lifecycle deadline overrun.
The bounded Windows allowance is now 120 seconds; Linux remains unchanged. CI
failure output now includes timeout, duration, exit/signal and cleanup fields
so future failures expose that distinction directly. No assertions/skips were
removed. The earlier native backend, read-only helper and eight runtime guardian
checks passed. The complete release remains failed until the next run verifies
the correction; this is a software verification issue, not absent hardware or
an account blocker.

## Additional Vial rule capabilities

Key-override and alternate-repeat table read/review/write/readback/restore are
implemented against the same pinned Vial GUI/QMK contracts. Their mixed 16/8-bit
wire formats are distinct, options/modifiers/layers are closed and explicit,
plain base typing remains protected, and opaque unused slots are preserved.
Vial 6 repeat/alternate-repeat, Caps Word and Layer Lock key forms are gated by
actual advertised tables/bits; older migration sentinels cannot become wire
values. Nine new fault tests bring device/dynamic/encoder/rule coverage to
44 passing cases, including literal packets and mixed-byte partial restoration.
Integrated checks are running. UI exposure, source/model reconciliation and
physical acceptance remain separate unfinished/external work. No HID write
occurred on the pilot: the last actual interface inventory remains empty.

The integrated rule-capability run passes **108 groups, 763 tests: 754 passed,
9 expected platform skips**, receipt
`2b3abb60-fa51-4bce-91ee-7a2f425588a8`. TypeScript typecheck passed. The isolated
test-runner checks also pass after the bounded Windows Claude allowance and
expanded failure diagnostics. Native Windows full verification remains pending.

## Native request refusals

The restricted Codex client now refuses each native approval, permission,
elicitation, input and dynamic-tool request using that method's actual response
schema. Unknown requests receive a protocol error. Malformed frames close the
owned connection and late buffered data cannot restore it. Real-pipe fault tests
and the task/service suites pass **32 tests**. This grants no execution authority;
reviewed general task submissions and native client attachment remain unfinished.

## Profile-derived assignment legends

Authenticated saved-profile export now produces a self-contained assignment
reference and relegendable-cap HTML/SVG sheets. V2 role/intents, modifier meanings,
unassigned actions and review issues remain explicit. Export follows compartment
policy, includes no local account/session authority and has no device/host effect.
The retained cyber_engineer source is hash-verified, its full vector geometry and
credit are preserved, and ink uses exact source face rectangles. Long labels
require an explicit shorter print label rather than splitting words or omitting
meaning. Pagination includes every assigned action.

The actual F77 Dvorak catalog export rendered to an A4 PDF and was visually
inspected after correcting approximate overlay coordinates and word wrapping.
No printer scaling, cap fit, hardware or frontend acceptance is claimed. The
frozen frontend is unchanged; its export control remains implementation work.
The older canonical B122 overlays are a separate generator and still need their
face/panel coordinates reconciled. See [assignment legends](assignment-legends.md).
The export and packaged release checks pass **11 focused tests**; TypeScript
typecheck passes. Integrated Linux verification is running.

Integrated export source passed **109 groups, 771 tests: 762 passed and 9 expected
platform skips**, receipt `2b29d669-60f9-471a-969c-cbba3b0ef3f8`. The normal installed
app was updated to source **70a27d3**, release
`9dfcca96d7198dca422bbc233f352a9a6f2b3bb39583c08bdd0558a87c63e73e`.
Private receipt `assignment-legends-1793369996490.json` passed six update/HTTP
checks: all three actual installed formats matched exact source output,
unauthenticated export was rejected, and Personal definitions, the validation
package/modes, private link and frozen Home bytes were preserved. The disposable
bundle was removed; the current/rollback installation occupies about **7.1 MiB**.
Render receipt `assignment-render-1793370138729.json` retains only hashes and
inspection results; all eight temporary render files were removed.

## Repository-specific native restrictions

The owned Codex stdio path now explicitly disables unified execution, computer
use, code-mode hosting and hooks as well as its previous restrictions. Effective
configuration is checked for the target repository before and after empty-thread
creation/resume, and the same restrictions accompany that request. Additional
project tools fail closed; a late failure preserves the returned identity and
submits no marker/model content. Configuration probes must verify owned exit
before returning. This does not change the user's shared daemon configuration.

The installed native CLI **0.166.0** verified these restrictions against the
actual repository without creating a thread or model turn, and verified its
owned process exit. The native pipe/task/service checks pass **34 tests**;
typecheck passes. Updated integrated verification is running. General approved
submissions, native interactive attachment and authority-broker integration
remain unfinished implementation, distinct from account/hardware acceptance.

The Windows `e5e8ab0` run has passed its native backend, real read-only helper,
eight actual Job Object/owner-loss tests and integrated suite packaging. Its
complete release verification is still running; the earlier full-run Claude
deadline correction is not accepted until that complete result arrives.

That `e5e8ab0` full run finished with **217 groups passing and one failing**
(run `41066193274`, receipt `f422a1db-24bf-4bee-8e03-393e2d8c7840`). Claude's group
passed within its bounded allowance. The failure was the runner contract test's
Windows-only expected-allowance list: it had not included the new Claude entry.
The list is corrected; both platform choices are now directly checked, and CI
runs the runner contract before the native backend to expose this class of
failure early. Bounded verification receipts are retained for seven days even
after a failed full build. The whole Windows release remains unaccepted until
the corrected run completes. No assertion was removed or skip added.

The repository-restriction checkpoint also passes **109 Linux groups, 773 tests:
764 passed and 9 expected platform skips**, receipt
`13dd0367-2656-44b1-8900-053b7b181bd9`. The corrected runner contract passes
its **16 focused tests** locally; native Windows follow-up is pending.

## Exact source keyboard identities

All 40 catalog definitions now carry an eight-byte UID extracted from literal
headers at the existing pinned firmware commits. Forty small source headers
(about 197 kB total) and their hashes/licenses are retained; no firmware is built
or executed. Every upstream saved-preset UID is parsed losslessly from its source
decimal literal and checked against its firmware header. Normal JavaScript
number parsing would round these 64-bit IDs.

The protected readout identification API compares both the complete definition
and exact UID, reports unknown/conflicting identities and undecoded layout
options, preserves stale-readout provenance, and returns case/build/split-part
suggestions without changing profiles or hardware. The F77's Classic and Compact
cases remain ambiguous; source UID matching is not hardware authentication.
The source/catalog/package checks pass **13 focused tests**, including all 40
definitions and lossless literal vectors. Typecheck, source canonicality and
updated integrated Linux verification are running. Frontend reconciliation,
readout-derived profile adoption and actual device acceptance remain separate
unfinished/external work.

The corrected runner contract passed on Windows at `e4513cc`, exposing a later
native-backend failure in five legend cases: checkout had converted the retained
SVG's line endings, so its exact source hash correctly rejected it (run
`41071678292`). A real local Git clone with `core.autocrlf=true` reproduced this
failure. Retained template and upstream catalog sources now disable newline
conversion, while the generated catalog pins LF for canonical regeneration.
The regression verifies both original CRLF instructions and LF vectors/headers
through an actual Windows-style checkout. Source hashes are unchanged and no
integrity check is relaxed. Updated native Windows verification remains pending.

## Readout-derived recommended workflows

The backend now prepares and adopts the recommended four-control workflow from
the captured typing layer, retaining Dvorak and opaque codes instead of copying
factory typing. Unique ordinary positions receive modified intents; duplicates
remain unassigned. Single boards and two distinct declared split halves are
supported; reversed/unrelated halves and missing known split parts are rejected.
Portable right-half matrix offsets remain logical, not a combined controller.

Reviews expire with the two-minute source window and are consumed once. The
exact readout digest is rechecked under the protected import lease. Adoption
preserves mode/policy/accounts/keys and changes no hardware or desktop shortcut.
The existing import machinery clears only the reviewed local role enrollment.
Review identity now also includes the standalone workflow when no profile exists,
closing a stale-review gap found by the new source-adoption tests. The normal
authenticated API accepts interface IDs and a friendly name; callers cannot
replace the protected snapshot or assert its verification.

The readout/catalog/portable suites pass **17 focused tests**, including actual
HTTP review/adopt, duplicate consumption, changed-source/workflow rejection,
Dvorak/opaque retention and paired matrix identity. Typecheck and canonical
catalog checks pass. New integrated verification and normal installed update
follow. The frozen frontend is unchanged; its source/adoption controls and
physical keyboard/pairing acceptance remain pending.

The integrated adoption checkpoint **92022c5** passes **111 Linux groups, 783
tests: 774 passed and 9 expected platform skips**, receipt
`d99b9e9d-81c4-486d-bdb2-f8b4327a03a7`. It is now the normal installed backend,
release `271ab5fc0f7b42e42408dded3653c9f1424afe7f3918c5cbd6e762fd2c84cf45`.
Six normal update/HTTP checks passed in private receipt
`assignment-legends-1793371935262.json`: saved definitions/package/modes/private
link and exact frozen Home were preserved, all export formats matched source,
and unauthenticated export was rejected. The disposable bundle was removed.
The installed current/rollback program pair is about **8.3 MiB**. No runtime/model
copy or new dependency was added. The corrected Windows `51a8996` native backend,
source-checkout, real helper/guardian and packaging steps have passed; complete
release verification is still running. Newer adoption checks await their turn.

The complete Windows release at **51a8996** subsequently passed **220 groups**
(run `41073728335`, receipt `819d42a6-b0f2-4119-951e-609ed910af15`). That includes
the corrected runner allowance, byte-preserving checkout, native backend, actual
read-only helper/guardian checks and the complete build/bootstrap/automation
verification. It does not accept newer uncommitted native-turn changes or
interactive Windows hardware/accounts. Receipt upload exposed one retention
gap: successful release cleanup removes the exported source tree before the
workflow upload. The builder now copies bounded regular receipt files into
verified build provenance first; the workflow collects that success path and
the original failure path. This follow-up awaits Windows verification.

## Account-bound restricted native turns

The owned Codex adapter now verifies the native handshake against its reviewed
CLI version, **0.166.0**, disables 34 explicit feature paths, checks effective
configuration and requires the existing first-party login. Browser control,
image access/generation, automatic approval review, dependency/tool discovery,
shells, hooks and MCP tools are disabled. Unsupported versions and alternate
provider routes fail before creating a thread or sending context. The adapter
does not change the user's global CLI configuration or configure an API key.

Configuration conversations retain the original login fingerprint and exact
returned session. Continuing under a different login is refused before context
submission; a failed attempt preserves the previous proposal and workflow.
Older conversations without a fingerprint are preserved but require an explicit
legacy-binding review (still unfinished) or a new conversation before continuing.

One owned connection runs one design turn per workspace. The bounded response
reader matches both thread and turn IDs, retains the acknowledgement before
accepting early notifications, rejects tool events and checks the account again
before saving a reply. Cancellation before acknowledgement closes only the owned
connection without guessing a turn ID or retrying. Unconfirmed probe/client exit
blocks replacement by either provider. Direct-child exit is evidence about that
child, not proof of general process-tree containment or external task completion.

`scripts/verify-codex-turn-host.mjs --synthetic` passed an actual tiny,
schema-constrained ephemeral turn through installed Codex 0.166.0. The reply
matched, exact identities were retained, the account stayed consistent, and the
owned child exited before its temporary directory was removed. Private receipt:
`codex-restricted-turn-1793374686385.json` (source hashes retained). A fresh
metadata-only owner-loss check also passed: **31 ms** native exit after SIGKILL,
receipt `codex-stdio-parent-loss-1793374784483.json`; no thread or prompt was
created by that check. No account email, session ID or credential is in Git.

The three focused conversation/stdio/turn groups pass **35 tests**, including
changed-login preservation, early replies, exact cancellation and uncertain-exit
quarantine. TypeScript typecheck passes. Updated full Linux verification is
running. General approved coding submissions, legacy account-binding review,
Claude configuration-conversation account binding and broader native attachment/
containment remain implementation work; unavailable hardware does not block them.


The restricted-turn checkpoint passed **112 Linux groups, 792 tests: 783 passed
and 9 expected platform skips**, receipt
`886d33a0-70e9-4e60-8db8-51c443369686`. The final additional tool-completion refusal
also passed its seven focused stream checks.

## First-party Claude configuration conversations

Claude configuration design now uses a bounded native version/auth-status check
before sending context and after receiving a reply. The reviewed design CLI is
**2.1.308**. Its first-party account/org fingerprint is retained with the original
conversation; alternate authentication, changed login/org and unbound legacy
context fail before continuation. Email and org values are not copied into state.
The separate coding-inventory adapter reuses the same fingerprint function.

A new conversation retains its exact requested UUID before launch, claims its
workspace ownership, and requires the returned native UUID to match. A failed or
changed-account reply preserves saved context and the previous proposal. Auth
probes participate in workspace shutdown and uncertain-exit quarantine. Subprocess
environments exclude provider keys, endpoint overrides and runtime injection;
the restricted design launch keeps tools, hooks and MCP disabled.

The conversation/Claude groups pass **30 focused tests**; TypeScript typecheck
passes. An actual installed-account check created and continued one synthetic
configuration conversation with two validated structured replies and the same
session UUID. All owned direct children exited; the isolated protected validation
store and runtime staging were removed. Personal definitions were unchanged.
Private receipt: `claude-account-bound-design-1793375021836.json`. The installed
Claude CLI retains its two tiny native history entries; no history or account
material enters Git. This verifies configuration continuation, not an external
coding task, general process-tree containment or Windows runtime acceptance.

Legacy conversation account-binding review remains unfinished. New conversations
work; older unbound context is preserved until deliberate review. The frozen
frontend and currently installed source remain unchanged during this checkpoint.

The Claude checkpoint passed **113 Linux groups, 797 tests: 788 passed and 9
expected platform skips**, receipt `54e9788c-70ed-48b4-9c53-fc6f974d0169`.

## Deliberate recovery of legacy conversation bindings

The backend now offers authenticated `conversation/binding/review` and
`conversation/binding/bind` routes for older Codex/Claude configuration
conversations that have no account fingerprint. Review shows the exact saved
context and currently verified destination. It explicitly reports that the
original account is unknown. A known account binding cannot be overwritten.
No model prompt, resume or native-session existence claim follows from binding.

Approval uses the protected five-minute one-use ledger, scoped to the workspace,
provider, native session, destination login, saved context, mode, policy and
account enrollment. Consumption survives restart. Context is checked again under
the state lease before binding; stale content, changed enrollment/login, expired
or replayed approvals and cross-workspace tokens are refused. Saved messages,
proposal and original session identity are preserved. The additional local
confirmation domain does not add physical commands or grant tool authority.

The binding/conversation/control-plane groups pass **26 focused tests** and
TypeScript typecheck passes. `scripts/verify-conversation-binding-host.mjs
--synthetic` prepares repeatable installed-route acceptance using invented legacy
session UUIDs and actual native login checks; installed acceptance is pending.
Its synthetic records are removed afterward and modes/definitions are checked.
Frontend exposure remains pending the frozen design review.

The complete legacy-binding checkpoint passes **114 Linux groups, 801 tests:
792 passed and 9 expected platform skips**, receipt
`92b75c6c-7767-4bbb-822b-6115cded4799`. The normal installed application is now
source **1a0f802**, release
`5de40d90265a31856af4e1ee2c767c8fc71e844fda0451494f4f77e73b101999`.
Its six update/export checks passed, preserving definitions, modes, the private
link and frozen Home hash. The disposable bundle was removed. Private receipt:
`assignment-legends-1793375445666.json`.

The new installed-route check also passed **four checks** using the actual native
Codex/Claude login probes and invented legacy session UUIDs. Exact context and
identity were retained, replay and unauthenticated review were rejected, and the
synthetic records were removed. Validation mode/definitions, Personal definitions
and the private link were preserved. Receipt:
`installed-legacy-binding-1793375470441.json`. No native session was resumed or
prompted; existence of the invented IDs is explicitly unverified.

The complete Windows release including readout workflow adoption passed **221
groups** for PR head **3246b7a** (run `41076395406`, receipt
`130127f2-b844-4e65-be1e-8c060e4e1cc8`). GitHub checks out its PR merge revision
`97eaaa2` against unchanged main. This includes actual helper and eight guardian
checks, packaging and complete build/bootstrap/automation. Newer conversation
checkpoints and the successful-build receipt-retention follow-up await their
own Windows run; interactive device/account/window acceptance remains separate.

## Repository identity before native task continuation

New Codex coding-task creation/binding records the native directory device/inode
identity, preserving large file IDs as strings. Status and owned read-only resume
recheck that identity, so a different repository placed at the same pathname is
refused. Explicit binding can add the current directory identity to an older
record that has none; it cannot replace a known identity. The source directory
is checked again before saving a native observation/acknowledgement.

The coding/stdio groups pass **21 focused tests**, including moving the original
directory aside, creating a different Git directory at the same path and
verifying that status, resume and rebinding cannot redirect its saved task.
General approved text submission remains the next implementation step.

The current native configuration exposed a generated `node_repl` MCP entry.
A table containing only `enabled=false` failed native parsing before a prompt.
The owned client now replaces each discovered MCP entry with a complete,
explicitly disabled transport referencing the already trusted CLI and a fixed
`--version` argument. That command is never launched as an MCP server. Effective
configuration still must report every entry disabled; newly appearing enabled
entries fail closed. The user's global configuration is unchanged.

Automatic project instruction discovery is also explicitly set to zero and read
back. The current [official configuration schema](https://developers.openai.com/codex/config-schema.json)
documents additional tool configuration fields that this installed version does
not return. Those fields are not treated as enforced controls. The adapter uses
its verified 0.166.0 contract and read-only sandbox; an instruction or an ignored
configuration field is not a grant or proof of isolation.

An actual restricted ephemeral turn passed with the generated entry disabled,
project-document bytes zero, account stable and exact owned exit verified:
`codex-restricted-turn-1793375838303.json`. The 36 focused conversation/stdio/turn
tests pass, including complete disabled-transport arguments and rejection of
enabled automatic project instructions. General text submission is being built
separately and is not included in this compatibility checkpoint.


## Reviewed Codex coding-task text

The new [native task backend](native-coding-tasks.md) adds exact reviewed text
submission to registered read-only tasks created by Switchyard, separate from
keyboard design conversations. Each operation verifies its native account,
repository device/inode identity, task/session ownership, effective restrictions
and idle metadata. Review does not resume a task or submit text. A five-minute
one-use approval binds the exact text, native identity, account, root and current
workspace policy/enrollment. The native read-only sandbox and explicit shell,
browser and MCP restrictions remain enforced. Saved native context may be used;
this route grants no file-change or command-execution authority.

A durable request is reserved before continuation, its exact returned turn ID is
retained before accepting replies, and repeating a retained request UUID cannot
submit again. Responses are bounded to 32 KiB and explicitly do not verify task
completion. Cancellation and keyboard-only shutdown stop the owned connection
without guessing an unacknowledged turn ID. Unconfirmed owned exit blocks a
replacement in this component. This is not general provider-tree containment.

Uncertain submissions survive restart and block new text for that task until
explicit outcome review. Resolution never retries, reverses effects or infers
completion; another turn still needs fresh approval and verified idle metadata.
Completed private text follows retention; unresolved identities remain for
recovery. History is bounded to 32 entries with storage headroom checked before
prompting, and only completed/failed-before-turn/reviewed records can be deleted.

Ten focused submission fault tests pass, including durable duplicates, stale
scope, wrong permissions, account changes, uncertain exit, failed acknowledgement
storage, pending-startup/mode fences and retention/quota behavior. The combined
runner/binding/conversation checks pass, and TypeScript typecheck passes. Three
new process-heavy Windows protected-state groups receive a bounded 120-second
cold-start allowance, with both platform choices and the exact allowance list
checked; Linux budgets/assertions/skips are unchanged. Full integrated and normal
installed acceptance are running. The frontend stays frozen. Claude task text,
interactive attachment and execution-authority mediation remain implementation
work rather than hardware/account-blocked checks.

The initial submission checkpoint passed **115 Linux groups, 813 tests: 804
passed and 9 expected platform skips**, receipt
`5a9b64e8-51bd-44a6-9609-bdfef1dafd58`. Normal installed update/export also passed
six checks for source **7aeb1e6**, release
`74099a7a50be5cf92bd74b44ee8f92a4af70471b4cf33bdb989a1965bc95330f`,
preserving the frozen frontend, definitions, modes and private link. Its disposable
bundle was removed; receipt `assignment-legends-1793376459558.json`.

Actual installed text acceptance then exposed a native writer-ownership conflict:
an empty task created in the shared Linux daemon remains held by that runtime.
Private continuation was refused before a model turn; both failed proof fixtures
were removed and their modes/definitions restored. Private receipts are
`installed-reviewed-codex-text-1793376494515.json` and
`installed-reviewed-codex-text-1793376606244.json`. This is a software integration
failure, not unavailable hardware/account acceptance. A controlled two-runtime
native check confirmed that `thread/unsubscribe` does not release the writer.

New app tasks now use a dedicated restricted creator on both Linux and Windows.
Its direct child must verify exit before registration; only these explicitly
marked tasks can enter private text review. An uncertain creator exit retains its
returned identity, blocks another creator and never relaunches the request.
Delayed acknowledgements after shutdown are retained as uncertain. Existing
daemon/terminal sessions remain attached to their original runtimes, and dedicated
tasks do not advertise unverified native-client resumption. Legacy daemon resume
checks its own account separately. Default metadata reads use an owned restricted
CLI connection and need no pre-existing daemon.

Claude coding-task create/bind/status/focus also now verifies native repository
device/inode identity. Replacing a directory cannot inherit its saved task or
stop/focus review. Forty-five focused native creator/submission/stdio/Claude checks
pass. TypeScript typecheck passes; fresh integrated and installed text acceptance
are running for the ownership correction.


The ownership correction passed **115 Linux groups, 817 tests: 808 passed and 9
expected platform skips**, receipt `0ef29e04-faa9-4842-b94a-24b9e3843175`.
The normal installed application is now source **201a942**, release
`9ce3a9d4b81ee3aca618987eb346ea26b87701ac589abc0cebc0399e91229808`.
Six normal update/export checks passed, preserving the exact frozen Home,
definitions, modes and private link. The disposable bundle was removed; private
receipt `assignment-legends-1793377247683.json`.

**Installed reviewed text acceptance passed seven checks** with the actual native
Codex login: one exact empty task, separate text review, one prompt returning
`Ready`, exact native acknowledgement retention, duplicate-result reuse, consumed
approval/unauthenticated-review rejection, unchanged synthetic repository and
keyboard-only cleanup. Private receipt:
`installed-reviewed-codex-text-1793377263795.json`. Personal/validation definitions,
active selection and private link were preserved. The synthetic local task/turn
records and private directory were removed. The native CLI retains its small
synthetic history entry. No original daemon session was displaced, file/command
authority granted or external coding-task completion inferred. Newer native
Windows/account acceptance and corresponding frontend controls remain separate.


## Fresh native Windows optional runtime

Release CI now includes an actual fresh optional-runtime check after its native
helper/guardian verification. It verifies the pinned upstream uv 0.12.7 archive,
uses the production Windows Job Object guardian, installs Python 3.12.14 and the
universal hash-locked dependencies, downloads the pinned model and requires
native AV/HID/Whisper/LangChain imports, an actual Runnable and offline CPU model
load. A second inventory/import/model check must verify the same release. This
requires neither hardware nor a provider account, so it is not deferred to those
external gates. Its native result is pending CI.

The disposable software/model stage is removed only after owned exit is verified;
uncertain guardian recovery data is preserved. CI retains a bounded JSON receipt
for seven days, not an environment/model copy. Three orchestration/failure tests
and all sixteen runner-contract checks pass. No additional runtime or model was
downloaded onto the pilot machine. The complete Windows release and interactive
native-account/window acceptance remain separately reported.


The fresh-runtime manifest checkpoint passed **116 Linux groups, 820 tests: 811
passed and 9 expected platform skips**, receipt
`68f6caaf-f384-4e3c-94c7-a6ae2e89e7ee`. GitHub Linux verification also passed at
2c2fec7 (run `41090133820`). Its native Windows run is queued as `41090133750`.

## Reviewed stopped-task Claude text

The separate Claude task-text adapter now verifies the original native account/
org, exact directory identity and full UUID of a stopped Switchyard-owned
background task. Live/waiting/external clients are refused. Continuation uses the
reviewed 2.1.308 CLI with safe mode, tools/MCP/hooks/Chrome disabled, plan mode and
denied permission prompts. The final successful JSON result must match the exact
session, stay within its output bound and contain no permission denials. Auth is
checked again before retaining the reply.

This native envelope supplies a session UUID, not a Codex-style turn
acknowledgement. Records explicitly report `nativeTurnIdSupported: false` and
never invent a turn ID. Provider completion still does not verify coding-task
completion. Both providers now use the same protected review/reservation/
idempotency/retention/outcome lifecycle with distinct action/provider scopes;
foreign-provider history cannot be consumed or deleted through another adapter.

Workspace shutdown stops the owned print before reconciling background inventory,
while preserving local uncertainty. Five Claude pipe/policy/identity/recovery
checks and the shared Codex regressions pass. The combined native text,
conversation and runner groups pass **52 focused tests**; TypeScript typecheck
passes. General provider-tree containment is still unfinished beyond direct-child
exit. Full integrated and installed stopped-task text acceptance are running.

The shared provider checkpoint passed **117 Linux groups, 825 tests: 816 passed
and 9 expected platform skips**, receipt
`e8f0c1f9-616e-4f74-a741-756125d6c28a`. Normal update/export passed six checks for
source **e31e147**, release
`527ac05e69dba36a531c9af89bc5c4ca1fbbd012d4b4b0d2b064e97bc4437dac`;
its disposable bundle was removed. Receipt:
`assignment-legends-1793378903351.json`.

The app worktree has no native Claude workspace-trust approval. Its background
creation was refused before a prompt, and the conservative uncertain fixture was
preserved. Receipt: `installed-reviewed-claude-text-1793378924065.json`. No trust
setting was changed. The earlier empty private contract repository was already
approved and was reused instead. There, actual create, reviewed stop and text
review passed; the native print result did not pass the expected envelope
contract. Its exact request remains unresolved and its reply was not retained.
Receipt: `installed-reviewed-claude-text-1793379061243.json`. This result is not
accepted or attributed to missing hardware.

Native result failures now retain bounded structural diagnostics and any valid
returned session UUID inside the protected request, separately from its original
target. No reply text, credentials, email or account/org data is copied into those
diagnostics. This permits contract diagnosis without guessing a new target or
silently rebinding the task. The fifteen focused provider tests pass. Installed
acceptance is continuing; neither failure is reported as task completion.

The protected Claude diagnostic confirmed a native process exit with no JSON
result, while preserving the original task and refusing to retain a reply.
Receipt: `claude-envelope-diagnostic-1793379516989.json`. Native stderr is now
bounded and reduced to fixed error categories and known option names; raw text
and secrets are not persisted. This distinguishes CLI preconditions from reply
identity errors without exposing provider diagnostics. A verified empty-output
workspace-trust rejection is now recorded as `creation-rejected`, without claiming
an unknown background job or automatically retrying it. These changes preserve
native trust settings. Native continuation acceptance remains in progress.

## Claude first-turn lifecycle and Windows evidence checkpoint

The stopped empty-background Claude trial was rejected with no result and a
classified session-unavailable diagnostic. No reply or replacement identity was
accepted. New `coding/claude/text/create` reservations now explicitly report that
no native conversation exists yet. The first separately reviewed turn must verify
its requested UUID; continuation then uses that exact native UUID. Uncertain
first creation is blocked across outcome review and restart. Existing background
identities are preserved. The 32 focused native task/lifecycle tests and
TypeScript checks pass; installed first-turn/continuation acceptance is pending.

The complete Windows release at 7aeb1e6 passed **225 groups** in run
41086724429 (receipt a3672c96-9eca-49bd-a92b-e973ea7d8e94), including actual
native guardian/owner-loss checks. Its bounded receipt artifact was retained
correctly. The later fresh optional-runtime Windows check is failing in native
CI and is being diagnosed as a software/integration failure. It is not marked
hardware/account-blocked or accepted. Linux integrated evidence at e31e147 is
117 groups, 825 tests: 816 pass and nine platform skips (receipt
e8f0c1f9-616e-4f74-a741-756125d6c28a).

The normal installed Claude text journey now passed **nine checks** against
43ac630: two separately reviewed synthetic prompts created and continued the
same exact native UUID, repeated request IDs reused their saved reply, replay
and unauthenticated review were rejected, Git state was preserved, and final
keyboard-only cleanup removed the synthetic local records while retaining the
small native conversation. Receipt:
installed-reviewed-claude-text-1793380499845.json (private workstation evidence).
No native turn ID, general tool authority or task-completion verification is
claimed. The verifier compares existing task definitions independently of their
expected refreshed observation timestamps.

The fresh Windows runtime failed before native readiness: the verifier used the
explicit desktop environment, which includes standard `ProgramFiles(x86)` and
`CommonProgramFiles(x86)` names, while the guardian only accepted POSIX-style
identifiers. The guardian now accepts those two Windows coordinates explicitly;
other parenthesized names remain rejected. The verifier uses its narrower runtime
environment and retains a bounded preflight failure receipt too. The native helper
build passes with zero warnings/errors on the pilot; its actual Windows test is
queued for CI. Eleven applicable guardian/runtime tests passed locally, with the
one added Windows environment test correctly pending native Windows execution.

The latest integrated Linux run passed all 117 groups: **832 tests, 823 pass and
nine platform skips**, receipt 70559d96-91a8-421e-9760-7c194fa07f4d.
The frozen frontend and installed private link are preserved.

## Canonical B122 print geometry accepted in software

The older approximate overlay positions are removed. Canonical sheets now match
all 33 literal faces to the pinned source SVG and derive all sixty full-insert
flaps plus clip cuts from that same source. Ink stays inside cut boundaries; the
side labels leave one point clear of the clip ends. PDF and SVG share text layout
with a 4.75 pt minimum, word/hyphen wrapping and no glyph stretching. The compact
RE-ANCHOR label wraps at its hyphen. The short Run/Alt label is STOP OWNED RUN,
retaining the existing managed-only action. No protocol assignment changed.

All three two-page palette PDFs and all 22 actual-scale standalone SVGs were
rendered and visually inspected. All 26 documentation tests and deterministic
regeneration pass with the pinned Node 24 environment. The generator also uses
the pinned pypdf compression API and attaches source pages to its writer before
merging. The original creator notices and 15 mm calibration box are preserved.
Private receipt: canonical-legend-geometry-1793381215131.json. Printer scaling,
physical cap fit, final branded artwork and hardware commissioning remain open;
the source geometry is not a hardware measurement. Temporary review tooling and
PNGs are disposable; the canonical PDFs/SVGs remain in Git.

Next independently executable work: finish owned-provider crash containment;
implement supported exact native client attachment and authority mediation;
complete the remaining verified controller controls and expose the accumulated
backend controls after the frozen frontend review. Native Windows fresh-runtime
acceptance is being monitored separately.

## Native Windows runtime accepted; private provider transport checkpoint

The corrected fresh Windows runtime check at 222dfca passed in run 41097396455.
The retained native receipt independently confirms Python 3.12.14, 49 exact
distributions, no extras, CPU model load, same-release independent recheck and
removal of the disposable runtime. Artifact 12998575101 is a 760-byte ZIP; its
verified SHA-256 is
921808014e9dcc5e19f637cf4e0bfb88531c4f7313213d69304eeef302060f24.
A small receipt copy is retained privately as windows-fresh-runtime-222dfca.json.
The full release check is still running; microphone/device/account acceptance
is not inferred. No new runtime/model copy was placed on the pilot.

The native guardian now has a private bounded text-input/diagnostic contract for
provider turns, capability-gated before start acknowledgement, with AbortSignal
cleanup. Fifteen applicable runtime/guardian checks pass on Linux; one Windows
environment-block case awaits native CI. The helper builds with zero warnings
and errors. This is the transport foundation; Claude reviewed-task integration
and durable guardian recovery are still being implemented.

## Claude owned-command lifecycle integration

Claude text turns now use the production native guardian rather than a direct
print child. The encrypted request saves the exact guardian scope before start
acknowledgement, and records verified exit before accepting a bounded native
reply. Text travels over stdin, with optional diagnostics kept in memory and
only structural failure categories retained. Shared text cleanup retains the
complete owned resource when exit is uncertain. Recovery checks the saved scope
before any replacement; keyboard-only cleanup and shutdown also check it.
Unverified guardian records cannot be deleted or pruned after outcome review.

Fifty applicable focused tests passed with one native Windows environment case
skipped on Linux (51 total), including actual Linux private input, cancellation,
resource readiness/exit and owner-loss boundaries. The helper builds with zero
warnings/errors and TypeScript checks pass. The normal installed Claude journey
now asserts distinct recorded/stopped guardians for its exact first and continued
turn; that updated installed check is pending. Windows native private-pipe checks
are queued separately. This is owned-session/Job containment, not a general OS
sandbox or proof of containment for deliberately detached Linux processes.
Metadata probes, native shared background services, broader terminal attachment
and execution-authority integration remain distinct unfinished work.

The normal installed guarded-Claude journey passed **ten checks** at f2d11f3,
with two separately reviewed native turns, distinct saved guardian scopes and
verified exit before reply retention. Duplicate/replay checks, unchanged Git
state and keyboard-only cleanup passed; synthetic local records and disposable
bundle staging were removed. Receipt:
installed-reviewed-claude-text-1793381931590.json. Configuration interface discovery
still returns zero devices; no HID operation was written.

The later integrated run 5dc771ba-0657-4a05-846f-a5bba9864838 was **not accepted**:
116/117 groups passed and every test body passed, but the runner correctly rejected
a new unexpected Linux skip. The environment-name test now verifies Linux rejection
of Windows-only identifiers rather than skipping there. The source-only Windows
lane's exact helper-absence skip allowance is updated from eight to fourteen,
matching the expanded boundary cases that run for real in its separate built-helper
CI step. The corrected full run is being rerun; the previous accepted integrated
receipt remains 70559d96-91a8-421e-9760-7c194fa07f4d.

The corrected integrated Linux run is accepted: **117/117 groups, 839 tests,
830 passed and nine expected platform skips**, receipt
e1949f40-b7c5-4987-89c3-99151dc6786a. All fourteen native guardian tests run on
Linux, including rejection of Windows-only environment identifiers before a
target can start. Native Windows executes those boundary cases in its separate
built-helper step; its source-only lane records the exact helper-absence skips.
Malformed native lifecycle objects/capability fields now fail the owned command
rather than escaping the response parser. The last normal installed backend is
f2d11f3, with frozen frontend and private endpoint preserved.

## Explicit recovery of uncertain Claude first creation

A task whose first native acceptance was lost now has separate recovery
review/submit routes. The previous uncertain outcome must be deliberately
reviewed first; fresh approval binds the original UUID, account, repository,
text and recovery operation. Recovery uses native `--resume` only and cannot
fall back to `--session-id` or fork. A successful exact reply atomically verifies
the original task and restores normal continuation. Missing native history
retains uncertainty. Request identities cannot cross ordinary/recovery scopes;
repeated recovery requests reuse the durable saved result.

All 51 focused native-task/suite checks and TypeScript checks pass, including
missing-history preservation and rejected recovery before outcome review. The
normal installed journey now includes a synthetic lost-local-acceptance fault
against an actual existing native conversation, then separate recovery approval;
that expanded native acceptance is pending. This is not an automatic retry or
proof of external task completion.

The expanded installed Claude journey passed **13 checks** at 4eea520 with three
separately reviewed synthetic prompts. It created/continued one native UUID,
injected a loss of local first-creation acceptance, required outcome review,
then recovered that exact existing native conversation through resume-only
approval. Recovery/ordinary request-scope and duplicate checks passed; final
keyboard-only cleanup removed the synthetic local records. Receipt:
installed-reviewed-claude-text-1793382629147.json. This is a synthetic local
fault injection against a real native conversation, not a claimed hardware crash.

The complete Linux run at that checkpoint is accepted: **117/117 groups, 841
tests, 832 passed and nine platform skips**, receipt
6f8e3e9c-0c9e-4e84-8e06-832c1d334dbd. The normal application is release
d3429262c8c69d6b348247f3c0f9d2dc5fd03b41efc789f8f258789f74232464;
its six update/export checks preserved the exact frozen Home and private link.

Windows CI now checks each native documentation-generator exit code immediately.
PowerShell's default native-command error preference can otherwise allow a later
successful command to hide an earlier failure. See Microsoft's
[preference-variable contract](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables).
This closes an error-propagation gap; it does not retroactively accept old legend
checks. The full Windows checkpoint still needs its corrected complete run.

## Read-only host lock indicator backend

The new authenticated host keyboard-indicator route separates OS output state
from firmware keymaps. Linux reads bounded kernel lock LED nodes by input
instance, preserving disagreements and null unknown values. The actual pilot
reported one input instance with three readable indicators; no device is linked
and no key or LED state was changed. Windows implements a separate fixed native
GetKeyboardState mode under the existing owned guardian, returning only three
toggle booleans with explicit calling-thread provenance and no live physical
attestation. No hooks, input-thread attachment or input injection is added.

Fifty focused indicator/suite/runner/native guardian tests and TypeScript checks
pass; the native helper builds with zero warnings/errors. Windows observer CI
now exercises the new contract after the helper is built. Actual Windows
interactive state and device LED acceptance remain open. The normal installed
Linux route/retention-preservation demonstration passed all four checks, including
independent stable kernel readback, unauthorized-request rejection and unchanged
workspace definitions, mode, selection and private access URL. Receipt:
installed-keyboard-indicators-1793384062783.json. Complete Linux source acceptance
at `3a01549` is 118/118 groups, 845 tests: 836 passed and nine platform skips;
receipt 54a0a8ef-d251-4c32-9735-e8f8e2cb2131.

The latest Codex regression also passed all seven installed checks after the
shared recovery refactor (one tiny native prompt, exact acknowledgement,
duplicates/replay, unchanged repository and keyboard-only cleanup). Receipt:
installed-reviewed-codex-text-1793382924738.json. Browser automation currently
exposes no Switchyard tab; no browser navigation or frozen-frontend reload was
performed.

## Reproducible Windows documentation checkout

The native Windows backend test step at `3a01549` passed. The now-strict
documentation step then correctly rejected generated text and its byte-digest
manifest because Windows checkout converted text to CRLF. The repository default
now requires LF for detected text, with retained vendor source trees still
explicitly exempt and PDFs/images treated as binary. This addresses source
checkout determinism; it does not establish a complete Windows release pass.

## Consented Vial matrix diagnostic and verified relock

The backend now has a one-use explicit consent review, physical-unlock preflight
and ephemeral switch-state sampling for the active permitted workspace. Samples
are never persisted or routed to a provider. Capture is bounded to 60 seconds,
240 samples and a 100 ms minimum interval, with no background polling. Exact
protected scope, live UID/protocol and complete definition checks fence every
request. Unlock is checked on both sides of each matrix query. Stop, mode,
workspace, expiry and shutdown revoke capture and reject late responses.

The source-specific codec enforces the actual firmware compile guard, big-endian
row packing and strict reply bounds. A separate exact-target relock command
checks locked readback, including refusal by insecure firmware. Ten focused
matrix tests cover these paths with synthetic transports; the existing 60 device
and suite checks also pass. The normal installed rejection-path demonstration
passed six checks without HID or key capture (receipt
installed-matrix-boundaries-1793384678511.json). The update retained the exact
frontend and removed its disposable bundle. Complete Linux acceptance at
`30168d3`: 119/119 groups, 855 tests, 846 passed and nine platform skips; receipt
934ec9a0-77f8-4be6-93be-98636e093a7f. Frontend controls remain unfinished;
actual physical switch, unlock/relock and typing acceptance need the device.

## Supervised native Claude command lifecycle

Claude coding-task version/account/inventory, background creation and exact stop
commands now run through the shared owned native guardian instead of direct
child-only management. Policy and generation are rechecked before target start.
Each command has a 20-second deadline, bounded stdout/private stderr, no input
and verified guardian exit. An unconfirmed command stays quarantined, blocks
replacement in its workspace and causes shutdown to report incomplete exit.
Concurrent cleanup calls share one operation. The provider's separate native
background service is still governed by exact inventory/stop readback; guardian
ownership of a CLI command is not general sandbox or shared-daemon ownership.

Three additional lifecycle tests pass alongside the existing native coding,
reviewed text, suite and guardian checks (58 focused tests total); typecheck
passes. The normal installed metadata-only demonstration passed seven checks,
including six distinct actual native guardians independently verified exited,
Work rejection before launch and preserved installed state/selection/private URL.
Receipt: installed-claude-commands-1793385000379.json. A trailing directory
separator in the first verification attempt was rejected by the canonical-path
fence; the script now resolves the actual repository path before querying it.
Temporary isolated encrypted state was removed on both attempts.

The new installed empty-background regression also passed both scenarios with
no model prompt: the newly created task remained observable after its creator
guardian exited, and its separately reviewed exact stop read back stopped and
rejected replay. Its durable request lives in a dedicated keyboard-only validation
workspace, preventing accidental duplicate creation on rerun. Receipt:
claude-suite-1793385128325.json. No external session or native trust setting was
changed. Complete Linux acceptance at `dc5f699` is 119/119 groups, 858 tests:
849 passed and nine platform skips; receipt 775a1344-2f6b-4a7e-9be1-0126fa7df482.
Designer subprocess and metadata paths outside this coding-task service still
require lifecycle work.

## Shared native Claude metadata supervision

The shared version/account/inventory probes used by configuration conversations
and reviewed coding text now use the same owned guardian. Their exact clients
join the caller's existing stop/quarantine mechanism; unverified guardian exit
retains the complete owned client rather than only its direct process. Policy
and generation checks run again before target start and before retaining output.
Fixed argument vectors, operation-specific output caps, no stdin and discarded
stderr keep this a metadata-only contract. Ownership tracking failure prevents
target start and closes its unused client. Successfully reconciled probe clients
are removed from auxiliary ownership tracking.

Six new shared-metadata boundary tests plus the affected design/text, suite,
native guardian and verification-runner tests pass: 74 focused checks with no
skips. Typecheck passes. The normal installed metadata demonstration passed eight
checks with nine actual distinct guardians independently verified exited,
including shared designer/text-task probes. Temporary isolated encrypted state
was removed. Receipt: installed-claude-commands-1793385399492.json. The installed
Claude text journey also passed all 13 checks again (three tiny separately
reviewed prompts, exact create/continue/recover, unchanged source, keyboard-only
cleanup and removal of successful synthetic local records); receipt
installed-reviewed-claude-text-1793385438049.json. Complete Linux acceptance at
`468b9ac`: 120/120 groups, 864 tests, 855 passed and nine platform skips; receipt
a118038d-3ce9-4fa8-af43-ee3dc6f07b6e. Fresh normal installed device enumeration at
18:37 UTC still returned zero configuration interfaces; no device was opened.
Configuration designer model subprocess containment remains unfinished;
this checkpoint does not claim general provider containment is complete.

## Canonical documentation fingerprints and raster encoding

The Windows backend step passed at `30168d3`, then strict documentation checking
correctly rejected a remaining stale source-digest manifest. The LF checkout
rule fixed text output mismatches; the manifest now records actual current
source bytes. Linux's PNG compression library also emitted a different byte
stream for identical pixels. Generation now retains the committed small demo PNG
only after an exact bounded RGB pixel comparison; the manifest still hashes the
original complete encoded bytes. A changed pixel or invalid image forces a new
render and fails a stale check. No PDF, SVG or demo PNG content was changed.

Both documentation/legend generator checks and all 27 Python documentation tests
pass using CI's pinned Python 3.13.3. A new compression-variant test also checks
that a one-pixel change cannot be hidden. The temporary Python installations and
dependency environments are removed after this verification. Complete native
Windows acceptance remains pending; software failures are not hardware blockers.

## Bounded complete designer context transport

The internal native guardian now accepts at most 512 KiB of UTF-8 stdin, with
an encoded request bounded to 1 MiB. Input above the existing 12,000-byte size
requires an additional advertised capability before start. The Linux reader
also bounds the total owner stream including its acknowledgement; the Windows
helper validates the same decoded input bound. Reviewed coding-task text keeps
its separate 12,000-byte product limit. This prepares full keyboard/workflow
context for supervised configuration design; that designer model-process
migration is still unfinished at this checkpoint.

An actual native exact-limit multibyte test verified the byte count and SHA-256
after readiness, with no text in argv and independently verified guardian exit.
An over-limit input cannot start a guardian. All 56 focused transport, runner,
metadata, coding and indicator tests pass; TypeScript checks pass and the native
Windows helper builds with zero warnings/errors. The source-only Windows skip
inventory is now 15, matching the separately built helper's native test group.
Actual Windows large-input acceptance awaits CI.

## Supervised configuration designer process

Claude's configuration designer now uses the owned native guardian for the model
process as well as metadata. The exact scope is committed to its encrypted
conversation before model execution and verified exit is recorded before a
proposal is retained. Complete context is bounded before any native request.
Structured success, permission-denial absence, exact native UUID and stable
account checks remain required; proposals still undergo independent validation.
Cancellation and workspace shutdown stop the exact owned resource. Unverified
ownership survives retention and restart and blocks provider replacement until
independent exact exit reconciliation. Shutdown reports an unconfirmed owned exit.

Four additional tests cover pre-start durable scope, full-board continuation,
cancelled late output, restart/retention and oversized context. All 42 affected
designer/text/suite/binding checks and typecheck pass. The installed API journey
now checks two synthetic replies, distinct exited guardians, protected ownership,
authentication, keyboard-only cleanup and preserved definitions. That normal
installed journey passed all seven checks with two tiny synthetic prompts;
receipt installed-claude-design-1793386347178.json. Both model guardians were
independently verified exited; only the verified test conversation was removed.
No keyboard write, external-session stop or personal definition change occurred.
Complete Linux acceptance at `9781e6c`: 120/120 groups, 869 tests, 860 passed and
nine platform skips; receipt dfd60a04-a929-4351-ad96-e24ad2a96765. The normal update
preserved the frozen frontend and removed its disposable bundle. No Windows
native agent/account acceptance is inferred.
