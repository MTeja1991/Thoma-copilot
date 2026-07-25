# Thoma

Self-hosted coding assistant running entirely on **local GGUF models** — no paid hosted API required.

Named after **Thomas** — shows reasoning before acting on your code.

## How it works

```
Cursor / VS Code extension  →  Thoma API  →  llama.cpp (GGUF on disk)
Cursor agents (MCP)         ↗
Browser chat (/)            ↗
```

Models are downloaded once from Hugging Face into `models/gguf/` and run locally via **llama-cpp-python** (Metal on Mac, CUDA on NVIDIA).

Ollama is **optional** — set `THOMA_INFERENCE_BACKEND=ollama` only if you prefer it.

A generic OpenAI-compatible remote-profile backend still exists in code (`apps/api/backends/openai_backend.py`) for anyone who wants to wire up their own hosted endpoint later, but no hosted profile ships by default — Thoma runs fully local out of the box.

---

## Quick start (local — recommended)

### Mac (Apple Silicon / MPS)

```bash
cd /path/to/Assistant_os
chmod +x docker/scripts/start-local.sh
THOMA_UNIFIED_MEMORY_GB=16 ./docker/scripts/start-local.sh
```

First run downloads GGUF files (~2–8 GB each) and installs `llama-cpp-python` with Metal.

### Manual API start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt

# Mac Metal build:
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python

python scripts/download-gguf.py --config config/models-local-mps-16gb.yaml

export THOMA_INFERENCE_BACKEND=llamacpp
export THOMA_MODELS_CONFIG=config/models-local-mps-16gb.yaml
export THOMA_PROJECT_ROOT=$(pwd)
uvicorn apps.api.main:app --host 127.0.0.1 --port 8080
```

Verify:

```bash
curl http://localhost:8080/health
# "backend": "llamacpp"
```

### NVIDIA 6 GB

```bash
THOMA_UNIFIED_MEMORY_GB=6 THOMA_HARDWARE=cuda-6gb ./docker/scripts/start-local.sh
```

Uses `config/models-local-6gb.yaml` (3B–4B models).

---

## Use Thoma in Cursor (recommended)

### 1. Start the API

Use the manual steps above or `start-local.sh`. The extension expects `http://127.0.0.1:8080`.

### 2. Install the extension

```bash
./scripts/install-cursor-extension.sh
```

Then **reload Cursor**: `Cmd+Shift+P` → **Developer: Reload Window**

### 3. Open the chat panel

- Thoma opens on the **right sidebar** (like Cursor/Windsurf)
- **Cmd+L** — focus chat from the editor
- **Explorer right-click** → **thoma: Add to Chat** — attach files/folders

### Extension features

| Feature | Description |
|---------|-------------|
| **Right-side chat** | Secondary sidebar panel with markdown rendering |
| **Workspace context** | File tree + key files sent on first message (toggle *Workspace*) |
| **@ File / @ Folder** | Attach paths as context chips |
| **Per-project chat history** | Chats scoped to the open workspace folder |
| **Streaming** | Token-by-token replies; thinking shown as spinner (expand to read) |
| **Stop** | Red **■ Stop** button aborts generation mid-stream |
| **File proposals** | Model suggests files via ` ```python path/to/file.py ` blocks |
| **Keep / Undo** | Review diffs; accept or reject writes (auto-apply on by default) |
| **Plan** | Workspace-aware planning mode |

### Extension settings

| Setting | Default | Description |
|---------|---------|-------------|
| `thoma.apiUrl` | `http://localhost:8080` | Thoma API base URL |
| `thoma.defaultProfile` | `thoma-reason` | Default model profile |
| `thoma.openOnStartup` | `true` | Open right panel when workspace loads |
| `thoma.includeWorkspaceByDefault` | `true` | Attach workspace tree on first message |
| `thoma.autoApplyFileEdits` | `false` | Write proposed files without clicking Keep (off by default — review diffs first) |
| `thoma.maxFileContextLines` | `400` | Max lines per attached file |

See [apps/vscode-extension/README.md](apps/vscode-extension/README.md) for editor commands and troubleshooting.

---

## Thoma MCP server (Cursor agents)

