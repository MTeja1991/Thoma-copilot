# IMPLEMENTATION

Concise implementation state log for Thoma.

## Phase 0 — Foundation

| Item | Status |
|------|--------|
| `plans/thoma/THOMA-PLAN.md` | Done |
| `docs/CONTEXT.md`, `ARCHITECTURE.md` | Done |
| `config/models-6gb.yaml` | Done (CUDA) |
| `config/models-mps-8gb.yaml` | Done (Metal) |
| `config/models-mps-16gb.yaml` | Done (Metal) |
| `docker/docker-compose.nvidia.yml` | Done |
| `docker/docker-compose.mps.yml` | Done |
| Local GGUF inference | `apps/api/backends/llamacpp_backend.py` | Done (default) |
| Ollama inference (optional) | `apps/api/backends/ollama_backend.py` | Done |
| `config/models-local-*.yaml` | GGUF profiles | Done |
| `scripts/download-gguf.py` | Hugging Face download | Done |
| `docker/scripts/start-local.sh` | One-command local start | Done |

## Phase 2 — VS Code Extension (MVP)

| Item | Status |
|------|--------|
| `apps/vscode-extension/package.json` | Done |
| Sidebar chat webview | Done |
| Model profile switch | Done |
| Include active file context | Done |
| Explain / fix selection (context menu) | Done |
| Insert at cursor / run in terminal | Done |
| Conversation persistence | Not started |
| Diff accept/reject for multi-file agent | Not started |
| MCP tools | Not started |

## Next

- Smoke test extension with API on user machine
- Agent loop with multi-file edits + diff view
- `.thoma/rules` project instructions
