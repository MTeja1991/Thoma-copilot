# ARCHITECTURE

Technical architecture for Thoma — self-hosted coding assistant.

## Modules

| Module | Path | Status |
|--------|------|--------|
| Model runtime | Ollama (Docker CUDA or native macOS) | Active |
| API gateway | `apps/api/` | Active |
| Model profiles | `config/models-*.yaml` | Active |
| VS Code extension | `apps/vscode-extension/` | MVP done |

## Backends

| Backend | Accelerator | Ollama location | Compose |
|---------|-------------|-----------------|---------|
| `nvidia` | CUDA | Docker + GPU overlay | `docker-compose.yml` + `docker-compose.nvidia.yml` |
| `mps` | Metal (via Ollama) | **macOS host** (native) | `docker-compose.mps.yml` or `start-mps.sh` |
| `docker` | CPU (fallback) | Docker container | `docker-compose.yml` only |

MPS does not run inside Linux Docker containers on Mac. Ollama on macOS uses Metal automatically when installed natively.

## Runtime topology

### NVIDIA

```
VS Code  →  Thoma API (:8080)  →  Ollama container (:11434)  →  CUDA
```

### Apple Silicon (MPS)

```
VS Code Extension  →  Thoma API (:8080)  →  host Ollama (:11434)  →  Metal/MPS
```

## VS Code extension (`apps/vscode-extension/`)

| Capability | Implementation |
|------------|----------------|
| Chat UI | Webview sidebar `thoma.chatView` |
| API client | `src/thomaClient.ts` → `thoma.apiUrl` |
| Editor context | Active file / selection via `editorContext.ts` |
| Apply code | Insert or replace selection from chat actions |
| Commands | Explain, fix, ask about file, run in terminal |


| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Liveness + backend (`cuda` / `mps`) |
| `/v1/models` | GET | List profiles for active config |
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/profiles/{id}/switch` | POST | Unload + warm target model |

## Model configs

| File | Hardware |
|------|----------|
| `config/models-6gb.yaml` | NVIDIA 6 GB VRAM |
| `config/models-mps-8gb.yaml` | Apple Silicon 8 GB unified |
| `config/models-mps-16gb.yaml` | Apple Silicon 16 GB+ unified |

Set via `THOMA_MODELS_CONFIG` environment variable.

## Memory constraints

- `OLLAMA_MAX_LOADED_MODELS=1` on constrained hardware
- Explicit profile switch unloads previous model before loading next
- MPS 16 GB can run 7B–8B models at 8K context; 8 GB Mac uses 3B–4B primary

## Security

- API on localhost by default in native MPS dev (`127.0.0.1`)
- No secrets in repo; `.env` / `.env.mps` for local overrides