Expose Thoma to **Cursor agent mode** via MCP tools (`thoma_chat`, `thoma_read_file`, `thoma_write_file`, `thoma_workspace_tree`, etc.).

### Install

Requires **Python 3.10+** (e.g. `python3.11` from Anaconda):

```bash
./scripts/install-thoma-mcp.sh
```

This merges **Thoma** into `~/.cursor/mcp.json`. Restart Cursor to load it.

### Point MCP at your project

When working outside this repo, set the workspace root:

```bash
THOMA_WORKSPACE_ROOT=/path/to/your/project ./scripts/install-thoma-mcp.sh
```

Or add a project-level `.cursor/mcp.json` with `THOMA_WORKSPACE_ROOT` in `env`.

**Prerequisite:** Thoma API must be running (`uvicorn` on port 8080).

Implementation: [apps/mcp_server/server.py](apps/mcp_server/server.py)

---

## Browser chat (no editor)

```bash
./docker/scripts/start-smoke.sh
# or start the API manually (see above)
```

Open **http://127.0.0.1:8080** — chat UI with history, streaming, and markdown.

### Terminal CLI

```bash
.venv/bin/python scripts/thoma-chat.py
```

---

## Chat API & persistence

- **REST:** `GET/POST /v1/chats` — workspace-scoped sessions (`workspace_root` query/body field)
- **Completions:** `POST /v1/chat/completions` — OpenAI-compatible; supports `chat_id`, `stream`, `workspace_planning`
- **Storage:** SQLite at `data/chats.db` (under `THOMA_PROJECT_ROOT`)

---

## Model configs

| Config | Hardware | Backend |
|--------|----------|---------|
| `config/models-local-6gb.yaml` | NVIDIA 6 GB / 8 GB Mac | GGUF 3B–4B |
| `config/models-local-mps-16gb.yaml` | Apple Silicon 16 GB+ | GGUF 7B–8B |
| `config/models-smoke.yaml` | Quick smoke test | Small GGUF |
| `config/models-6gb.yaml` | NVIDIA + **Ollama** (legacy) | ollama |
| `config/models-mps-16gb.yaml` | Mac + **Ollama** (legacy) | ollama |

Download manifest: `config/gguf-manifest.yaml`

---

## Environment variables

| Variable | Values | Default |
|----------|--------|---------|
| `THOMA_INFERENCE_BACKEND` | `llamacpp`, `ollama`, `openai`, `hybrid` | `llamacpp` |
| `THOMA_MODELS_CONFIG` | path to yaml | `models-local-mps-16gb.yaml` |
| `THOMA_PROJECT_ROOT` | repo root | cwd |
| `THOMA_N_GPU_LAYERS` | `-1` = all GPU layers | `-1` |
| `THOMA_MODELS_DIR` | GGUF folder | `models/gguf` |
| `THOMA_API_URL` | MCP / clients | `http://127.0.0.1:8080` |
| `THOMA_WORKSPACE_ROOT` | MCP file tools scope | `THOMA_PROJECT_ROOT` |
| `THOMA_ENV` | `development`, `production` | `development` |
| `THOMA_AUTH_ENABLED` | `1` to enable API key auth | `0` (off) |
| `THOMA_API_KEY` | Bearer token when auth enabled | (unused) |
| `THOMA_CORS_ORIGINS` | Comma-separated origins | (none) |
| `THOMA_RATE_LIMIT_RPM` | Chat requests/min per client | `0` (off) |
| `THOMA_TRUST_PROXY` | `1` to key rate limiting off `X-Forwarded-For` (set only behind a trusted reverse proxy) | `0` |
| `THOMA_WORKERS` | Uvicorn worker count | `1` |
| `THOMA_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING` | `INFO` |
| `THOMA_MCP_ALLOW_WRITE` | `1` / `0` for MCP file writes | `1` |
| `OPENAI_API_KEY` | Key for an OpenAI-compatible remote profile, if configured | (unused) |
| `OPENAI_BASE_URL` | Base URL for that remote profile | `https://api.openai.com/v1` |

**Ollama mode** (optional):

```bash
export THOMA_INFERENCE_BACKEND=ollama
export THOMA_MODELS_CONFIG=config/models-mps-16gb.yaml
export OLLAMA_BASE_URL=http://localhost:11434
uvicorn apps.api.main:app --port 8080
```

