# Try Switchyard before the B122 arrives

This software preview lets you study your Omarchy workflow and start a Codex
thread from VS Code. The physical B122 is expected in January 2027; the current
firmware overlay is not a complete typing keymap and must not be flashed as one.
The canonical 65 assigned chords remain unchanged.

The repository is **private** today. Invited collaborators can clone it and
download its GitHub Actions artifacts. Public access, redistribution terms,
and a public release still require the maintainer's decisions in
[the licensing plan](../LICENSING.md) and [publication gate](06-publication-gate.md).

## What the two controls do

| Control | Result | What it knows |
| --- | --- | --- |
| **Super+Alt+R** after shortcut installation | Starts or stops a local workflow study | Broad foreground app category and time only |
| **SXSY-B122: Start Task-Bound Codex Thread** in the VS Code Command Palette | Opens a Codex CLI thread for an exact Git root and short task ID | Exact Codex thread ID and local runtime status; not a verified task outcome |

The recorder works while you use Claude Code, Codex, or other apps. The
task-bound thread command currently supports Codex on Linux. Existing Claude
terminals can be labelled **Registered** through **Adopt Terminal Once**, but
Switchyard does not yet read their exact live task state.

## Install from a verified Linux workflow artifact

From a successful [B122 Linux release verification workflow](https://github.com/SquirmyWormy275/strathex-switchyard/actions/workflows/b122-linux.yml)
run, download its `sxsy-b122-linux-preview-<commit>` artifact. Extract the
GitHub artifact ZIP, then run these commands in the extracted directory:

```sh
sha256sum --check sxsy-b122-linux-x64.tar.xz.sha256
tar -xJf sxsy-b122-linux-x64.tar.xz
./sxsy-b122-linux-x64/deployment/preflight-b122-linux.sh
./sxsy-b122-linux-x64/deployment/install-b122-linux.sh ./sxsy-b122-linux-x64
code --install-extension ./sxsy-b122-linux-x64/extension/sxsy-b122-switchyard.vsix --force
```

The Linux bundle needs a systemd user session, Secret Service (`secret-tool`),
Bubblewrap (`bwrap`), `flock`, and `espeak-ng`. The companion installation and
VS Code installation are separate. The bundle installer verifies its own
manifest, keeps versioned copies, and has a rollback command; see the
[Linux installation guide](linux-release-and-installation.md). Reload an
already-open VS Code window after installing the extension.

To add the opt-in Omarchy shortcut from that installed bundle:

```sh
~/.local/share/strathex-switchyard/current/runtime/bin/node \
  ~/.local/share/strathex-switchyard/current/scripts/install-workflow-shortcut.mjs
```

The installer leaves an existing Super+Alt+R assignment alone. Before a
change, it saves a dated copy of `~/.config/hypr/bindings.lua` and the reason.
It verifies the live Hyprland binding after reload and restores the old file
if activation fails. The shortcut follows the installed `current` bundle
across updates. It does not start recording by itself.

## Use the recorder

Press **Super+Alt+R** to begin a study session and press it again to end. The
monitor runs as a temporary systemd user service, not at boot. To inspect the
local report and storage size from the installed bundle:

```sh
~/.local/share/strathex-switchyard/current/runtime/bin/node \
  ~/.local/share/strathex-switchyard/current/scripts/workflow-capture.mjs report
~/.local/share/strathex-switchyard/current/runtime/bin/node \
  ~/.local/share/strathex-switchyard/current/scripts/workflow-capture.mjs path
```

The log stays in your private local state and stops at 10 MiB. It does not
capture prompts, code, keystrokes, clipboard data, or window titles. See
[workflow capture](workflow-capture.md) for deliberate event fields and limits.

## Start a task-bound Codex thread

Install and sign into a current Codex CLI. Start its same-user App Server
daemon with `codex app-server daemon start`. Open an exact Git repository root
in VS Code, then run **SXSY-B122: Start Task-Bound Codex Thread** from the
Command Palette. Enter a short, non-sensitive task ID. The terminal opens the
exact returned thread; **SXSY-B122: Show Managed Sessions** displays its local
status. The extension checks fixed user/system Codex locations and never
accepts a workspace-selected executable. See the
[Codex thread guide](codex-thread-inventory.md) for the supported paths and
status meaning.

## Build the same pieces from source

Collaborators can use the feature branch directly while its changes await
integration with `main`:

```sh
git clone --branch feat/omarchy-capability-foundation \
  https://github.com/SquirmyWormy275/strathex-switchyard.git
cd strathex-switchyard
mise exec node@24.14.0 -- npm ci --ignore-scripts
mise exec node@24.14.0 -- npm run build:vscode
mise exec node@24.14.0 -- node deployment/linux/build-vsix.mjs \
  apps/vscode-extension artifacts/sxsy-b122-switchyard.vsix
code --install-extension artifacts/sxsy-b122-switchyard.vsix --force
mise exec node@24.14.0 -- node scripts/install-workflow-shortcut.mjs
```

Keep the checkout at the same path while using its shortcut. The VSIX builder
needs `zip` and `unzip`. Source builds are development evidence; the workflow
artifact is built and verified from an exact Git commit. Ordinary USB keyboard
typing on Windows remains a hardware acceptance test for the B122 after it
arrives. No companion is required for ordinary typing.
