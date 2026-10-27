# Linux Release and Installation

The Linux deliverable is a per-user, versioned bundle containing the shared durable B122 control plane, the Linux companion, the VS Code extension package, an official digest-pinned Node.js x64 runtime, systemd user-service policy, a narrow `uaccess` udev rule template, lifecycle scripts, and a complete SHA-256 manifest. It does not require root for the companion. Installing the optional physical-device udev rule is a separate administrator action and must wait for the accepted keyboard VID/PID.

## Supported boundary

The reviewed host is a systemd-based x86-64 desktop Linux distribution with:

- `/usr/bin/secret-tool` backed by the current desktop user's Secret Service;
- `/usr/bin/bwrap` with unprivileged user namespaces enabled;
- `/usr/bin/flock` from util-linux for cross-process lifecycle and Secret Service key-creation locks;
- `/usr/bin/espeak-ng` for trusted local synthesis of gateway-redacted response text;
- a private, current-user `XDG_RUNTIME_DIR`;
- systemd user services; and
- VS Code capable of loading the packaged extension.

The companion stores a random 256-bit master key in Secret Service and uses AES-256-GCM envelopes for its journal, credential references, receipts, and IPC token. The clear master key is never persisted by B122. Startup fails closed if Secret Service is absent or locked. IPC uses only a mode-`0600` Unix-domain socket below `XDG_RUNTIME_DIR/sxsy-b122`; TCP and workspace-selected endpoints do not exist.

Bubblewrap is invoked only as fixed `/usr/bin/bwrap`, without a shell. Full-sandbox capability probes unshare the user, PID, IPC, UTS, cgroup, and network namespaces, mount the exact canonical repository read-only, and use disposable `/tmp`. If the binary, target identity, or namespace support changes, the command reports unavailable or blocked instead of falling back to a directory copy.

Repository recipes run in a private disposable execution root. Linux Python
recipes must use `.venv/bin/python`; create the environment with copied
executables (for example, `python3 -m venv --copies .venv`) because a symlink
that resolves outside the registered repository is rejected. The recipe's sole
bounded stdout value is exact JSON:

```json
{
  "schema": "sxsy-b122.linux-repository-recipe-result",
  "version": 1,
  "coverage": [
    { "dimension": "tests", "status": "covered", "fixtureId": "reviewed-fixture-id" }
  ],
  "scannerFixtureIds": [],
  "advisoryFixtureIds": []
}
```

Every required manifest dimension must appear exactly once. Shield scanner or
advisory IDs must resolve to installed, signed fixture evidence before the host
issues a protected receipt. Missing dimensions, extra output, a changed target,
an unsigned fixture, or a failed namespace returns incomplete or unavailable.

## Build

The repository pins Node.js 24.14.0 in `.nvmrc`, `.mise.toml`, package metadata, CI, and bundled runtimes. Use the reviewed Node v24.14.0 Linux x64 archive. Its SHA-256 in the official Node release manifest is `41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df`.

```sh
npm ci --ignore-scripts
deployment/linux/build-b122-linux-release.sh \
  /reviewed/node-v24.14.0-linux-x64.tar.xz \
  41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df \
  artifacts/sxsy-b122-linux-x64
deployment/linux/test-linux-release.sh artifacts/sxsy-b122-linux-x64
```

The builder compiles from the current checkout, packages the extension and opt-in workflow-study tools, embeds the reviewed runtime, and generates `MANIFEST.sha256`. A release intended for distribution must be built by the Linux GitHub workflow from a clean exact commit; a local directory is development evidence only. After its tests pass, that workflow uploads a Linux bundle archive, its SHA-256 sidecar, and the VSIX as a 14-day GitHub Actions artifact. The [first-use guide](try-switchyard.md) gives the download and verification steps. The repository is currently private, so only invited collaborators can access that artifact.

## Install, update, rollback, uninstall

Run the bundled read-only prerequisite check before installation:

```sh
artifacts/sxsy-b122-linux-x64/deployment/preflight-b122-linux.sh
```

It reports the exact reviewed executable path and package name for Secret Service, Bubblewrap, flock, espeak-ng, and systemd. It never installs packages or changes the host.

```sh
artifacts/sxsy-b122-linux-x64/deployment/install-b122-linux.sh \
  artifacts/sxsy-b122-linux-x64
```

