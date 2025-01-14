(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ChessCoachExtensionEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class OffscreenEngine {
    constructor(options) {
      this.depth = (options && options.depth) || 14;
      this.sessionId = createSessionId();
    }

    async send(type, payload) {
      const response = await chrome.runtime.sendMessage({
        target: "background-engine",
        type,
        sessionId: this.sessionId,
        depth: this.depth,
        ...(payload || {})
      });

      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Engine did not respond.");
      }

      return response.payload;
    }

    async init() {
      await this.send("engine-init");
    }

    async evaluate(fen, options) {
      return this.send("engine-evaluate", {
        fen,
        options: {
          depth: (options && options.depth) || this.depth,
          multiPv: (options && options.multiPv) || 1
        }
      });
    }

    terminate() {
      return chrome.runtime
        .sendMessage({
          target: "background-engine",
          sessionId: this.sessionId,
          type: "engine-terminate"
        })
        .catch(() => {});
    }
  }

  function createSessionId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  return { OffscreenEngine };
});
