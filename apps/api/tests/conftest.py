"""Shared fixtures for the Thoma API test suite.

Settings (auth, CORS, rate limit) and middleware are baked into the FastAPI
``app`` object at import time of ``apps.api.main`` (module-level globals), so
each distinct configuration needs its own fresh import rather than mutating a
shared app instance.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, AsyncIterator, Iterator, Optional

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_ENV = {
    "THOMA_MODELS_CONFIG": "config/models-smoke.yaml",
    "THOMA_INFERENCE_BACKEND": "llamacpp",
    "THOMA_ENV": "development",
    "THOMA_DATA_DIR": "data",
    "THOMA_AUTH_ENABLED": "0",
    "THOMA_API_KEY": "",
    "THOMA_CORS_ORIGINS": "",
    "THOMA_RATE_LIMIT_RPM": "0",
    "THOMA_TRUST_PROXY": "0",
}

_ENV_KEYS = set(DEFAULT_ENV) | {"THOMA_PROJECT_ROOT"}


class FakeInferenceBackend:
    """Stand-in for LlamaCppBackend so tests never load a real GGUF model."""

    name = "fake"

    def model_ref(self, profile: Any) -> str:
        return "fake-model"

    async def unload_all(self) -> None:
        return None

    async def warm(self, profile: Any) -> None:
        return None

    async def chat(
        self,
        profile: Any,
        messages: list[dict[str, str]],
        stream: bool = False,
    ) -> dict[str, Any] | AsyncIterator[bytes]:
        return {"message": {"content": "ok", "thinking": ""}}


def _client_for(tmp_path: Path, overrides: Optional[dict[str, str]] = None) -> Iterator[TestClient]:
    """(Re-)import apps.api.main with a fresh env so its module-level Settings
    and app/middleware reflect the given configuration.

    The env override must stay in effect for the whole test, not just during
    import: chat_store reads THOMA_PROJECT_ROOT fresh on every DB call, so
    restoring the env right after import (instead of after the test finishes)
    would make every request silently fall back to the real cwd-based
    data/chats.db.
    """
    env = {**DEFAULT_ENV, **(overrides or {})}
    env["THOMA_PROJECT_ROOT"] = str(tmp_path)

    saved = {k: os.environ.get(k) for k in _ENV_KEYS}
    os.environ.update(env)
    try:
        sys.modules.pop("apps.api.main", None)
        import apps.api.main as main_module

        with TestClient(main_module.app) as client:
            main_module._inference = FakeInferenceBackend()
            yield client
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@pytest.fixture
def api_key() -> str:
    return "test-secret-key"


@pytest.fixture
def client_no_auth(tmp_path: Path) -> Iterator[TestClient]:
    yield from _client_for(tmp_path, {"THOMA_AUTH_ENABLED": "0"})


@pytest.fixture
def client_auth_enabled(tmp_path: Path, api_key: str) -> Iterator[TestClient]:
    yield from _client_for(
        tmp_path, {"THOMA_AUTH_ENABLED": "1", "THOMA_API_KEY": api_key}
    )


@pytest.fixture
def client_rate_limited(tmp_path: Path) -> Iterator[TestClient]:
    yield from _client_for(tmp_path, {"THOMA_RATE_LIMIT_RPM": "2"})
