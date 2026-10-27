# Omarchy integration

Omarchy Linux is the primary agent workstation. Its existing cross-application clipboard remains the ordinary quick-copy route; B122 Handoff adds exact task, plan, decision, target, and authority context only when a supported adapter can prove the binding. The native ChatGPT launcher and its main-window voice repair are host-specific; this repository currently has no accepted ChatGPT focus or voice adapter for that installation. Do not substitute a browser URL or enable a desktop overlay. See [the host capability matrix](platform-capability-matrix.md) and [workflow reassessment](workflow-reassessment-2026-10.md).

The first integration gate is evidence, not desktop automation. The companion must establish which host capabilities are present before an Omarchy adapter is enabled.

Run the read-only collector on the target workstation:

```sh
npm run --silent audit:omarchy-host > omarchy-host-evidence.json
```

The collector executes only version/introspection commands for Omarchy, Hyprland, tmux, and the systemd user manager. It records two Wayland session markers and a narrow `/etc/os-release` marker. It does not enumerate processes, repositories, files in the home directory, credentials, or arbitrary environment variables.

The JSON is deliberately descriptive. A capability marked `available` is not yet authorization to dispatch host actions. Later adapter work must consume this model, bind every action to the canonical B122 protocol, and fail closed when required capability evidence is absent.

The initial host-action planner covers only the canonical, targetless VS Code and external-terminal focus actions. It requires Omarchy, Hyprland, and Wayland evidence plus a separately provisioned exact `initialClass` identity. Its output is a fixed, shell-free `/usr/bin/hyprctl dispatch` invocation using Hyprland's current Lua dispatcher and an anchored `initialclass:` selector. It cannot launch a program, accept a path or URL, or fall back to an inexact window match.

The native effect adapter executes only that plan with a bounded timeout and output buffer. It requires Hyprland's exact `ok` acknowledgement and treats cancellation, process failure, timeout, stderr, or any other response as failure.

Commission exact mapped surface identities before enabling the installed adapter:

```sh
npm run commission:omarchy-surfaces
```

The provisioner binds each observed `initialClass` to a mapped client whose `/proc/<pid>/exe` is the reviewed installed VS Code or current Omarchy default-terminal executable. Omarchy-scoped terminal app IDs such as `org.omarchy.nvim` are excluded; any other class disagreement fails as ambiguous. The artifact is created atomically at mode `0600` below the companion state directory and cannot be silently replaced with different identities.

At startup, the Linux companion loads that no-follow, current-UID artifact and starts its Omarchy consumer only when at least one identity is commissioned. The consumer owns only the exact targetless `focus_vscode` and `focus_terminal` intents, durably journals a claim and single-use effect boundary, obtains one-time queue authorization, and never replays a crossed effect after restart or lost settlement. Missing evidence or identity settles without a compositor action. Other host actions remain extension-owned or unavailable.

Real-workstation results and remaining commissioning blockers are recorded in [the Omarchy workstation validation](omarchy-host-validation.md).
