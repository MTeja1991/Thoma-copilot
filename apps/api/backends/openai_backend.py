"""OpenAI-compatible HTTP backend for remote model profiles."""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, Optional

import httpx

from apps.api.models import ModelProfile
from apps.api.streaming import sse_chunk, sse_done


def _default_base_for(profile: ModelProfile) -> str:
    if profile.api_base:
        return profile.api_base.rstrip("/")
    return os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


def _api_key_for(profile: ModelProfile) -> str:
    key = os.environ.get("OPENAI_API_KEY") or ""
    if not key:
        raise RuntimeError(
            "Missing API key for remote model. Set OPENAI_API_KEY for this profile."
        )
    return key


class OpenAICompatibleBackend:
    """Chat Completions against any OpenAI-compatible /v1 endpoint."""

    name = "openai"

    def model_ref(self, profile: ModelProfile) -> str:
        return profile.api_model or profile.display_model

    async def unload_all(self) -> None:
        return None

    async def warm(self, profile: ModelProfile) -> None:
        return None

    def _headers(self, profile: ModelProfile) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {_api_key_for(profile)}",
            "Content-Type": "application/json",
        }

    def _build_body(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool,
    ) -> dict[str, Any]:
        # Preserve reasoning_content across turns for models that expose thinking traces.
        clean: list[dict[str, Any]] = []
        for m in messages:
            item: dict[str, Any] = {"role": m["role"], "content": m.get("content") or ""}
            reasoning = m.get("reasoning_content")
            if reasoning and m["role"] == "assistant":
                item["reasoning_content"] = reasoning
            clean.append(item)

        body: dict[str, Any] = {
            "model": profile.api_model,
            "messages": clean,
            "stream": stream,
        }

        if profile.thinking:
            body["thinking"] = {"type": "enabled"}

        return body

    async def chat(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]:
        base = _default_base_for(profile)
        url = f"{base}/chat/completions"
        body = self._build_body(profile, messages, stream=stream)
        headers = self._headers(profile)

        client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))
        if stream:
            return self._stream_chat(client, url, headers, body, profile)

        try:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
        finally:
            await client.aclose()

        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = message.get("content") or ""
        reasoning = (
            message.get("reasoning_content")
            or message.get("thinking")
            or ""
        )
        return {"message": {"content": content, "thinking": reasoning}}

    async def _stream_chat(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        profile: ModelProfile,
    ) -> AsyncIterator[bytes]:
        try:
            async with client.stream("POST", url, headers=headers, json=body) as resp:
                if resp.status_code >= 400:
                    text = (await resp.aread()).decode(errors="replace")
                    yield sse_chunk(
                        content=f"\n[Error: remote API {resp.status_code}: {text[:500]}]",
                        finish_reason="stop",
                        model=profile.id,
                    )
                    yield sse_done()
                    return

                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choice = (data.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    content = delta.get("content") or None
                    reasoning = (
                        delta.get("reasoning_content")
                        or delta.get("thinking")
                        or None
                    )
                    finish = choice.get("finish_reason")
                    if content or reasoning or finish:
                        yield sse_chunk(
                            content=content,
                            reasoning=reasoning,
                            finish_reason=finish,
                            model=profile.id,
                        )
            yield sse_done()
        except Exception as exc:
            yield sse_chunk(
                content=f"\n[Error: {exc}]",
                finish_reason="stop",
                model=profile.id,
            )
            yield sse_done()
        finally:
            await client.aclose()
