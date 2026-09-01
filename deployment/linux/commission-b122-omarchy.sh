#!/bin/sh
set -eu
data_root="$HOME/.local/share/strathex-switchyard"
current=$(readlink -f "$data_root/current")
case "$current" in ("$data_root"/versions/*) ;; (*) printf '%s\n' "ERROR: installed bundle escaped the installation root" >&2; exit 1;; esac
exec "$current/runtime/bin/node" "$current/app/dist/apps/linux-companion/src/commission-omarchy-surfaces.js"
