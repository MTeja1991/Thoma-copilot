import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import {
  extractCodeBlocks,
  getActiveEditorSnippet,
  insertTextAtCursor,
  replaceSelection,
  runInTerminal,
} from "./editorContext";

export function registerEditorCommands(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thoma.focusChat", async () => {
      await chatProvider.focusChat();
    }),

    vscode.commands.registerCommand("thoma.explainSelection", async () => {
      const snippet = getActiveEditorSnippet();
      if (!snippet?.selection.trim()) {
        vscode.window.showWarningMessage("Select code to explain.");
        return;
      }
      await chatProvider.sendPrompt(
        `Explain this code:\n\n\`\`\`${snippet.languageId}\n${snippet.selection}\n\`\`\``,
        true
      );
    }),

    vscode.commands.registerCommand("thoma.fixSelection", async () => {
      const snippet = getActiveEditorSnippet();
      if (!snippet?.selection.trim()) {
        vscode.window.showWarningMessage("Select code to fix.");
        return;
      }
      await chatProvider.sendPrompt(
        [
          `Fix bugs and improve this code. Return only the corrected code in a single fenced block.`,
          `File: ${snippet.filePath}`,
          "```" + snippet.languageId,
          snippet.selection,
          "```",
        ].join("\n"),
        true,
        "thoma-code"
      );
    }),

    vscode.commands.registerCommand("thoma.askAboutFile", async () => {
      const snippet = getActiveEditorSnippet();
      if (!snippet) {
        vscode.window.showWarningMessage("Open a file first.");
        return;
      }
      const question = await vscode.window.showInputBox({
        prompt: "What do you want to know about this file?",
        placeHolder: "e.g. How does authentication work here?",
      });
      if (!question) {
        return;
      }
      await chatProvider.sendPrompt(
        `${question}\n\nContext:\n\`\`\`${snippet.languageId}\n${snippet.fullFile}\n\`\`\``,
        false
      );
    }),

    vscode.commands.registerCommand("thoma.insertAtCursor", async () => {
      const text = await vscode.window.showInputBox({
        prompt: "Text to insert at cursor",
      });
      if (text) {
        await insertTextAtCursor(text);
      }
    }),

    vscode.commands.registerCommand("thoma.runInTerminal", async () => {
      const editor = vscode.window.activeTextEditor;
      const text = editor?.document.getText(editor.selection);
      if (!text?.trim()) {
        vscode.window.showWarningMessage("Select a command to run.");
        return;
      }
      await runInTerminal(text.trim());
    }),

    vscode.commands.registerCommand("thoma.planProject", async () => {
      await chatProvider.planProject();
    }),

    vscode.commands.registerCommand("thoma.applyLastCodeBlock",
      async (code?: string) => {
        const editor = vscode.window.activeTextEditor;
        const toApply = code ?? (editor ? extractCodeBlocks(chatProvider.getLastAssistantContent())[0] : undefined);
        if (!toApply) {
          vscode.window.showWarningMessage("No code block to apply.");
          return;
        }
        if (editor?.selection && !editor.selection.isEmpty) {
          await replaceSelection(toApply);
        } else {
          await insertTextAtCursor(toApply);
        }
        vscode.window.showInformationMessage("thoma: code applied to editor.");
      }
    )
  );
}
