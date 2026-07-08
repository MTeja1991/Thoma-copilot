(function () {
  const vscode = acquireVsCodeApi();

  // Inlined stream thinking filter (avoids external script load/CSP issues)
  class StreamThinkingFilter {
    constructor() {
      this._pending = "";
      this._open = null;
      this._openClose = [
        ["<think>", "</think>"],
        ["<" + "think" + ">", "</" + "think" + ">"],
        ["<|think|>", "<|/think|>"],
        ["[THINK]", "[/THINK]"],
      ];
    }
    get inThinking() {
      return this._open !== null;
    }
    _partialSuffixLen(text) {
      const lower = text.toLowerCase();
      let best = 0;
      for (const [marker] of this._openClose) {
        const mlower = marker.toLowerCase();
        for (let i = 1; i < mlower.length; i++) {
          if (lower.endsWith(mlower.slice(0, i))) best = Math.max(best, i);
        }
      }
      return best;
    }
    feed(chunk) {
      if (!chunk) return ["", ""];
      this._pending += chunk;
      const reasoningOut = [];
      const contentOut = [];
      while (this._pending) {
        if (this._open === null) {
          let earliest = -1;
          let marker = "";
          for (const [openTag] of this._openClose) {
            const idx = this._pending.toLowerCase().indexOf(openTag.toLowerCase());
            if (idx !== -1 && (earliest === -1 || idx < earliest)) {
              earliest = idx;
              marker = openTag;
            }
          }
          if (earliest === -1) {
            const hold = this._partialSuffixLen(this._pending);
            if (hold) {
              contentOut.push(this._pending.slice(0, -hold));
              this._pending = this._pending.slice(-hold);
            } else {
              contentOut.push(this._pending);
              this._pending = "";
            }
            break;
          }
          contentOut.push(this._pending.slice(0, earliest));
          this._pending = this._pending.slice(earliest + marker.length);
          this._open = marker;
        } else {
          let close = "";
          for (const [openTag, closeTag] of this._openClose) {
            if (openTag === this._open) {
              close = closeTag;
              break;
            }
          }
          const idx = this._pending.toLowerCase().indexOf(close.toLowerCase());
          if (idx === -1) {
            const hold = Math.min(this._pending.length, Math.max(0, close.length - 1));
            const emit = hold ? this._pending.slice(0, -hold) : this._pending;
            if (emit) reasoningOut.push(emit);
            this._pending = hold ? this._pending.slice(-hold) : "";
            break;
          }
          reasoningOut.push(this._pending.slice(0, idx));
          this._pending = this._pending.slice(idx + close.length).replace(/^\s+/, "");
          this._open = null;
        }
      }
      return [reasoningOut.join(""), contentOut.join("")];
    }
    flush() {
      if (this._open) {
        const reasoning = this._pending;
        this._pending = "";
        this._open = null;
        return [reasoning, ""];
      }
      const content = this._pending;
      this._pending = "";
      return ["", content];
    }
  }

  const messagesEl = document.getElementById("messages");
  const profileEl = document.getElementById("profile");
  const promptEl = document.getElementById("prompt");
  const includeFileEl = document.getElementById("includeFile");
  const includeWorkspaceEl = document.getElementById("includeWorkspace");
  const statusEl = document.getElementById("status");
  const backendEl = document.getElementById("backend");
  const workspaceEl = document.getElementById("workspace");
  const chatBarEl = document.getElementById("chatBar");
  const chatBarTitleEl = document.getElementById("chatBarTitle");
  const emptyChatEl = document.getElementById("emptyChat");
  const chatListEl = document.getElementById("chatList");
  const historyPanelEl = document.getElementById("historyPanel");
  const contextChipsEl = document.getElementById("contextChips");

  let activeChatId = "";
  let streamState = null;

  function setStreamingUI(active) {
    const stopBtn = document.getElementById("stopBtn");
    const sendBtn = document.getElementById("send");
    if (stopBtn) {
      stopBtn.classList.toggle("hidden", !active);
    }
    if (sendBtn) {
      sendBtn.disabled = active;
    }
  }

  function stopStream() {
    if (!streamState) {
      setStreamingUI(false);
      return;
    }
    const [tailReasoning] = streamState.streamFilter.flush();
    if (tailReasoning) {
      streamState.fullReasoning += tailReasoning;
    }
    const parsed = extractThinking(streamState.fullText);
    const displayText = streamState.visibleText || parsed.content;
    const displayThinking = [streamState.fullReasoning, parsed.thinking].filter(Boolean).join("\n\n");
    if (displayThinking) {
      finalizeThinkingPanel(streamState, displayThinking);
    }
    if (displayText) {
      setMarkdownBody(streamState.body, displayText);
      const actions = document.createElement("div");
      actions.className = "msg-actions";
      const insertBtn = document.createElement("button");
      insertBtn.className = "secondary";
      insertBtn.textContent = "Insert at cursor";
      insertBtn.onclick = () =>
        vscode.postMessage({ type: "applyCode", code: extractFirstBlock(displayText) });
      actions.appendChild(insertBtn);
      streamState.wrap.appendChild(actions);
    }
    streamState = null;
    setStreamingUI(false);
    scrollToBottom();
  }

  const FENCE = "```";
  const THINK_PATTERNS = [
    /<think>([\s\S]*?)<\/redacted_thinking>\s*/gi,
    new RegExp("<" + "think" + ">([\\s\\S]*?)</" + "think" + ">\\s*", "gi"),
    /<\|think\|>([\s\S]*?)<\|\/think\|>\s*/gi,
    /\[THINK\]([\s\S]*?)\[\/THINK\]\s*/gi,
  ];

  function extractThinking(text) {
    let thinking = "";
    let content = text || "";
    for (const re of THINK_PATTERNS) {
      content = content.replace(re, (_, block) => {
        thinking += (thinking ? "\n\n" : "") + block.trim();
        return "";
      });
    }
    return { thinking: thinking.trim(), content: content.trim() };
  }

  function createThinkingShell(streaming) {
    const details = document.createElement("details");
    details.className = "thinking-wrap" + (streaming ? " streaming" : "");
    const summary = document.createElement("summary");
    const spinner = document.createElement("span");
    spinner.className = "thinking-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "thinking-label";
    label.textContent = "Thinking";
    summary.appendChild(spinner);
    summary.appendChild(label);
    const body = document.createElement("div");
    body.className = "thinking-body";
    details.appendChild(summary);
    details.appendChild(body);
    return details;
  }

  function createThinkingDetails(thinkingText) {
    if (!thinkingText) return null;
    const details = createThinkingShell(false);
    details.querySelector(".thinking-body").textContent = thinkingText;
    return details;
  }

  function ensureStreamingThinking(wrap, state) {
    if (!state.thinkingEl) {
      state.thinkingEl = createThinkingShell(true);
      wrap.insertBefore(state.thinkingEl, state.body);
    } else if (!state.thinkingEl.classList.contains("streaming")) {
      state.thinkingEl.classList.add("streaming");
      state.thinkingEl.querySelector(".thinking-body").textContent = "";
    }
  }

  function finalizeThinkingPanel(state, thinkingText) {
    if (!thinkingText) {
      if (state.thinkingEl) {
        state.thinkingEl.remove();
        state.thinkingEl = null;
      }
      state.thinkingText = "";
      return;
    }
    if (!state.thinkingEl) {
      state.thinkingEl = createThinkingShell(false);
      state.wrap.insertBefore(state.thinkingEl, state.body);
    } else {
      state.thinkingEl.classList.remove("streaming");
    }
    state.thinkingEl.querySelector(".thinking-body").textContent = thinkingText;
    state.thinkingText = thinkingText;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderMarkdown(text) {
    if (!text) {
      return "";
    }
    if (typeof marked !== "undefined") {
      return marked.parse(text, { breaks: true, gfm: true });
    }
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function setMarkdownBody(el, text) {
    el.className = "md-body";
    el.innerHTML = renderMarkdown(text);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
        const last = messagesEl.lastElementChild;
        if (last) {
          last.scrollIntoView({ block: "end", behavior: "instant" });
        }
      });
    });
  }

  function clearMessages() {
    messagesEl.innerHTML = "";
  }

  function updateChatBar(title, chatId) {
    activeChatId = chatId || "";
    if (chatId && title) {
      chatBarEl.classList.remove("hidden");
      emptyChatEl.classList.add("hidden");
      chatBarTitleEl.textContent = title;
    } else {
      chatBarEl.classList.add("hidden");
      chatBarTitleEl.textContent = "";
      if (!messagesEl.children.length) {
        emptyChatEl.classList.remove("hidden");
      }
    }
  }

  function showEmptyState() {
    clearMessages();
    emptyChatEl.classList.remove("hidden");
    updateChatBar("", "");
  }

  function addUser(text) {
    emptyChatEl.classList.add("hidden");
    const div = document.createElement("div");
    div.className = "msg user";
    div.textContent = text;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function extractFirstBlock(text) {
    const m = text.match(new RegExp(FENCE + "[\\w]*\\n([\\s\\S]*?)" + FENCE));
    return m ? m[1].trim() : text;
  }

  function addAssistant(text, reasoning) {
    const parsed = extractThinking(text);
    const displayText = parsed.content;
    const displayThinking = [reasoning, parsed.thinking].filter(Boolean).join("\n\n");

    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    const thinkingEl = createThinkingDetails(displayThinking);
    if (thinkingEl) wrap.appendChild(thinkingEl);
    const body = document.createElement("div");
    setMarkdownBody(body, displayText);
    wrap.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const insertBtn = document.createElement("button");
    insertBtn.className = "secondary";
    insertBtn.textContent = "Insert at cursor";
    insertBtn.onclick = () =>
      vscode.postMessage({ type: "applyCode", code: extractFirstBlock(displayText) });

    const runBtn = document.createElement("button");
    runBtn.className = "secondary";
    runBtn.textContent = "Run in terminal";
    runBtn.onclick = () =>
      vscode.postMessage({ type: "runCode", code: extractFirstBlock(displayText) });

    actions.appendChild(insertBtn);
    actions.appendChild(runBtn);
    wrap.appendChild(actions);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function beginStream() {
    emptyChatEl.classList.add("hidden");
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    const body = document.createElement("div");
    wrap.appendChild(body);
    messagesEl.appendChild(wrap);
    streamState = {
      wrap,
      body,
      thinkingEl: null,
      thinkingText: "",
      fullText: "",
      fullReasoning: "",
      visibleText: "",
      streamFilter: new StreamThinkingFilter(),
    };
    setStreamingUI(true);
    scrollToBottom();
  }

  function appendStreamDelta(msg) {
    if (!streamState) {
      beginStream();
    }
    if (msg.reasoning) {
      streamState.fullReasoning += msg.reasoning;
      ensureStreamingThinking(streamState.wrap, streamState);
    }
    if (msg.delta) {
      streamState.fullText += msg.delta;
      const [reasonFromContent, visible] = streamState.streamFilter.feed(msg.delta);
      if (reasonFromContent) {
        streamState.fullReasoning += reasonFromContent;
        ensureStreamingThinking(streamState.wrap, streamState);
      }
      if (streamState.streamFilter.inThinking || streamState.fullReasoning) {
        ensureStreamingThinking(streamState.wrap, streamState);
      }
      if (visible) {
        streamState.visibleText += visible;
        setMarkdownBody(streamState.body, streamState.visibleText);
      }
    }
    scrollToBottom();
  }

  function endStream(text, reasoning, messageId) {
    if (!streamState) {
      addAssistant(text, reasoning);
      return;
    }
    const [tailReasoning] = streamState.streamFilter.flush();
    if (tailReasoning) {
      streamState.fullReasoning += tailReasoning;
    }
    const parsed = extractThinking(text || streamState.fullText);
    const displayText = parsed.content || streamState.visibleText;
    const displayThinking = [reasoning, streamState.fullReasoning, parsed.thinking]
      .filter(Boolean)
      .join("\n\n");
    finalizeThinkingPanel(streamState, displayThinking);
    setMarkdownBody(streamState.body, displayText);

    if (messageId) {
      streamState.wrap.dataset.messageId = messageId;
    }

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const insertBtn = document.createElement("button");
    insertBtn.className = "secondary";
    insertBtn.textContent = "Insert at cursor";
    insertBtn.onclick = () =>
      vscode.postMessage({ type: "applyCode", code: extractFirstBlock(displayText) });

    const runBtn = document.createElement("button");
    runBtn.className = "secondary";
    runBtn.textContent = "Run in terminal";
    runBtn.onclick = () =>
      vscode.postMessage({ type: "runCode", code: extractFirstBlock(displayText) });

    actions.appendChild(insertBtn);
    actions.appendChild(runBtn);
    streamState.wrap.appendChild(actions);
    streamState = null;
    setStreamingUI(false);
    scrollToBottom();
  }
    if (!messageId || !edits || !edits.length) {
      return;
    }
    const wrap = messagesEl.querySelector('[data-message-id="' + messageId + '"]');
    if (!wrap) {
      return;
    }
    let panel = wrap.querySelector(".file-edits");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "file-edits";
      const actions = wrap.querySelector(".msg-actions");
      if (actions) {
        wrap.insertBefore(panel, actions);
      } else {
        wrap.appendChild(panel);
      }
    }
    panel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "file-edits-header";
    header.textContent = "Proposed changes";
    panel.appendChild(header);

    const pending = edits.filter((e) => e.status === "pending");
    if (pending.length > 1) {
      const bulk = document.createElement("div");
      bulk.className = "file-edits-bulk";
      const keepAll = document.createElement("button");
      keepAll.className = "secondary";
      keepAll.textContent = "Keep all";
      keepAll.onclick = () =>
        vscode.postMessage({ type: "acceptAllFileEdits", messageId });
      const undoAll = document.createElement("button");
      undoAll.className = "secondary";
      undoAll.textContent = "Undo all";
      undoAll.onclick = () =>
        vscode.postMessage({ type: "rejectAllFileEdits", messageId });
      bulk.appendChild(keepAll);
      bulk.appendChild(undoAll);
      panel.appendChild(bulk);
    }

    edits.forEach((edit) => {
      const row = document.createElement("div");
      row.className = "file-edit-row status-" + edit.status;

      const info = document.createElement("div");
      info.className = "file-edit-info";
      const badge = document.createElement("span");
      badge.className = "file-edit-badge " + (edit.isNew ? "new" : "mod");
      badge.textContent = edit.isNew ? "NEW" : "MOD";
      const pathEl = document.createElement("span");
      pathEl.className = "file-edit-path";
      pathEl.textContent = edit.path;
      pathEl.title = edit.path;
      info.appendChild(badge);
      info.appendChild(pathEl);

      const btns = document.createElement("div");
      btns.className = "file-edit-actions";

      if (edit.status === "pending") {
        const review = document.createElement("button");
        review.className = "secondary";
        review.textContent = "Review";
        review.onclick = () =>
          vscode.postMessage({ type: "reviewFileEdit", messageId, editId: edit.id });
        const keep = document.createElement("button");
        keep.textContent = "Keep";
        keep.onclick = () =>
          vscode.postMessage({ type: "acceptFileEdit", messageId, editId: edit.id });
        const undo = document.createElement("button");
        undo.className = "secondary";
        undo.textContent = "Undo";
        undo.onclick = () =>
          vscode.postMessage({ type: "rejectFileEdit", messageId, editId: edit.id });
        btns.appendChild(review);
        btns.appendChild(keep);
        btns.appendChild(undo);
      } else if (edit.status === "accepted") {
        const status = document.createElement("span");
        status.className = "file-edit-status kept";
        status.textContent = "Kept";
        const undo = document.createElement("button");
        undo.className = "secondary";
        undo.textContent = "Undo";
        undo.onclick = () =>
          vscode.postMessage({ type: "rejectFileEdit", messageId, editId: edit.id });
        btns.appendChild(status);
        btns.appendChild(undo);
      } else {
        const status = document.createElement("span");
        status.className = "file-edit-status skipped";
        status.textContent = "Skipped";
        btns.appendChild(status);
      }

      row.appendChild(info);
      row.appendChild(btns);
      panel.appendChild(row);
    });
    scrollToBottom();
  }

  function showError(err) {
    const div = document.createElement("div");
    div.className = "error";
    div.textContent = err;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function renderContextFiles(files) {
    contextChipsEl.innerHTML = "";
    (files || []).forEach((key) => {
      const chip = document.createElement("span");
      const isFolder = key.startsWith("folder:");
      chip.className = "chip " + (isFolder ? "folder" : "file");
      const label = document.createElement("span");
      label.textContent = isFolder ? key.slice(7) : key;
      label.title = key;
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "Remove from context";
      remove.onclick = () =>
        vscode.postMessage({ type: "removeContextFile", contextKey: key });
      chip.appendChild(label);
      chip.appendChild(remove);
      contextChipsEl.appendChild(chip);
    });
  }

  function fillProfiles(models, active) {
    profileEl.innerHTML = "";
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.id + (m.active ? " *" : "");
      if (m.id === active) {
        opt.selected = true;
      }
      profileEl.appendChild(opt);
    });
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  function renderChatList(chats, currentId) {
    activeChatId = currentId || "";
    chatListEl.innerHTML = "";
    if (!chats || !chats.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.style.fontSize = "11px";
      empty.style.color = "var(--thoma-muted)";
      empty.textContent = "No chats for this project yet.";
      chatListEl.appendChild(empty);
      return;
    }
    chats.forEach((c) => {
      const row = document.createElement("div");
      row.className = "chat-item" + (c.id === activeChatId ? " active" : "");
      row.title = c.title;

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = c.title || "Untitled";

      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = (c.message_count || 0) + " · " + formatWhen(c.updated_at);

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.title = "Delete chat";
      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Delete "' + (c.title || "chat") + '"?')) {
          vscode.postMessage({ type: "deleteChat", chatId: c.id });
        }
      };

      row.onclick = () => {
        if (c.id !== activeChatId) {
          vscode.postMessage({ type: "openChat", chatId: c.id });
        }
      };

      row.appendChild(title);
      row.appendChild(meta);
      row.appendChild(del);
      chatListEl.appendChild(row);
    });
  }

  profileEl.addEventListener("change", () => {
    vscode.postMessage({ type: "switchProfile", profile: profileEl.value });
  });

  document.getElementById("refresh").onclick = () => {
    vscode.postMessage({ type: "refreshModels" });
  };

  document.getElementById("pickFileBtn").onclick = () => {
    vscode.postMessage({ type: "pickFile" });
  };
  document.getElementById("pickFolderBtn").onclick = () => {
    vscode.postMessage({ type: "pickFolder" });
  };

  document.getElementById("toggleHistory").onclick = () => {
    historyPanelEl.classList.toggle("collapsed");
  };

  document.getElementById("newChat").onclick = () => {
    showEmptyState();
    vscode.postMessage({ type: "newChat" });
  };

  document.getElementById("closeChatBtn").onclick = () => {
    showEmptyState();
    vscode.postMessage({ type: "closeChat" });
  };

  document.getElementById("deleteCurrentChatBtn").onclick = () => {
    if (!activeChatId) return;
    const title = chatBarTitleEl.textContent || "this chat";
    if (confirm('Delete "' + title + '"?')) {
      vscode.postMessage({ type: "deleteChat", chatId: activeChatId });
    }
  };

  function send() {
    const text = promptEl.value.trim();
    if (!text) {
      return;
    }
    vscode.postMessage({
      type: "sendChat",
      text,
      includeFile: includeFileEl.checked,
      includeWorkspace: includeWorkspaceEl.checked,
    });
    promptEl.value = "";
  }

  document.getElementById("send").onclick = send;
  document.getElementById("stopBtn").onclick = () => {
    vscode.postMessage({ type: "stopChat" });
    stopStream();
  };
  document.getElementById("planBtn").onclick = () => {
    const text = promptEl.value.trim();
    vscode.postMessage({ type: "planProject", text: text || undefined });
    promptEl.value = "";
  };

  promptEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      send();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "health":
        backendEl.textContent =
          (msg.backend ? msg.backend + " · " : "") + (msg.activeProfile || "");
        break;
      case "workspaceInfo":
        workspaceEl.textContent = msg.rootName
          ? " · " + msg.rootName + " (" + (msg.fileCount || 0) + " files)"
          : "";
        break;
      case "contextFiles":
        renderContextFiles(msg.files || []);
        break;
      case "chatLoaded":
        updateChatBar(msg.chatTitle || "", msg.chatId || "");
        break;
      case "chatList":
        renderChatList(msg.chats || [], msg.chatId);
        if (!msg.chatId) {
          if (!messagesEl.children.length) {
            emptyChatEl.classList.remove("hidden");
          }
        }
        break;
      case "clearMessages":
        clearMessages();
        if (!activeChatId) {
          emptyChatEl.classList.remove("hidden");
        }
        break;
      case "models":
        fillProfiles(msg.models || [], msg.activeProfile);
        break;
      case "userMessage":
        addUser(msg.text);
        break;
      case "streamStart":
        beginStream();
        break;
      case "streamStopped":
        stopStream();
        break;
      case "streamDelta":
        appendStreamDelta(msg);
        break;
      case "streamEnd":
        endStream(msg.text, msg.reasoning, msg.messageId);
        break;
      case "fileEdits":
        renderFileEdits(msg.messageId, msg.fileEdits);
        break;
      case "assistantMessage":
        addAssistant(msg.text, msg.reasoning);
        break;
      case "error":
        showError(msg.error);
        break;
      case "status":
        statusEl.textContent = msg.status || "";
        break;
      case "profileSwitched":
        statusEl.textContent = "Switched to " + msg.activeProfile;
        setTimeout(() => {
          statusEl.textContent = "";
        }, 2000);
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
