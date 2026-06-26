#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/Applications/Clave.app}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTITLEMENTS="$SCRIPT_DIR/entitlements.plist"

if [ ! -d "$APP_PATH" ]; then
  echo "Clave.app introuvable: $APP_PATH"
  echo "Copiez d'abord Clave.app dans Applications, puis relancez ce script."
  exit 1
fi

echo "Reparation de $APP_PATH"

echo "Suppression de la quarantaine macOS..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo "Correction des droits d'execution..."
if [ -d "$APP_PATH/Contents/MacOS" ]; then
  find "$APP_PATH/Contents/MacOS" -type f -exec chmod 755 {} \;
fi

echo "Signature ad hoc locale..."
if [ -f "$ENTITLEMENTS" ]; then
  codesign --force --deep --sign - --entitlements "$ENTITLEMENTS" "$APP_PATH"
else
  codesign --force --deep --sign - "$APP_PATH"
fi

echo "Verification de la signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "Ouverture de Clave..."
open "$APP_PATH"
