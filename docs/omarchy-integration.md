# Omarchy integration

The first integration gate is evidence, not desktop automation. The companion must establish which host capabilities are present before an Omarchy adapter is enabled.

Run the read-only collector on the target workstation:

```sh
npm run --silent audit:omarchy-host > omarchy-host-evidence.json
```

The collector executes only version/introspection commands for Omarchy, Hyprland, tmux, and the systemd user manager. It records two Wayland session markers and a narrow `/etc/os-release` marker. It does not enumerate processes, repositories, files in the home directory, credentials, or arbitrary environment variables.

The JSON is deliberately descriptive. A capability marked `available` is not yet authorization to dispatch host actions. Later adapter work must consume this model, bind every action to the canonical B122 protocol, and fail closed when required capability evidence is absent.

The initial host-action planner covers only the canonical, targetless VS Code and external-terminal focus actions. It requires Omarchy, Hyprland, and Wayland evidence plus a separately provisioned exact `initialClass` identity. Its output is a fixed, shell-free `/usr/bin/hyprctl dispatch` invocation using Hyprland's current Lua dispatcher and an anchored `initialclass:` selector. It cannot launch a program, accept a path or URL, or fall back to an inexact window match.

The native effect adapter executes only that plan with a bounded timeout and output buffer. It requires Hyprland's exact `ok` acknowledgement and treats cancellation, process failure, timeout, stderr, or any other response as failure. This adapter is not yet connected to the durable companion host-action queue: doing so safely still requires a Linux-specific durable claim/effect/no-replay consumer and separately provisioned identities for every enabled surface.

Real-workstation results and remaining commissioning blockers are recorded in [the Omarchy workstation validation](omarchy-host-validation.md).
