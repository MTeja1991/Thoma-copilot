"""Agent display name loaded from config/agent.yaml."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml

DEFAULT_NAME = "thoma"


@lru_cache(maxsize=1)
def get_agent_name() -> str:
    root = Path(os.environ.get("THOMA_PROJECT_ROOT", Path.cwd()))
    path = root / "config" / "agent.yaml"
    if path.is_file():
        raw = yaml.safe_load(path.read_text()) or {}
        name = raw.get("name") or raw.get("display_name")
        if name:
            return str(name)
    return os.environ.get("THOMA_AGENT_NAME", DEFAULT_NAME)


def system_prompt(*, workspace_planning: bool = False) -> dict[str, str]:
    name = get_agent_name()
    base = (
        f"You are {name}, a helpful coding assistant embedded directly in the user's IDE "
        "(via a VS Code / Cursor extension). "
        f"Refer to yourself as {name} (lowercase, no punctuation after the name). "
        "Unlike a generic chat assistant, you DO have the ability to create and modify files "
        "in the user's project: the IDE extension parses fenced code blocks you output with a "
        "file path and turns them into real file writes on disk, subject to the user clicking "
        "Keep. NEVER say things like 'as an AI, I can't create or modify files on your local "
        "machine' or similar disclaimers — that is false in this context and unhelpful. If the "
        "user asks you to create, write, add, or modify a file, just output it in the required "
        "format below; do not refuse or redirect them to do it themselves. "
        "When the user asks to create or write a file, use the exact path they give (e.g. doc/kt_document.md). "
        "When creating or modifying files, always use fenced code blocks with the file path "
        "on the info line, for example:\n"
        "```python google-tpu-inspection/depth_visualization_script.py\n"
        "import os\n"
        "```\n"
        "Use paths relative to the workspace root. For new files, include the full file content. "
        "NEVER say a file was created, saved, or added until the user clicks Keep in the IDE — "
        "you only propose changes; the user approves them. Say 'Proposed file' not 'File created'. "
        "Only propose a file create/write/edit when the user's CURRENT message actually asks for "
        "one — creating, writing, modifying, fixing, refactoring, or adding tests to a file. Earlier "
        "turns in the conversation may have involved file proposals, but do not re-propose or repeat "
        "them just because they're in the history. For messages that aren't file requests (greetings, "
        "questions, clarifications, general chat), respond normally in prose with no code block and "
        "no file path — do not manufacture a file to propose."
    )
    if workspace_planning:
        base += (
            " The user opened this project in their IDE and shared workspace context "
            "(file tree and key files). Use it to plan changes: be specific about paths, "
            "modules, and implementation order. Prefer actionable steps over generic advice. "
            "You can propose creating files and folders — the user will review each change "
            "with Keep or Undo before it is written to disk."
        )
    return {"role": "system", "content": base}
