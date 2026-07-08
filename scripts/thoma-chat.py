#!/usr/bin/env python3
"""Terminal chat with Thoma — no VS Code required."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8080"
PROFILE = "thoma-fast"


def api_post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def api_get(path: str) -> dict:
    with urllib.request.urlopen(f"{API}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def main() -> int:
    global PROFILE
    try:
        health = api_get("/health")
    except urllib.error.URLError:
        print("thoma API is not running.")
        print("Start it: ./docker/scripts/start-smoke.sh")
        return 1

    print(f"thoma — {health.get('inference')} / {health.get('active_profile')}")
    print("Type 'exit' or Ctrl+C to quit.\n")

    history: list[dict[str, str]] = []
    while True:
        try:
            user = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            return 0
        if not user:
            continue
        if user.lower() in ("exit", "quit"):
            return 0

        history.append({"role": "user", "content": user})
        print("thoma: (thinking…)", flush=True)
        try:
            data = api_post(
                "/v1/chat/completions",
                {"model": PROFILE, "messages": history},
            )
            msg = data["choices"][0]["message"]
            content = msg.get("content", "")
            thinking = msg.get("reasoning_content")
            if thinking:
                print(f"\n[thinking]\n{thinking[:500]}{'…' if len(thinking) > 500 else ''}\n")
            print(f"thoma: {content}\n")
            history.append({"role": "assistant", "content": content})
        except Exception as exc:
            print(f"Error: {exc}\n")
            history.pop()


if __name__ == "__main__":
    raise SystemExit(main())
