"""Per-client rate limiting on /v1/chat/completions."""

from __future__ import annotations

CHAT_PAYLOAD = {"messages": [{"role": "user", "content": "hi"}], "stream": False}


def test_requests_within_limit_succeed(client_rate_limited) -> None:
    # client_rate_limited allows 2 requests/min
    for _ in range(2):
        resp = client_rate_limited.post("/v1/chat/completions", json=CHAT_PAYLOAD)
        assert resp.status_code == 200


def test_requests_exceeding_limit_get_429(client_rate_limited) -> None:
    for _ in range(2):
        resp = client_rate_limited.post("/v1/chat/completions", json=CHAT_PAYLOAD)
        assert resp.status_code == 200

    resp = client_rate_limited.post("/v1/chat/completions", json=CHAT_PAYLOAD)
    assert resp.status_code == 429


def test_rate_limit_disabled_allows_many_requests(client_no_auth) -> None:
    # client_no_auth uses THOMA_RATE_LIMIT_RPM=0 (disabled) from DEFAULT_ENV
    for _ in range(5):
        resp = client_no_auth.post("/v1/chat/completions", json=CHAT_PAYLOAD)
        assert resp.status_code == 200
