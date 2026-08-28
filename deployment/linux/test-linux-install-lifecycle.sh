#!/bin/sh
set -eu
release=$(realpath "$1")
root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT HUP INT TERM
export HOME="$root/home" XDG_DATA_HOME="$root/data" XDG_CONFIG_HOME="$root/config"
mkdir -p "$HOME" "$root/fake-bin"
cat > "$root/fake-bin/systemctl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "${SXSY_SYSTEMCTL_LOG:?}"
if [ "${SXSY_FAIL_ACTIVE:-0}" = 1 ] && [ "${1:-}" = "--user" ] && [ "${2:-}" = "is-active" ]; then exit 1; fi
exit 0
EOF
chmod 700 "$root/fake-bin/systemctl"
export SXSY_SYSTEMCTL_LOG="$root/systemctl.log"
PATH="$root/fake-bin:$PATH"; export PATH

first="$root/release-one"
second="$root/release-two"
third="$root/release-three"
cp -a "$release" "$first"
cp -a "$release" "$second"
cp -a "$release" "$third"
printf '%s\n' linux-test-one > "$first/BUNDLE_ID"
printf '%s\n' linux-test-two > "$second/BUNDLE_ID"
printf '%s\n' linux-test-three > "$third/BUNDLE_ID"
sed -i 's/mediated companion/mediated companion release one/' "$first/deployment/sxsy-b122.service"
sed -i 's/mediated companion/mediated companion release two/' "$second/deployment/sxsy-b122.service"
sed -i 's/mediated companion/mediated companion release three/' "$third/deployment/sxsy-b122.service"
for candidate in "$first" "$second" "$third"; do
  (cd "$candidate" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256)
done

"$first/deployment/install-b122-linux.sh" "$first"
[ "$(basename "$(readlink -f "$HOME/.local/share/strathex-switchyard/current")")" = linux-test-one ]
"$second/deployment/install-b122-linux.sh" "$second"
[ "$(basename "$(readlink -f "$HOME/.local/share/strathex-switchyard/current")")" = linux-test-two ]
"$second/deployment/rollback-b122-linux.sh"
[ "$(basename "$(readlink -f "$HOME/.local/share/strathex-switchyard/current")")" = linux-test-one ]
grep -q 'release one' "$XDG_CONFIG_HOME/systemd/user/sxsy-b122.service"
export SXSY_FAIL_ACTIVE=1
if "$third/deployment/install-b122-linux.sh" "$third"; then exit 1; fi
unset SXSY_FAIL_ACTIVE
[ "$(basename "$(readlink -f "$HOME/.local/share/strathex-switchyard/current")")" = linux-test-one ]
grep -q 'release one' "$XDG_CONFIG_HOME/systemd/user/sxsy-b122.service"
"$second/deployment/uninstall-b122-linux.sh"
[ ! -e "$HOME/.local/share/strathex-switchyard/current" ]
[ -d "$HOME/.local/share/strathex-switchyard/versions/linux-test-one" ]
grep -q 'enable --now sxsy-b122.service' "$SXSY_SYSTEMCTL_LOG"
grep -q 'restart sxsy-b122.service' "$SXSY_SYSTEMCTL_LOG"
grep -q 'disable --now sxsy-b122.service' "$SXSY_SYSTEMCTL_LOG"
grep -q 'try-restart sxsy-b122-provider-host.service' "$SXSY_SYSTEMCTL_LOG"
grep -q 'disable --now sxsy-b122-provider-host.service' "$SXSY_SYSTEMCTL_LOG"
printf '%s\n' "Linux install, update, rollback, and recoverable uninstall lifecycle passed."
