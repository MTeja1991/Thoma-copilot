import * as path from "path";
import * as vscode from "vscode";
import { buildContextBlock, getActiveEditorSnippet, insertTextAtCursor, replaceSelection, runInTerminal } from "./editorContext";
import { getDefaultProfile, ThomaClient } from "./thomaClient";
import {
  ChatMessage,
  ExtensionToWebviewMessage,
  ThomaModel,
  WebviewToExtensionMessage,
} from "./types";
import {
  buildWorkspaceSnapshot,
  formatWorkspaceContext,
  PLAN_PROMPT_PREFIX,
  WorkspaceSnapshot,
} from "./workspaceContext";
import {
  applyFileEdit,
  claimsFileWrite,
  getWorkspaceRootPath,
  hydrateFileEdits,
  parseFileEdits,
  ParsedFileEdit,
  showFileEditDiff,
  toWebviewEdit,
  undoFileEdit,
} from "./fileEdits";
import {
  contextKey,
  formatUriContext,
  isDirectory,
  pickWorkspaceFile,
  pickWorkspaceFolder,
} from "./fileContext";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "thoma.chatView";

  private view?: vscode.WebviewView;
  private readonly history: ChatMessage[] = [];
  private lastAssistantContent = "";
  private activeProfile: string;
  private models: ThomaModel[] = [];
  private chatId?: string;
  private workspaceSnapshot?: WorkspaceSnapshot;
  private workspaceAttachedToChat = false;
  private chatRestored = false;
  private readonly contextFiles = new Map<string, vscode.Uri>();
  private readonly fileEditsByMessage = new Map<string, ParsedFileEdit[]>();
  private messageCounter = 0;
  private chatAbort?: AbortController;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ThomaClient
  ) {
    this.activeProfile = getDefaultProfile();
    this.chatId = this.loadStoredChatId();
  }

  private workspaceStateKey(): string {
    const root = getWorkspaceRootPath();
    return root ? `chatId:${root}` : "chatId";
  }

  private loadStoredChatId(): string | undefined {
    return this.context.workspaceState.get<string>(this.workspaceStateKey());
  }

  private async saveStoredChatId(chatId: string | undefined): Promise<void> {
    await this.context.workspaceState.update(this.workspaceStateKey(), chatId);
    this.chatId = chatId;
  }

  getLastAssistantContent(): string {
    return this.lastAssistantContent;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      await this.handleMessage(msg);
    });
  }

  async sendPrompt(
    text: string,
    includeFile: boolean,
    profileOverride?: string,
    options?: { includeWorkspace?: boolean; planMode?: boolean }
  ): Promise<void> {
    this.post({ type: "userMessage", text });
    await this.focusChat();
    await this.runChat(text, includeFile, profileOverride, options);
  }

  async planProject(userGoal?: string): Promise<void> {
    const goal =
      userGoal ??
      (await vscode.window.showInputBox({
        prompt: "What do you want to build or change in this project?",
        placeHolder: "e.g. Add user authentication to the API",
      }));
    if (!goal) {
      return;
    }
    await this.focusChat();
    await this.sendPrompt(goal, false, "thoma-reason", {
      includeWorkspace: true,
      planMode: true,
    });
  }

  async focusChat(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.thoma-sidebar");
    await vscode.commands.executeCommand("thoma.chatView.focus");
  }

  async addContextFromExplorer(uris: vscode.Uri[]): Promise<void> {
    for (const uri of uris) {
      await this.addContextUri(uri);
    }
    await this.focusChat();
  }

  async addContextUri(uri: vscode.Uri): Promise<void> {
    const dir = await isDirectory(uri);
    const key = contextKey(uri, dir);
    if (this.contextFiles.has(key)) {
      return;
    }
    this.contextFiles.set(key, uri);
    this.syncContextFiles();
    this.post({
      type: "status",
      status: `Added ${dir ? "folder" : "file"}: ${key.replace(/^folder:/, "")}`,
    });
    setTimeout(() => this.post({ type: "status", status: "" }), 2000);
  }

  private syncContextFiles(): void {
    this.post({ type: "contextFiles", files: [...this.contextFiles.keys()] });
  }

  private async buildAttachedContext(): Promise<string> {
    const parts: string[] = [];
    for (const [, uri] of this.contextFiles) {
      try {
        parts.push(await formatUriContext(uri));
      } catch {
        // skip unreadable paths
      }
    }
    return parts.join("\n\n");
  }

  private async pickFileForContext(): Promise<void> {
    const uri = await pickWorkspaceFile();
    if (uri) {
      await this.addContextUri(uri);
    }
  }

  private async pickFolderForContext(): Promise<void> {
    const uri = await pickWorkspaceFolder();
    if (uri) {
      await this.addContextUri(uri);
    }
  }

  private removeContextFile(key: string): void {
    this.contextFiles.delete(key);
    this.syncContextFiles();
  }

  private post(msg: ExtensionToWebviewMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private async handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.refreshState();
        await this.refreshChatList();
        this.syncContextFiles();
        await this.restoreChat();
        break;
      case "refreshModels":
        await this.refreshState();
        await this.refreshChatList();
        break;
      case "switchProfile":
        if (msg.profile) {
          await this.switchProfile(msg.profile);
        }
        break;
      case "sendChat":
        if (msg.text?.trim()) {
          this.post({ type: "userMessage", text: msg.text });
          await this.runChat(msg.text, msg.includeFile ?? false, undefined, {
            includeWorkspace: msg.includeWorkspace,
          });
        }
        break;
      case "planProject":
        await this.planProject(msg.text);
        break;
      case "newChat":
        await this.startNewChat();
        break;
      case "openChat":
        if (msg.chatId) {
          await this.openChat(msg.chatId);
        }
        break;
      case "deleteChat":
        if (msg.chatId) {
          await this.deleteChat(msg.chatId);
        }
        break;
      case "closeChat":
        await this.closeChat();
        break;
      case "pickFile":
        await this.pickFileForContext();
        break;
      case "pickFolder":
        await this.pickFolderForContext();
        break;
      case "removeContextFile":
        if (msg.contextKey) {
          this.removeContextFile(msg.contextKey);
        }
        break;
      case "applyCode":
        if (msg.code) {
          await this.applyCode(msg.code);
        }
        break;
      case "runCode":
        if (msg.code) {
          await runInTerminal(msg.code);
        }
        break;
      case "reviewFileEdit":
        if (msg.messageId && msg.editId) {
          await this.reviewFileEdit(msg.messageId, msg.editId);
        }
        break;
      case "acceptFileEdit":
        if (msg.messageId && msg.editId) {
          await this.acceptFileEdit(msg.messageId, msg.editId);
        }
        break;
      case "rejectFileEdit":
        if (msg.messageId && msg.editId) {
          await this.rejectFileEdit(msg.messageId, msg.editId);
        }
        break;
      case "acceptAllFileEdits":
        if (msg.messageId) {
          await this.acceptAllFileEdits(msg.messageId);
        }
        break;
      case "rejectAllFileEdits":
        if (msg.messageId) {
          await this.rejectAllFileEdits(msg.messageId);
        }
        break;
      case "stopChat":
        await this.stopChat();
        break;
    }
  }

  private async stopChat(): Promise<void> {
    this.chatAbort?.abort();
  }

  private async publishFileEdits(messageId: string, content: string): Promise<void> {
    const { edits: parsed, skipped: parseSkipped } = parseFileEdits(content);
    if (!parsed.length) {
      if (claimsFileWrite(content)) {
        this.post({
          type: "status",
          status:
            "No file proposal detected — thoma does not write files until you click Keep. Ask again with path on the code block line.",
        });
        vscode.window.showWarningMessage(
          "thoma: model said a file was created, but nothing was written. Look for Proposed changes and click Keep, or re-ask with ```python path/to/file.py on the fence line."
        );
      }
      if (parseSkipped.length) {
        this.reportSkippedEdits(parseSkipped);
      }
      return;
    }

    if (!getWorkspaceRootPath()) {
      this.post({
        type: "error",
        error:
          "No workspace folder is open — thoma can't write files without one. Use File > Open Folder... and re-ask.",
      });
      vscode.window.showWarningMessage(
        "thoma: open a workspace folder (File > Open Folder…) so proposed file changes have somewhere to write to."
      );
      return;
    }

    const { edits: hydrated, skipped: hydrateSkipped } = await hydrateFileEdits(parsed);
    const skipped = [...parseSkipped, ...hydrateSkipped];
    if (skipped.length) {
      this.reportSkippedEdits(skipped);
    }
    this.fileEditsByMessage.set(messageId, hydrated);
    this.post({
      type: "fileEdits",
      messageId,
      fileEdits: hydrated.map(toWebviewEdit),
    });
    const autoApply =
      vscode.workspace.getConfiguration("thoma").get<boolean>("autoApplyFileEdits", false);
    if (autoApply && hydrated.length) {
      await this.acceptAllFileEdits(messageId);
    } else if (hydrated.length) {
      this.post({
        type: "status",
        status: `Proposed ${hydrated.length} file(s) — review below and click Keep to write to disk.`,
      });
    }
  }

  private reportSkippedEdits(skipped: { path: string; reason: string }[]): void {
    const summary = skipped.map((s) => `${s.path} (${s.reason})`).join(", ");
    this.post({ type: "error", error: `Skipped proposed edit(s): ${summary}` });
    vscode.window.showWarningMessage(`thoma: skipped ${skipped.length} proposed edit(s) — ${summary}`);
  }

  private getFileEdit(messageId: string, editId: string): ParsedFileEdit | undefined {
    return this.fileEditsByMessage.get(messageId)?.find((e) => e.id === editId);
  }

  private syncFileEdits(messageId: string): void {
    const edits = this.fileEditsByMessage.get(messageId);
    if (edits) {
      this.post({
        type: "fileEdits",
        messageId,
        fileEdits: edits.map(toWebviewEdit),
      });
    }
  }

  private async reviewFileEdit(messageId: string, editId: string): Promise<void> {
    const edit = this.getFileEdit(messageId, editId);
    if (!edit) {
      return;
    }
    await showFileEditDiff(edit);
  }

  private async acceptFileEdit(messageId: string, editId: string): Promise<void> {
    const edit = this.getFileEdit(messageId, editId);
    if (!edit || edit.status !== "pending") {
      return;
    }
    try {
      await applyFileEdit(edit);
      edit.status = "accepted";
      this.syncFileEdits(messageId);
      this.post({ type: "status", status: `Kept ${edit.path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
    }
  }

  private async rejectFileEdit(messageId: string, editId: string): Promise<void> {
    const edit = this.getFileEdit(messageId, editId);
    if (!edit) {
      return;
    }
    try {
      if (edit.status === "accepted") {
        await undoFileEdit(edit);
      }
      edit.status = "rejected";
      this.syncFileEdits(messageId);
      this.post({ type: "status", status: `Undid ${edit.path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
    }
  }

  private async acceptAllFileEdits(messageId: string): Promise<void> {
    const edits = this.fileEditsByMessage.get(messageId) ?? [];
    const failures: string[] = [];
    let succeeded = 0;
    for (const edit of edits) {
      if (edit.status !== "pending") {
        continue;
      }
      try {
        await applyFileEdit(edit);
        edit.status = "accepted";
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${edit.path}: ${message}`);
      }
    }
    this.syncFileEdits(messageId);
    if (failures.length) {
      this.post({
        type: "status",
        status: `Wrote ${succeeded} file(s), ${failures.length} failed — ${failures.join("; ")}`,
      });
    } else if (succeeded) {
      this.post({ type: "status", status: `Wrote ${succeeded} file(s) to workspace.` });
    }
  }

  private async rejectAllFileEdits(messageId: string): Promise<void> {
    const edits = this.fileEditsByMessage.get(messageId) ?? [];
    for (const edit of edits) {
      if (edit.status === "pending" || edit.status === "accepted") {
        await this.rejectFileEdit(messageId, edit.id);
      }
    }
  }

  private async closeChat(): Promise<void> {
    this.history.length = 0;
    this.chatId = undefined;
    this.workspaceAttachedToChat = false;
    this.workspaceSnapshot = undefined;
    this.chatRestored = false;
    this.contextFiles.clear();
    this.fileEditsByMessage.clear();
    await this.saveStoredChatId(undefined);
    this.post({ type: "clearMessages" });
    this.post({ type: "contextFiles", files: [] });
    this.post({ type: "chatLoaded", chatId: "", chatTitle: "" });
    this.post({ type: "status", status: "" });
    await this.refreshChatList();
  }

  private async startNewChat(): Promise<void> {
    await this.closeChat();
    this.post({ type: "status", status: "New chat — send a message to begin." });
  }

  private async openChat(chatId: string): Promise<void> {
    this.post({ type: "status", status: "Loading chat..." });
    try {
      const chat = await this.client.getChat(chatId);
      this.chatId = chat.id;
      this.chatRestored = true;
      this.workspaceAttachedToChat = (chat.messages?.length ?? 0) > 0;
      await this.saveStoredChatId(chat.id);

      this.history.length = 0;
      for (const m of chat.messages ?? []) {
        if (m.role === "user" || m.role === "assistant") {
          this.history.push({
            role: m.role,
            content: m.content,
            reasoning: m.reasoning_content ?? undefined,
          });
        }
      }

      this.post({ type: "clearMessages" });
      this.post({
        type: "chatLoaded",
        chatId: chat.id,
        chatTitle: chat.title,
      });
      for (const m of this.history) {
        if (m.role === "user") {
          this.post({ type: "userMessage", text: m.content });
        } else {
          this.post({ type: "assistantMessage", text: m.content, reasoning: m.reasoning });
        }
      }
      await this.refreshChatList();
      this.post({ type: "status", status: "" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
      this.post({ type: "status", status: "" });
    }
  }

  private async deleteChat(chatId: string): Promise<void> {
    try {
      await this.client.deleteChat(chatId);
      if (this.chatId === chatId) {
        await this.closeChat();
      } else {
        await this.refreshChatList();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
    }
  }

  private async refreshChatList(): Promise<void> {
    try {
      const chats = await this.client.listChats(50, getWorkspaceRootPath());
      this.post({ type: "chatList", chats, chatId: this.chatId });
    } catch {
      // API may be down; list will refresh on next successful health check
    }
  }

  private async restoreChat(): Promise<void> {
    if (this.chatRestored) {
      return;
    }
    const root = getWorkspaceRootPath();
    if (this.chatId) {
      await this.openChat(this.chatId);
      return;
    }
    if (!root) {
      return;
    }
    try {
      const chats = await this.client.listChats(1, root);
      if (chats.length > 0) {
        await this.openChat(chats[0].id);
      }
    } catch {
      // no chats yet for this workspace
    }
  }

  private async ensureChat(profile: string): Promise<string> {
    if (this.chatId) {
      return this.chatId;
    }
    const root = getWorkspaceRootPath();
    const title = root ? `${path.basename(root)} chat` : "IDE chat";
    const chat = await this.client.createChat(profile, title, root);
    this.chatRestored = true;
    await this.saveStoredChatId(chat.id);
    this.post({ type: "chatLoaded", chatId: chat.id, chatTitle: chat.title });
    await this.refreshChatList();
    return chat.id;
  }

  private async applyCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor?.selection && !editor.selection.isEmpty) {
      await replaceSelection(code);
    } else {
      await insertTextAtCursor(code);
    }
    vscode.window.showInformationMessage("thoma: code applied to editor.");
  }

  private async refreshState(): Promise<void> {
    try {
      const health = await this.client.health();
      this.activeProfile = health.active_profile;
      this.models = await this.client.listModels();
      this.post({
        type: "health",
        backend: health.backend,
        activeProfile: health.active_profile,
      });
      this.post({ type: "models", models: this.models, activeProfile: this.activeProfile });
      await this.refreshWorkspaceInfo();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({
        type: "error",
        error: `Cannot reach thoma API. Start the backend first.\n${message}`,
      });
    }
  }

  private async refreshWorkspaceInfo(): Promise<void> {
    const snapshot = await buildWorkspaceSnapshot();
    if (snapshot) {
      this.workspaceSnapshot = snapshot;
      this.post({
        type: "workspaceInfo",
        rootName: snapshot.rootName,
        fileCount: snapshot.fileCount,
      });
    }
  }

  private async switchProfile(profileId: string): Promise<void> {
    this.post({ type: "status", status: `Switching to ${profileId}...` });
    try {
      await this.client.switchProfile(profileId);
      this.activeProfile = profileId;
      this.models = await this.client.listModels();
      this.post({ type: "profileSwitched", activeProfile: profileId });
      this.post({ type: "models", models: this.models, activeProfile: profileId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
    }
  }

  private async runChat(
    userText: string,
    includeFile: boolean,
    profileOverride?: string,
    options?: { includeWorkspace?: boolean; planMode?: boolean }
  ): Promise<void> {
    const profile = profileOverride ?? this.activeProfile;
    let content = userText;

    const defaultInclude =
      vscode.workspace.getConfiguration("thoma").get<boolean>("includeActiveFileByDefault") ??
      false;

    if (includeFile || defaultInclude) {
      const snippet = getActiveEditorSnippet();
      if (snippet) {
        const mode = snippet.selection.trim() ? "selection" : "file";
        content = `${userText}\n\n---\nContext:\n${buildContextBlock(snippet, mode)}`;
      }
    }

    const attached = await this.buildAttachedContext();
    if (attached) {
      content = `${content}\n\n---\nAttached from explorer:\n${attached}`;
    }

    const defaultWorkspace =
      vscode.workspace.getConfiguration("thoma").get<boolean>("includeWorkspaceByDefault") ??
      false;
    const wantWorkspace =
      options?.planMode ||
      options?.includeWorkspace ||
      defaultWorkspace;

    let workspacePlanning = false;
    if (wantWorkspace && !this.workspaceAttachedToChat) {
      this.post({ type: "status", status: "Scanning workspace folders..." });
      const snapshot = this.workspaceSnapshot ?? (await buildWorkspaceSnapshot());
      if (snapshot) {
        this.workspaceSnapshot = snapshot;
        const prefix = options?.planMode ? `${PLAN_PROMPT_PREFIX}\n\n` : "";
        content = `${prefix}${content}\n\n---\n${formatWorkspaceContext(snapshot)}`;
        this.workspaceAttachedToChat = true;
        workspacePlanning = true;
        this.post({
          type: "workspaceInfo",
          rootName: snapshot.rootName,
          fileCount: snapshot.fileCount,
        });
      } else {
        vscode.window.showWarningMessage("thoma: open a workspace folder to include project context.");
      }
    }

    let streamContent = "";
    let streamReasoning = "";

    try {
      const chatId = await this.ensureChat(profile);
      this.history.push({ role: "user", content });
      this.post({ type: "status", status: "Thinking..." });
      this.post({ type: "streamStart" });

      this.chatAbort?.abort();
      this.chatAbort = new AbortController();
      const signal = this.chatAbort.signal;

      const reply = await this.client.chat(
        this.history,
        {
          profile,
          chatId,
          workspacePlanning,
          stream: true,
        },
        (delta) => {
          if (delta.content) {
            streamContent += delta.content;
          }
          if (delta.reasoning) {
            streamReasoning += delta.reasoning;
          }
          if (delta.content || delta.reasoning) {
            this.post({
              type: "streamDelta",
              delta: delta.content,
              reasoning: delta.reasoning,
            });
          }
        },
        signal
      );

      this.lastAssistantContent = reply.content;
      this.history.push({
        role: "assistant",
        content: reply.content,
        reasoning: reply.reasoning || streamReasoning || undefined,
      });

      const messageId = `msg-${++this.messageCounter}`;
      this.post({
        type: "streamEnd",
        text: reply.content,
        reasoning: reply.reasoning || streamReasoning || undefined,
        messageId,
      });
      await this.publishFileEdits(messageId, reply.content);
      this.post({ type: "status", status: "" });
      await this.refreshChatList();
      const updated = await this.client.getChat(chatId);
      this.post({
        type: "chatLoaded",
        chatId: updated.id,
        chatTitle: updated.title,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (streamContent.trim()) {
          this.lastAssistantContent = streamContent;
          this.history.push({
            role: "assistant",
            content: streamContent,
            reasoning: streamReasoning || undefined,
          });
          const messageId = `msg-${++this.messageCounter}`;
          this.post({
            type: "streamEnd",
            text: streamContent,
            reasoning: streamReasoning || undefined,
            messageId,
          });
          await this.publishFileEdits(messageId, streamContent);
        } else {
          this.post({ type: "streamStopped" });
        }
        this.post({ type: "status", status: "Stopped." });
        return;
      }
      this.history.pop();
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", error: message });
      this.post({ type: "status", status: "" });
    } finally {
      this.chatAbort = undefined;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "chat.js")
    );
    const markedUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "marked.min.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "chat.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="thoma-shell">
    <div class="top-bar">
      <span class="brand">thoma</span>
      <select id="profile" title="Model"></select>
      <div class="top-actions">
        <button id="toggleHistory" class="secondary" title="Chat history">History</button>
        <button id="refresh" class="secondary" title="Refresh">↻</button>
        <button id="newChat" class="secondary" title="New chat">+</button>
      </div>
    </div>
    <div class="meta-row">
      <span id="backend"></span>
      <span id="workspace"></span>
    </div>
    <div id="chatBar" class="hidden">
      <span id="chatBarTitle"></span>
      <div class="chat-bar-actions">
        <button id="closeChatBtn" class="icon-btn" title="Close chat">×</button>
        <button id="deleteCurrentChatBtn" class="icon-btn danger" title="Delete chat">⌫</button>
      </div>
    </div>
    <section id="historyPanel" class="collapsed">
      <div id="historyHeader"><h3>Past chats</h3></div>
      <div id="chatList"></div>
    </section>
    <div id="contextChips" class="context-chips"></div>
    <div class="messages-wrap">
      <div id="emptyChat" class="hidden">Ask thoma about this project.<br><br>Use <b>@</b> to attach files. Proposed file changes can be <b>Kept</b> or <b>Undone</b> before writing to disk.</div>
      <div id="messages"></div>
    </div>
    <div id="status"></div>
    <div class="composer">
      <div class="composer-toolbar">
        <button id="pickFileBtn" class="tool-btn" title="Add file (@)">@ File</button>
        <button id="pickFolderBtn" class="tool-btn" title="Add folder">@ Folder</button>
        <label class="checkbox-row">
          <input type="checkbox" id="includeFile" />
          Active file
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="includeWorkspace" checked />
          Workspace
        </label>
      </div>
      <textarea id="prompt" placeholder="Ask thoma… (@ file, Explorer right-click, Enter to send, Shift+Enter for a new line)"></textarea>
      <div class="composer-actions">
        <button id="planBtn" class="secondary">Plan</button>
        <button id="stopBtn" class="stop-btn hidden" title="Stop generation">■ Stop</button>
        <button id="send" title="Send (Enter)">Send ↵</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
