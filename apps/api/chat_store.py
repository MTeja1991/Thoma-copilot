"""SQLite persistence for thoma chat sessions and messages."""

from __future__ import annotations

import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _db_path() -> Path:
    root = Path(os.environ.get("THOMA_PROJECT_ROOT", Path.cwd()))
    rel = os.environ.get("THOMA_DATA_DIR", "data")
    path = root / rel
    path.mkdir(parents=True, exist_ok=True)
    return path / "chats.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def _conn():
    db = sqlite3.connect(_db_path())
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    finally:
        db.close()


def init_db() -> None:
    with _conn() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                profile TEXT NOT NULL,
                workspace_root TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                reasoning TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
            CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
            """
        )
        cols = {row[1] for row in db.execute("PRAGMA table_info(chats)").fetchall()}
        if "workspace_root" not in cols:
            db.execute("ALTER TABLE chats ADD COLUMN workspace_root TEXT")
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats(workspace_root, updated_at DESC)"
        )


def create_chat(
    profile: str,
    title: str = "New chat",
    workspace_root: Optional[str] = None,
) -> dict[str, Any]:
    chat_id = str(uuid.uuid4())
    ts = _now()
    with _conn() as db:
        db.execute(
            """
            INSERT INTO chats (id, title, profile, workspace_root, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (chat_id, title, profile, workspace_root, ts, ts),
        )
    return get_chat(chat_id)


def list_chats(limit: int = 50, workspace_root: Optional[str] = None) -> list[dict[str, Any]]:
    with _conn() as db:
        if workspace_root:
            rows = db.execute(
                """
                SELECT c.*, COUNT(m.id) AS message_count
                FROM chats c
                LEFT JOIN messages m ON m.chat_id = c.id
                WHERE c.workspace_root = ?
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT ?
                """,
                (workspace_root, limit),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT c.*, COUNT(m.id) AS message_count
                FROM chats c
                LEFT JOIN messages m ON m.chat_id = c.id
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    return [_chat_row(r) for r in rows]


def get_chat(chat_id: str) -> dict[str, Any]:
    with _conn() as db:
        row = db.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not row:
            raise KeyError(chat_id)
        messages = db.execute(
            "SELECT role, content, reasoning, created_at FROM messages WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()
    chat = _chat_row(row)
    chat["messages"] = [
        {
            "role": m["role"],
            "content": m["content"],
            "reasoning_content": m["reasoning"],
            "created_at": m["created_at"],
        }
        for m in messages
    ]
    return chat


def delete_chat(chat_id: str) -> None:
    with _conn() as db:
        cur = db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        if cur.rowcount == 0:
            raise KeyError(chat_id)
        db.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))


def add_message(
    chat_id: str,
    role: str,
    content: str,
    reasoning: Optional[str] = None,
) -> None:
    ts = _now()
    with _conn() as db:
        if not db.execute("SELECT 1 FROM chats WHERE id = ?", (chat_id,)).fetchone():
            raise KeyError(chat_id)
        db.execute(
            "INSERT INTO messages (chat_id, role, content, reasoning, created_at) VALUES (?, ?, ?, ?, ?)",
            (chat_id, role, content, reasoning, ts),
        )
        db.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (ts, chat_id))


def set_chat_title(chat_id: str, title: str) -> None:
    with _conn() as db:
        cur = db.execute(
            "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
            (title[:120], _now(), chat_id),
        )
        if cur.rowcount == 0:
            raise KeyError(chat_id)


def get_messages_for_inference(chat_id: str) -> list[dict[str, str]]:
    with _conn() as db:
        rows = db.execute(
            "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in rows]


def trim_messages(
    messages: list[dict[str, str]],
    max_tokens: int,
) -> list[dict[str, str]]:
    """Keep system message and recent turns within rough token budget."""
    if not messages:
        return messages

    system: list[dict[str, str]] = []
    rest = messages
    if messages[0]["role"] == "system":
        system = [messages[0]]
        rest = messages[1:]

    def est_tokens(msgs: list[dict[str, str]]) -> int:
        return sum(max(1, len(m["content"]) // 4) for m in msgs)

    kept: list[dict[str, str]] = []
    for msg in reversed(rest):
        candidate = [*kept, msg]
        if est_tokens(system + list(reversed(candidate))) > max_tokens:
            break
        kept.append(msg)
    kept.reverse()
    return system + kept


def title_from_message(text: str) -> str:
    line = text.strip().split("\n", 1)[0]
    return (line[:60] + "…") if len(line) > 60 else line or "New chat"


def _chat_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "profile": row["profile"],
        "workspace_root": row["workspace_root"] if "workspace_root" in row.keys() else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "message_count": row["message_count"] if "message_count" in row.keys() else None,
    }
