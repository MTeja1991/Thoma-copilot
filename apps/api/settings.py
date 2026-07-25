"""Runtime settings loaded from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    api_key: str
    auth_enabled_flag: bool
    cors_origins: list[str]
    log_level: str
    rate_limit_rpm: int
    bind_host: str
    bind_port: int
    workers: int
    reload: bool
    max_body_bytes: int
    trust_proxy: bool
    env: str

    @property
    def auth_enabled(self) -> bool:
        # Pre-prod: auth off by default. Enable with THOMA_AUTH_ENABLED=1 + THOMA_API_KEY.
        # Production will move to JWT — API key middleware is interim only.
        return self.auth_enabled_flag and bool(self.api_key)

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def load_settings() -> Settings:
    cors_raw = os.environ.get("THOMA_CORS_ORIGINS", "")
    auth_flag = os.environ.get("THOMA_AUTH_ENABLED", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    return Settings(
        api_key=os.environ.get("THOMA_API_KEY", "").strip(),
        auth_enabled_flag=auth_flag,
        cors_origins=[origin.strip() for origin in cors_raw.split(",") if origin.strip()],
        log_level=os.environ.get("THOMA_LOG_LEVEL", "INFO").upper(),
        rate_limit_rpm=int(os.environ.get("THOMA_RATE_LIMIT_RPM", "0")),
        bind_host=os.environ.get("THOMA_API_HOST", "127.0.0.1"),
        bind_port=int(os.environ.get("THOMA_API_PORT", "8080")),
        workers=max(1, int(os.environ.get("THOMA_WORKERS", "1"))),
        reload=os.environ.get("THOMA_RELOAD", "0") == "1",
        max_body_bytes=int(os.environ.get("THOMA_MAX_BODY_BYTES", str(2 * 1024 * 1024))),
        trust_proxy=os.environ.get("THOMA_TRUST_PROXY", "0") == "1",
        env=os.environ.get("THOMA_ENV", "development").lower(),
    )
