# Omarchy workstation validation — 2026-08-31 PDT

This record is host-specific pre-hardware evidence from the real Omarchy workstation used to continue `feat/omarchy-capability-foundation`. It is not hardware, production, or acceptance evidence and does not change the canonical B122 map.

## Capability audit

`npm run audit:omarchy-host` was run from a clean install. The workstation's default Node.js 26.7.0 rejects the repository's `--experimental-transform-types` option, so the successful audit and validation commands were run with the already-installed Node.js 24.14.0 through mise. The JSON artifact was captured with npm's `--silent` option so npm's command banner did not contaminate stdout. The collector reported:

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
| VS Code | Not provisionable on this host | unavailable |

The VS Code result is deliberately unavailable. `code`, `code-insiders`, `codium`, and `vscodium` were absent from `PATH`; no matching package or desktop registration was installed; and no matching Hyprland client existed. No identity was inferred from documentation or another product.

## Native focus validation

The legacy Hyprland command shape originally represented by the planner failed on this host because Hyprland 0.56 uses Lua dispatchers. The current native plan was checked against the installed compositor using the exact selector:

```text
/usr/bin/hyprctl dispatch 'hl.dsp.focus({ window = "initialclass:^(foot)$" })'
```

Hyprland returned exactly `ok`, and `hyprctl activewindow -j` then reported both `class` and `initialClass` as `foot`. This proves only the bounded Foot focus effect on this workstation; it does not prove durable queue integration, restart reconciliation, adversarial same-user isolation, or a VS Code focus effect.

## Genuine commissioning blockers

- VS Code is not installed, so its exact live `initialClass` cannot be captured and `focus_vscode` must remain unavailable.
- The repository has no protected Linux identity-provisioning artifact yet. The observed Foot value is evidence, not authority for an installed companion.
- The native Omarchy effect adapter is not connected to a Linux-specific durable claim/effect/no-replay consumer, so neither focus action is enabled in the packaged companion.
- Node.js 26.7.0 cannot run the repository scripts while they pass `--experimental-transform-types`; validation currently requires the installed Node.js 24.14.0 runtime.
- No physical B122, Raw HID hot-plug, Vial, LED, or ergonomic commissioning was performed in this pre-hardware work.
