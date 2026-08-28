#!/bin/sh
set -eu
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
[ "$#" -eq 3 ] || fail "usage: build-b122-linux-release.sh NODE_TAR_XZ NODE_SHA256 OUTPUT_DIRECTORY"
archive=$(realpath "$1")
expected=$2
output=$3
case "$expected" in (*[!a-f0-9]*|'') fail "Node digest is invalid";; esac
[ "${#expected}" -eq 64 ] || fail "Node digest is invalid"
[ "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected" ] || fail "Node runtime digest mismatch"
[ ! -e "$output" ] || fail "output already exists"

npm run build:linux-companion
npm run build:vscode
npm run build:provider-host
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
bundle="$stage/sxsy-b122-linux-x64"
mkdir -p "$bundle/app" "$bundle/runtime" "$bundle/deployment" "$bundle/extension"
tar -xJf "$archive" -C "$bundle/runtime" --strip-components=1
cp -a apps/linux-companion/dist/. "$bundle/app/dist/"
cp -a apps/provider-adapter-host/dist/. "$bundle/app/dist/"
cp apps/linux-companion/package.json "$bundle/app/package.json"
cp apps/provider-adapter-host/package.json "$bundle/app/provider-adapter-host.package.json"
cp deployment/linux/sxsy-b122.service "$bundle/deployment/"
cp deployment/linux/sxsy-b122-provider-host.service deployment/linux/provider-host-launch.mjs "$bundle/deployment/"
cp deployment/linux/99-sxsy-b122-hidraw.rules "$bundle/deployment/"
cp deployment/linux/org.strathex.switchyard.policy "$bundle/deployment/"
cp deployment/linux/smoke-client.mjs "$bundle/deployment/"
cp deployment/linux/install-b122-linux.sh deployment/linux/rollback-b122-linux.sh deployment/linux/uninstall-b122-linux.sh "$bundle/deployment/"
chmod 700 "$bundle/deployment/"*.sh "$bundle/runtime/bin/node"
node deployment/linux/build-vsix.mjs apps/vscode-extension "$bundle/extension/sxsy-b122-switchyard.vsix"
[ -s "$bundle/extension/sxsy-b122-switchyard.vsix" ] || fail "VS Code extension VSIX was not produced"
printf '%s\n' "linux-x64-$(git rev-parse --short=12 HEAD)" > "$bundle/BUNDLE_ID"
(cd "$bundle" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum) > "$stage/MANIFEST.sha256"
mv "$stage/MANIFEST.sha256" "$bundle/MANIFEST.sha256"
(cd "$bundle" && sha256sum --check --strict MANIFEST.sha256)
mkdir -p "$(dirname "$output")"
mv "$bundle" "$output"
trap - EXIT HUP INT TERM
rm -rf -- "$stage"
printf 'Built verified Linux release at %s\n' "$output"
