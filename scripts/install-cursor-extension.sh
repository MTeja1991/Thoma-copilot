#!/usr/bin/env bash
# Install the thoma VS Code/Cursor extension from this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/apps/vscode-extension"
VSIX="$EXT/thoma-0.3.3.vsix"

CURSOR_CLI="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
CODE_CLI="$(command -v code || true)"

echo "==> Building extension..."
cd "$EXT"
npm install --silent
npm run compile
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository

if [[ -x "$CURSOR_CLI" ]]; then
  echo "==> Installing into Cursor..."
  "$CURSOR_CLI" --install-extension "$VSIX"
  echo ""
  echo "Done. Reload Cursor: Cmd+Shift+P → 'Developer: Reload Window'"
  echo "thoma opens on the right sidebar (like Cursor/Windsurf). Cmd+L or Explorer right-click → Add to thoma."
elif [[ -n "$CODE_CLI" ]]; then
  echo "==> Installing into VS Code..."
  "$CODE_CLI" --install-extension "$VSIX"
  echo ""
  echo "Done. Reload VS Code: Cmd+Shift+P → 'Developer: Reload Window'"
else
  echo "No Cursor or VS Code CLI found."
  echo "Manual install: Cmd+Shift+P → 'Extensions: Install from VSIX...'"
  echo "Select: $VSIX"
  exit 1
fi
