#!/bin/sh
set -eu
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
data_root="$HOME/.local/share/strathex-switchyard"
config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
previous_file="$data_root/previous"
if [ ! -f "$previous_file" ] || [ -L "$previous_file" ]; then fail "no safe previous bundle record exists"; fi
previous=$(cat "$previous_file")
case "$previous" in ("$data_root"/versions/*) ;; (*) fail "previous bundle escaped the installation root";; esac
previous=$(realpath "$previous")
case "$previous" in ("$data_root"/versions/*) ;; (*) fail "canonical previous bundle escaped the installation root";; esac
[ -d "$previous" ] || fail "previous bundle no longer exists"
(cd "$previous" && sha256sum --check --strict MANIFEST.sha256) || fail "previous bundle failed manifest verification"
current=$(readlink -f "$data_root/current")
case "$current" in ("$data_root"/versions/*) ;; (*) fail "current bundle escaped the installation root";; esac
restore_current() {
  ln -s "$current" "$data_root/.rollback-restore-$$"
  mv -Tf "$data_root/.rollback-restore-$$" "$data_root/current"
  install -m 600 "$current/deployment/sxsy-b122.service" "$config_root/sxsy-b122.service"
  install -m 600 "$current/deployment/sxsy-b122-provider-host.service" "$config_root/sxsy-b122-provider-host.service"
  systemctl --user daemon-reload || true
  systemctl --user restart sxsy-b122.service || true
  systemctl --user try-restart sxsy-b122-provider-host.service || true
}
ln -s "$previous" "$data_root/.rollback-$$"
mv -Tf "$data_root/.rollback-$$" "$data_root/current"
install -m 600 "$previous/deployment/sxsy-b122.service" "$config_root/sxsy-b122.service"
install -m 600 "$previous/deployment/sxsy-b122-provider-host.service" "$config_root/sxsy-b122-provider-host.service"
systemctl --user daemon-reload
if ! systemctl --user restart sxsy-b122.service || ! systemctl --user is-active --quiet sxsy-b122.service; then restore_current; fail "rolled-back companion is not active"; fi
systemctl --user try-restart sxsy-b122-provider-host.service || true
printf '%s\n' "$current" > "$previous_file"; chmod 600 "$previous_file"
printf 'Rolled back SXSY-B122 to %s\n' "$(basename "$previous")"
