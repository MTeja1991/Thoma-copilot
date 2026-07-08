import * as path from "path";
import * as vscode from "vscode";

export type FileEditStatus = "pending" | "accepted" | "rejected";

export interface ParsedFileEdit {
  id: string;
  path: string;
  content: string;
  isNew: boolean;
  originalContent: string;
  status: FileEditStatus;
}

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

/** Parse file proposals from assistant markdown. */
export function parseFileEdits(text: string): Omit<ParsedFileEdit, "status">[] {
  const edits: Omit<ParsedFileEdit, "status">[] = [];
  const seen = new Set<string>();
  const re = new RegExp(FENCE_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const info = (match[1] || "").trim();
    let content = match[2].replace(/\n$/, "");
    if (!content.trim()) {
      continue;
    }

    let filePath =
      extractPathFromInfo(info) ||
      extractPathFromContentHeader(content) ||
      prosePathBeforeBlock(text, match.index);

    if (!filePath) {
      continue;
    }

    content = stripPathHeaderComment(content, filePath).content;
    const normalized = normalizeRelPath(filePath);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    edits.push({
      id: `${normalized}:${edits.length}`,
      path: normalized,
      content,
      isNew: false,
      originalContent: "",
    });
  }

  return edits;
}

/** True when the model claims a file was written but nothing was parsed. */
export function claimsFileWrite(text: string): boolean {
  return (
    /file\s+created/i.test(text) ||
    /created:\s*\S+\//i.test(text) ||
    /new\s+file/i.test(text)
  );
}

function prosePathBeforeBlock(text: string, blockIndex: number): string | undefined {
  const before = text.slice(0, blockIndex);
  const patterns = [
    /File Created:\s*[`"']?([^\s`"'\n]+)/gi,
    /(?:^|\n)\s*(?:path|location):\s*[`"']?([^\s`"'\n]+)/gi,
  ];
  let last: string | undefined;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(before)) !== null) {
      const p = normalizeRelPath(m[1]);
      if (looksLikePath(p)) {
        last = p;
      }
    }
  }
  return last;
}

function extractPathFromInfo(info: string): string | undefined {
  if (!info) {
    return undefined;
  }
  const parts = info.split(/\s+/);
  if (parts.length >= 2 && looksLikePath(parts[parts.length - 1])) {
    return parts[parts.length - 1];
  }
  if (parts.length === 1 && looksLikePath(parts[0]) && !isLanguageTag(parts[0])) {
    return parts[0];
  }
  const colon = info.indexOf(":");
  if (colon > 0) {
    const maybe = info.slice(colon + 1).trim();
    if (looksLikePath(maybe)) {
      return maybe;
    }
  }
  return undefined;
}

function extractPathFromContentHeader(content: string): string | undefined {
  const first = content.split("\n")[0]?.trim() ?? "";
  const fileComment = first.match(/^#\s*(?:file:\s*)?(.+)$/i);
  if (fileComment && looksLikePath(fileComment[1].trim())) {
    return fileComment[1].trim();
  }
  return undefined;
}

function stripPathHeaderComment(
  content: string,
  filePath: string
): { content: string; matched: boolean } {
  const lines = content.split("\n");
  const first = lines[0]?.trim() ?? "";
  const base = path.posix.basename(filePath.replace(/\\/g, "/"));
  if (
    first.match(/^#\s*(?:file:\s*)?.+$/i) &&
    (first.includes(base) || first.endsWith(".py") || first.endsWith(".ts"))
  ) {
    return { content: lines.slice(1).join("\n").replace(/^\n/, ""), matched: true };
  }
  return { content, matched: false };
}

function isLanguageTag(s: string): boolean {
  return /^(python|py|typescript|ts|javascript|js|json|yaml|yml|bash|sh|rust|go|java|cpp|c|html|css|sql)$/i.test(
    s
  );
}

function looksLikePath(s: string): boolean {
  return /[/\\]/.test(s) || /\.[a-zA-Z0-9]+$/.test(s);
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^[`"']|[`"']$/g, "");
}

export function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function getWorkspaceRootPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function hydrateFileEdits(
  edits: Omit<ParsedFileEdit, "status">[]
): Promise<ParsedFileEdit[]> {
  const root = getWorkspaceRoot();
  if (!root) {
    return edits.map((e) => ({ ...e, status: "pending" as const }));
  }

  const hydrated: ParsedFileEdit[] = [];
  for (const edit of edits) {
    const uri = vscode.Uri.joinPath(root, edit.path);
    let originalContent = "";
    let isNew = true;
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      originalContent = Buffer.from(data).toString("utf8");
      isNew = false;
    } catch {
      isNew = true;
    }
    hydrated.push({
      ...edit,
      isNew,
      originalContent,
      status: "pending",
    });
  }
  return hydrated;
}

export async function ensureParentDirs(root: vscode.Uri, relPath: string): Promise<void> {
  const dir = path.posix.dirname(relPath.replace(/\\/g, "/"));
  if (!dir || dir === ".") {
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, dir));
}

export async function applyFileEdit(edit: ParsedFileEdit): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error("Open a workspace folder to apply file changes.");
  }
  const uri = vscode.Uri.joinPath(root, edit.path);
  await ensureParentDirs(root, edit.path);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(edit.content, "utf8"));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function undoFileEdit(edit: ParsedFileEdit): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    return;
  }
  const uri = vscode.Uri.joinPath(root, edit.path);
  if (edit.isNew) {
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // already removed
    }
    return;
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(edit.originalContent, "utf8"));
}

const diffContents = new Map<string, string>();

export class ThomaDiffContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "thoma-diff";

  provideTextDocumentContent(uri: vscode.Uri): string {
    return diffContents.get(uri.toString()) ?? "";
  }

  set(uri: vscode.Uri, content: string): void {
    diffContents.set(uri.toString(), content);
  }

  clear(uri: vscode.Uri): void {
    diffContents.delete(uri.toString());
  }
}

export async function showFileEditDiff(edit: ParsedFileEdit): Promise<void> {
  const provider = new ThomaDiffContentProvider();
  const leftUri = vscode.Uri.parse(`${ThomaDiffContentProvider.scheme}:orig-${edit.id}`);
  const rightUri = vscode.Uri.parse(`${ThomaDiffContentProvider.scheme}:new-${edit.id}`);
  provider.set(leftUri, edit.originalContent);
  provider.set(rightUri, edit.content);

  const reg = vscode.workspace.registerTextDocumentContentProvider(
    ThomaDiffContentProvider.scheme,
    provider
  );
  try {
    const title = edit.isNew ? `${edit.path} (new)` : edit.path;
    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
  } finally {
    setTimeout(() => reg.dispose(), 60_000);
  }
}

export function toWebviewEdit(edit: ParsedFileEdit) {
  return {
    id: edit.id,
    path: edit.path,
    isNew: edit.isNew,
    status: edit.status,
    lineCount: edit.content.split("\n").length,
  };
}
