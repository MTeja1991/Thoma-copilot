# CONTEXT

Thoma is a self-hosted open-source coding assistant named after Thomas the disciple — it shows its reasoning before acting on code.

## Target state

- Cursor-like assistant: chat, agent edits, model switching, visible thinking
- Runs on Docker with local open-source LLMs
- Primary developer GPUs: NVIDIA RTX 4050 (6 GB VRAM) and Apple Silicon (MPS/Metal via native Ollama)
- First client: VS Code extension; backend API first
- Privacy-first: code stays on the user's machine

## Users

- Solo developer building and using Thoma on a laptop with 6 GB GPU

## Non-goals (MVP)

- Cloud-hosted SaaS
- Models larger than 7B Q3 on 6 GB hardware
- Full VS Code fork in Phase 1
