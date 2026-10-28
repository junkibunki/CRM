#!/usr/bin/env bash
# Downloads the pinned PocketBase binary into pocketbase/.
# Usage: scripts/get-pocketbase.sh [linux_amd64|windows_amd64|darwin_arm64|...]
set -euo pipefail

PB_VERSION="0.40.6"

case "${1:-}" in
  "") case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows_amd64" ;;
        Darwin) PLATFORM="darwin_$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo amd64 )" ;;
        *) PLATFORM="linux_$( case "$(uname -m)" in aarch64|arm64) echo arm64 ;; *) echo amd64 ;; esac )" ;;
      esac ;;
  *) PLATFORM="$1" ;;
esac

DIR="$(cd "$(dirname "$0")/../pocketbase" && pwd)"
ZIP="$DIR/pocketbase_${PB_VERSION}_${PLATFORM}.zip"
URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${PLATFORM}.zip"

echo "Downloading $URL"
curl -fL -o "$ZIP" "$URL"
EXPECTED="$(curl -fsL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
  | grep " pocketbase_${PB_VERSION}_${PLATFORM}.zip$" | cut -d' ' -f1)"
ACTUAL="$(sha256sum "$ZIP" | cut -d' ' -f1)"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch for $ZIP (expected '$EXPECTED', got '$ACTUAL')" >&2
  rm -f "$ZIP"
  exit 1
fi
if ! command -v unzip >/dev/null; then
  echo "unzip not found, please install it (e.g. apt install unzip)" >&2
  rm -f "$ZIP"
  exit 1
fi
unzip -o "$ZIP" 'pocketbase*' -d "$DIR"
rm -f "$ZIP" "$DIR/CHANGELOG.md" "$DIR/LICENSE.md"
echo "PocketBase $PB_VERSION installed in $DIR"
