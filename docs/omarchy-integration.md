# Omarchy integration

The first integration gate is evidence, not desktop automation. The companion must establish which host capabilities are present before an Omarchy adapter is enabled.

Run the read-only collector on the target workstation:

```sh
npm run audit:omarchy-host > omarchy-host-evidence.json
```

The collector executes only version/introspection commands for Omarchy, Hyprland, tmux, and the systemd user manager. It records two Wayland session markers and a narrow `/etc/os-release` marker. It does not enumerate processes, repositories, files in the home directory, credentials, or arbitrary environment variables.

The JSON is deliberately descriptive. A capability marked `available` is not yet authorization to dispatch host actions. Later adapter work must consume this model, bind every action to the canonical B122 protocol, and fail closed when required capability evidence is absent.
