#!/usr/bin/env bash
# Production Thoma API (no --reload, configurable host/port/workers)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

export PYTHONPATH="${ROOT}"
export THOMA_PROJECT_ROOT="${ROOT}"
export THOMA_ENV="${THOMA_ENV:-production}"
export THOMA_INFERENCE_BACKEND="${THOMA_INFERENCE_BACKEND:-llamacpp}"
export THOMA_MODELS_CONFIG="${THOMA_MODELS_CONFIG:-config/models-local-mps-16gb.yaml}"
export THOMA_MODELS_DIR="${THOMA_MODELS_DIR:-models/gguf}"
export THOMA_DATA_DIR="${THOMA_DATA_DIR:-data}"
export THOMA_API_HOST="${THOMA_API_HOST:-127.0.0.1}"
export THOMA_API_PORT="${THOMA_API_PORT:-8080}"
export THOMA_WORKERS="${THOMA_WORKERS:-1}"
export THOMA_RELOAD=0
export THOMA_LOG_LEVEL="${THOMA_LOG_LEVEL:-INFO}"
export THOMA_AUTH_ENABLED="${THOMA_AUTH_ENABLED:-0}"

if [[ ! -d .venv ]]; then
  echo "Missing .venv — run docker/scripts/start-local.sh once to bootstrap."
  exit 1
fi

.venv/bin/pip install -q -r apps/api/requirements.txt

echo "Thoma production API"
echo "  env:      ${THOMA_ENV}"
echo "  host:     ${THOMA_API_HOST}:${THOMA_API_PORT}"
echo "  workers:  ${THOMA_WORKERS}"
echo "  auth:     $([ "${THOMA_AUTH_ENABLED:-0}" = "1" ] && [ -n "${THOMA_API_KEY:-}" ] && echo enabled || echo disabled)"
echo ""

exec "${ROOT}/apps/api/entrypoint.sh"
