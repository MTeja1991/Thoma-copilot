import * as vscode from "vscode";

export interface WorkspaceContextOptions {
  maxFiles?: number;
  maxChars?: number;
  keyFileMaxLines?: number;
}

export interface WorkspaceSnapshot {
  rootName: string;
  rootPath: string;
  fileCount: number;
  tree: string;
  keyFiles: string;
  charCount: number;
}

const DEFAULT_EXCLUDE =
  "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.tox/**,**/coverage/**,**/*.gguf,**/models/gguf/**,**/.next/**,**/out/**}";

const KEY_FILE_NAMES = new Set([
  "readme.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "makefile",
  "tsconfig.json",
  "architecture.md",
]);

interface TreeNode {
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function getConfig(): Required<WorkspaceContextOptions> {
  const cfg = vscode.workspace.getConfiguration("thoma");
  return {
    maxFiles: cfg.get<number>("workspaceMaxFiles") ?? 600,
    maxChars: cfg.get<number>("workspaceMaxContextChars") ?? 28000,
    keyFileMaxLines: cfg.get<number>("workspaceKeyFileMaxLines") ?? 180,
  };
}

function isKeyFile(relPath: string): boolean {
  const base = relPath.split("/").pop()?.toLowerCase() ?? "";
  if (KEY_FILE_NAMES.has(base)) {
    return true;
  }
  if (relPath.startsWith("config/") && /\.ya?ml$/i.test(relPath)) {
    return true;
  }
  if (relPath.startsWith("docs/") && /\.md$/i.test(relPath)) {
    return true;
  }
  if (relPath === ".thoma/rules" || relPath.endsWith("/.thoma/rules")) {
    return true;
  }
  return false;
}

function insertPath(root: TreeNode, parts: string[]): void {
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isFile = i === parts.length - 1;
    if (!node.children.has(part)) {
      node.children.set(part, { children: new Map(), isFile });
    }
    node = node.children.get(part)!;
    node.isFile = isFile;
  }
}

function renderTree(node: TreeNode, prefix: string, lines: string[]): void {
  const entries = [...node.children.entries()].sort((a, b) => {
    const aDir = a[1].isFile ? 1 : 0;
    const bDir = b[1].isFile ? 1 : 0;
    if (aDir !== bDir) {
      return aDir - bDir;
    }
    return a[0].localeCompare(b[0]);
  });

  entries.forEach(([name, child], idx) => {
    const last = idx === entries.length - 1;
    const branch = last ? "└── " : "├── ";
    const nextPrefix = prefix + (last ? "    " : "│   ");
    lines.push(prefix + branch + name + (child.isFile ? "" : "/"));
    if (!child.isFile) {
      renderTree(child, nextPrefix, lines);
    }
  });
}

async function readSnippet(uri: vscode.Uri, maxLines: number): Promise<string | undefined> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(buf);
    const lines = text.split("\n");
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
    }
    return text;
  } catch {
    return undefined;
  }
}

export async function buildWorkspaceSnapshot(
  options?: WorkspaceContextOptions
): Promise<WorkspaceSnapshot | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }

  const cfg = { ...getConfig(), ...options };
  const root = folders[0];
  const uris = await vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE, cfg.maxFiles);

  const treeRoot: TreeNode = { children: new Map(), isFile: false };
  const keyFileUris: Array<{ rel: string; uri: vscode.Uri }> = [];

  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) {
      continue;
    }
    insertPath(treeRoot, rel.split("/"));
    if (isKeyFile(rel)) {
      keyFileUris.push({ rel, uri });
    }
  }

  const treeLines: string[] = [`${root.name}/`];
  renderTree(treeRoot, "", treeLines);

  const keyParts: string[] = [];
  let used = treeLines.join("\n").length;

  keyFileUris.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const { rel, uri } of keyFileUris) {
    const content = await readSnippet(uri, cfg.keyFileMaxLines);
    if (!content) {
      continue;
    }
    const block = [`### ${rel}`, "```", content, "```"].join("\n");
    if (used + block.length > cfg.maxChars) {
      keyParts.push(`### ${rel}\n(skipped — context budget reached)`);
      break;
    }
    keyParts.push(block);
    used += block.length;
  }

  const snapshot: WorkspaceSnapshot = {
    rootName: root.name,
    rootPath: root.uri.fsPath,
    fileCount: uris.length,
    tree: treeLines.join("\n"),
    keyFiles: keyParts.join("\n\n"),
    charCount: used,
  };
  return snapshot;
}

export function formatWorkspaceContext(snapshot: WorkspaceSnapshot): string {
  return [
    "## Workspace",
    `Root: ${snapshot.rootName} (${snapshot.fileCount} files indexed)`,
    "",
    "### File tree",
    "```",
    snapshot.tree,
    "```",
    "",
    "### Key files",
    snapshot.keyFiles || "(no key config/readme files found)",
  ].join("\n");
}

export const PLAN_PROMPT_PREFIX = `Analyze the workspace below and produce a practical coding plan:
1. Summarize what this project does (2–4 sentences).
2. List relevant folders/files for the task.
3. Propose ordered implementation steps (specific files to create or edit).
4. Call out risks, dependencies, and tests to run.

Do not dump full code unless asked — focus on planning.`;
