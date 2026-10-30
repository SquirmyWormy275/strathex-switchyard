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
- Integrated native Linux run: **97/97 groups passed; 667 tests, 658 passed and 9
  expected platform skips**. Receipt:
  `.sxsy-verification/isolated-test-c1579860-23fc-4385-b51b-22a68c0ca50f.json`.
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
editing; Windows managed-startup correction and interactive acceptance;
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
2. Complete remaining controller capabilities: tap-dance/combo/encoder/settings
   transactions, exact source/model reconciliation and their failure/recovery
   tests. Keep all physical F77/B122 checks separately pending.
3. Fix native Windows managed startup and finish automatic connection restoration and runtime
   maintenance. Then complete profile compatibility metadata and dynamic
   assignment legends. The frontend remains frozen for the user's morning review;
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
