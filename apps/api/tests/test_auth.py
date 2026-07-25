"""Auth middleware: public paths stay open, protected paths require a valid key."""

from __future__ import annotations

PUBLIC_PATHS = ["/", "/health", "/health/live", "/health/ready", "/v1/config"]


def test_public_paths_reachable_without_key(client_auth_enabled) -> None:
    for path in PUBLIC_PATHS:
        resp = client_auth_enabled.get(path)
        assert resp.status_code != 401, f"{path} should not require auth"


def test_protected_path_rejects_missing_key(client_auth_enabled) -> None:
    resp = client_auth_enabled.get("/v1/models")
    assert resp.status_code == 401


def test_protected_path_rejects_wrong_key(client_auth_enabled) -> None:
    resp = client_auth_enabled.get("/v1/models", headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 401


def test_protected_path_accepts_bearer_token(client_auth_enabled, api_key) -> None:
    resp = client_auth_enabled.get(
        "/v1/models", headers={"Authorization": f"Bearer {api_key}"}
    )
    assert resp.status_code == 200


def test_protected_path_accepts_x_api_key_header(client_auth_enabled, api_key) -> None:
    resp = client_auth_enabled.get("/v1/models", headers={"X-API-Key": api_key})
    assert resp.status_code == 200


def test_auth_disabled_allows_protected_path(client_no_auth) -> None:
    resp = client_no_auth.get("/v1/models")
    assert resp.status_code == 200
