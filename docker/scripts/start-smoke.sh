#!/usr/bin/env bash
# Quick smoke test: API + single Qwen3-4B model (already downloaded)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

export PYTHONPATH="${ROOT}"
export THOMA_INFERENCE_BACKEND=llamacpp
export THOMA_PROJECT_ROOT="${ROOT}"
export THOMA_MODELS_DIR=models/gguf
export THOMA_MODELS_CONFIG=config/models-smoke.yaml
export THOMA_N_GPU_LAYERS=-1

if [[ ! -f models/gguf/Qwen3-4B-Q4_K_M.gguf ]]; then
  echo "Missing model. Run: .venv/bin/python scripts/download-gguf.py --config config/models-smoke.yaml"
  exit 1
fi

echo "Thoma smoke test API → http://127.0.0.1:8080"
echo "VS Code: open apps/vscode-extension and press F5"
exec .venv/bin/uvicorn apps.api.main:app --host 127.0.0.1 --port 8080 --reload
