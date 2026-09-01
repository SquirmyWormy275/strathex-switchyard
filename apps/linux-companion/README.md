# SXSY-B122 Linux companion

## Omarchy capability audit

Before enabling desktop-specific behavior, collect a bounded, read-only capability report on the target workstation:

```sh
npm run audit:omarchy-host
```

See `docs/omarchy-integration.md` for the evidence boundary and adapter gate.

With mapped VS Code and default-terminal windows open, commission their exact
live process-bound Hyprland identities with `npm run commission:omarchy-surfaces`.
The command writes only the owner-only companion state artifact; it never edits
Hyprland configuration or launches a missing surface.

This package is the native Linux host for the shared durable B122 control plane. Production startup requires a current-user Secret Service, `/usr/bin/secret-tool`, `/usr/bin/bwrap`, an absolute `XDG_RUNTIME_DIR`, and installation through the reviewed systemd user-service bundle. It never falls back to TCP, plaintext credentials, a shell, or a weaker copy-only sandbox.

The JavaScript package alone is not release evidence. Use the verified Linux release builder under `deployment/linux`.
