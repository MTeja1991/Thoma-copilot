#!/usr/bin/env python3
"""Thoma MCP server — expose the local Thoma API to Cursor agents."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP

API_URL = os.environ.get("THOMA_API_URL", "http://127.0.0.1:8080").rstrip("/")
API_KEY = os.environ.get("THOMA_API_KEY", "").strip()
ALLOW_WRITE = os.environ.get("THOMA_MCP_ALLOW_WRITE", "1") == "1"
WORKSPACE_ROOT = Path(
    os.environ.get("THOMA_WORKSPACE_ROOT", os.environ.get("THOMA_PROJECT_ROOT", Path.cwd()))
).resolve()

mcp = FastMCP(
    "Thoma",
    instructions=(
        "Thoma is a self-hosted coding assistant. Use these tools to chat with the local "
        "Thoma API, manage workspace-scoped chats, and read/write project files. "
        "Start the API with: uvicorn apps.api.main:app --host 127.0.0.1 --port 8080"
    ),
)

DEFAULT_EXCLUDE = {
    "node_modules",
    ".git",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    "out",
    "models/gguf",
}

MAX_WRITE_BYTES = 2 * 1024 * 1024


def _resolve_path(rel_path: str) -> Path:
    target = (WORKSPACE_ROOT / rel_path).resolve()
    if target != WORKSPACE_ROOT and WORKSPACE_ROOT not in target.parents:
        raise ValueError(f"Path escapes workspace: {rel_path}")
    return target


async def _api_client() -> httpx.AsyncClient:
    headers: dict[str, str] = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return httpx.AsyncClient(
        base_url=API_URL,
        timeout=httpx.Timeout(300.0, connect=10.0),
        headers=headers,
    )


@mcp.tool()
async def thoma_health() -> str:
    """Check Thoma API status, backend, and active model profile."""
    async with await _api_client() as client:
        response = await client.get("/health")
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)


@mcp.tool()
async def thoma_list_models() -> str:
    """List available Thoma model profiles."""
    async with await _api_client() as client:
        response = await client.get("/v1/models")
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)


@mcp.tool()
async def thoma_chat(
    message: str,
    profile: Optional[str] = None,
    chat_id: Optional[str] = None,
    workspace_planning: bool = False,
) -> str:
    """Send a message to Thoma and return the assistant reply (non-streaming)."""
    payload: dict = {
        "messages": [{"role": "user", "content": message}],
        "stream": False,
        "workspace_planning": workspace_planning,
    }
    if profile:
        payload["model"] = profile
    if chat_id:
        payload["chat_id"] = chat_id

    async with await _api_client() as client:
        response = await client.post("/v1/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        msg = data.get("choices", [{}])[0].get("message", {})
        parts = [msg.get("content", "")]
        reasoning = msg.get("reasoning_content")
        if reasoning:
            parts.append(f"\n\n---\nThinking:\n{reasoning}")
        if data.get("chat_id"):
            parts.append(f"\n\n(chat_id: {data['chat_id']})")
        return "".join(parts)


@mcp.tool()
async def thoma_list_chats(workspace_root: Optional[str] = None, limit: int = 20) -> str:
    """List saved Thoma chats, optionally filtered by workspace folder path."""
    root = workspace_root or str(WORKSPACE_ROOT)
    params = {"limit": limit, "workspace_root": root}
    async with await _api_client() as client:
        response = await client.get("/v1/chats", params=params)
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)


@mcp.tool()
async def thoma_create_chat(
    title: str = "MCP chat",
    profile: str = "thoma-reason",
    workspace_root: Optional[str] = None,
) -> str:
    """Create a new workspace-scoped Thoma chat session."""
    payload = {
        "title": title,
        "profile": profile,
        "workspace_root": workspace_root or str(WORKSPACE_ROOT),
    }
    async with await _api_client() as client:
        response = await client.post("/v1/chats", json=payload)
        response.raise_for_status()
        return json.dumps(response.json(), indent=2)


@mcp.tool()
async def thoma_read_file(path: str, max_lines: int = 400) -> str:
    """Read a text file relative to the workspace root."""
    target = _resolve_path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Not a file: {path}")
    text = target.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    if len(lines) > max_lines:
        head = "\n".join(lines[:max_lines])
        return f"{head}\n... ({len(lines) - max_lines} more lines)"
    return text


@mcp.tool()
async def thoma_write_file(path: str, content: str) -> str:
    """Write a text file relative to the workspace root (creates parent folders)."""
    if not ALLOW_WRITE:
        raise PermissionError(
            "MCP file writes are disabled. Set THOMA_MCP_ALLOW_WRITE=1 to enable."
        )
    if "\x00" in content:
        raise ValueError(f"Refusing to write binary content to {path}")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_WRITE_BYTES:
        raise ValueError(
            f"Refusing to write {path} — {len(encoded)} bytes exceeds the "
            f"{MAX_WRITE_BYTES} byte limit"
        )
    target = _resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"Wrote {path} ({len(encoded)} bytes)"


@mcp.tool()
async def thoma_workspace_tree(max_files: int = 200) -> str:
    """Return a file tree of the workspace root for context."""
    lines: list[str] = [f"{WORKSPACE_ROOT.name}/"]
    count = 0
    for root, dirs, files in os.walk(WORKSPACE_ROOT):
        dirs[:] = sorted(
            d for d in dirs if d not in DEFAULT_EXCLUDE and not d.startswith(".")
        )
        rel_root = Path(root).relative_to(WORKSPACE_ROOT)
        depth = 0 if str(rel_root) == "." else len(rel_root.parts)
        for name in sorted(files):
            if count >= max_files:
                lines.append("... (truncated)")
                return "\n".join(lines)
            if any(part in DEFAULT_EXCLUDE for part in Path(name).parts):
                continue
            prefix = "  " * (depth + 1)
            lines.append(f"{prefix}{name}")
            count += 1
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
