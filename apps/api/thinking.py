"""Extract model thinking/reasoning blocks from assistant output."""

from __future__ import annotations

import re
from typing import Optional

_THINK_OPEN = "<" + "think" + ">"
_THINK_CLOSE = "</" + "think" + ">"
_REDACTED_OPEN = "<" + "redacted_thinking" + ">"
_REDACTED_CLOSE = "</" + "redacted_thinking" + ">"

_BLOCK_PATTERNS = [
    re.compile(
        rf"{re.escape(_REDACTED_OPEN)}([\s\S]*?){re.escape(_REDACTED_CLOSE)}\s*",
        re.IGNORECASE,
    ),
    re.compile(
        rf"{re.escape(_THINK_OPEN)}([\s\S]*?){re.escape(_THINK_CLOSE)}\s*",
        re.IGNORECASE,
    ),
    re.compile(r"<\|think\|>([\s\S]*?)<\|/think\|>\s*", re.IGNORECASE),
    re.compile(r"\[THINK\]([\s\S]*?)\[/THINK\]\s*", re.IGNORECASE),
]

_OPEN_CLOSE = [
    (_REDACTED_OPEN, _REDACTED_CLOSE),
    (_THINK_OPEN, _THINK_CLOSE),
    ("<|think|>", "<|/think|>"),
    ("[THINK]", "[/THINK]"),
]


def extract_thinking(text: str) -> tuple[str, str]:
    """Return (thinking, visible_content)."""
    thinking_parts: list[str] = []
    content = text
    for pattern in _BLOCK_PATTERNS:
        for match in pattern.finditer(content):
            part = match.group(1).strip()
            if part:
                thinking_parts.append(part)
        content = pattern.sub("", content)
    thinking = "\n\n".join(thinking_parts).strip()
    return thinking, content.strip()


class StreamThinkingFilter:
    """Split streaming content deltas into reasoning vs visible text."""

    def __init__(self) -> None:
        self._pending = ""
        self._open: Optional[str] = None

    def feed(self, chunk: str) -> tuple[str, str]:
        if not chunk:
            return "", ""
        self._pending += chunk
        reasoning_out: list[str] = []
        content_out: list[str] = []

        while self._pending:
            if self._open is None:
                earliest = -1
                marker = ""
                for open_tag, _ in _OPEN_CLOSE:
                    idx = self._pending.lower().find(open_tag.lower())
                    if idx != -1 and (earliest == -1 or idx < earliest):
                        earliest = idx
                        marker = open_tag
                if earliest == -1:
                    hold = _partial_suffix_len(self._pending)
                    if hold:
                        content_out.append(self._pending[:-hold])
                        self._pending = self._pending[-hold:]
                    else:
                        content_out.append(self._pending)
                        self._pending = ""
                    break
                content_out.append(self._pending[:earliest])
                self._pending = self._pending[earliest + len(marker) :]
                self._open = marker
            else:
                close = ""
                for open_tag, close_tag in _OPEN_CLOSE:
                    if open_tag == self._open:
                        close = close_tag
                        break
                idx = self._pending.lower().find(close.lower())
                if idx == -1:
                    hold = min(len(self._pending), max(0, len(close) - 1))
                    emit = self._pending[:-hold] if hold else self._pending
                    if emit:
                        reasoning_out.append(emit)
                    self._pending = self._pending[-hold:] if hold else ""
                    break
                reasoning_out.append(self._pending[:idx])
                self._pending = self._pending[idx + len(close) :].lstrip()
                self._open = None

        return "".join(reasoning_out), "".join(content_out)

    def flush(self) -> tuple[str, str]:
        if self._open:
            reasoning = self._pending
            self._pending = ""
            self._open = None
            return reasoning, ""
        content = self._pending
        self._pending = ""
        return "", content


def _partial_suffix_len(text: str) -> int:
    lower = text.lower()
    best = 0
    for marker, _ in _OPEN_CLOSE:
        mlower = marker.lower()
        for i in range(1, len(mlower)):
            if lower.endswith(mlower[:i]):
                best = max(best, i)
    return best
