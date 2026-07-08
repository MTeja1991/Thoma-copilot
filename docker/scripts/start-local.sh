#!/usr/bin/env bash
# Start Thoma with local GGUF models (no Ollama)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

UNIFIED_GB="${THOMA_UNIFIED_MEMORY_GB:-16}"
if [[ "${THOMA_UNIFIED_MEMORY_GB:-}" == "6" ]] || [[ "${THOMA_HARDWARE:-}" == "cuda-6gb" ]]; then
  CONFIG="config/models-local-6gb.yaml"
elif [[ "${UNIFIED_GB}" -le 8 ]]; then
  CONFIG="config/models-local-6gb.yaml"
else
  CONFIG="config/models-local-mps-16gb.yaml"
fi

export PYTHONPATH="${ROOT}"
export THOMA_INFERENCE_BACKEND=llamacpp
export THOMA_PROJECT_ROOT="${ROOT}"
export THOMA_MODELS_DIR=models/gguf
export THOMA_MODELS_CONFIG="${CONFIG}"
export THOMA_N_GPU_LAYERS="${THOMA_N_GPU_LAYERS:--1}"

echo "Thoma local inference (llama.cpp / GGUF)"
echo "  Config: ${CONFIG}"
echo "  Models: ${ROOT}/models/gguf/"
echo ""

if [[ ! -d models/gguf ]] || [[ -z "$(ls -A models/gguf 2>/dev/null || true)" ]]; then
  echo "No GGUF files found. Downloading..."
  if [[ ! -d .venv ]]; then
    python3 -m venv .venv
    .venv/bin/pip install -q huggingface_hub pyyaml
  fi
  .venv/bin/python scripts/download-gguf.py --config "${CONFIG}"
fi

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python -c "import llama_cpp" 2>/dev/null; then
  echo "Installing llama-cpp-python (Metal/CUDA if available)..."
  if [[ "$(uname)" == "Darwin" ]]; then
    CMAKE_ARGS="-DGGML_METAL=on" .venv/bin/pip install llama-cpp-python
  else
    .venv/bin/pip install llama-cpp-python
  fi
fi

.venv/bin/pip install -q -r apps/api/requirements.txt

exec .venv/bin/uvicorn apps.api.main:app --reload --host 127.0.0.1 --port 8080
