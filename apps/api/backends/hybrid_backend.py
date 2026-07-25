"""Route each profile to local GGUF, Ollama, or a remote OpenAI-compatible API."""

from __future__ import annotations

from typing import Any, AsyncIterator, Optional

from apps.api.backends.llamacpp_backend import LlamaCppBackend
from apps.api.backends.ollama_backend import OllamaBackend
from apps.api.backends.openai_backend import OpenAICompatibleBackend
from apps.api.models import ModelProfile


class HybridBackend:
    """Keep local models available while routing remote profiles to an OpenAI-compatible API."""

    name = "hybrid"

    def __init__(
        self,
        local: Optional[LlamaCppBackend] = None,
        ollama: Optional[OllamaBackend] = None,
        remote: Optional[OpenAICompatibleBackend] = None,
        preferred_local: str = "llamacpp",
    ) -> None:
        self._local = local
        self._ollama = ollama
        self._remote = remote or OpenAICompatibleBackend()
        self._preferred_local = preferred_local

    def _backend_for(self, profile: ModelProfile):
        if profile.is_remote:
            return self._remote
        if profile.model_file and self._local is not None:
            return self._local
        if profile.ollama_model and self._ollama is not None:
            return self._ollama
        if profile.model_file:
            raise RuntimeError(
                f"Profile {profile.id} needs local GGUF backend, but none is configured"
            )
        if profile.ollama_model:
            raise RuntimeError(
                f"Profile {profile.id} needs Ollama backend, but none is configured"
            )
        raise RuntimeError(f"Profile {profile.id} has no usable backend target")

    def model_ref(self, profile: ModelProfile) -> str:
        return self._backend_for(profile).model_ref(profile)

    async def unload_all(self) -> None:
        if self._local is not None:
            await self._local.unload_all()
        if self._ollama is not None:
            await self._ollama.unload_all()
        await self._remote.unload_all()

    async def warm(self, profile: ModelProfile) -> None:
        await self._backend_for(profile).warm(profile)

    async def chat(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]:
        return await self._backend_for(profile).chat(profile, messages, stream=stream)
