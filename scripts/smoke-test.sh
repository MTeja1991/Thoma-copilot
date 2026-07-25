#!/usr/bin/env bash
# Smoke test — exit 0 when API is healthy and chat pipeline works
set -euo pipefail

API="${THOMA_API_URL:-http://127.0.0.1:8080}"
API="${API%/}"
AUTH=()
if [[ -n "${THOMA_API_KEY:-}" ]]; then
  AUTH=(-H "Authorization: Bearer ${THOMA_API_KEY}")
fi

echo "→ live  ${API}/health/live"
curl -fsS "${AUTH[@]}" "${API}/health/live" >/dev/null

echo "→ ready ${API}/health/ready"
curl -fsS "${AUTH[@]}" "${API}/health/ready" >/dev/null

echo "→ models"
curl -fsS "${AUTH[@]}" "${API}/v1/models" >/dev/null

echo "→ chat"
CHAT=$(curl -fsS "${AUTH[@]}" -X POST "${API}/v1/chats" \
  -H "Content-Type: application/json" \
  -d '{"profile":"thoma-fast","title":"smoke"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

curl -fsS "${AUTH[@]}" -N -X POST "${API}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"thoma-fast\",\"chat_id\":\"${CHAT}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":true}" \
  | grep -q "data:"

echo "✓ smoke test passed"
