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
