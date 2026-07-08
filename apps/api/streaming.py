"""OpenAI-style SSE helpers for chat streaming."""

from __future__ import annotations

import json
from typing import Any, Optional


def sse_chunk(
    *,
    content: Optional[str] = None,
    reasoning: Optional[str] = None,
    finish_reason: Optional[str] = None,
    model: str = "thoma",
    chat_id: Optional[str] = None,
) -> bytes:
    delta: dict[str, str] = {}
    if content:
        delta["content"] = content
    if reasoning:
        delta["reasoning_content"] = reasoning
    payload: dict[str, Any] = {
        "object": "chat.completion.chunk",
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    if chat_id:
        payload["chat_id"] = chat_id
    return f"data: {json.dumps(payload)}\n\n".encode()


def sse_done() -> bytes:
    return b"data: [DONE]\n\n"
