# Integrated application packaging

Switchyard's new suite can now be built as a small, self-contained application
directory. It starts independently of the checkout and VS Code, using an existing
Node **24.14.0** installation. The current Linux package is approximately 4.5 MiB (552 files at `738c1f7`).
The packaged first-party catalog provenance index uses a declared, bounded
gzip JSON encoding. Every field and all upstream source/notice bytes are retained;
source checkouts continue using JSON. [Packaging evidence](evidence/design-observations-source-summary.json).
The optional Python/HID/voice runtime, model, accounts, protected workspaces and
recovery records remain outside the bundle and are reused.

This is a **private development package**, not a signed public release. The
manifest verifies every file and binds the platform, source commit, Node version
and frozen frontend. An independently obtained expected content identity detects
replacement; the manifest alone does not authenticate a publisher. Updates are
not downloaded or trusted automatically.

## Build and run a checkpoint

From a clean source checkout:

```sh
mise exec node@24.14.0 -- npm run suite:package
```

The command prints the exact bundle directory, SHA-256 identity and byte count.
It includes only selected tracked source, the required backend dependencies,
examples, catalog source and licenses. It excludes tests, credentials, caches,
installed dependencies, models and checkout history. The currently frozen morning
frontend is reconstructed from committed bytes and its recorded hashes; the live
review artifact is never regenerated or overwritten.

Run the printed bundle, from any working directory:

```sh
/absolute/path/to/node /absolute/bundle/deployment/suite/run.mjs
```

Open its private loopback link. `--port 43177` chooses the pilot review port and
retains the same frozen review's private access only after its previous owner
has exited. A live owner is never displaced. The packaged frontend uses a separate
directory so frozen browser modules cannot replace newer backend modules.

The managed CLI starts or reuses exactly one application owner:

```sh
/absolute/path/to/node /absolute/bundle/deployment/suite/cli.mjs launch --no-open
/absolute/path/to/node /absolute/bundle/deployment/suite/cli.mjs status
/absolute/path/to/node /absolute/bundle/deployment/suite/cli.mjs stop
```

Omit `--no-open` to use the normal OS URL opener. Startup is serialized by a
kernel lock; a separate lifetime lease belongs to the application process.
Concurrent launches reuse the exact authenticated build. Discovery signs both
directions with fresh, route-bound HMAC, so an unverified replacement listener
never receives the browser access token. Stop addresses the same instance and
requires process-exit readback. It does not infer completion of a coding task.
An occupied port or another live build is preserved for deliberate resolution.
Abrupt owner loss releases the kernel lease; the saved endpoint remains for
recovery, and a later launch creates a new generation without replaying actions.

For an explicitly labeled uncommitted development build, add `--allow-dirty`.
Untracked files are still excluded. Commit tested checkpoints before regular
packaging. Generated bundles live under `artifacts/switchyard-suite/` and stay
outside Git; retain only the working package and required rollback version.

## Windows build

Windows packages also require the self-contained native hotkey helper, built from
the reviewed repository-local .NET toolchain. Its executable, source and runtime
license texts are included:

```powershell
node .\scripts\build-switchyard-suite.mjs --windows-hotkeys=C:\absolute\Switchyard.Hotkeys.exe
```

Both CI workflows run actual packaged-server and integrity-failure tests. They
also build the platform bundle and retain it as a private Actions artifact for
seven days. Those builds do not establish interactive Windows device, shortcut,
DPAPI, focus or microphone acceptance.

## Install, update, restore and remove

After reviewing the bundle identity printed by the builder:

```sh
/absolute/path/to/node /absolute/bundle/deployment/suite/manage.mjs install /absolute/bundle EXPECTED_SHA256
switchyard launch
switchyard status
switchyard update /absolute/new-bundle EXPECTED_SHA256
switchyard rollback
switchyard recover
switchyard uninstall
```

Linux installs to `~/.local/share/strathex-switchyard/application`, adds
`~/.local/bin/switchyard` and a **Switchyard** desktop entry. Windows installs
under `%LOCALAPPDATA%\Programs\Switchyard`, creates a Start Menu shortcut and
provides `switchyard.cmd` in that directory. Native shortcut creation reads back
the exact target and arguments. Neither path installs a login autostart service.
Add `--no-start` to installation/update for deliberate headless setup.

The Windows shortcut writer retains its ten-second execution deadline and bounded
request/response. On timeout, excess output or process error, the installer waits
for the owned direct child to exit before removing its temporary shortcut. The
existing bounded termination helper allows 1.5 seconds for ordinary shutdown and
1.5 seconds for final readback; these are cleanup bounds, not extra execution
time. An unconfirmed exit fails explicitly and preserves the exact owned staging
file. A verified response is accepted only after successful process closure.

