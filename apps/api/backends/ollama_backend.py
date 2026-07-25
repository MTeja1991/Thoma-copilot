"""Ollama HTTP backend (optional — requires Ollama service)."""

from __future__ import annotations

from typing import Any, AsyncIterator

import httpx

from apps.api.models import ModelProfile


class OllamaBackend:
    name = "ollama"

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def model_ref(self, profile: ModelProfile) -> str:
        return profile.ollama_model or profile.model_file

    async def list_running(self) -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{self.base_url}/api/ps")
            resp.raise_for_status()
            data = resp.json()
            return [m.get("name", "") for m in data.get("models", [])]

    async def unload_all(self) -> None:
        running = await self.list_running()
        async with httpx.AsyncClient(timeout=120.0) as client:
            for name in running:
                if name:
                    await client.post(
                        f"{self.base_url}/api/generate",
                        json={"model": name, "keep_alive": 0},
                    )

    async def warm(self, profile: ModelProfile) -> None:
        async with httpx.AsyncClient(timeout=300.0) as client:
            await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": profile.ollama_model,
                    "prompt": "hi",
                    "stream": False,
                    "options": {"num_ctx": profile.context_length},
                },
            )

    async def chat(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]:
        plain = [{"role": m["role"], "content": m.get("content") or ""} for m in messages]
        body: dict[str, Any] = {
            "model": profile.ollama_model,
            "messages": plain,
            "stream": stream,
            "options": {"num_ctx": profile.context_length},
        }
        if profile.thinking:
            body["think"] = True

        client = httpx.AsyncClient(timeout=600.0)
        if stream:
            return self._stream_chat(client, body)
        resp = await client.post(f"{self.base_url}/api/chat", json=body)
        resp.raise_for_status()
        await client.aclose()
        return resp.json()

    async def _stream_chat(
        self, client: httpx.AsyncClient, body: dict[str, Any]
    ) -> AsyncIterator[bytes]:
        try:
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=body
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line:
                        yield (line + "\n").encode()
        finally:
            await client.aclose()
