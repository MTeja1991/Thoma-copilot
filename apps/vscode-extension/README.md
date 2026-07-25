# Thoma VS Code / Cursor Extension

Cursor-style **right-side chat** connected to the local Thoma API — workspace context, file attachments, streaming, and file writes with review.

## Prerequisites

1. **Thoma API** on `http://localhost:8080` (see the repo root README.md)
2. **Node.js 18+**

## Install in Cursor (recommended)

```bash
# From repo root — builds VSIX and installs into Cursor
./scripts/install-cursor-extension.sh
```

Then **reload**: `Cmd+Shift+P` → **Developer: Reload Window**

Thoma appears in the **right sidebar** (secondary panel). Use **Cmd+L** to focus chat.

### Manual VSIX

```bash
cd apps/vscode-extension
npm install && npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

`Cmd+Shift+P` → **Extensions: Install from VSIX...** → `thoma-0.3.3.vsix`

## Features

| Feature | How |
|---------|-----|
| **Chat panel** | Right sidebar — opens on workspace load |
| **Workspace context** | *Workspace* checkbox — file tree + README on first message |
| **@ File / @ Folder** | Composer buttons or Explorer → *Add to thoma* |
| **Chat history** | Per workspace folder (not global) |
| **Streaming** | Live tokens; thinking = spinner, click to expand |
| **Stop** | **■ Stop** during generation |
| **File writes** | Model uses ` ```lang path/to/file ` — **Keep** / **Undo** or auto-apply |
| **Markdown** | Assistant replies rendered as markdown |
| **Explain selection** | Right-click → *thoma: Explain Selection* |
| **Fix selection** | Right-click → *thoma: Fix Selection* |
| **Plan** | *Plan* button — workspace planning prompt |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `thoma.apiUrl` | `http://localhost:8080` | API base URL |
| `thoma.defaultProfile` | `thoma-reason` | Default model profile |
| `thoma.openOnStartup` | `true` | Open right panel on load |
| `thoma.includeWorkspaceByDefault` | `true` | Attach workspace tree |
| `thoma.autoApplyFileEdits` | `true` | Auto-write proposed files |
| `thoma.maxFileContextLines` | `400` | Max lines per attached file |
| `thoma.workspaceMaxFiles` | `600` | Max files in workspace tree |

## File proposals

Ask thoma to create or edit files. The model should use:

````markdown
```python src/example.py
# full file content
```
````

You'll see **Proposed changes** with **Review**, **Keep**, and **Undo**. With `thoma.autoApplyFileEdits` (default), files are written automatically.

## Troubleshooting

**Cannot reach Thoma API** — Start `uvicorn apps.api.main:app --host 127.0.0.1 --port 8080`; check `curl http://localhost:8080/health`.

**Slow first message** — Model loads on first request; subsequent messages are faster.

**Model said "file created" but nothing on disk** — Reload extension; ensure code blocks include the path on the fence line. Click **Keep** if auto-apply is off.

**ThomaStreamThinking is not defined** — Fixed in v0.3.3+; reload after `./scripts/install-cursor-extension.sh`.

**Wrong chat history** — Chats are per workspace folder; switch projects to see that project's history.

## Development

```bash
cd apps/vscode-extension
npm install
npm run compile
# Open apps/vscode-extension in VS Code → F5
```
