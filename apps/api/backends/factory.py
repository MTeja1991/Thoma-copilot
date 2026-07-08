"""Create inference backend from environment."""

from __future__ import annotations

import os

from apps.api.backends.llamacpp_backend import LlamaCppBackend
from apps.api.backends.ollama_backend import OllamaBackend


def create_inference_backend():
    kind = os.environ.get("THOMA_INFERENCE_BACKEND", "llamacpp").lower()
    if kind == "ollama":
        url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        return OllamaBackend(url)
    if kind in ("llamacpp", "local", "gguf"):
        return LlamaCppBackend()
    raise ValueError(
        f"Unknown THOMA_INFERENCE_BACKEND={kind!r}. Use 'llamacpp' or 'ollama'."
    )
