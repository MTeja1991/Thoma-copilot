"""Local GGUF inference via llama-cpp-python (Metal/CUDA/CPU — no Ollama)."""

from __future__ import annotations

import asyncio
import gc
import os
import re
from pathlib import Path
from queue import Empty, Queue
from threading import Lock, Thread
from typing import Any, AsyncIterator

from apps.api.models import ModelProfile, models_dir, resolve_model_path
from apps.api.streaming import sse_chunk, sse_done
from apps.api.thinking import StreamThinkingFilter, extract_thinking


class LlamaCppBackend:
    name = "llamacpp"

    def __init__(self) -> None:
        self._llm: Any = None
        self._loaded_profile_id: str | None = None
        self._lock = Lock()
        self._n_gpu_layers = int(os.environ.get("THOMA_N_GPU_LAYERS", "-1"))
        self._verbose = os.environ.get("THOMA_LLAMA_VERBOSE", "0") == "1"

    def model_ref(self, profile: ModelProfile) -> str:
        return profile.model_file or profile.ollama_model

    @staticmethod
    def _plain_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
        return [{"role": m["role"], "content": m.get("content") or ""} for m in messages]

    def _path_for(self, profile: ModelProfile) -> Path:
        path = resolve_model_path(profile)
        if not path.is_file():
            raise FileNotFoundError(
                f"GGUF not found: {path}\n"
                f"Run: python scripts/download-gguf.py --config {os.environ.get('THOMA_MODELS_CONFIG', 'config/models-local-mps-16gb.yaml')}"
            )
        return path

    def _unload_sync(self) -> None:
        with self._lock:
            if self._llm is not None:
                del self._llm
                self._llm = None
                self._loaded_profile_id = None
                gc.collect()

    async def unload_all(self) -> None:
        await asyncio.to_thread(self._unload_sync)

    def _load_sync(self, profile: ModelProfile) -> None:
        from llama_cpp import Llama

        path = self._path_for(profile)
        with self._lock:
            if self._loaded_profile_id == profile.id and self._llm is not None:
                return
            if self._llm is not None:
                del self._llm
                self._llm = None
                gc.collect()

            self._llm = Llama(
                model_path=str(path),
                n_ctx=profile.context_length,
                n_gpu_layers=self._n_gpu_layers,
                verbose=self._verbose,
            )
            self._loaded_profile_id = profile.id

    async def warm(self, profile: ModelProfile) -> None:
        await asyncio.to_thread(self._load_sync, profile)

    def _chat_sync(
        self, profile: ModelProfile, messages: list[dict[str, str]]
    ) -> dict[str, Any]:
        self._load_sync(profile)
        assert self._llm is not None
        messages = self._plain_messages(messages)

        kwargs: dict[str, Any] = {
            "messages": messages,
            "temperature": 0.7,
        }
        if profile.thinking:
            kwargs["extra_body"] = {"enable_thinking": True}

        try:
            result = self._llm.create_chat_completion(**kwargs)
        except TypeError:
            result = self._llm.create_chat_completion(messages=messages, temperature=0.7)

        choice = result["choices"][0]["message"]
        content = choice.get("content") or ""
        reasoning = choice.get("reasoning_content") or choice.get("thinking") or ""

        embedded, content = extract_thinking(content)
        if embedded:
            reasoning = f"{reasoning}\n\n{embedded}".strip() if reasoning else embedded

        return {"message": {"content": content, "thinking": reasoning}}

    def _chat_stream_sync(self, profile: ModelProfile, messages: list[dict[str, str]], out: Queue) -> None:
        splitter = StreamThinkingFilter()
        try:
            self._load_sync(profile)
            assert self._llm is not None
            messages = self._plain_messages(messages)
            kwargs: dict[str, Any] = {
                "messages": messages,
                "temperature": 0.7,
                "stream": True,
            }
            if profile.thinking:
                kwargs["extra_body"] = {"enable_thinking": True}
            try:
                stream = self._llm.create_chat_completion(**kwargs)
            except TypeError:
                stream = self._llm.create_chat_completion(
                    messages=messages, temperature=0.7, stream=True
                )

            for chunk in stream:
                choice = chunk["choices"][0]
                delta = choice.get("delta") or {}
                raw_content = delta.get("content") or ""
                reasoning = delta.get("reasoning_content") or delta.get("thinking") or ""
                if raw_content:
                    split_reasoning, visible = splitter.feed(raw_content)
                    reasoning = f"{reasoning}{split_reasoning}" if reasoning else split_reasoning
                    raw_content = visible
                finish = choice.get("finish_reason")
                if raw_content or reasoning or finish:
                    out.put(
                        {
                            "content": raw_content,
                            "reasoning": reasoning,
                            "finish_reason": finish,
                        }
                    )
            tail_reasoning, tail_content = splitter.flush()
            if tail_reasoning or tail_content:
                out.put(
                    {
                        "content": tail_content,
                        "reasoning": tail_reasoning,
                        "finish_reason": None,
                    }
                )
        except Exception as exc:
            out.put({"error": str(exc)})
        finally:
            out.put(None)

    async def _stream_chat(
        self, profile: ModelProfile, messages: list[dict[str, str]]
    ) -> AsyncIterator[bytes]:
        queue: Queue = Queue()
        thread = Thread(
            target=self._chat_stream_sync,
            args=(profile, messages, queue),
            daemon=True,
        )
        thread.start()

        while True:
            item = await asyncio.to_thread(queue.get)
            if item is None:
                break
            if item.get("error"):
                yield sse_chunk(content=f"\n[Error: {item['error']}]", finish_reason="stop")
                break
            yield sse_chunk(
                content=item.get("content") or None,
                reasoning=item.get("reasoning") or None,
                finish_reason=item.get("finish_reason"),
                model=profile.id,
            )
        yield sse_done()
        thread.join(timeout=1.0)

    async def chat(
        self,
        profile: ModelProfile,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]:
        if stream:
            return self._stream_chat(profile, messages)
        return await asyncio.to_thread(self._chat_sync, profile, messages)


def _split_thinking_tags(text: str) -> tuple[str, str]:
    """Backward-compatible alias."""
    return extract_thinking(text)
