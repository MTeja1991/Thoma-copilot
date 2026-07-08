#!/usr/bin/env bash
# Register the Thoma MCP server in Cursor (~/.cursor/mcp.json).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${THOMA_MCP_PYTHON:-/opt/anaconda3/bin/python3.11}"

if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3.11 2>/dev/null || command -v python3.12 2>/dev/null || true)"
fi
if [[ -z "$PYTHON" ]]; then
  echo "Need Python 3.10+ for MCP. Set THOMA_MCP_PYTHON or install python3.11."
  exit 1
fi

echo "==> Installing MCP dependencies..."
"$PYTHON" -m pip install -q -r "$ROOT/apps/mcp_server/requirements.txt"

export THOMA_MCP_ROOT="$ROOT"
export THOMA_MCP_PYTHON_BIN="$PYTHON"
export THOMA_API_URL="${THOMA_API_URL:-http://127.0.0.1:8080}"
export THOMA_WORKSPACE_ROOT="${THOMA_WORKSPACE_ROOT:-$ROOT}"

"$PYTHON" <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["THOMA_MCP_ROOT"])
python = os.environ["THOMA_MCP_PYTHON_BIN"]
mcp_user = Path.home() / ".cursor" / "mcp.json"

entry = {
    "command": python,
    "args": ["-m", "apps.mcp_server.server"],
    "cwd": str(root),
    "env": {
        "THOMA_API_URL": os.environ.get("THOMA_API_URL", "http://127.0.0.1:8080"),
        "THOMA_PROJECT_ROOT": str(root),
        "THOMA_WORKSPACE_ROOT": os.environ.get("THOMA_WORKSPACE_ROOT", str(root)),
    },
}

data: dict = {"mcpServers": {}}
if mcp_user.is_file():
    data = json.loads(mcp_user.read_text())
data.setdefault("mcpServers", {})["Thoma"] = entry
mcp_user.parent.mkdir(parents=True, exist_ok=True)
mcp_user.write_text(json.dumps(data, indent=2) + "\n")
print(f"Updated {mcp_user}")
PY

echo ""
echo "Done. Restart Cursor (or reload MCP) to enable the Thoma server."
