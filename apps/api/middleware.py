"""Production middleware: auth, request logging, rate limiting."""

from __future__ import annotations

import hmac
import logging
import time
from collections import defaultdict, deque
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from apps.api.settings import Settings

logger = logging.getLogger("thoma.api")

_PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/health/live",
        "/health/ready",
        "/v1/config",
        "/docs",
        "/openapi.json",
        "/redoc",
    }
)


def _extract_api_key(request: Request, expected: str) -> bool:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        if hmac.compare_digest(auth[7:].strip(), expected):
            return True
    return hmac.compare_digest(request.headers.get("x-api-key", "").strip(), expected)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("%s %s failed", request.method, request.url.path)
            raise
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s -> %s (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response


class APIKeyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not self._settings.auth_enabled:
            return await call_next(request)

        path = request.url.path
        if path in _PUBLIC_PATHS or path.startswith("/web/") or path == "/":
            return await call_next(request)

        if path.startswith("/v1/"):
            if not _extract_api_key(request, self._settings.api_key):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Missing or invalid API key"},
                )

        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple per-IP rate limit for chat completions (disabled when rpm=0)."""

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self._rpm = settings.rate_limit_rpm
        self._trust_proxy = settings.trust_proxy
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, request: Request) -> str:
        if self._trust_proxy:
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if self._rpm <= 0 or request.url.path != "/v1/chat/completions":
            return await call_next(request)

        client = self._client_key(request)
        now = time.time()
        window = self._hits[client]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self._rpm:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded — try again shortly"},
            )
        window.append(now)
        return await call_next(request)
