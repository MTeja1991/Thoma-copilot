export interface ThomaModel {
  id: string;
  ollama_model: string;
  thinking: boolean;
  context_length: number;
  memory_estimate_gb: string;
  stretch: boolean;
  active: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
}

export interface ThomaChat {
  id: string;
  title: string;
  profile: string;
  message_count?: number;
  updated_at?: string;
  messages?: Array<{
    role: string;
    content: string;
    reasoning_content?: string | null;
  }>;
}

export interface ThomaChatSummary {
  id: string;
  title: string;
  profile: string;
  workspace_root?: string | null;
  message_count?: number;
  updated_at?: string;
}

export interface HealthResponse {
  status: string;
  backend: string;
  accelerator: string;
  active_profile: string;
}

export interface FileEditSummary {
  id: string;
  path: string;
  isNew: boolean;
  status: "pending" | "accepted" | "rejected";
  lineCount?: number;
}

export interface WebviewToExtensionMessage {
  type:
    | "ready"
    | "sendChat"
    | "switchProfile"
    | "refreshModels"
    | "applyCode"
    | "runCode"
    | "planProject"
    | "newChat"
    | "openChat"
    | "deleteChat"
    | "closeChat"
    | "toggleHistory"
    | "pickFile"
    | "pickFolder"
    | "removeContextFile"
    | "reviewFileEdit"
    | "acceptFileEdit"
    | "rejectFileEdit"
    | "acceptAllFileEdits"
    | "rejectAllFileEdits"
    | "stopChat";
  text?: string;
  profile?: string;
  includeFile?: boolean;
  includeWorkspace?: boolean;
  code?: string;
  chatId?: string;
  contextKey?: string;
  editId?: string;
  messageId?: string;
}

export interface ExtensionToWebviewMessage {
  type:
    | "init"
    | "models"
    | "health"
    | "userMessage"
    | "assistantMessage"
    | "error"
    | "status"
    | "profileSwitched"
    | "chatLoaded"
    | "workspaceInfo"
    | "chatList"
    | "clearMessages"
    | "streamStart"
    | "streamDelta"
    | "streamEnd"
    | "streamStopped"
    | "contextFiles"
    | "fileEdits";
  models?: ThomaModel[];
  backend?: string;
  activeProfile?: string;
  text?: string;
  reasoning?: string;
  error?: string;
  status?: string;
  chatId?: string;
  chatTitle?: string;
  fileCount?: number;
  rootName?: string;
  chats?: ThomaChatSummary[];
  historyOpen?: boolean;
  delta?: string;
  streamId?: string;
  files?: string[];
  fileEdits?: FileEditSummary[];
  messageId?: string;
}
