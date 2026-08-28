#!/bin/sh
set -eu
config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
data_root="$HOME/.local/share/strathex-switchyard"
systemctl --user disable --now sxsy-b122.service 2>/dev/null || true
systemctl --user disable --now sxsy-b122-provider-host.service 2>/dev/null || true
rm -f -- "$config_root/sxsy-b122.service" "$config_root/sxsy-b122-provider-host.service"
systemctl --user daemon-reload
rm -f -- "$data_root/current" "$data_root/previous"
printf '%s\n' "Uninstalled the B122 Linux service. Versioned bundles and protected state were retained for recovery."
