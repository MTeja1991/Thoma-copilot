"""Create inference backend from environment."""

from __future__ import annotations

import os

from apps.api.backends.hybrid_backend import HybridBackend
from apps.api.backends.llamacpp_backend import LlamaCppBackend
from apps.api.backends.ollama_backend import OllamaBackend
from apps.api.backends.openai_backend import OpenAICompatibleBackend


def create_inference_backend():
    kind = os.environ.get("THOMA_INFERENCE_BACKEND", "llamacpp").lower()
    remote = OpenAICompatibleBackend()

    if kind == "openai":
        return remote

    if kind == "ollama":
        url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        return HybridBackend(
            ollama=OllamaBackend(url),
            remote=remote,
            preferred_local="ollama",
        )

    if kind in ("llamacpp", "local", "gguf", "hybrid"):
        return HybridBackend(
            local=LlamaCppBackend(),
            remote=remote,
            preferred_local="llamacpp",
        )

    raise ValueError(
        f"Unknown THOMA_INFERENCE_BACKEND={kind!r}. "
        "Use 'llamacpp', 'ollama', 'openai', or 'hybrid'."
    )
