"""Backward-compatible re-export. Prefer apps.api.backends.ollama_backend."""

from apps.api.backends.ollama_backend import OllamaBackend as OllamaClient

__all__ = ["OllamaClient"]
