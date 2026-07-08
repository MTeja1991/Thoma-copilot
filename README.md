# Thoma

Self-hosted coding assistant with **local GGUF models** — no cloud APIs required.

Named after **Thomas** — shows reasoning before acting on your code.

## How it works

```
Cursor / VS Code extension  →  Thoma API  →  llama.cpp (GGUF on disk)
Cursor agents (MCP)         ↗
Browser chat (/)            ↗
```

Models are downloaded once from Hugging Face into `models/gguf/` and run locally via **llama-cpp-python** (Metal on Mac, CUDA on NVIDIA).

Ollama is **optional** — set `THOMA_INFERENCE_BACKEND=ollama` only if you prefer it.

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
| `thoma.autoApplyFileEdits` | `true` | Write proposed files without clicking Keep |
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
| `THOMA_INFERENCE_BACKEND` | `llamacpp`, `ollama` | `llamacpp` |
| `THOMA_MODELS_CONFIG` | path to yaml | `models-local-mps-16gb.yaml` |
| `THOMA_PROJECT_ROOT` | repo root | cwd |
| `THOMA_N_GPU_LAYERS` | `-1` = all GPU layers | `-1` |
| `THOMA_MODELS_DIR` | GGUF folder | `models/gguf` |
| `THOMA_API_URL` | MCP / clients | `http://127.0.0.1:8080` |
| `THOMA_WORKSPACE_ROOT` | MCP file tools scope | `THOMA_PROJECT_ROOT` |

**Ollama mode** (optional):

```bash
export THOMA_INFERENCE_BACKEND=ollama
export THOMA_MODELS_CONFIG=config/models-mps-16gb.yaml
export OLLAMA_BASE_URL=http://localhost:11434
uvicorn apps.api.main:app --port 8080
```

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