Installation verifies every manifest entry before and after copying, writes a new immutable version under the fixed per-user service root `$HOME/.local/share/strathex-switchyard/versions`, atomically changes the `current` symlink, installs the systemd user unit, and requires the service to become active. The fixed root is intentional because the installed units must resolve the same path without interpolating a caller-controlled `XDG_DATA_HOME`. Installing another verified bundle is the update operation.

```sh
~/.local/share/strathex-switchyard/current/deployment/rollback-b122-linux.sh
~/.local/share/strathex-switchyard/current/deployment/uninstall-b122-linux.sh
```

Rollback verifies the previous immutable manifest before switching and restarting. Uninstall removes the service and active selectors but deliberately retains versioned bundles and protected state for recovery. Purging protected state is not automated.

## VS Code

Install `extension/sxsy-b122-switchyard.vsix` with VS Code's **Install from VSIX** command or the reviewed VS Code CLI. The same extension package supports Windows and Linux: it selects DPAPI/named pipes on Windows and Secret Service/Unix sockets on Linux. It reads only the companion-owned endpoint record below `${XDG_STATE_HOME:-$HOME/.local/state}/STRATHEX/switchyard`.

The optional `scripts/install-workflow-shortcut.mjs` adds Super+Alt+R to the current Omarchy user's `~/.config/hypr/bindings.lua` after checking for a collision. Run it with the installed bundle's `runtime/bin/node` after installation. It saves the prior file and reason in private local state, validates the live binding, and leaves the recorder stopped until the first keypress. The bundled workflow recorder is independent of the companion and retains its local study log outside the repository.

## Configured provider host

The bundle includes the same digest-pinned Claude/Codex provider-adapter host used by Windows, with Linux Secret Service envelopes and a private current-UID/mode-`0700` state boundary. Its systemd user unit is installed but deliberately not enabled: proprietary modules, credentials, TLS material, exact network routes, and authorization remain separately reviewed inputs. After placing an exact validated configuration at `${XDG_STATE_HOME:-$HOME/.local/state}/STRATHEX/switchyard/provider-host/provider-host.json`, enable it explicitly:

```sh
systemctl --user enable --now sxsy-b122-provider-host.service
```

The unit generates a fresh lifecycle nonce on each start, uses the same versioned bundle, and keeps the configured host in a separate systemd control group. Missing or invalid configuration, Secret Service, TLS, module digest, credentials, or mediated final-current binding fails closed.

## Optional hidraw configuration

Physical input remains disabled unless the companion state directory contains
a current-UID, mode-`0600`, non-symlink `linux-hidraw.json` with the exact shape:

```json
{
  "devicePath": "/dev/hidraw7",
  "vendorId": 45346,
  "productId": 1,
  "reportDescriptorSha256": "64-lowercase-hex-characters",
  "serialNumber": "accepted-device-serial"
}
```

`serialNumber` may be omitted only when the accepted device has no serial. The
transport revalidates canonical path, character-device identity, VID, PID,
serial, report descriptor, inode, and device number across open. It journals an
accepted canonical signal before sending the protocol ACK. The udev rule below
controls access only; it cannot substitute for this identity or hardware
acceptance evidence.

## Desktop integration boundary

The installed VS Code extension can route and focus registered VS Code-hosted
sessions through the authenticated companion. On an evidenced Omarchy,
Hyprland, and Wayland host, the companion may also consume only the canonical
targetless VS Code and external-terminal focus actions after exact live surface
commissioning:

```sh
~/.local/share/strathex-switchyard/current/deployment/commission-b122-omarchy.sh
```

The resulting mode-`0600` identity artifact survives update and rollback in the
separate protected state root. The release includes `omarchy-health.mjs` for a
read-only capability/identity health check. No launch fallback, path, URL,
repository value, arbitrary class, X11 fallback, or accessibility scraping is
accepted. Other compositors and uncommissioned surfaces remain unavailable.

## Physical keyboard boundary

The bundled udev file is a template, not an install command. Do not install it until the keyboard's exact VID, PID, usage page, usage, firmware map, and ownership behavior are independently accepted. It intentionally grants `uaccess` to one identity and never uses `MODE="0666"`. Firmware deployment, hot-plug behavior, physical Raw-HID acceptance, LED behavior, and ergonomics remain hardware work; all 27 acceptance gates remain **NOT ACCEPTED**.
