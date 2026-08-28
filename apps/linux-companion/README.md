# SXSY-B122 Linux companion

This package is the native Linux host for the shared durable B122 control plane. Production startup requires a current-user Secret Service, `/usr/bin/secret-tool`, `/usr/bin/bwrap`, an absolute `XDG_RUNTIME_DIR`, and installation through the reviewed systemd user-service bundle. It never falls back to TCP, plaintext credentials, a shell, or a weaker copy-only sandbox.

The JavaScript package alone is not release evidence. Use the verified Linux release builder under `deployment/linux`.
