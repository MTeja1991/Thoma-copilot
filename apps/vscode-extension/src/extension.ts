import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { registerEditorCommands } from "./editorActions";
import { getApiKey, getApiUrl, ThomaClient } from "./thomaClient";

export function activate(context: vscode.ExtensionContext): void {
  const client = new ThomaClient(getApiUrl, getApiKey);
  const chatProvider = new ChatViewProvider(context, client);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  registerEditorCommands(context, chatProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand("thoma.addToChat", async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
      const targets: vscode.Uri[] = uris?.length ? uris : uri ? [uri] : [];
      if (!targets.length) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          targets.push(editor.document.uri);
        }
      }
      if (!targets.length) {
        vscode.window.showWarningMessage("thoma: select a file or folder in the Explorer.");
        return;
      }
      await chatProvider.addContextFromExplorer(targets);
    })
  );

  if (vscode.workspace.getConfiguration("thoma").get<boolean>("openOnStartup", true)) {
    void vscode.commands.executeCommand("workbench.view.extension.thoma-sidebar");
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("thoma.apiUrl")) {
        vscode.window.showInformationMessage(
          "thoma: API URL changed. Reload window if connection issues persist."
        );
      }
    })
  );
}

export function deactivate(): void {}
