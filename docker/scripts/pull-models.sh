#!/usr/bin/env bash
# Pull Thoma models for NVIDIA CUDA, Apple Silicon MPS, or custom config
set -euo pipefail

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
THOMA_HARDWARE="${THOMA_HARDWARE:-nvidia}"

case "${THOMA_HARDWARE}" in
  nvidia|cuda|6gb)
    MODELS=(
      "qwen3:4b"
      "qwen2.5-coder:3b"
      "qwen2.5:3b"
      "deepseek-r1:1.5b"
    )
    STRETCH_NOTE="Optional 7B (tight on 6GB CUDA): qwen2.5-coder:7b, deepseek-r1:7b"
    ;;
  mps|mps-8gb|apple-8gb)
    MODELS=(
      "qwen3:4b"
      "qwen2.5-coder:3b"
      "qwen2.5:3b"
      "deepseek-r1:1.5b"
    )
    STRETCH_NOTE="Optional 7B on 8GB unified memory: qwen2.5-coder:7b"
    ;;
  mps-16gb|apple-16gb)
    MODELS=(
      "qwen3:8b"
      "qwen2.5-coder:7b"
      "deepseek-r1:7b"
      "qwen3:4b"
      "qwen2.5-coder:3b"
    )
    STRETCH_NOTE="Optional stretch: qwen2.5-coder:14b, deepseek-r1:14b"
    ;;
  *)
    echo "Unknown THOMA_HARDWARE=${THOMA_HARDWARE}"
    echo "Use: nvidia | mps-8gb | mps-16gb"
    exit 1
    ;;
esac

echo "Thoma: pulling models for ${THOMA_HARDWARE} via ${OLLAMA_HOST}"
echo ""

if [[ "${THOMA_HARDWARE}" == mps* ]] || [[ "${THOMA_HARDWARE}" == apple* ]]; then
  echo "MPS note: run Ollama natively on macOS (ollama serve) for Metal GPU acceleration."
  echo "Docker Ollama on Mac does not use MPS."
  echo ""
fi

for model in "${MODELS[@]}"; do
  echo "==> Pulling ${model}..."
  curl -sf "${OLLAMA_HOST}/api/pull" -d "{\"name\": \"${model}\"}" || {
    echo "Failed to pull ${model}. Is Ollama running at ${OLLAMA_HOST}?"
    exit 1
  }
  echo ""
done

echo "Done. Verify: curl ${OLLAMA_HOST}/api/tags"
echo ""
echo "${STRETCH_NOTE}"
