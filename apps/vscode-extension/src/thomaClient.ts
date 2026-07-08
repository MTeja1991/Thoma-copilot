import * as vscode from "vscode";
import { ChatMessage, HealthResponse, ThomaChat, ThomaChatSummary, ThomaModel } from "./types";

export interface ChatOptions {
  profile?: string;
  chatId?: string;
  workspacePlanning?: boolean;
  stream?: boolean;
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
}

export class ThomaClient {
  constructor(private readonly getApiUrl: () => string) {}

  private url(path: string): string {
    return `${this.getApiUrl().replace(/\/$/, "")}${path}`;
  }

  async health(): Promise<HealthResponse> {
    const res = await fetch(this.url("/health"));
    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  }

  async listModels(): Promise<ThomaModel[]> {
    const res = await fetch(this.url("/v1/models"));
    if (!res.ok) {
      throw new Error(`List models failed: ${res.status}`);
    }
    const body = (await res.json()) as { data: ThomaModel[] };
    return body.data;
  }

  async switchProfile(profileId: string): Promise<void> {
    const res = await fetch(this.url(`/v1/profiles/${profileId}/switch`), {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Switch profile failed: ${text}`);
    }
  }

  async createChat(
    profile: string,
    title = "IDE chat",
    workspaceRoot?: string
  ): Promise<ThomaChat> {
    const res = await fetch(this.url("/v1/chats"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, title, workspace_root: workspaceRoot }),
    });
    if (!res.ok) {
      throw new Error(`Create chat failed: ${await res.text()}`);
    }
    return (await res.json()) as ThomaChat;
  }

  async getChat(chatId: string): Promise<ThomaChat> {
    const res = await fetch(this.url(`/v1/chats/${chatId}`));
    if (!res.ok) {
      throw new Error(`Get chat failed: ${await res.text()}`);
    }
    return (await res.json()) as ThomaChat;
  }

  async listChats(limit = 50, workspaceRoot?: string): Promise<ThomaChatSummary[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (workspaceRoot) {
      params.set("workspace_root", workspaceRoot);
    }
    const res = await fetch(this.url(`/v1/chats?${params.toString()}`));
    if (!res.ok) {
      throw new Error(`List chats failed: ${await res.text()}`);
    }
    const body = (await res.json()) as { data: ThomaChatSummary[] };
    return body.data;
  }

  async deleteChat(chatId: string): Promise<void> {
    const res = await fetch(this.url(`/v1/chats/${chatId}`), { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Delete chat failed: ${await res.text()}`);
    }
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
    onDelta?: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<{ content: string; reasoning?: string; chatId?: string }> {
    const body: Record<string, unknown> = {
      model: options?.profile,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: options?.stream ?? Boolean(onDelta),
      workspace_planning: options?.workspacePlanning ?? false,
    };

    if (options?.chatId) {
      body.chat_id = options.chatId;
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        body.messages = [{ role: "user", content: last.content }];
      }
    }

    const res = await fetch(this.url("/v1/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat failed: ${text}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (body.stream && contentType.includes("text/event-stream") && res.body && onDelta) {
      return this.readSseStream(res, onDelta, signal);
    }

    const data = (await res.json()) as {
      chat_id?: string;
      choices: Array<{
        message: { content: string; reasoning_content?: string | null };
      }>;
    };

    const msg = data.choices[0]?.message;
    return {
      content: msg?.content ?? "",
      reasoning: msg?.reasoning_content ?? undefined,
      chatId: data.chat_id,
    };
  }

  private async readSseStream(
    res: Response,
    onDelta: (delta: StreamDelta) => void,
    signal?: AbortSignal
  ): Promise<{ content: string; reasoning?: string; chatId?: string }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoning = "";
    let chatId: string | undefined;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          throw new DOMException("Chat stopped by user", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          if (signal?.aborted) {
            await reader.cancel();
            throw new DOMException("Chat stopped by user", "AbortError");
          }
          const line = part.trim();
          if (!line.startsWith("data: ")) {
            continue;
          }
          const data = line.slice(6);
          if (data === "[DONE]") {
            continue;
          }
          const chunk = JSON.parse(data) as {
            chat_id?: string;
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          };
          if (chunk.chat_id) {
            chatId = chunk.chat_id;
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) {
            continue;
          }
          if (delta.content) {
            content += delta.content;
            onDelta({ content: delta.content });
          }
          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onDelta({ reasoning: delta.reasoning_content });
          }
        }
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        throw new DOMException("Chat stopped by user", "AbortError");
      }
      throw err;
    }

    return { content, reasoning: reasoning || undefined, chatId };
  }
}

export function getApiUrl(): string {
  return vscode.workspace.getConfiguration("thoma").get<string>("apiUrl") ?? "http://localhost:8080";
}

export function getDefaultProfile(): string {
  return (
    vscode.workspace.getConfiguration("thoma").get<string>("defaultProfile") ?? "thoma-reason"
  );
}
