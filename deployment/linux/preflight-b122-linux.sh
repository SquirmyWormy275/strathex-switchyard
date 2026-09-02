#!/bin/sh
set -eu

failures=0
check_reviewed() {
  name=$1 expected=$2 package=$3
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'MISSING %-12s install package: %s\n' "$name" "$package"
    failures=$((failures + 1))
    return
  fi
  actual=$(realpath "$(command -v "$name")")
  if [ "$actual" != "$expected" ]; then
    printf 'UNREVIEWED %-9s expected %s, found %s\n' "$name" "$expected" "$actual"
    failures=$((failures + 1))
    return
  fi
  printf 'READY   %-12s %s\n' "$name" "$actual"
}

printf '%s\n' 'SXSY-B122 Linux installation preflight (read-only)'
check_reviewed secret-tool /usr/bin/secret-tool libsecret
check_reviewed bwrap /usr/bin/bwrap bubblewrap
check_reviewed flock /usr/bin/flock util-linux
check_reviewed espeak-ng /usr/bin/espeak-ng espeak-ng
check_reviewed systemctl /usr/bin/systemctl systemd

if [ "$failures" -ne 0 ]; then
  printf '%s\n' "BLOCKED: $failures prerequisite check(s) failed. On Omarchy/Arch, review then install the named packages with pacman."
  exit 1
fi
printf '%s\n' 'READY: reviewed Linux installation prerequisites are present.'
