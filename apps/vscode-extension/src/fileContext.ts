import * as vscode from "vscode";

const DEFAULT_EXCLUDE =
  "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.tox/**,**/coverage/**,**/*.gguf,**/models/gguf/**,**/.next/**,**/out/**}";

function maxLines(): number {
  return vscode.workspace.getConfiguration("thoma").get<number>("maxFileContextLines") ?? 400;
}

export async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

export async function formatFileContext(uri: vscode.Uri): Promise<string> {
  const rel = vscode.workspace.asRelativePath(uri);
  const doc = await vscode.workspace.openTextDocument(uri);
  const limit = maxLines();
  const lines = doc.getText().split("\n");
  const truncated = lines.length > limit;
  const content = truncated
    ? lines.slice(0, limit).join("\n") + `\n... (${lines.length - limit} more lines)`
    : doc.getText();
  return [
    `File: ${rel} (${doc.languageId})`,
    "```" + doc.languageId,
    content,
    "```",
  ].join("\n");
}

export async function formatFolderContext(uri: vscode.Uri): Promise<string> {
  const rel = vscode.workspace.asRelativePath(uri);
  const pattern = new vscode.RelativePattern(uri, "**/*");
  const files = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE, 100);
  const paths = files
    .map((f) => vscode.workspace.asRelativePath(f).replace(/\\/g, "/"))
    .sort();
  const listing = paths.length ? paths.join("\n") : "(empty folder)";
  return [`Folder: ${rel}/`, "```", listing, "```"].join("\n");
}

export async function formatUriContext(uri: vscode.Uri): Promise<string> {
  if (await isDirectory(uri)) {
    return formatFolderContext(uri);
  }
  return formatFileContext(uri);
}

export async function pickWorkspaceFile(): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE, 800);
  const items = files
    .map((uri) => ({
      label: vscode.workspace.asRelativePath(uri).replace(/\\/g, "/"),
      uri,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!items.length) {
    vscode.window.showWarningMessage("thoma: no files found in workspace.");
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Add file to thoma context (@)",
    matchOnDescription: true,
  });
  return pick?.uri;
}

export async function pickWorkspaceFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  if (folders.length === 1) {
    const pick = await vscode.window.showQuickPick(
      [{ label: folders[0].name, uri: folders[0].uri }],
      { placeHolder: "Add folder to thoma context" }
    );
    return pick?.uri;
  }
  const items = folders.map((f) => ({ label: f.name, uri: f.uri }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Add folder to thoma context",
  });
  return pick?.uri;
}

export function contextKey(uri: vscode.Uri, isDir: boolean): string {
  const rel = vscode.workspace.asRelativePath(uri).replace(/\\/g, "/");
  return isDir ? `folder:${rel}` : rel;
}