Twenty-three focused groups accept 69 distinct checks, including actual controlled
Node writers, late output after termination, unconfirmed exit and the original
installation/rollback/package tests. These controlled writers do not exercise
Windows COM. Native Windows 9f35961 now also passes all sixteen original install/
recovery scenarios plus nine writer checks, with exact cleanup and no extended
deadlines. The historical ten-second failure remains recorded separately; its
cause is not established by this later pass. Interactive user acceptance remains
separate. [Native acceptance](evidence/shortcut-writer-native-summary.json).
[Source evidence](evidence/shortcut-writer-retirement-source-summary.json),
[native failure](evidence/windows-shortcut-timeout-summary.json).

Only the current program version and one rollback version are retained. A stable
loader verifies the pinned Node executable and expected release before loading
the application. Installed Linux host shortcuts use that stable entry, so
retiring a previous program version cannot break their command path.

Every persistent entry change has a dated exact-byte backup and reason under
the private application state directory's `installation-backups/`. A durable
journal precedes replacement. Failed writes restore the previous entry bytes;
`recover` handles interrupted transactions and refuses unrelated edits before
writing anything. A committed update whose final cleanup was interrupted is
kept. Unowned or subsequently edited launchers are preserved. Unknown/modified
program contents are retained and reported as pending cleanup.
Pre-promotion recovery also records the exact staging inventory. Completed files
must match their hashes; an incomplete copy must match the exact prefix of an
independently verified source. Unrelated staging content is preserved before
any deletion.

Uninstall first verifies and stops the exact installed application, then holds
its start/owner leases while restoring host connections and removing owned
entries. Linux preflights every saved active shortcut, saves a dated copy of the
complete current configuration, removes exact owned blocks, reloads and reads
back shortcuts/callbacks. The host lease remains held through program removal.
Windows clears exact owned saved re-registration preferences after the app/helper
has exited; it preserves protected original baselines and creates no new helper
or registration during removal.

An edited/ambiguous binding, missing protected key, unconfirmed process exit or
another registered instance preserves the program. A restoration conflict
resumes the previous running app. Interrupted batch restoration uses an exact
before/after journal; unrelated later edits stop recovery without overwriting
them. Successful removal retains protected workspaces, OS credential entries,
device recovery records and the optional runtime. Use the separate
[optional-runtime maintenance command](optional-runtime.md) to remove generated
Python/model components deliberately.

Each installation journal also records `recoveryNode` and `recoveryEntry`: a
small, dated verified recovery entry outside the program directory. If an
interrupted uninstall already removed the main `switchyard` command, run the
recorded Node executable with the recorded recovery entry and `recover` as its
arguments. It verifies the pinned executable and retained release before loading
recovery code, works outside the checkout, and restores exact owned entries.
Restart failure keeps the recovery journal available for another attempt.

## Current evidence and remaining acceptance

Integrated Linux tests cover actual installed application processes, normal
update/rollback, exact-generation stop rejection, host-restoration ordering,
conflict preservation, unconfirmed exit, failed removal/restart, and forced
installer loss. A dated recovery entry has restored an interrupted uninstall
from outside the checkout after the primary loader was removed. Linux shortcut
batch tests use a synthetic compositor with actual subprocess/kernel-lease loss;
they do not establish physical key or live-desktop removal acceptance.

The pilot normal installation is source **1bee5a5**, with 554 files/4,749,428 bytes.
Its normal update passes **101 metadata/refusal checks across 59 exact modules**.
All 54 semantic workspaces, four profiles, 57 workflows, selected compartment,
pending keyboard-only conversation, private review link and frozen frontend are
preserved. Dated launcher backups and persistent-file readback verify; only the
current version and one rollback remain. The exact temporary bundle is removed.
[Installed update evidence](evidence/installed-claude-319-summary.json).

The existing optional runtime is reused. Earlier adoption verified 48 exact
dependencies, offline CPU model load, synthetic CPU/HTTP voice and owned worker
retirement. This update introduces no runtime/model downloads and makes no live
account, provider/task/model, agent, keyboard or microphone request.

The complete Windows release passed **212 groups** at `4cab102`, including the
previously failing alias/bootstrap/automation cases and native task/controller
checks. At `7efce3a`, native backend tests, read-only category observation and
runtime Job Object owner-loss checks also passed. Its full run later reported
the Claude group failed despite nine passing assertions in 44.99 seconds, against
a 45-second lifecycle budget. A bounded Windows allowance and clearer failure
timing are queued for verification. New removal code must also pass its next
native run before execution is accepted. Browser visual/click, interactive Windows device/account,
voice capture and exact provider-task attachment remain separate acceptance or
implementation items. See the [live requirement ledger](switchyard-requirements.md)
and [evidence](switchyard-status.md). Building a package changes no launcher or
keyboard mapping by itself.
