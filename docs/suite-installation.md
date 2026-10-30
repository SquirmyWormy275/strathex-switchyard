# Integrated application packaging

Switchyard's new suite can now be built as a small, self-contained application
directory. It starts independently of the checkout and VS Code, using an existing
Node **24.14.0** installation. Linux program files are approximately 2 MiB.
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

Uninstall removes only matching owned launchers and verified program versions.
Protected workspace data, OS credential entries and the shared optional runtime
are retained. Active host connections must be restored in the app first; their
program and recovery baseline remain available until that succeeds. This guard
does not stop an application when it refuses removal. Automatic connection
restoration as part of uninstall is still unfinished.

## Implementation and acceptance still in progress

Linux installer tests exercise real installed application processes through
update and rollback, eight failure/recovery scenarios, forced installer exits
before and after promotion, and preserved protected/runtime files.
The pilot installation from `215f351` passed actual command launch, desktop-file
validation, authenticated protected-workspace access, stop/restart and simultaneous
launch reuse on 2026-10-30. Its original frozen review URL was retained. Program
files total 2,126,459 bytes; the duplicate source bundles were removed afterward.
Browser visual/click acceptance is still open. Native Windows managed startup currently fails
in CI and is being diagnosed; a Windows host is not the cause of that software
failure. Native Windows shortcut/install execution must pass CI before acceptance
is claimed. Complete optional-runtime maintenance
and broader owned-provider containment remain implementation work. Building a
package changes no launcher or keyboard mapping by itself.

The latest Windows diagnostics stop before ownership acknowledgement. Helpers now
use explicit UTF-8 raw standard streams, following the
[documented standard-stream API](https://learn.microsoft.com/en-us/dotnet/api/system.console.openstandardoutput?view=net-8.0),
with a dedicated detached/no-console lock test. File identity comparisons use
exact 64-bit integers, and Windows recovery does not interpret synthesized Unix
permission bits as native ACL evidence. The next native run must verify the fixes.
The native rerun passed those filesystem/recovery and detached-pipe cases; managed
startup still failed. Its restricted environment now preserves required Windows
system coordinates. Helpers import the built-in utility by its explicit system
path instead of discovering user/third-party modules. This also avoids dependence
on a pre-existing [PowerShell module analysis cache](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_windows_powershell_5.1).
The next run must establish application startup before Windows acceptance.
