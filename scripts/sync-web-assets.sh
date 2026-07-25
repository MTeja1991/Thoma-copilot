#!/usr/bin/env bash
# Copy shared web assets into API and VS Code extension media folders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/shared/web"

for dest in "$ROOT/apps/api/web" "$ROOT/apps/vscode-extension/media"; do
  cp "$SRC/marked.min.js" "$dest/marked.min.js"
  cp "$SRC/streamThinking.js" "$dest/streamThinking.js"
done

echo "Synced web assets to api/web and vscode-extension/media"
