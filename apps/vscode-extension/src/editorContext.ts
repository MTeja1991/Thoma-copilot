import * as vscode from "vscode";

export interface EditorSnippet {
  filePath: string;
  languageId: string;
  selection: string;
  fullFile: string;
  lineRange: string;
}

export function getActiveEditorSnippet(): EditorSnippet | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const doc = editor.document;
  const selection = editor.selection;
  const selectedText = doc.getText(selection);
  const maxLines =
    vscode.workspace.getConfiguration("thoma").get<number>("maxFileContextLines") ?? 400;

  const lines = doc.getText().split("\n");
  const truncated = lines.length > maxLines;
  const fileContent = truncated
    ? lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`
    : doc.getText();

  const relPath = vscode.workspace.asRelativePath(doc.uri);
  const start = selection.start.line + 1;
  const end = selection.end.line + 1;
  const lineRange =
    selection.isEmpty ? `line ${start}` : `lines ${start}-${end}`;

  return {
    filePath: relPath,
    languageId: doc.languageId,
    selection: selectedText,
    fullFile: fileContent,
    lineRange,
  };
}

export function buildContextBlock(snippet: EditorSnippet, mode: "selection" | "file"): string {
  if (mode === "selection" && snippet.selection.trim()) {
    return [
      `File: ${snippet.filePath} (${snippet.languageId}, ${snippet.lineRange})`,
      "```" + snippet.languageId,
      snippet.selection,
      "```",
    ].join("\n");
  }

  return [
    `File: ${snippet.filePath} (${snippet.languageId})`,
    "```" + snippet.languageId,
    snippet.fullFile,
    "```",
  ].join("\n");
}

export async function insertTextAtCursor(text: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    const doc = await vscode.workspace.openTextDocument({ content: text });
    await vscode.window.showTextDocument(doc);
    return;
  }

  await editor.edit((eb) => {
    eb.insert(editor.selection.active, text);
  });
}

export async function replaceSelection(text: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await insertTextAtCursor(text);
    return;
  }

  await editor.edit((eb) => {
    eb.replace(editor.selection, text);
  });
}

export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[\w]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push(match[1].trimEnd());
  }
  return blocks;
}

export async function runInTerminal(command: string): Promise<void> {
  const term = vscode.window.createTerminal({ name: "thoma" });
  term.show();
  term.sendText(command, true);
}
