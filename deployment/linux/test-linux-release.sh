#!/bin/sh
set -eu
release=$1
[ -x "$release/runtime/bin/node" ]
[ -x "$release/deployment/commission-b122-omarchy.sh" ]
[ -f "$release/deployment/omarchy-health.mjs" ]
[ -f "$release/app/dist/apps/linux-companion/src/commission-omarchy-surfaces.js" ]
[ -f "$release/app/dist/apps/linux-companion/src/omarchy-host-action-consumer.js" ]
[ -f "$release/app/dist/apps/linux-companion/src/main.js" ]
[ -f "$release/extension/sxsy-b122-switchyard.vsix" ]
[ -x "$release/scripts/workflow-toggle.sh" ]
[ -f "$release/scripts/install-workflow-shortcut.mjs" ]
[ -f "$release/scripts/workflow-capture.mjs" ]
[ -f "$release/scripts/workflow-monitor.mjs" ]
(cd "$release" && /usr/bin/unzip -t extension/sxsy-b122-switchyard.vsix >/dev/null)
/usr/bin/unzip -Z1 "$release/extension/sxsy-b122-switchyard.vsix" | grep -qx 'extension/dist/apps/vscode-extension/src/extension.js'
/usr/bin/unzip -p "$release/extension/sxsy-b122-switchyard.vsix" extension/package.json | grep -q '"command": "sxsy-b122.startBoundCodexThread"'
(cd "$release" && sha256sum --check --strict MANIFEST.sha256)
grep -q '^KillMode=control-group$' "$release/deployment/sxsy-b122.service"
grep -q '^NoNewPrivileges=yes$' "$release/deployment/sxsy-b122.service"
grep -q '^PrivateTmp=yes$' "$release/deployment/sxsy-b122.service"
grep -q '^Requires=sxsy-b122.service$' "$release/deployment/sxsy-b122-provider-host.service"
grep -q '^NoNewPrivileges=yes$' "$release/deployment/sxsy-b122-provider-host.service"
grep -q 'TAG+="uaccess"' "$release/deployment/99-sxsy-b122-hidraw.rules"
if grep -q 'MODE="0666"' "$release/deployment/99-sxsy-b122-hidraw.rules"; then exit 1; fi
printf '%s\n' "Linux release structure and manifest verified."
