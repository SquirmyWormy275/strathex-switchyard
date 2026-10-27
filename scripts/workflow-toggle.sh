#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
recorder=(/usr/bin/mise exec node@24.14.0 -- node "$repo_root/scripts/workflow-capture.mjs")
unit=sxsy-workflow-monitor.service

notify() { /usr/bin/notify-send -a "STRATHEX Switchyard" "$1" "$2" >/dev/null 2>&1 || true; }
fail() { notify "Workflow recorder unavailable" "$1"; exit 1; }

status=$("${recorder[@]}" status 2>&1) || fail "$status"
if [[ "$status" == Active:* ]]; then
  /usr/bin/systemctl --user stop "$unit" >/dev/null 2>&1 || true
  result=$("${recorder[@]}" end 2>&1) || fail "$result"
  notify "Workflow study stopped" "Foreground category capture ended. Open the report with npm run workflow -- report."
  exit 0
fi
if [[ "$status" != "No workflow session is active." ]]; then fail "The study state could not be identified safely."; fi

result=$("${recorder[@]}" start linux 2>&1) || fail "$result"
environment=()
for name in HYPRLAND_INSTANCE_SIGNATURE XDG_RUNTIME_DIR SXSY_WORKFLOW_STUDY_DIR; do
  if [[ -n "${!name:-}" ]]; then environment+=("--setenv=$name=${!name}"); fi
done
if ! /usr/bin/systemd-run --user --collect --unit="$unit" --property=Type=exec --working-directory="$repo_root" \
  "${environment[@]}" /usr/bin/mise exec node@24.14.0 -- node "$repo_root/scripts/workflow-monitor.mjs" >/dev/null 2>&1; then
  "${recorder[@]}" end >/dev/null 2>&1 || true
  fail "The temporary foreground monitor did not start. No study session was left open."
fi
if ! /usr/bin/systemctl --user is-active --quiet "$unit"; then
  "${recorder[@]}" end >/dev/null 2>&1 || true
  fail "The foreground monitor exited during startup. No study session was left open."
fi
notify "Workflow study started" "Foreground app categories are being counted. Press Super+Alt+R again to stop."
