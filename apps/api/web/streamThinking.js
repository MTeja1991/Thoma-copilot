(function (root) {
  const THINK_OPEN = "<" + "think" + ">";
  const THINK_CLOSE = "</" + "think" + ">";
  const OPEN_CLOSE = [
    ["<think>", "</think>"],
    [THINK_OPEN, THINK_CLOSE],
    ["<|think|>", "<|/think|>"],
    ["[THINK]", "[/THINK]"],
  ];

  function partialSuffixLen(text) {
    const lower = text.toLowerCase();
    let best = 0;
    for (const [marker] of OPEN_CLOSE) {
      const mlower = marker.toLowerCase();
      for (let i = 1; i < mlower.length; i++) {
        if (lower.endsWith(mlower.slice(0, i))) {
          best = Math.max(best, i);
        }
      }
    }
    return best;
  }

  class StreamThinkingFilter {
    constructor() {
      this._pending = "";
      this._open = null;
    }

    get inThinking() {
      return this._open !== null;
    }

    feed(chunk) {
      if (!chunk) {
        return ["", ""];
      }
      this._pending += chunk;
      const reasoningOut = [];
      const contentOut = [];

      while (this._pending) {
        if (this._open === null) {
          let earliest = -1;
          let marker = "";
          for (const [openTag] of OPEN_CLOSE) {
            const idx = this._pending.toLowerCase().indexOf(openTag.toLowerCase());
            if (idx !== -1 && (earliest === -1 || idx < earliest)) {
              earliest = idx;
              marker = openTag;
            }
          }
          if (earliest === -1) {
            const hold = partialSuffixLen(this._pending);
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
          for (const [openTag, closeTag] of OPEN_CLOSE) {
            if (openTag === this._open) {
              close = closeTag;
              break;
            }
          }
          const idx = this._pending.toLowerCase().indexOf(close.toLowerCase());
          if (idx === -1) {
            const hold = Math.min(this._pending.length, Math.max(0, close.length - 1));
            const emit = hold ? this._pending.slice(0, -hold) : this._pending;
            if (emit) {
              reasoningOut.push(emit);
            }
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

  root.ThomaStreamThinking = { StreamThinkingFilter };
})(typeof window !== "undefined" ? window : globalThis);
