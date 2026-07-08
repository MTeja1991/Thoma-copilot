"""Inference backend protocol — Ollama or local GGUF (llama.cpp)."""

from __future__ import annotations

from typing import Any, AsyncIterator, Protocol, runtime_checkable

from apps.api.models import ModelProfile


@runtime_checkable
class InferenceBackend(Protocol):
    name: str

    async def unload_all(self) -> None: ...

    async def warm(self, profile: ModelProfile) -> None: ...

    async def chat(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]: ...

    def model_ref(self, profile: ModelProfile) -> str:
        """Human-readable model reference for API responses."""
        ...
