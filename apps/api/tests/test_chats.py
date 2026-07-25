"""Chat session CRUD round-trip through /v1/chats."""

from __future__ import annotations


def test_create_list_get_rename_delete_chat(client_no_auth) -> None:
    create_resp = client_no_auth.post(
        "/v1/chats", json={"title": "First chat", "profile": "thoma-fast"}
    )
    assert create_resp.status_code == 200
    chat = create_resp.json()
    chat_id = chat["id"]
    assert chat["title"] == "First chat"

    list_resp = client_no_auth.get("/v1/chats")
    assert list_resp.status_code == 200
    ids = [c["id"] for c in list_resp.json()["data"]]
    assert chat_id in ids

    get_resp = client_no_auth.get(f"/v1/chats/{chat_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["messages"] == []

    rename_resp = client_no_auth.patch(f"/v1/chats/{chat_id}", json={"title": "Renamed"})
    assert rename_resp.status_code == 200
    assert client_no_auth.get(f"/v1/chats/{chat_id}").json()["title"] == "Renamed"

    delete_resp = client_no_auth.delete(f"/v1/chats/{chat_id}")
    assert delete_resp.status_code == 200

    missing_resp = client_no_auth.get(f"/v1/chats/{chat_id}")
    assert missing_resp.status_code == 404


def test_get_nonexistent_chat_returns_404(client_no_auth) -> None:
    resp = client_no_auth.get("/v1/chats/does-not-exist")
    assert resp.status_code == 404


def test_rename_nonexistent_chat_returns_404(client_no_auth) -> None:
    resp = client_no_auth.patch("/v1/chats/does-not-exist", json={"title": "x"})
    assert resp.status_code == 404


def test_delete_nonexistent_chat_returns_404(client_no_auth) -> None:
    resp = client_no_auth.delete("/v1/chats/does-not-exist")
    assert resp.status_code == 404


def test_list_chats_filters_by_workspace_root(client_no_auth) -> None:
    client_no_auth.post(
        "/v1/chats",
        json={"title": "A", "profile": "thoma-fast", "workspace_root": "/ws/a"},
    )
    client_no_auth.post(
        "/v1/chats",
        json={"title": "B", "profile": "thoma-fast", "workspace_root": "/ws/b"},
    )
    resp = client_no_auth.get("/v1/chats", params={"workspace_root": "/ws/a"})
    assert resp.status_code == 200
    titles = [c["title"] for c in resp.json()["data"]]
    assert titles == ["A"]
