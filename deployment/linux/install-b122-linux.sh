#!/bin/sh
set -eu

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "$#" -eq 1 ] || fail "usage: install-b122-linux.sh RELEASE_DIRECTORY"
release=$(realpath "$1")
[ -d "$release" ] || fail "release directory is unavailable"
[ -f "$release/MANIFEST.sha256" ] || fail "release manifest is missing"
[ -x "$release/runtime/bin/node" ] || fail "bundled Node runtime is missing"
[ -f "$release/app/dist/apps/linux-companion/src/main.js" ] || fail "Linux companion entry point is missing"
command -v secret-tool >/dev/null 2>&1 || fail "secret-tool/libsecret is required"
[ "$(realpath "$(command -v secret-tool)")" = /usr/bin/secret-tool ] || fail "secret-tool is not the reviewed /usr/bin executable"
command -v bwrap >/dev/null 2>&1 || fail "Bubblewrap is required"
[ "$(realpath "$(command -v bwrap)")" = /usr/bin/bwrap ] || fail "bwrap is not the reviewed /usr/bin executable"
command -v flock >/dev/null 2>&1 || fail "util-linux flock is required"
[ "$(realpath "$(command -v flock)")" = /usr/bin/flock ] || fail "flock is not the reviewed /usr/bin executable"
command -v espeak-ng >/dev/null 2>&1 || fail "espeak-ng is required for trusted local speech synthesis"
[ "$(realpath "$(command -v espeak-ng)")" = /usr/bin/espeak-ng ] || fail "espeak-ng is not the reviewed /usr/bin executable"
(cd "$release" && sha256sum --check --strict MANIFEST.sha256) || fail "release manifest verification failed"

data_root="$HOME/.local/share/strathex-switchyard"
config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
versions="$data_root/versions"
bundle_id=$(cat "$release/BUNDLE_ID")
case "$bundle_id" in (*[!A-Za-z0-9._-]*|'') fail "bundle identity is invalid";; esac
destination="$versions/$bundle_id"
mkdir -p "$versions" "$config_root"
chmod 700 "$data_root" "$versions" "$config_root"
[ ! -e "$destination" ] || fail "bundle identity is already installed"
temporary="$versions/.install-$bundle_id-$$"
previous=""
switched=0
restore_previous() {
  if [ -n "$previous" ]; then
    ln -s "$previous" "$data_root/.restore-$bundle_id-$$"
    mv -Tf "$data_root/.restore-$bundle_id-$$" "$data_root/current"
    install -m 600 "$previous/deployment/sxsy-b122.service" "$config_root/sxsy-b122.service"
    install -m 600 "$previous/deployment/sxsy-b122-provider-host.service" "$config_root/sxsy-b122-provider-host.service"
    systemctl --user daemon-reload || true
    systemctl --user restart sxsy-b122.service || true
    systemctl --user try-restart sxsy-b122-provider-host.service || true
  else
    rm -f -- "$data_root/current" "$config_root/sxsy-b122.service" "$config_root/sxsy-b122-provider-host.service"
    systemctl --user daemon-reload || true
    systemctl --user disable --now sxsy-b122.service 2>/dev/null || true
  fi
}
cleanup() {
  status=$?
  rm -rf -- "$temporary"
  if [ "$status" -ne 0 ] && [ "$switched" -eq 1 ]; then restore_previous; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
mkdir -m 700 "$temporary"
cp -a "$release/." "$temporary/"
(cd "$temporary" && sha256sum --check --strict MANIFEST.sha256) || fail "installed copy verification failed"
chmod -R go-w "$temporary"
mv "$temporary" "$destination"

if [ -L "$data_root/current" ]; then
  previous=$(readlink -f "$data_root/current")
  case "$previous" in ("$versions"/*) ;; (*) fail "current bundle escaped the installation root";; esac
fi
ln -s "$destination" "$data_root/.current-$bundle_id"
mv -Tf "$data_root/.current-$bundle_id" "$data_root/current"
switched=1
install -m 600 "$destination/deployment/sxsy-b122.service" "$config_root/sxsy-b122.service"
install -m 600 "$destination/deployment/sxsy-b122-provider-host.service" "$config_root/sxsy-b122-provider-host.service"
systemctl --user daemon-reload
systemctl --user enable --now sxsy-b122.service
systemctl --user is-active --quiet sxsy-b122.service || fail "systemd did not report the companion active"
systemctl --user try-restart sxsy-b122-provider-host.service || true
if [ -n "$previous" ]; then printf '%s\n' "$previous" > "$data_root/previous"; chmod 600 "$data_root/previous"; else rm -f -- "$data_root/previous"; fi
switched=0
trap - EXIT HUP INT TERM
rm -rf -- "$temporary"
printf 'Installed SXSY-B122 Linux bundle %s\n' "$bundle_id"
