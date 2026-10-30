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

## Implementation still in progress

The normal desktop launcher, coordinated single-instance startup, installed
version switching, rollback, uninstall and runtime maintenance are the next
lifecycle work. The standalone bundle runner is not yet their substitute.
Use the existing review server while that work continues. No existing desktop
launcher, autostart setting, ordinary keyboard mapping or protected data is
changed by building a package.