---

## Production deployment

**Pre-prod (now):** auth is **off** by default — no API key or JWT required. Start with:

```bash
cp .env.example .env
# THOMA_AUTH_ENABLED=0  (default)

chmod +x docker/scripts/start-prod.sh
./docker/scripts/start-prod.sh
```

**Production (later):** JWT auth will replace the interim API-key middleware. Until then, optional API key:

```bash
export THOMA_AUTH_ENABLED=1
export THOMA_API_KEY=your-secret
```

**Health checks**

| Endpoint | Use |
|----------|-----|
| `GET /health/live` | Process up (load balancer liveness) |
| `GET /health/ready` | DB + inference ready (returns 503 if degraded) |
| `GET /health` | Full status + checks |

**Smoke test**

```bash
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh
# with optional API key auth: THOMA_AUTH_ENABLED=1 THOMA_API_KEY=... ./scripts/smoke-test.sh
```

**Docker (Ollama stack)**

```bash
cd docker
cp .env.example .env
docker compose up -d --build
# production overlay (localhost bind + prod defaults):
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Clients**

- Browser UI, extension, and MCP work without auth in pre-prod
- When auth is enabled: set `thoma.apiKey` (extension) or `THOMA_API_KEY` (MCP)

**Before internet-facing prod**

- Add JWT (planned) or set `THOMA_AUTH_ENABLED=1` + `THOMA_API_KEY` as interim
- Set `THOMA_MCP_ALLOW_WRITE=0` unless agents must write files
- Put TLS in front (Caddy/nginx)
- Use `THOMA_RATE_LIMIT_RPM=120` to cap chat abuse
- If you're behind a reverse proxy, set `THOMA_TRUST_PROXY=1` so rate limiting keys off the real client IP (`X-Forwarded-For`) instead of the proxy's

**Tests**

```bash
pip install -r apps/api/requirements-dev.txt
python -m pytest apps/api/tests -v
```

Covers auth (public vs. protected paths, bearer/`X-API-Key` acceptance), rate limiting, and chat session CRUD.

**Known limitations (documented, not yet fixed)**

- Rate limiting is per-worker, in-memory state. If `THOMA_WORKERS` is ever raised above the default of `1`, the effective limit becomes `rpm × workers` since counters aren't shared across workers.
- No container resource limits (`mem_limit`/`cpus`) are set in the Docker Compose files — a runaway model load can exhaust host memory on a small VPS. Add them manually if hosting on a memory-constrained box.
- `apps/api/requirements.txt` uses lower-bound version pins only, no lockfile — fine for local dev, but pin exact versions (or generate a lockfile) before relying on reproducible prod builds.

---

## Project layout

```
├── models/gguf/              # Local GGUF weights (not in git)
├── data/chats.db             # Chat persistence (SQLite)
├── scripts/
│   ├── download-gguf.py
│   ├── install-cursor-extension.sh
│   ├── install-thoma-mcp.sh
│   └── thoma-chat.py
├── config/
│   ├── models-local-*.yaml
│   ├── models-smoke.yaml
│   └── gguf-manifest.yaml
├── apps/
│   ├── api/                  # FastAPI, chat store, llama.cpp / Ollama backends
│   │   └── web/chat.html     # Browser UI
│   ├── mcp_server/           # MCP tools for Cursor agents
│   └── vscode-extension/     # Cursor/VS Code right-panel extension
├── docker/scripts/           # start-local.sh, start-smoke.sh, …
└── .cursor/mcp.json          # Example MCP config (project-local)
```

---

## Roadmap

- [x] Local GGUF + OpenAI-compatible API
- [x] VS Code / Cursor extension (right panel, workspace context)
- [x] Chat persistence + per-workspace history
- [x] Streaming, collapsible thinking, markdown replies
- [x] File proposals with Keep / Undo (diff review)
- [x] Stop generation mid-stream
- [x] Thoma MCP server for Cursor agents
- [ ] `.thoma/rules` project instructions
- [ ] Multi-file edit batches with per-hunk review

---

## Docs

- [apps/vscode-extension/README.md](apps/vscode-extension/README.md) — extension install & commands
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design
- [agents/IMPLEMENTATION.md](agents/IMPLEMENTATION.md) — implementation notes
