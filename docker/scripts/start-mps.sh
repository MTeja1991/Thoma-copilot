#!/usr/bin/env bash
# Native macOS dev — Ollama (Metal/MPS) + Thoma API on host
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

UNIFIED_GB="${THOMA_UNIFIED_MEMORY_GB:-16}"
if [[ "${UNIFIED_GB}" -le 8 ]]; then
  CONFIG="config/models-mps-8gb.yaml"
  HARDWARE="mps-8gb"
else
  CONFIG="config/models-mps-16gb.yaml"
  HARDWARE="mps-16gb"
fi

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

if ! curl -sf "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
  echo "Ollama is not running at ${OLLAMA_HOST}"
  echo "Start it with: ollama serve"
  echo "Or install: brew install ollama"
  exit 1
fi

export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
export OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-8192}"
export THOMA_BACKEND=mps
export THOMA_INFERENCE_BACKEND=ollama
export THOMA_PROJECT_ROOT="${ROOT}"
export THOMA_DEFAULT_PROFILE="${THOMA_DEFAULT_PROFILE:-thoma-reason}"
export THOMA_MODELS_CONFIG="${CONFIG}"
export OLLAMA_BASE_URL="${OLLAMA_HOST}"

echo "Thoma MPS dev"
echo "  Config: ${CONFIG}"
echo "  Ollama: ${OLLAMA_HOST} (Metal/MPS via native Ollama)"
echo ""

if [[ "${PULL_MODELS:-0}" == "1" ]]; then
  THOMA_HARDWARE="${HARDWARE}" OLLAMA_HOST="${OLLAMA_HOST}" \
    "${ROOT}/docker/scripts/pull-models.sh"
fi

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r apps/api/requirements.txt
fi

exec .venv/bin/uvicorn apps.api.main:app --reload --host 127.0.0.1 --port 8080
