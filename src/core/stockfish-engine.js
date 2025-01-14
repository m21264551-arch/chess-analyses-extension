(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./grading.js"));
  } else {
    const api = factory(root.ChessCoachGrading);
    root.ChessCoachStockfish = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (grading) {
  const DEFAULT_TIMEOUT_MS = 30000;

  class StockfishEngine {
    constructor(options) {
      this.scriptUrl = options.scriptUrl;
      this.wasmUrl = options.wasmUrl;
      this.depth = options.depth || 14;
      this.worker = null;
      this.waiters = [];
      this.activeEvaluation = null;
      this.initPromise = null;
      this.busy = false;
      this.ready = false;
    }

    async init() {
      if (this.ready) return;
      if (this.initPromise) return this.initPromise;

      this.initPromise = (async () => {
        const url = `${this.scriptUrl}#${encodeURIComponent(this.wasmUrl)}`;
        this.worker = new Worker(url);
        this.worker.onmessage = (event) => this.handleLine(String(event.data || ""));
        this.worker.onerror = (event) => this.rejectAll(new Error(event.message || "Stockfish worker failed."));

        const uciReady = this.waitForLine((line) => line === "uciok", DEFAULT_TIMEOUT_MS);
        this.post("uci");
        await uciReady;
        await this.waitUntilReady();
        this.ready = true;
      })().finally(() => {
        this.initPromise = null;
      });

      return this.initPromise;
    }

    post(command) {
      if (!this.worker) {
        throw new Error("Stockfish is not running.");
      }
      this.worker.postMessage(command);
    }

    handleLine(line) {
      if (this.activeEvaluation && line.startsWith("info ")) {
        const parsed = grading.parseUciInfo(line);
        if (parsed) {
          this.activeEvaluation.lines.set(parsed.multipv || 1, parsed);
        }
      }

      const remaining = [];
      for (const waiter of this.waiters) {
        try {
          if (waiter.predicate(line)) {
            clearTimeout(waiter.timer);
            waiter.resolve(line);
          } else {
            remaining.push(waiter);
          }
        } catch (error) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
      }
      this.waiters = remaining;
    }

    waitForLine(predicate, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
          reject(new Error("Timed out waiting for Stockfish."));
        }, timeoutMs || DEFAULT_TIMEOUT_MS);

        this.waiters.push({ predicate, resolve, reject, timer });
      });
    }

    async waitUntilReady() {
      const ready = this.waitForLine((line) => line === "readyok", DEFAULT_TIMEOUT_MS);
      this.post("isready");
      await ready;
    }

    async evaluate(fen, options) {
      if (this.busy) {
        throw new Error("Stockfish evaluation already running.");
      }

      this.busy = true;
      try {
        await this.init();
        const multiPv = Math.max(1, Math.min(5, (options && options.multiPv) || 1));
        const depth = (options && options.depth) || this.depth;

        this.post(`setoption name MultiPV value ${multiPv}`);
        await this.waitUntilReady();
        this.activeEvaluation = { lines: new Map() };
        const bestMovePromise = this.waitForLine((line) => line.startsWith("bestmove "), DEFAULT_TIMEOUT_MS);

        this.post(`position fen ${fen}`);
        this.post(`go depth ${depth}`);

        let bestMoveLine;
        let lines;
        try {
          bestMoveLine = await bestMovePromise;
          lines = Array.from(this.activeEvaluation.lines.entries())
            .sort((a, b) => a[0] - b[0])
            .map((entry) => entry[1]);
        } finally {
          this.activeEvaluation = null;
        }

        const bestMove = bestMoveLine.split(/\s+/)[1] || (lines[0] && lines[0].pv[0]) || "";
        return { bestMove, lines };
      } finally {
        this.busy = false;
      }
    }

    terminate() {
      if (this.worker) {
        try {
          this.post("quit");
        } catch (_error) {
          // The worker may already be gone.
        }
        this.worker.terminate();
      }
      this.worker = null;
      this.ready = false;
      this.activeEvaluation = null;
      this.initPromise = null;
      this.busy = false;
      this.rejectAll(new Error("Analysis stopped."));
    }

    rejectAll(error) {
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.waiters = [];
    }
  }

  return { StockfishEngine };
});
