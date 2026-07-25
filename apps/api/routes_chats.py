"""Chat session API routes."""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from apps.api import chat_store

router = APIRouter(prefix="/v1/chats", tags=["chats"])


class CreateChatRequest(BaseModel):
    profile: str = "thoma-reason"
    title: str = "New chat"
    workspace_root: Optional[str] = Field(
        default=None,
        description="Absolute workspace folder path this chat belongs to",
    )


class RenameChatRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1)
    model: Optional[str] = None


@router.post("")
async def create_chat(req: CreateChatRequest) -> dict[str, Any]:
    return await asyncio.to_thread(
        chat_store.create_chat,
        profile=req.profile,
        title=req.title,
        workspace_root=req.workspace_root,
    )


@router.get("")
async def list_chats(
    limit: int = 50,
    workspace_root: Optional[str] = None,
) -> dict[str, Any]:
    data = await asyncio.to_thread(
        chat_store.list_chats, limit=limit, workspace_root=workspace_root
    )
    return {"object": "list", "data": data}


@router.get("/{chat_id}")
async def get_chat(chat_id: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(chat_store.get_chat, chat_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@router.patch("/{chat_id}")
async def rename_chat(chat_id: str, req: RenameChatRequest) -> dict[str, str]:
    try:
        await asyncio.to_thread(chat_store.set_chat_title, chat_id, req.title)
        return {"id": chat_id, "title": req.title}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str) -> dict[str, str]:
    try:
        await asyncio.to_thread(chat_store.delete_chat, chat_id)
        return {"status": "deleted", "id": chat_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
