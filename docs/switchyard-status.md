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
- Integrated native Linux run: **86/86 groups passed; 575 tests, 566 passed and 9
  expected platform skips**. Receipt:
  `.sxsy-verification/isolated-test-1482e6d6-8f89-4e9f-a909-9036f042e8e8.json`.
- Current focused Studio run after typing-layer rebasing and microphone-release
  changes: **51/51 tests passed**, no skips. This includes all 104 named catalog
  configurations, physical option variations, encrypted compartment boundaries,
  device fault/restore paths and SDK/OAuth contract tests.
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
- Installed Claude Code 2.1.308 completed a real configuration design request
  with tools/hooks/MCP disabled for that session and its existing account.
- Real custom Node and Python LangChain Runnable examples registered distinct
  sessions, received an authenticated review intent and acknowledged completion.
  An example's acknowledgement is self-report, not verified coding-task evidence.
- Local CPU faster-whisper transcribed synthetic speech without an external API.
  Recognition was imperfect; transcript correction remains part of the flow.
  A live microphone conversation has not yet been accepted.
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
can continue without changing this review screen.

F77 is absent from USB/input inventory; no unrelated HID device was opened. Live
identity, physical option agreement, key read/write/restore, unplug/replug and
ordinary typing must be checked when it is reconnected. Historical snapshots are
not live evidence. B122 hardware has not arrived. Actual Windows device/shortcut/
DPAPI/lifecycle checks need a Windows host. Actual Microsoft 365 Graph account,
license and permissions acceptance needs an approved tenant/account.

## Unfinished implementation

These are code/product work, not hardware/account blockers: physical role shortcut controls in the next frontend iteration; general coding-task
session control beyond configuration conversations; full layer/macro/settings
editing; Windows interactive acceptance and packaging; install/update/rollback/uninstall and
a normal launcher; interprocess coordination and child supervision; profile-library visual acceptance; reproducible optional dependency installation; assignment legend export.
The Home example is explicitly sample work, never presented as a live agent result.

## Branch and handover

`feat/switchyard-configuration-loop` starts from Omarchy foundation `25824cc` and
cherry-picks the four existing Studio commits while retaining both original
worktrees. Integrated checkpoints precede the current continuation. Revision 2
handover SHA-256:
`8c3bee6c378548dedab7fed7e959b426d2d9bb7609835d88d354c37cb9e80adb`.
No upstream merge, public release, firmware flash, reset, bootloader action,
solenoid adjustment or persistent desktop modification has been performed here.

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
