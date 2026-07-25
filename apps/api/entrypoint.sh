#!/bin/sh
set -eu

HOST="${THOMA_API_HOST:-0.0.0.0}"
PORT="${THOMA_API_PORT:-8080}"
WORKERS="${THOMA_WORKERS:-1}"
RELOAD="${THOMA_RELOAD:-0}"

ARGS="apps.api.main:app --host ${HOST} --port ${PORT}"

if [ "${RELOAD}" = "1" ]; then
  exec uvicorn ${ARGS} --reload
fi

if [ "${WORKERS}" -gt 1 ]; then
  exec uvicorn ${ARGS} --workers "${WORKERS}"
fi

exec uvicorn ${ARGS}
