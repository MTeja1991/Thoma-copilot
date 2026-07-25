"""Thoma API — OpenAI-compatible gateway with profile-based model routing."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import traceback
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from apps.api import chat_store
from apps.api.agent import get_agent_name, system_prompt
from apps.api.backends.base import InferenceBackend
from apps.api.backends.factory import create_inference_backend
from apps.api.middleware import APIKeyMiddleware, RateLimitMiddleware, RequestLoggingMiddleware
from apps.api.routes_chats import router as chats_router
from apps.api.settings import Settings, load_settings
from apps.api.streaming import sse_done
from apps.api.thinking import extract_thinking
from apps.api.models import (
    HardwareInfo,
    ModelProfile,
    get_default_profile_id,
    get_hardware_info,
    load_profiles,
    resolve_model_path,
    resolve_profile,
)

THOMA_BACKEND = os.environ.get("THOMA_BACKEND", "auto")
THOMA_INFERENCE = os.environ.get("THOMA_INFERENCE_BACKEND", "llamacpp")
DEFAULT_PROFILE = os.environ.get("THOMA_DEFAULT_PROFILE", get_default_profile_id())
SETTINGS: Settings = load_settings()

_profiles: dict[str, ModelProfile] = {}
_hardware: Optional[HardwareInfo] = None
_inference: Optional[InferenceBackend] = None
_active_profile: str = DEFAULT_PROFILE

_WEB_ROOT = os.path.join(os.path.dirname(__file__), "web")
logger = logging.getLogger("thoma.api")


def _configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, SETTINGS.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def _unload_note() -> str:
    if _hardware and _hardware.backend == "mps":
        return "Previous model unloaded to free unified memory"
    return "Previous model unloaded to free GPU memory"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _profiles, _hardware, _inference, _active_profile
    _configure_logging()
    _profiles = load_profiles()
    _hardware = get_hardware_info()
    _inference = create_inference_backend()
    if DEFAULT_PROFILE not in _profiles:
        raise RuntimeError(f"Default profile not in config: {DEFAULT_PROFILE}")
    _active_profile = DEFAULT_PROFILE
    chat_store.init_db()
    logger.info(
        "Thoma API started env=%s inference=%s profiles=%d auth=%s",
        SETTINGS.env,
        _inference.name,
        len(_profiles),
        SETTINGS.auth_enabled,
    )
    yield
    if _inference:
        await _inference.unload_all()
    logger.info("Thoma API shutdown complete")


app = FastAPI(
    title=f"{get_agent_name()} API",
    description="Self-hosted coding assistant — local GGUF or Ollama",
    version="0.5.0",
    lifespan=lifespan,
    docs_url="/docs" if not SETTINGS.is_production else None,
    redoc_url="/redoc" if not SETTINGS.is_production else None,
)

if SETTINGS.cors_origins:
    _cors_wildcard = "*" in SETTINGS.cors_origins
    if _cors_wildcard:
        logger.warning(
            "THOMA_CORS_ORIGINS=* — disabling credentialed CORS to avoid reflecting "
            "any origin with cookies/auth headers allowed. Set explicit origins to "
            "allow credentialed cross-origin requests."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=SETTINGS.cors_origins,
        allow_credentials=not _cors_wildcard,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-API-Key"],
    )

app.add_middleware(RateLimitMiddleware, settings=SETTINGS)
app.add_middleware(APIKeyMiddleware, settings=SETTINGS)
app.add_middleware(RequestLoggingMiddleware)
app.include_router(chats_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.error("Unhandled error: %s", exc, exc_info=True)
    if SETTINGS.is_production:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()},
    )


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = Field(default=None, description="Thoma profile id")
    messages: list[ChatMessage]
    stream: bool = False
    enable_thinking: Optional[bool] = None
    chat_id: Optional[str] = Field(
        default=None,
        description="Persist turns to this session; send only the new user message in messages",
    )
    workspace_planning: bool = Field(
        default=False,
        description="Use IDE workspace-aware planning system prompt",
    )


def _health_payload() -> dict[str, Any]:
    hw = _hardware or get_hardware_info()
    backend = THOMA_BACKEND if THOMA_BACKEND != "auto" else hw.backend
    assert _inference is not None
    return {
        "status": "ok",
        "service": "thoma-api",
        "version": app.version,
        "env": SETTINGS.env,
        "backend": backend,
        "inference": _inference.name,
        "accelerator": hw.accelerator,
        "platform": hw.platform,
        "memory_gb": hw.memory_gb,
        "active_profile": _active_profile,
        "models_config": os.environ.get("THOMA_MODELS_CONFIG", ""),
        "auth_enabled": SETTINGS.auth_enabled,
    }


def _readiness_checks() -> tuple[bool, dict[str, str]]:
    checks: dict[str, str] = {}
    ok = True

    try:
        chat_store.ping_db()
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"fail: {exc}"
        ok = False

    if _inference is None:
        checks["inference"] = "fail: not initialized"
        ok = False
    else:
        checks["inference"] = "ok"

    profile = _profiles.get(_active_profile)
    if profile and profile.model_file and not profile.is_remote:
        try:
            path = resolve_model_path(profile)
            if path.is_file():
                checks["model_file"] = "ok"
            else:
                checks["model_file"] = f"missing: {profile.model_file}"
                ok = False
        except Exception as exc:
            checks["model_file"] = f"fail: {exc}"
            ok = False
    elif profile and profile.is_remote:
        if not os.environ.get("OPENAI_API_KEY"):
            checks["remote_api_key"] = "warn: OPENAI_API_KEY not set"
        else:
            checks["remote_api_key"] = "ok"

    return ok, checks


@app.get("/", response_class=HTMLResponse)
async def web_chat() -> FileResponse:
    """Browser chat UI — use Thoma without VS Code."""
    return FileResponse(
        os.path.join(_WEB_ROOT, "chat.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


app.mount("/web", StaticFiles(directory=_WEB_ROOT), name="web_static")


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> JSONResponse:
    ok, checks = await asyncio.to_thread(_readiness_checks)
    body = {"status": "ok" if ok else "degraded", "checks": checks}
    return JSONResponse(status_code=200 if ok else 503, content=body)


@app.get("/health")
async def health() -> dict[str, Any]:
    payload = _health_payload()
    _, checks = _readiness_checks()
    payload["checks"] = checks
    return payload


@app.get("/v1/config")
async def public_config() -> dict[str, Any]:
    return {
        "auth_required": SETTINGS.auth_enabled,
        "version": app.version,
        "env": SETTINGS.env,
    }


@app.get("/v1/models")
async def list_models() -> dict[str, Any]:
    hw = _hardware or get_hardware_info()
    assert _inference is not None
    data = [
        {
            "id": pid,
            "object": "model",
            "owned_by": "thoma",
            "model": p.display_model,
            "ollama_model": p.ollama_model or None,
            "model_file": p.model_file or None,
            "api_model": p.api_model or None,
            "provider": p.provider or None,
            "remote": p.is_remote,
            "thinking": p.thinking,
            "context_length": p.context_length,
            "memory_estimate_gb": p.memory_estimate_gb,
            "stretch": p.stretch,
            "active": pid == _active_profile,
        }
        for pid, p in _profiles.items()
    ]
    return {
        "object": "list",
        "backend": hw.backend,
        "inference": _inference.name,
        "accelerator": hw.accelerator,
        "data": data,
    }


@app.post("/v1/profiles/{profile_id}/switch")
async def switch_profile(profile_id: str) -> dict[str, Any]:
    global _active_profile
    if profile_id not in _profiles:
        raise HTTPException(status_code=404, detail=f"Unknown profile: {profile_id}")

    profile = _profiles[profile_id]
    assert _inference is not None

    await _inference.unload_all()
    await _inference.warm(profile)
    _active_profile = profile_id

    return {
        "status": "switched",
        "profile": profile_id,
        "model": _inference.model_ref(profile),
        "context_length": profile.context_length,
        "note": _unload_note(),
    }


async def _persist_stream_chat(
    req: ChatCompletionRequest,
    profile: ModelProfile,
    messages: list[dict[str, str]],
    stored_msgs: list[dict[str, str]],
    new_user_text: Optional[str],
) -> AsyncIterator[bytes]:
    assert _inference is not None
    raw = await _inference.chat(profile, messages, stream=True)
    assert hasattr(raw, "__aiter__")

    content_parts: list[str] = []
    reasoning_parts: list[str] = []

    async for chunk in raw:  # type: ignore[union-attr]
        skip = False
        if chunk.startswith(b"data: "):
            payload = chunk[6:].decode().strip()
            if payload == "[DONE]":
                skip = True
            elif payload:
                try:
                    data = json.loads(payload)
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        content_parts.append(delta["content"])
                    if delta.get("reasoning_content"):
                        reasoning_parts.append(delta["reasoning_content"])
                except json.JSONDecodeError:
                    pass
        if not skip:
            yield chunk

    content = "".join(content_parts)
    thinking = "".join(reasoning_parts)
    extra_thinking, content = extract_thinking(content)
    if extra_thinking:
        thinking = f"{thinking}\n\n{extra_thinking}".strip() if thinking else extra_thinking

    if req.chat_id and new_user_text:
        if not stored_msgs:
            await asyncio.to_thread(
                chat_store.set_chat_title,
                req.chat_id,
                chat_store.title_from_message(new_user_text),
            )
        await asyncio.to_thread(chat_store.add_message, req.chat_id, "user", new_user_text)
        await asyncio.to_thread(
            chat_store.add_message, req.chat_id, "assistant", content, thinking or None
        )

    yield sse_done()


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    global _active_profile
    assert _inference is not None

    model_key = req.model or _active_profile
    try:
        profile = resolve_profile(model_key, _profiles)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if profile.id != _active_profile:
        await _inference.unload_all()
        await _inference.warm(profile)
        _active_profile = profile.id

    client_msgs = [{"role": m.role, "content": m.content} for m in req.messages]
    stored_msgs: list[dict[str, str]] = []
    new_user_text: Optional[str] = None

    if req.chat_id:
        try:
            await asyncio.to_thread(chat_store.get_chat, req.chat_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Chat not found") from exc
        stored_msgs = await asyncio.to_thread(chat_store.get_messages_for_inference, req.chat_id)
        if len(client_msgs) == 1 and client_msgs[0]["role"] == "user":
            new_user_text = client_msgs[0]["content"]
            messages = stored_msgs + client_msgs
        elif len(client_msgs) > len(stored_msgs):
            new_user_text = next(
                (m["content"] for m in reversed(client_msgs) if m["role"] == "user"),
                None,
            )
            messages = client_msgs
        else:
            messages = stored_msgs + client_msgs
            if client_msgs:
                new_user_text = client_msgs[-1]["content"] if client_msgs[-1]["role"] == "user" else None
    else:
        messages = client_msgs

    if not any(m["role"] == "system" for m in messages):
        messages = [system_prompt(workspace_planning=req.workspace_planning), *messages]

    reserve = int(profile.context_length * 0.85) if profile.context_length else 12000
    messages = chat_store.trim_messages(messages, reserve)

    if req.stream:
        stream = _persist_stream_chat(
            req, profile, messages, stored_msgs, new_user_text
        )
        return StreamingResponse(stream, media_type="text/event-stream")

    result = await _inference.chat(profile, messages, stream=False)

    if _inference.name == "ollama":
        assert isinstance(result, dict)
        message = result.get("message", {})
        content = message.get("content", "")
        thinking = message.get("thinking", "")
    else:
        assert isinstance(result, dict)
        message = result.get("message", {})
        content = message.get("content", "")
        thinking = message.get("thinking", "")

    if req.chat_id and new_user_text:
        if not stored_msgs:
            await asyncio.to_thread(
                chat_store.set_chat_title,
                req.chat_id,
                chat_store.title_from_message(new_user_text),
            )
        await asyncio.to_thread(chat_store.add_message, req.chat_id, "user", new_user_text)
        await asyncio.to_thread(
            chat_store.add_message, req.chat_id, "assistant", content, thinking or None
        )

    return JSONResponse(
        {
            "id": req.chat_id or "thoma-chat",
            "object": "chat.completion",
            "model": profile.id,
            "chat_id": req.chat_id,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content,
                        "reasoning_content": thinking if thinking else None,
                    },
                    "finish_reason": "stop",
                }
            ],
        }
    )
