# Omarchy workstation validation — 2026-08-31 PDT

This record is host-specific pre-hardware evidence from the real Omarchy workstation used to continue `feat/omarchy-capability-foundation`. It is not hardware, production, or acceptance evidence and does not change the canonical B122 map.

## Capability audit

`npm run audit:omarchy-host` was run from a clean install. The workstation's default Node.js 26.7.0 rejects the repository's `--experimental-transform-types` option, so source-level audit and test commands use the already-installed Node.js 24.14.0 through mise. A trial alternate TypeScript loader changed unrelated module/test semantics and was fully reverted rather than modifying Windows behavior. Packaged companions continue to use compiled JavaScript. The JSON artifact was captured with npm's `--silent` option so npm's command banner did not contaminate stdout. The collector reported:

- Omarchy `4.0.1-1`; `/etc/os-release` identifies Omarchy `4.0.1`.
- Hyprland `0.56.2`, tag `v0.56.2`, commit `efb50993780079460b0cbed1363e2166a2de1d9f`.
- Wayland session markers `WAYLAND_DISPLAY=wayland-1` and `XDG_SESSION_TYPE=wayland`.
- tmux `3.7c`.
- a responsive systemd user manager.

The focused Omarchy tests, repository typecheck, and Linux companion build passed under Node.js 24.14.0.

## Exact surface identities

Hyprland's live `clients -j` response and Omarchy's default-terminal query establish:

| Surface | Provisioning result | Exact Hyprland `initialClass` |
| --- | --- | --- |
| Installed/default external terminal | Foot `1.27.0-2`; `omarchy-default-terminal` returned `foot`; two live Foot clients agreed | `foot` |
| VS Code | `visual-studio-code-bin` `1.135.0-1`; mapped process `/usr/share/code/code` | `code` |

VS Code was installed through Omarchy's reviewed `omarchy install editor vscode` route. Its identity was captured only after a mapped client existed. The live provisioner also distinguished ordinary Foot windows (`foot`) from an Omarchy-scoped Neovim Foot surface (`org.omarchy.nvim`) and failed closed before that exclusion was explicit.

## Native focus validation

The legacy Hyprland command shape originally represented by the planner failed on this host because Hyprland 0.56 uses Lua dispatchers. The current native plan was checked against the installed compositor using the exact selector:

```text
/usr/bin/hyprctl dispatch 'hl.dsp.focus({ window = "initialclass:^(foot)$" })'
```

Hyprland returned exactly `ok` for both commissioned routes. After the sequential Foot then VS Code exercise, `hyprctl activewindow -j` reported both `class` and `initialClass` as `code`. The protected commissioning artifact contains only `code` and `foot`, is owned by the current user, and has mode `0600`.

The Linux-specific consumer now provides durable claim/effect/terminal records, one-time queue authorization, and no-replay startup reconciliation. Isolated tests cover exact routing, missing identity, and a lost settlement after the effect boundary. This is still workstation evidence, not independent same-user adversarial acceptance.

## Connected keyboard evidence

A Model F Labs F77, not a B122, was connected as USB `1209:4704` with serial `vial:f64c2b3c` and three HID interfaces. Their report descriptors were read without opening a writable transport:

| Device | Descriptor bytes | SHA-256 | Current access |
| --- | ---: | --- | --- |
| `/dev/hidraw1` | 64 | `cdd26924c1763bbe5c7964ad6f92ee7996f003e64e594877d251f859e861b58c` | root only |
| `/dev/hidraw2` | 34 | `b464b2658e8e41b89af847112efa3c3059c330864e10094425c0b92d55e24d89` | current-user ACL present |
| `/dev/hidraw3` | 188 | `8f0a86f9a8f957bbad2cb5bb5c5cf536d1d70aed9724aa75bf9d5c8f4d48db91` | root only |

The repository udev file deliberately remains the uninstalled B122 placeholder. No F77 identity was written to `linux-hidraw.json`, no packet was sent, and no firmware was flashed because this device is not evidence for the canonical B122 matrix or Raw-HID implementation.

## Genuine commissioning blockers

- No physical B122 is connected. The observed F77 cannot establish the B122 VID/PID, usage, matrix, Vial map, Raw-HID framing, LEDs, rollover, hot-plug, sleep/resume, or ergonomics.
- The narrow B122 udev rule still contains reviewed placeholders and must not be installed until the actual device identity is accepted.
- Source-level audit and test scripts require Node.js 24 on this workstation; Node.js 26 removed the transformation mode used by the repository. Release bundles remain pinned to Node.js 24.14.0 compiled output.
- Same-user adversarial and lock-screen/inhibitor acceptance remain external commissioning work; the software fails closed but this workstation exercise is not an independent security assessment.

## Validation boundary

The final focused verification passed 17 tests covering capability evidence, owner-only identity loading, Linux path safety, exact native dispatch, missing-window refusal, durable targetless routing, missing identity, and no-replay recovery. Typecheck and the Linux companion build passed. A manifest-verified Linux release was built with the reviewed Node.js 24.14.0 archive; its structure check and Omarchy health check passed with `code` and `foot` available.

The broader isolated repository suite was also run. Its Omarchy suites and every build group passed, but the aggregate suite was not green on this Linux workstation: existing Windows-only/path-sensitive groups reported Linux execution failures or unexpected skip counts, and the isolated Linux Secret Service group lacked `XDG_RUNTIME_DIR`. No Windows runtime source was changed to suppress those results. The release install/update/rollback lifecycle test reached the host prerequisite check and stopped because `/usr/bin/espeak-ng` was not installed; this is a genuine workstation prerequisite, not a passed lifecycle receipt.

## Pre-hardware follow-up

The repository now pins source-level work to Node.js 24.14.0 and provisions private `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` directories for every isolated test child. A packaged read-only Linux preflight names missing reviewed prerequisites before installation; it does not claim the workstation's missing `espeak-ng` has been installed. The next live-host lifecycle run must still produce its own passing receipt after the operator installs that prerequisite.
