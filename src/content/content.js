(function () {
  const EXTENSION_ID = "chess-coach-panel";
  const BOARD_OVERLAY_ID = "chess-coach-board-overlay";
  const PANEL_DISMISSED_KEY = "chess-coach-panel-dismissed";
  const DEPTH = 14;
  const MULTI_PV = 3;
  const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const CACHE_PREFIX = "analysis:v5:";
  const MAX_CACHE_ENTRIES = 20;
  const MAX_CACHE_ENTRY_CHARS = 1000000;
  const GRADE_PRESENTATION = {
    Book: { glyph: "B", color: "#627386" },
    Brilliant: { glyph: "!!", color: "#18a7d5" },
    Best: { glyph: "★", color: "#1e8e3e" },
    Great: { glyph: "!", color: "#6cbf2d" },
    Excellent: { glyph: "EX", color: "#0f8f86" },
    Good: { glyph: "+", color: "#a8d869" },
    Inaccuracy: { glyph: "?!", color: "#e5a91f" },
    Mistake: { glyph: "?", color: "#e56f2c" },
    Miss: { glyph: "×", color: "#8b5cf6" },
    Blunder: { glyph: "??", color: "#d9334f" }
  };
  const GRADE_LABELS = Object.keys(GRADE_PRESENTATION);
  const PIECE_CLASS_TYPES = {
    pawn: "p",
    knight: "n",
    bishop: "b",
    rook: "r",
    queen: "q",
    king: "k"
  };
  const PIECE_CLASS_NAMES = Object.keys(PIECE_CLASS_TYPES);
  const PIECE_SYMBOLS = {
    wp: "♙",
    wn: "♘",
    wb: "♗",
    wr: "♖",
    wq: "♕",
    wk: "♔",
    bp: "♟",
    bn: "♞",
    bb: "♝",
    br: "♜",
    bq: "♛",
    bk: "♚"
  };

  function isPanelDismissed() {
    try {
      return sessionStorage.getItem(PANEL_DISMISSED_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function rememberPanelDismissed() {
    try {
      sessionStorage.setItem(PANEL_DISMISSED_KEY, "1");
    } catch (_error) {
      // Storage can be unavailable in hardened browsing modes; closing should still work.
    }
  }

  if (window.top !== window || document.getElementById(EXTENSION_ID) || isPanelDismissed()) {
    return;
  }

  if (typeof globalThis.ChessCoachClosePanel === "function") {
    try {
      globalThis.ChessCoachClosePanel({ rememberDismissal: false });
    } catch (_error) {
      // A stale instance should not block opening a fresh panel.
    }
  }

  const state = {
    run: null,
    source: null,
    result: null,
    partialMoves: [],
    gameKey: "",
    currentPly: 0,
    manualSelectionUntil: 0,
    branchExplorer: null,
    observedFen: "",
    freeMoveAnalysis: null,
    pendingFreeMoveKey: "",
    disposed: false
  };

  const host = document.createElement("div");
  host.id = EXTENSION_ID;
  const shadow = host.attachShadow({ mode: "open" });
  let monitorId = null;

  function placeHost() {
    if (!host.isConnected) {
      host.style.position = "fixed";
      host.style.top = "72px";
      host.style.right = "16px";
      host.style.zIndex = "2147483647";
      host.style.width = "min(384px, calc(100vw - 20px))";
      document.documentElement.appendChild(host);
    }
  }

  function setHtml() {
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: light;
          contain: layout style paint;
        }
        .panel {
          box-sizing: border-box;
          width: 384px;
          max-height: min(760px, calc(100vh - 96px));
          overflow: hidden;
          border: 1px solid rgba(15, 23, 42, 0.14);
          border-radius: 8px;
          background: #f7f9fa;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22), 0 1px 2px rgba(15, 23, 42, 0.08);
          color: #17212a;
          font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: #172832;
          color: #f7fbfc;
        }
        .title {
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0;
        }
        .header-actions {
          display: flex;
          align-items: center;
          flex: 0 0 auto;
          gap: 8px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid rgba(247, 251, 252, 0.18);
          background: rgba(255, 255, 255, 0.08);
          color: #eaf8ee;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
        }
        .badge::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #7ddc70;
          box-shadow: 0 0 0 3px rgba(125, 220, 112, 0.16);
        }
        .body {
          padding: 14px;
          overflow: auto;
          max-height: calc(min(760px, 100vh - 96px) - 48px);
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        }
        .actions button {
          flex: 1 1 0;
        }
        button {
          appearance: none;
          border: 1px solid #b6c4c8;
          border-radius: 8px;
          background: #ffffff;
          color: #172026;
          cursor: pointer;
          font: inherit;
          font-weight: 750;
          min-height: 34px;
          padding: 7px 11px;
          transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
        }
        button:hover:not(:disabled) {
          box-shadow: 0 2px 8px rgba(20, 45, 48, 0.10);
        }
        button:not(.primary):hover:not(:disabled) {
          border-color: #7e969d;
        }
        button:active:not(:disabled) {
          transform: translateY(1px);
        }
        button:focus-visible {
          outline: 2px solid rgba(24, 167, 213, 0.42);
          outline-offset: 2px;
        }
        button.icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          min-height: 30px;
          padding: 0;
          border-radius: 7px;
          border-color: rgba(246, 251, 251, 0.42);
          background: rgba(255, 255, 255, 0.12);
          color: #f6fbfb;
        }
        button.icon-button svg {
          width: 16px;
          height: 16px;
          stroke-width: 2.2;
        }
        button.icon-button:hover,
        button.icon-button:focus-visible {
          background: rgba(255, 255, 255, 0.22);
        }
        button.primary {
          background: linear-gradient(180deg, #179782, #12776f);
          border-color: #137c73;
          color: #ffffff;
          box-shadow: 0 6px 14px rgba(18, 119, 111, 0.24);
        }
        button:disabled {
          cursor: default;
          opacity: 0.55;
        }
        .status {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          min-height: 20px;
          margin-bottom: 10px;
          border: 1px solid #dfe7e9;
          border-radius: 8px;
          background: #ffffff;
          color: #405058;
          padding: 7px 9px;
        }
        .status::before {
          content: "";
          flex: 0 0 auto;
          width: 7px;
          height: 7px;
          margin-top: 6px;
          border-radius: 999px;
          background: #179782;
        }
        .progress {
          height: 5px;
          overflow: hidden;
          border-radius: 999px;
          background: #e1e9eb;
          margin-bottom: 12px;
        }
        .progress > div {
          width: 0%;
          height: 100%;
          background: linear-gradient(90deg, #167a72, #d6f26b);
          transition: width 180ms ease;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
          margin: 8px 0 12px;
        }
        .summary > span {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          border: 1px solid #dce5e8;
          border-radius: 8px;
          background: #ffffff;
          padding: 6px 8px;
          white-space: nowrap;
          box-shadow: 0 1px 2px rgba(20, 45, 48, 0.04);
        }
        textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 120px;
          resize: vertical;
          border: 1px solid #b9c7ce;
          border-radius: 8px;
          padding: 8px;
          font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .paste {
          display: none;
          margin-top: 8px;
        }
        .paste.visible {
          display: block;
        }
        table {
          width: 100%;
          table-layout: fixed;
          border-collapse: separate;
          border-spacing: 0;
          background: #ffffff;
          border: 1px solid #dce5e8;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(20, 45, 48, 0.05);
        }
        th, td {
          border-bottom: 1px solid #edf1f3;
          padding: 7px 7px;
          text-align: left;
          vertical-align: top;
          overflow-wrap: anywhere;
        }
        th:nth-child(1),
        td:nth-child(1) {
          width: 72px;
        }
        th:nth-child(2),
        td:nth-child(2) {
          width: 112px;
        }
        th {
          background: #eef4f3;
          color: #43515a;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        tr:last-child td {
          border-bottom: 0;
        }
        .move {
          color: #172026;
          font-weight: 800;
        }
        .grade {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 2px 8px 2px 3px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.55);
        }
        .grade-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.56), 0 3px 8px rgba(0,0,0,.14);
          color: #ffffff;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0;
          line-height: 1;
        }
        .summary .grade-icon {
          width: 18px;
          height: 18px;
          font-size: 9px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.5);
        }
        .summary > span > b {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .phase-summary {
          display: none;
          margin: 8px 0 12px;
          border: 1px solid #dce5e8;
          border-radius: 8px;
          background: #ffffff;
          padding: 9px 10px;
          box-shadow: 0 1px 2px rgba(20, 45, 48, 0.05);
        }
        .phase-summary.visible {
          display: block;
        }
        .phase-title {
          color: #43515a;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .phase-line {
          color: #172026;
          font-size: 12px;
          line-height: 1.4;
          margin-top: 3px;
        }
        .coach {
          display: none;
          margin: 8px 0 12px;
          border: 1px solid #cfe0db;
          border-radius: 8px;
          background: #ffffff;
          padding: 10px;
          box-shadow: 0 10px 24px rgba(20, 45, 48, 0.10);
        }
        .coach.visible {
          display: block;
        }
        .coach-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          color: #137c73;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        .coach-move {
          max-width: 210px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #172026;
          text-transform: none;
        }
        .coach-text {
          color: #172026;
          font-size: 13px;
          line-height: 1.45;
          font-weight: 650;
        }
        .coach-branches {
          margin-top: 10px;
          border-top: 1px solid rgba(20, 45, 48, 0.10);
          padding-top: 8px;
        }
        .branch-title {
          margin-bottom: 6px;
          color: #43515a;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        .branch-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 5px 7px;
          padding: 7px 7px;
          border: 1px solid transparent;
          border-radius: 8px;
          background: #f8fbfa;
          margin-top: 6px;
        }
        .branch-row:first-of-type {
          margin-top: 0;
        }
        .branch-move {
          color: #122b2d;
          font-weight: 900;
          white-space: nowrap;
        }
        .branch-note {
          min-width: 0;
          color: #172026;
          font-size: 12px;
        }
        .branch-line {
          grid-column: 2;
          color: #6a7880;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .branch-row {
          cursor: pointer;
          border-radius: 8px;
        }
        .branch-row:hover,
        .branch-row.active {
          border-color: rgba(18, 119, 111, 0.22);
          background: #eefaf6;
        }
        .branch-controls {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
        }
        .branch-controls button {
          min-height: 28px;
          padding: 3px 9px;
          font-size: 13px;
        }
        .branch-step {
          min-width: 0;
          flex: 1 1 auto;
          color: #172026;
          font-size: 12px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .eval-graph {
          display: none;
          margin: 8px 0 12px;
          border: 1px solid #dce5e8;
          border-radius: 8px;
          background: #ffffff;
          padding: 8px;
          box-shadow: 0 1px 2px rgba(20, 45, 48, 0.05);
        }
        .eval-graph.visible {
          display: block;
        }
        .graph-title {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
          color: #43515a;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        .graph-title span:last-child {
          color: #172026;
          font-weight: 800;
          text-transform: none;
        }
        .graph-frame {
          position: relative;
          height: 112px;
        }
        .graph-frame svg {
          display: block;
          width: 100%;
          height: 100%;
        }
        .graph-band-white {
          fill: #eefaf6;
        }
        .graph-band-black {
          fill: #f3f0ff;
        }
        .graph-equal {
          stroke: #8fa1aa;
          stroke-dasharray: 4 4;
          stroke-width: 1.2;
        }
        .graph-line {
          fill: none;
          stroke: #167a72;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-width: 2.5;
        }
        .graph-point {
          cursor: pointer;
          fill: #ffffff;
          stroke: #167a72;
          stroke-width: 2;
        }
        .graph-point:hover,
        .graph-point:focus {
          fill: #dff8ce;
          outline: none;
        }
        .graph-point.current {
          fill: #18323a;
          stroke: #d6f26b;
          stroke-width: 3;
        }
        .graph-label {
          fill: #43515a;
          font: 700 10px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .grade-label {
          min-width: 0;
        }
        .Book { background: #e9edf3; color: #26323f; }
        .Brilliant { background: #d7f4ff; color: #083849; }
        .Best { background: #d9f3da; color: #173d19; }
        .Great { background: #e8f8b8; color: #263300; }
        .Excellent { background: #daf6f0; color: #0c4b46; }
        .Good { background: #e9ffd9; color: #285a15; }
        .Inaccuracy { background: #fff0b8; color: #5c3b00; }
        .Mistake { background: #ffd9bf; color: #6a2100; }
        .Miss { background: #f0e7ff; color: #4d247e; }
        .Blunder { background: #ffd5dd; color: #6b111f; }
        .grade-icon-book { background: #627386; }
        .grade-icon-brilliant { background: #18a7d5; }
        .grade-icon-best { background: #1e8e3e; }
        .grade-icon-great { background: #6cbf2d; }
        .grade-icon-excellent { background: #0f8f86; }
        .grade-icon-good { background: #a8d869; color: #1d390d; }
        .grade-icon-inaccuracy { background: #e5a91f; color: #2f2300; }
        .grade-icon-mistake { background: #e56f2c; }
        .grade-icon-miss { background: #8b5cf6; }
        .grade-icon-blunder { background: #d9334f; }
        tr[data-ply] {
          cursor: pointer;
        }
        tr.current-row td {
          background: #eefaf6;
        }
        .line {
          color: #43515a;
          font-size: 12px;
        }
        .note {
          color: #6a4b00;
          font-size: 12px;
          margin-top: 2px;
        }
        .coach-note {
          color: #172026;
          font-size: 12px;
          margin-top: 4px;
        }
        .coach-note b {
          color: #167a72;
        }
        .footer {
          display: flex;
          justify-content: flex-end;
          margin-top: 10px;
        }
        .support {
          display: none;
          border: 1px solid #b7d8e6;
          border-radius: 7px;
          background: #eef8fb;
          color: #173d49;
          font-size: 12px;
          font-weight: 750;
          padding: 6px 8px;
          text-decoration: none;
        }
        .support.visible {
          display: inline-block;
        }
        @media (max-width: 520px) {
          .panel {
            width: min(384px, calc(100vw - 20px));
          }
          .summary {
            grid-template-columns: 1fr;
          }
          th:nth-child(3),
          td:nth-child(3) {
            max-width: 170px;
          }
          .coach-move {
            max-width: 160px;
          }
        }
      </style>
      <section class="panel" part="panel">
        <div class="header">
          <div class="title">Post-Game Chess Coach</div>
          <div class="header-actions">
            <div class="badge">Local</div>
            <button class="icon-button" data-action="close" type="button" aria-label="Close panel" title="Close panel">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-linecap="round"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="body">
          <div class="actions">
            <button class="primary" data-action="analyze">Analyze</button>
            <button data-action="stop" disabled>Stop</button>
          </div>
          <div class="status" data-role="status">Ready after a completed game.</div>
          <div class="progress"><div data-role="bar"></div></div>
          <div class="summary" data-role="summary"></div>
          <div class="phase-summary" data-role="phase-summary"></div>
          <div class="coach" data-role="coach"></div>
          <div class="eval-graph" data-role="eval-graph"></div>
          <div class="paste" data-role="paste">
            <textarea data-role="pgn" placeholder="[Event &quot;...&quot;]"></textarea>
            <div class="actions" style="margin-top:8px">
              <button class="primary" data-action="analyze-paste">Analyze PGN</button>
            </div>
          </div>
          <div data-role="table"></div>
          <div class="footer">
            <a class="support" data-role="support" href="#" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>
          </div>
        </div>
      </section>
    `;
  }

  function role(name) {
    return shadow.querySelector(`[data-role="${name}"]`);
  }

  function action(name) {
    return shadow.querySelector(`[data-action="${name}"]`);
  }

  function setStatus(text) {
    const status = role("status");
    if (status) status.textContent = text;
  }

  function setProgress(done, total) {
    const bar = role("bar");
    if (!bar) return;
    const width = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = `${width}%`;
  }

  function showPaste(show) {
    const paste = role("paste");
    if (paste) paste.classList.toggle("visible", Boolean(show));
  }

  function setRunning(running) {
    const analyzeButton = action("analyze");
    const pasteButton = action("analyze-paste");
    const stopButton = action("stop");
    if (analyzeButton) analyzeButton.disabled = running;
    if (pasteButton) pasteButton.disabled = running;
    if (stopButton) stopButton.disabled = !running;
  }

  function fetchPgn(url) {
    return chrome.runtime.sendMessage({ type: "fetch-pgn", url });
  }

  async function storageGetAnalysis(key) {
    const value = await chrome.storage.local.get(key);
    const cached = value[key];
    return cached && cached.result ? cached.result : cached;
  }

  async function pruneAnalysisCache(keepKey) {
    const values = await chrome.storage.local.get(null);
    const entries = Object.entries(values)
      .filter(([key]) => key.startsWith("analysis:"))
      .map(([key, value]) => ({
        key,
        savedAt: value && Number.isFinite(value.savedAt) ? value.savedAt : 0
      }))
      .sort((a, b) => b.savedAt - a.savedAt);

    const staleKeys = entries.slice(MAX_CACHE_ENTRIES - 1).map((entry) => entry.key).filter((key) => key !== keepKey);
    if (staleKeys.length) {
      await chrome.storage.local.remove(staleKeys);
    }
  }

  async function storageSetAnalysis(key, result) {
    const payload = {
      savedAt: Date.now(),
      result
    };

    if (JSON.stringify(payload).length > MAX_CACHE_ENTRY_CHARS) {
      return false;
    }

    await pruneAnalysisCache(key);
    await chrome.storage.local.set({ [key]: payload });
    return true;
  }

  function siteAdapter() {
    if (location.hostname === "lichess.org") return window.ChessCoachLichess;
    if (location.hostname.endsWith("chess.com")) return window.ChessCoachChessCom;
    return null;
  }

  function hasAnalysisDependencies() {
    return Boolean(
      window.ChessCoachAnalyzer &&
        window.ChessCoachPgn &&
        window.ChessCoachGrading &&
        window.ChessCoachExtensionEngine &&
        window.ChessCoachVendor &&
        window.ChessCoachVendor.Chess
    );
  }

  function currentGameKey() {
    const adapter = siteAdapter();
    if (!adapter || typeof adapter.parseGameIdFromUrl !== "function") return "";
    const id = adapter.parseGameIdFromUrl(location.href);
    if (!id) return "";
    return `${location.hostname.includes("lichess") ? "lichess" : "chess.com"}:${id}`;
  }

  function shouldResetForNavigation(visibleGameKey) {
    if (!state.source || !state.source.gameId || !state.gameKey || !visibleGameKey) return false;
    return visibleGameKey !== state.gameKey;
  }

  async function resolveSource(pastedPgn) {
    const adapter = siteAdapter();
    if (pastedPgn) {
      return {
        site: location.hostname.includes("lichess") ? "lichess" : "chess.com",
        gameId: "",
        pgn: pastedPgn
      };
    }

    if (!adapter) {
      throw new Error("Open a Chess.com or Lichess game to analyze it.");
    }

    return adapter.getPgn({
      document,
      locationHref: location.href,
      fetchPgn,
      ChessCtor: window.ChessCoachVendor && window.ChessCoachVendor.Chess
    });
  }

  function renderSummary(summary) {
    const container = role("summary");
    if (!container) return;
    container.innerHTML = GRADE_LABELS
      .filter((label) => summary[label])
      .map((label) => `<span><b>${gradeIconHtml(label)} ${escapeHtml(label)}</b><em>${summary[label]}</em></span>`)
      .join("");
  }

  function renderPhaseSummary(phaseSummary) {
    const container = role("phase-summary");
    const lines = phaseSummary && Array.isArray(phaseSummary.lines) ? phaseSummary.lines : [];
    if (!lines.length) {
      container.classList.remove("visible");
      container.innerHTML = "";
      return;
    }

    container.classList.add("visible");
    container.innerHTML = `
      <div class="phase-title">Game summary</div>
      ${lines.map((line) => `<div class="phase-line">${escapeHtml(line)}</div>`).join("")}
    `;
  }

  function summarizeMoves(moves) {
    return moves.reduce((summary, move) => {
      summary[move.grade] = (summary[move.grade] || 0) + 1;
      return summary;
    }, {});
  }

  function selectedCoachMove(moves) {
    if (!moves || !moves.length) return null;
    if (state.currentPly) {
      const current = moves.find((move) => move.ply === state.currentPly);
      if (current) return current;
    }

    const grading = window.ChessCoachGrading;
    return moves.reduce((worst, move) => {
      const worstValue = grading.gradeSortValue(worst.grade);
      const moveValue = grading.gradeSortValue(move.grade);
      return moveValue > worstValue ? move : worst;
    }, moves[0]);
  }

  function renderCoach(moves) {
    const container = role("coach");
    const move = state.freeMoveAnalysis || selectedCoachMove(moves);
    if (!move || !move.coachNote) {
      container.classList.remove("visible");
      container.innerHTML = "";
      return;
    }

    const label = move.isFreeMove ? `Branch: ${move.san}` : `${move.moveNumber}${move.color === "b" ? "..." : "."} ${move.san}`;
    const branches = Array.isArray(move.branches) ? move.branches.slice(0, 3) : [];
    const activeBranch = state.branchExplorer && state.branchExplorer.basePly === move.ply ? state.branchExplorer : null;
    const activeBranchData = activeBranch ? branches[activeBranch.index] : null;
    const activeBranchMove = activeBranchData && activeBranch.step > 0
      ? (activeBranchData.pvSans && activeBranchData.pvSans[activeBranch.step - 1]) || activeBranchData.san
      : "Start";
    const branchControls = activeBranchData
      ? `<div class="branch-controls">
          <button data-branch-action="prev" type="button" title="Previous variation move">‹</button>
          <span class="branch-step">${escapeHtml(activeBranchMove)} (${activeBranch.step}/${Math.max(1, activeBranchData.pvUci.length)})</span>
          <button data-branch-action="next" type="button" title="Next variation move">›</button>
          <button data-branch-action="exit" type="button" title="Close variation">×</button>
        </div>`
      : "";
    const branchHtml = branches.length
      ? `<div class="coach-branches">
          <div class="branch-title">Candidate lines</div>
          ${branches.map((branch, index) => `
            <div class="branch-row${activeBranch && activeBranch.index === index ? " active" : ""}" data-branch-index="${index}" role="button" tabindex="0">
              <span class="branch-move">${escapeHtml(branch.rank)}. ${escapeHtml(branch.san)}</span>
              <span class="branch-note">${escapeHtml(branch.note || "")}</span>
              <span class="branch-line">${escapeHtml(branch.pv || "")}</span>
            </div>
          `).join("")}
          ${branchControls}
        </div>`
      : "";
    container.classList.add("visible");
    container.innerHTML = `
      <div class="coach-title"><span>Coach</span><span class="coach-move">${escapeHtml(label)} - ${escapeHtml(move.grade)}</span></div>
      <div class="coach-text">${escapeHtml(move.coachNote)}</div>
      ${branchHtml}
    `;
  }

  function activeMoves() {
    return state.result ? state.result.moves : state.partialMoves;
  }

  function activeCoachMoves() {
    return state.freeMoveAnalysis ? [state.freeMoveAnalysis] : activeMoves();
  }

  function activeCoachMove() {
    return state.freeMoveAnalysis || selectedCoachMove(activeMoves());
  }

  function fenPlacement(fen) {
    return String(fen || "").split(" ")[0] || "";
  }

  function chessCtor() {
    return window.ChessCoachVendor && window.ChessCoachVendor.Chess;
  }

  function startingFen() {
    const ChessCtor = chessCtor();
    return ChessCtor ? new ChessCtor().fen() : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  }

  function whiteEvalAfterMove(move) {
    const value = Number(move && move.evalAfter);
    if (!Number.isFinite(value)) return 0;
    return move.color === "w" ? value : -value;
  }

  function whiteEvalBeforeMove(move) {
    const value = Number(move && move.evalBefore);
    if (!Number.isFinite(value)) return 0;
    return move.color === "w" ? value : -value;
  }

  function clampEvalForGraph(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-800, Math.min(800, value));
  }

  function formatGraphEval(value) {
    if (Math.abs(value) >= window.ChessCoachGrading.MATE_CP - 10000) {
      return value > 0 ? "White mating" : "Black mating";
    }
    const pawns = Math.abs(value) / 100;
    if (Math.abs(value) < 15) return "Equal";
    return `${value > 0 ? "White" : "Black"} +${pawns.toFixed(pawns >= 10 ? 0 : 1)}`;
  }

  function renderEvalGraph(moves) {
    const container = role("eval-graph");
    if (!container) return;

    if (!moves || !moves.length) {
      container.classList.remove("visible");
      container.innerHTML = "";
      return;
    }

    const width = 320;
    const height = 112;
    const padX = 24;
    const padTop = 14;
    const padBottom = 18;
    const plotWidth = width - padX * 2;
    const plotHeight = height - padTop - padBottom;
    const zeroY = padTop + plotHeight / 2;
    const maxAbs = 800;
    const startEval = whiteEvalBeforeMove(moves[0]);
    const points = [
      { ply: 0, label: "Start", eval: startEval },
      ...moves.map((move) => ({
        ply: move.ply,
        label: `${move.moveNumber}${move.color === "b" ? "..." : "."} ${move.san}`,
        eval: whiteEvalAfterMove(move),
        grade: move.grade
      }))
    ];
    const lastPoint = points[points.length - 1];
    const coordinate = (point, index) => {
      const denominator = Math.max(1, points.length - 1);
      const x = padX + (index / denominator) * plotWidth;
      const y = zeroY - (clampEvalForGraph(point.eval) / maxAbs) * (plotHeight / 2);
      return { x, y };
    };
    const polyline = points
      .map((point, index) => {
        const position = coordinate(point, index);
        return `${position.x.toFixed(1)},${position.y.toFixed(1)}`;
      })
      .join(" ");
    const step = Math.max(1, Math.ceil(points.length / 36));
    const circles = points
      .map((point, index) => {
        if (point.ply !== 0 && index % step !== 0 && index !== points.length - 1 && point.ply !== state.currentPly) {
          return "";
        }
        const position = coordinate(point, index);
        const current = point.ply === state.currentPly ? " current" : "";
        const radius = point.ply === state.currentPly ? 4.6 : 3.3;
        const label = `${point.label}: ${formatGraphEval(point.eval)}`;
        return `<circle class="graph-point${current}" tabindex="0" role="button" data-ply="${point.ply}" cx="${position.x.toFixed(1)}" cy="${position.y.toFixed(1)}" r="${radius}"><title>${escapeHtml(label)}</title></circle>`;
      })
      .join("");

    container.classList.add("visible");
    container.innerHTML = `
      <div class="graph-title"><span>Game graph</span><span>${escapeHtml(formatGraphEval(lastPoint.eval))}</span></div>
      <div class="graph-frame">
        <svg viewBox="0 0 ${width} ${height}" aria-label="Evaluation graph">
          <rect class="graph-band-white" x="${padX}" y="${padTop}" width="${plotWidth}" height="${plotHeight / 2}"></rect>
          <rect class="graph-band-black" x="${padX}" y="${zeroY}" width="${plotWidth}" height="${plotHeight / 2}"></rect>
          <line class="graph-equal" x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}"></line>
          <text class="graph-label" x="4" y="${padTop + 10}">White</text>
          <text class="graph-label" x="4" y="${zeroY + 3}">Equal</text>
          <text class="graph-label" x="4" y="${height - padBottom + 2}">Black</text>
          <polyline class="graph-line" points="${polyline}"></polyline>
          ${circles}
        </svg>
      </div>
    `;
  }

  function scrollCurrentMoveIntoView() {
    const table = role("table");
    if (!table || !state.currentPly) return;
    const row = table.querySelector(`tr[data-ply="${state.currentPly}"]`);
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function clickNavigationControl(direction) {
    const labels = direction > 0 ? ["next", "forward"] : ["previous", "prev", "back"];
    for (const label of labels) {
      const selectors = [
        `button[aria-label*="${label}" i]`,
        `[role="button"][aria-label*="${label}" i]`,
        `button[title*="${label}" i]`,
        `[class*="${label}" i]`
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node || node.disabled || node.getAttribute("aria-disabled") === "true") continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        node.click();
        return true;
      }
    }
    return false;
  }

  function dispatchArrowNavigation(direction) {
    const key = direction > 0 ? "ArrowRight" : "ArrowLeft";
    const eventInit = {
      key,
      code: key,
      bubbles: true,
      cancelable: true
    };
    const targets = [document.activeElement, findBoardElement(), document.body, document, window].filter(Boolean);
    for (const target of targets) {
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    }
  }

  function navigateBoardByDelta(delta) {
    const direction = Math.sign(delta);
    let remaining = Math.min(300, Math.abs(delta));
    if (!direction || !remaining) return;

    const step = () => {
      if (state.disposed || !remaining) return;
      if (!clickNavigationControl(direction)) {
        dispatchArrowNavigation(direction);
      }
      remaining -= 1;
      if (remaining) {
        setTimeout(step, 45);
      }
    };

    step();
  }

  function selectPly(ply, navigateBoard) {
    const moves = activeMoves();
    const targetPly = Number(ply);
    if (!Number.isFinite(targetPly) || targetPly < 0 || !moves.length) return;

    const boundedPly = Math.max(0, Math.min(moves[moves.length - 1].ply, Math.round(targetPly)));
    const previousPly = Number.isFinite(state.currentPly) ? state.currentPly : 0;
    const selected = moves.find((move) => move.ply === boundedPly);
    state.currentPly = boundedPly;
    state.branchExplorer = null;
    state.freeMoveAnalysis = null;
    state.pendingFreeMoveKey = "";
    state.observedFen = selected ? selected.afterFen : startingFen();
    state.manualSelectionUntil = Date.now() + 1600;
    renderEvalGraph(moves);
    renderMoves(moves);
    renderCoach(moves);
    scrollCurrentMoveIntoView();

    if (navigateBoard) {
      navigateBoardByDelta(boundedPly - previousPly);
      if (selected) {
        setStatus(`Selected ${selected.moveNumber}${selected.color === "b" ? "..." : "."} ${selected.san}.`);
      }
    }
  }

  function startBranchExplorer(index) {
    const move = activeCoachMove();
    const branchIndex = Number(index);
    if (!move || !Array.isArray(move.branches) || !Number.isFinite(branchIndex)) return;
    const branch = move.branches[branchIndex];
    if (!branch || !Array.isArray(branch.pvUci) || !branch.pvUci.length) return;

    state.currentPly = move.ply;
    state.branchExplorer = {
      basePly: move.ply,
      index: branchIndex,
      step: 1
    };
    renderEvalGraph(activeMoves());
    renderMoves(activeMoves());
    renderCoach(activeMoves());
    updateBoardOverlay();
    setStatus(`Exploring ${branch.san}.`);
  }

  function stepBranchExplorer(delta) {
    const data = branchDataForExplorer();
    if (!state.branchExplorer || !data) return;
    const total = data.branch.pvUci.length;
    state.branchExplorer.step = Math.max(0, Math.min(total, state.branchExplorer.step + delta));
    renderCoach(activeMoves());
    updateBoardOverlay();
  }

  function exitBranchExplorer() {
    if (!state.branchExplorer) return;
    state.branchExplorer = null;
    renderCoach(activeMoves());
    updateBoardOverlay();
    setStatus("Returned to the game line.");
  }

  function renderMoves(moves) {
    const table = role("table");
    if (!table) return;

    if (!moves || !moves.length) {
      table.innerHTML = "";
      return;
    }

    const rows = moves
      .map((move) => {
        const label = `${move.moveNumber}${move.color === "b" ? "..." : "."}`;
        const note = move.heuristicNote ? `<div class="note">${escapeHtml(move.heuristicNote)}</div>` : "";
        const coach = move.coachNote ? `<div class="coach-note"><b>Coach:</b> ${escapeHtml(move.coachNote)}</div>` : "";
        const currentClass = move.ply === state.currentPly ? " class=\"current-row\"" : "";
        return `
          <tr data-ply="${move.ply}"${currentClass}>
            <td><span class="move">${label} ${escapeHtml(move.san)}</span></td>
            <td><span class="grade ${escapeHtml(move.grade)}">${gradeIconHtml(move.grade)}<span class="grade-label">${escapeHtml(move.grade)}</span></span></td>
            <td>
              <div>${escapeHtml(move.bestSan || move.bestMove || "")}</div>
              <div class="line">${escapeHtml(move.pv || "")}</div>
              ${coach}
              ${note}
            </td>
          </tr>
        `;
      })
      .join("");

    table.innerHTML = `
      <table>
        <thead>
          <tr><th>Move</th><th>Grade</th><th>Coach</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function ensureBoardOverlay() {
    if (state.disposed) return null;

    let overlay = document.getElementById(BOARD_OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = BOARD_OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483646";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;z-index:2">
        <defs>
          <marker id="chess-coach-arrow-head" markerWidth="18" markerHeight="18" refX="14" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,12 L14,6 z" fill="#23c76f"></path>
          </marker>
        </defs>
        <line data-role="best-arrow-shadow" x1="0" y1="0" x2="0" y2="0" stroke="#18323a" stroke-width="8" stroke-linecap="round" opacity="0.18"></line>
        <line data-role="best-arrow" x1="0" y1="0" x2="0" y2="0" stroke="#23c76f" stroke-width="5" stroke-linecap="round" opacity="0.82" marker-end="url(#chess-coach-arrow-head)"></line>
      </svg>
      <div data-role="played-square" style="position:absolute;z-index:3;border:3px solid rgba(35,199,111,.72);background:rgba(35,199,111,.15);box-sizing:border-box"></div>
      <div data-role="grade-badge" style="position:absolute;z-index:4;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;color:#fff;font:900 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 5px 14px rgba(0,0,0,.24),inset 0 0 0 2px rgba(255,255,255,.5)"></div>
      <div data-role="best-label" style="position:absolute;z-index:5;padding:4px 6px;border-radius:5px;background:rgba(24,50,58,.88);color:#fff;font:700 10px/1.2 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 5px 14px rgba(0,0,0,.18);white-space:nowrap"></div>
      <div data-role="variation-board" style="position:absolute;z-index:1;inset:0;display:none;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);box-shadow:inset 0 0 0 3px rgba(24,50,58,.38)"></div>
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function findBoardElement() {
    const selectors = [
      "wc-chess-board",
      "chess-board",
      "cg-board",
      ".board",
      ".board-layout-board",
      "[class*='board']"
    ];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    let best = null;
    let bestArea = 0;

    for (const node of candidates) {
      if (!node || node.id === EXTENSION_ID || node.closest(`#${EXTENSION_ID}`)) continue;
      const rect = node.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const ratio = rect.width && rect.height ? Math.max(rect.width, rect.height) / size : Infinity;
      if (size < 240 || ratio > 1.25) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = node;
        bestArea = area;
      }
    }

    return best;
  }

  function median(values) {
    const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.floor(sorted.length / 2)];
  }

  function squareClassFor(piece) {
    return Array.from(piece.classList || []).find((className) => /^square-[1-8][1-8]$/.test(className));
  }

  function squareDataFor(piece) {
    const squareClass = squareClassFor(piece);
    if (!squareClass) return null;

    return {
      file: Number(squareClass[7]),
      rank: Number(squareClass[8]),
      rect: piece.getBoundingClientRect()
    };
  }

  function pieceSquareData(board) {
    return Array.from(board.querySelectorAll("[class*='square-']"))
      .map(squareDataFor)
      .filter(Boolean)
      .filter((piece) => piece.rect.width > 10 && piece.rect.height > 10);
  }

  function orientationFromClass(board) {
    const classText = [];
    let node = board;
    for (let depth = 0; node && depth < 4; depth += 1) {
      classText.push(node.className || "");
      node = node.parentElement;
    }
    const text = classText.join(" ");
    if (/(^|\s)(orientation-black|flipped)(\s|$)/i.test(text)) return "black";
    if (/(^|\s)orientation-white(\s|$)/i.test(text)) return "white";
    return "";
  }

  function fitBoardGeometry(board, orientationHint) {
    const rect = board.getBoundingClientRect();
    const pieces = pieceSquareData(board);
    if (!pieces.length) {
      const fallbackSize = Math.min(rect.width, rect.height);
      return {
        left: rect.left,
        top: rect.top,
        size: fallbackSize,
        squareSize: fallbackSize / 8,
        orientation: orientationHint || "white"
      };
    }

    const squareSize = median(pieces.flatMap((piece) => [piece.rect.width, piece.rect.height])) || Math.min(rect.width, rect.height) / 8;

    function fit(orientation) {
      const origins = pieces.map((piece) => {
        const col = orientation === "black" ? 8 - piece.file : piece.file - 1;
        const row = orientation === "black" ? piece.rank - 1 : 8 - piece.rank;
        return {
          x: piece.rect.left + piece.rect.width / 2 - (col + 0.5) * squareSize,
          y: piece.rect.top + piece.rect.height / 2 - (row + 0.5) * squareSize
        };
      });
      const left = median(origins.map((origin) => origin.x));
      const top = median(origins.map((origin) => origin.y));
      const error = pieces.reduce((sum, piece) => {
        const col = orientation === "black" ? 8 - piece.file : piece.file - 1;
        const row = orientation === "black" ? piece.rank - 1 : 8 - piece.rank;
        const expectedX = left + (col + 0.5) * squareSize;
        const expectedY = top + (row + 0.5) * squareSize;
        const centerX = piece.rect.left + piece.rect.width / 2;
        const centerY = piece.rect.top + piece.rect.height / 2;
        return sum + Math.abs(centerX - expectedX) + Math.abs(centerY - expectedY);
      }, 0);
      return { left, top, size: squareSize * 8, squareSize, orientation, error };
    }

    if (orientationHint) return fit(orientationHint);

    const white = fit("white");
    const black = fit("black");
    return black.error < white.error ? black : white;
  }

  function parseChessComBoardPlacement(board) {
    const pieces = Array.from(board.querySelectorAll("[class*='square-']"));
    const boardArray = emptyBoardArray();

    for (const piece of pieces) {
      const classes = Array.from(piece.classList || []);
      const squareClass = squareClassFor(piece);
      const pieceClass = classes.find((className) => /^[wb][pnbrqk]$/i.test(className));
      if (!squareClass || !pieceClass) continue;

      const file = Number(squareClass[7]);
      const rank = Number(squareClass[8]);
      const color = pieceClass[0].toLowerCase();
      const type = pieceClass[1].toLowerCase();
      const symbol = color === "w" ? type.toUpperCase() : type;
      addPieceToPlacement(boardArray, symbol, file, rank);
    }

    return placementFromBoardArray(boardArray);
  }

  function pieceSymbolFromClasses(classes) {
    const text = classes.map((className) => className.toLowerCase());
    const color = text.includes("white") ? "w" : text.includes("black") ? "b" : "";
    const typeName = PIECE_CLASS_NAMES.find((name) => text.includes(name));
    if (!color || !typeName) return "";

    const type = PIECE_CLASS_TYPES[typeName];
    return color === "w" ? type.toUpperCase() : type;
  }

  function emptyBoardArray() {
    return Array.from({ length: 8 }, () => Array(8).fill(""));
  }

  function addPieceToPlacement(boardArray, symbol, file, rank) {
    if (!symbol || file < 1 || file > 8 || rank < 1 || rank > 8) return;
    boardArray[8 - rank][file - 1] = symbol;
  }

  function placementFromBoardArray(boardArray) {
    if (!boardArray.some((row) => row.some(Boolean))) return "";
    return boardArray
      .map((row) => {
        let text = "";
        let empty = 0;
        for (const square of row) {
          if (square) {
            if (empty) text += empty;
            empty = 0;
            text += square;
          } else {
            empty += 1;
          }
        }
        return text + (empty ? empty : "");
      })
      .join("/");
  }

  function parseLichessBoardPlacement(board) {
    const pieces = Array.from(board.querySelectorAll("piece"));
    if (!pieces.length) return "";

    const rect = board.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    if (!size) return "";

    const squareSize = size / 8;
    const orientation = boardOrientation(board);
    const boardArray = emptyBoardArray();

    for (const piece of pieces) {
      const symbol = pieceSymbolFromClasses(Array.from(piece.classList || []));
      if (!symbol) continue;

      const pieceRect = piece.getBoundingClientRect();
      const centerX = pieceRect.left + pieceRect.width / 2 - rect.left;
      const centerY = pieceRect.top + pieceRect.height / 2 - rect.top;
      const col = Math.max(0, Math.min(7, Math.round(centerX / squareSize - 0.5)));
      const row = Math.max(0, Math.min(7, Math.round(centerY / squareSize - 0.5)));
      const file = orientation === "black" ? 8 - col : col + 1;
      const rank = orientation === "black" ? row + 1 : 8 - row;

      addPieceToPlacement(boardArray, symbol, file, rank);
    }

    return placementFromBoardArray(boardArray);
  }

  function parseBoardPlacement(board) {
    return parseChessComBoardPlacement(board) || parseLichessBoardPlacement(board);
  }

  function inferOrientationFromPieces(board) {
    return fitBoardGeometry(board, "").orientation;
  }

  function boardOrientation(board) {
    return orientationFromClass(board) || inferOrientationFromPieces(board) || "white";
  }

  function squarePoint(square, geometry) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const col = geometry.orientation === "black" ? 7 - file : file;
    const row = geometry.orientation === "black" ? rank - 1 : 8 - rank;
    return {
      x: col * geometry.squareSize + geometry.squareSize / 2,
      y: row * geometry.squareSize + geometry.squareSize / 2,
      squareSize: geometry.squareSize
    };
  }

  function pieceSymbol(piece) {
    if (!piece) return "";
    return PIECE_SYMBOLS[`${piece.color}${piece.type}`] || "";
  }

  function branchDataForExplorer() {
    if (!state.branchExplorer) return null;
    const moves = activeCoachMoves();
    const baseMove = moves.find((move) => move.ply === state.branchExplorer.basePly);
    if (!baseMove || !Array.isArray(baseMove.branches)) return null;
    const branch = baseMove.branches[state.branchExplorer.index];
    if (!branch || !Array.isArray(branch.pvUci) || !branch.pvUci.length) return null;
    return { baseMove, branch };
  }

  function branchPosition(data) {
    const ChessCtor = window.ChessCoachVendor && window.ChessCoachVendor.Chess;
    if (!ChessCtor || !data || !data.baseMove || !data.branch) return null;

    try {
      const chess = new ChessCtor(data.baseMove.beforeFen);
      const maxStep = Math.min(state.branchExplorer.step, data.branch.pvUci.length);
      const sanMoves = [];
      for (const uci of data.branch.pvUci.slice(0, maxStep)) {
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4, 5) || undefined
        });
        if (!move) break;
        sanMoves.push(move.san);
      }
      return {
        chess,
        fen: chess.fen(),
        lastUci: maxStep ? data.branch.pvUci[maxStep - 1] : "",
        lastSan: sanMoves[sanMoves.length - 1] || data.branch.san || "",
        step: maxStep,
        total: data.branch.pvUci.length
      };
    } catch (_error) {
      return null;
    }
  }

  function renderVariationGrid(container, chess, geometry) {
    const board = chess.board();
    const cells = [];
    for (let displayRow = 0; displayRow < 8; displayRow += 1) {
      for (let displayCol = 0; displayCol < 8; displayCol += 1) {
        const file = geometry.orientation === "black" ? 7 - displayCol : displayCol;
        const boardRow = geometry.orientation === "black" ? 7 - displayRow : displayRow;
        const piece = board[boardRow][file];
        const light = (displayRow + displayCol) % 2 === 0;
        cells.push(`
          <div style="
            display:flex;
            align-items:center;
            justify-content:center;
            background:${light ? "rgba(238,238,210,.94)" : "rgba(118,150,86,.94)"};
            color:${piece && piece.color === "w" ? "#f8f8f8" : "#222"};
            font:700 ${Math.max(24, geometry.squareSize * 0.68)}px/1 'Times New Roman', serif;
            text-shadow:0 2px 3px rgba(0,0,0,.48);
            user-select:none;
          ">${pieceSymbol(piece)}</div>
        `);
      }
    }
    container.innerHTML = cells.join("");
  }

  function renderBranchExplorerOverlay() {
    const data = branchDataForExplorer();
    if (!data) return false;

    const board = findBoardElement();
    const overlay = ensureBoardOverlay();
    if (!board || !overlay) return true;

    const position = branchPosition(data);
    if (!position) return true;

    const geometry = fitBoardGeometry(board, boardOrientation(board));
    const size = geometry.size;
    const arrow = overlay.querySelector("[data-role='best-arrow']");
    const arrowShadow = overlay.querySelector("[data-role='best-arrow-shadow']");
    const playedSquare = overlay.querySelector("[data-role='played-square']");
    const badge = overlay.querySelector("[data-role='grade-badge']");
    const label = overlay.querySelector("[data-role='best-label']");
    const variationBoard = overlay.querySelector("[data-role='variation-board']");

    overlay.style.display = "block";
    overlay.style.left = `${geometry.left}px`;
    overlay.style.top = `${geometry.top}px`;
    overlay.style.width = `${size}px`;
    overlay.style.height = `${size}px`;

    if (variationBoard) {
      variationBoard.style.display = "grid";
      renderVariationGrid(variationBoard, position.chess, geometry);
    }

    if (playedSquare) playedSquare.style.display = "none";
    if (badge) badge.style.display = "none";

    if (position.lastUci && position.lastUci.length >= 4) {
      const from = squarePoint(position.lastUci.slice(0, 2), geometry);
      const to = squarePoint(position.lastUci.slice(2, 4), geometry);
      for (const line of [arrow, arrowShadow]) {
        line.style.display = "block";
        line.setAttribute("x1", String(from.x));
        line.setAttribute("y1", String(from.y));
        line.setAttribute("x2", String(to.x));
        line.setAttribute("y2", String(to.y));
      }
      if (label) {
        label.style.display = "block";
        label.textContent = `${position.step}/${position.total}: ${position.lastSan}`;
        label.style.left = `${Math.min(size - 112, Math.max(4, to.x + from.squareSize * 0.1))}px`;
        label.style.top = `${Math.min(size - 26, Math.max(4, to.y - from.squareSize / 2 - 26))}px`;
      }
    } else {
      for (const line of [arrow, arrowShadow]) {
        if (line) line.style.display = "none";
      }
      if (label) {
        label.style.display = "block";
        label.textContent = "Branch start";
        label.style.left = "4px";
        label.style.top = "4px";
      }
    }

    return true;
  }

  function inferMoveToPlacement(beforeFen, placement) {
    const ChessCtor = chessCtor();
    if (!ChessCtor || !beforeFen || !placement) return null;

    try {
      const base = new ChessCtor(beforeFen);
      const color = base.turn();
      const beforeMaterial = window.ChessCoachPgn.materialBalance(base, color);
      const candidates = base.moves({ verbose: true });
      for (const candidate of candidates) {
        const replay = new ChessCtor(beforeFen);
        const played = replay.move({
          from: candidate.from,
          to: candidate.to,
          promotion: candidate.promotion || undefined
        });
        if (!played || fenPlacement(replay.fen()) !== placement) continue;

        const afterMaterial = window.ChessCoachPgn.materialBalance(replay, color);
        const moveNumber = Number(String(beforeFen).split(" ")[5]) || 1;
        return {
          ply: Math.max(1, (state.currentPly || 0) + 1),
          moveNumber,
          color,
          colorName: color === "w" ? "White" : "Black",
          san: played.san,
          uci: `${played.from}${played.to}${played.promotion || ""}`,
          piece: played.piece || "",
          from: played.from || "",
          to: played.to || "",
          flags: played.flags || "",
          beforeFen,
          afterFen: replay.fen(),
          materialDelta: afterMaterial - beforeMaterial,
          captured: played.captured || "",
          promotion: played.promotion || ""
        };
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function freeMoveKey(move) {
    return move ? `${move.beforeFen}|${move.uci}` : "";
  }

  async function analyzeFreeMove(move) {
    if (state.disposed || state.run || !move) return;
    const key = freeMoveKey(move);
    if (!key || state.pendingFreeMoveKey === key) return;
    if (state.freeMoveAnalysis && state.freeMoveAnalysis.freeMoveKey === key) return;

    state.pendingFreeMoveKey = key;
    state.observedFen = move.afterFen;
    setStatus(`Analyzing branch move ${move.san}...`);

    const scriptUrl = chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.js");
    const wasmUrl = chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.wasm");
    const run = { cancelled: false, engine: null };

    try {
      const analyzed = await window.ChessCoachAnalyzer.analyzeMove({
        move,
        scriptUrl,
        wasmUrl,
        depth: DEPTH,
        multiPv: MULTI_PV,
        signal: run,
        ChessCtor: chessCtor(),
        engineFactory: () => {
          run.engine = new window.ChessCoachExtensionEngine.OffscreenEngine({ depth: DEPTH });
          return run.engine;
        }
      });

      if (state.disposed || state.pendingFreeMoveKey !== key) return;
      state.freeMoveAnalysis = {
        ...analyzed,
        isFreeMove: true,
        freeMoveKey: key
      };
      state.currentPly = analyzed.ply;
      state.observedFen = analyzed.afterFen;
      renderCoach(activeMoves());
      updateBoardOverlay();
      setStatus(`Branch move analyzed: ${analyzed.san} is ${analyzed.grade}.`);
    } catch (error) {
      if (!state.disposed && state.pendingFreeMoveKey === key) {
        setStatus(error.message || String(error));
      }
    } finally {
      if (run.engine) {
        run.engine.terminate();
      }
      if (state.pendingFreeMoveKey === key) {
        state.pendingFreeMoveKey = "";
      }
    }
  }

  function scheduleFreeMoveAnalysis(placement) {
    if (!placement || placement === START_PLACEMENT || state.branchExplorer) return;
    if (state.freeMoveAnalysis && fenPlacement(state.freeMoveAnalysis.afterFen) === placement) return;
    const beforeFen = state.observedFen;
    if (!beforeFen || fenPlacement(beforeFen) === placement) return;
    const move = inferMoveToPlacement(beforeFen, placement);
    if (move) {
      analyzeFreeMove(move);
    }
  }

  function freeMoveForCurrentBoard() {
    if (!state.freeMoveAnalysis) return null;
    const board = findBoardElement();
    if (!board) return null;
    const placement = parseBoardPlacement(board);
    if (!placement) return null;
    return fenPlacement(state.freeMoveAnalysis.afterFen) === placement ? state.freeMoveAnalysis : null;
  }

  function findMoveForCurrentBoard() {
    const moves = state.result ? state.result.moves : state.partialMoves;
    if (!moves || !moves.length) return null;

    const board = findBoardElement();
    if (!board) return null;

    const placement = parseBoardPlacement(board);
    if (!placement) return null;
    if (placement === START_PLACEMENT) {
      state.currentPly = 0;
      state.observedFen = startingFen();
      state.freeMoveAnalysis = null;
      return null;
    }

    const matches = moves.filter((move) => fenPlacement(move.afterFen) === placement);
    if (!matches.length) return null;

    const selected = !state.currentPly ? matches[matches.length - 1] : matches.reduce((best, move) => {
      return Math.abs(move.ply - state.currentPly) < Math.abs(best.ply - state.currentPly) ? move : best;
    }, matches[0]);
    state.observedFen = selected.afterFen;
    if (state.freeMoveAnalysis) {
      state.freeMoveAnalysis = null;
      state.pendingFreeMoveKey = "";
      renderCoach(activeMoves());
    }
    return selected;
  }

  function updateBoardOverlay() {
    if (state.disposed) return;
    if (state.branchExplorer) {
      renderBranchExplorerOverlay();
      return;
    }
    if (state.manualSelectionUntil && Date.now() < state.manualSelectionUntil) return;

    const previousPly = state.currentPly;
    const gameMove = findMoveForCurrentBoard();
    const move = gameMove || freeMoveForCurrentBoard();
    const board = findBoardElement();
    const overlay = ensureBoardOverlay();
    if (!overlay) return;

    if (!move || !board || !move.bestMove || move.bestMove.length < 4) {
      if (board) {
        scheduleFreeMoveAnalysis(parseBoardPlacement(board));
      }
      overlay.style.display = "none";
      const variationBoard = overlay.querySelector("[data-role='variation-board']");
      if (variationBoard) variationBoard.style.display = "none";
      if (previousPly !== state.currentPly) {
        const moves = activeMoves();
        renderEvalGraph(moves);
        renderMoves(moves);
        renderCoach(moves);
      }
      return;
    }

    state.currentPly = move.ply;
    if (move.afterFen) state.observedFen = move.afterFen;
    const geometry = fitBoardGeometry(board, boardOrientation(board));
    const size = geometry.size;
    const from = squarePoint(move.bestMove.slice(0, 2), geometry);
    const to = squarePoint(move.bestMove.slice(2, 4), geometry);
    const playedTo = move.uci && move.uci.length >= 4 ? squarePoint(move.uci.slice(2, 4), geometry) : to;
    const inset = from.squareSize * 0.18;
    const arrow = overlay.querySelector("[data-role='best-arrow']");
    const arrowShadow = overlay.querySelector("[data-role='best-arrow-shadow']");
    const playedSquare = overlay.querySelector("[data-role='played-square']");
    const badge = overlay.querySelector("[data-role='grade-badge']");
    const label = overlay.querySelector("[data-role='best-label']");
    const variationBoard = overlay.querySelector("[data-role='variation-board']");

    overlay.style.display = "block";
    overlay.style.left = `${geometry.left}px`;
    overlay.style.top = `${geometry.top}px`;
    overlay.style.width = `${size}px`;
    overlay.style.height = `${size}px`;
    if (variationBoard) variationBoard.style.display = "none";

    for (const line of [arrow, arrowShadow]) {
      line.style.display = "block";
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
    }

    playedSquare.style.display = "block";
    playedSquare.style.left = `${playedTo.x - playedTo.squareSize / 2}px`;
    playedSquare.style.top = `${playedTo.y - playedTo.squareSize / 2}px`;
    playedSquare.style.width = `${playedTo.squareSize}px`;
    playedSquare.style.height = `${playedTo.squareSize}px`;

    badge.textContent = gradeGlyph(move.grade);
    badge.style.display = "flex";
    badge.style.background = gradeColor(move.grade);
    badge.title = move.grade;
    badge.style.left = `${playedTo.x + playedTo.squareSize / 2 - 34}px`;
    badge.style.top = `${playedTo.y - playedTo.squareSize / 2 + 6}px`;

    label.textContent = move.bestSan ? `Best: ${move.bestSan}` : `Best: ${move.bestMove}`;
    label.style.display = "block";
    label.style.left = `${Math.min(size - 92, Math.max(4, to.x + inset * 0.6))}px`;
    label.style.top = `${Math.min(size - 26, Math.max(4, to.y - playedTo.squareSize / 2 - 26))}px`;

    if (previousPly !== state.currentPly) {
      const moves = activeMoves();
      renderEvalGraph(moves);
      renderMoves(moves);
      renderCoach(moves);
    }
  }

  function resetForNewGame() {
    state.result = null;
    state.partialMoves = [];
    state.source = null;
    state.currentPly = 0;
    state.manualSelectionUntil = 0;
    state.branchExplorer = null;
    state.observedFen = "";
    state.freeMoveAnalysis = null;
    state.pendingFreeMoveKey = "";
    state.gameKey = "";
    setStatus("Ready after a completed game.");
    setProgress(0, 1);
    const summary = role("summary");
    if (summary) summary.innerHTML = "";
    renderPhaseSummary(null);
    renderEvalGraph([]);
    const coach = role("coach");
    if (coach) {
      coach.innerHTML = "";
      coach.classList.remove("visible");
    }
    renderMoves([]);
    showPaste(false);
    const overlay = document.getElementById(BOARD_OVERLAY_ID);
    if (overlay) overlay.style.display = "none";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function gradeSlug(grade) {
    return String(grade || "good").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function gradeGlyph(grade) {
    return GRADE_PRESENTATION[grade] ? GRADE_PRESENTATION[grade].glyph : "?";
  }

  function gradeColor(grade) {
    return GRADE_PRESENTATION[grade] ? GRADE_PRESENTATION[grade].color : "#18323a";
  }

  function gradeIconHtml(grade) {
    return `<span class="grade-icon grade-icon-${gradeSlug(grade)}">${escapeHtml(gradeGlyph(grade))}</span>`;
  }

  function stoppedError() {
    const error = new Error("Analysis stopped.");
    error.code = "STOPPED";
    return error;
  }

  function ensureRunActive(run) {
    if (state.disposed || !run || run.cancelled || state.run !== run) {
      throw stoppedError();
    }
  }

  async function analyze(pastedPgn) {
    if (state.run || state.disposed) return;
    if (!hasAnalysisDependencies()) {
      setStatus("Loading analysis tools. Try again in a moment.");
      return;
    }

    setRunning(true);
    setProgress(0, 1);
    showPaste(false);
    const summary = role("summary");
    if (summary) summary.innerHTML = "";
    renderPhaseSummary(null);
    renderEvalGraph([]);
    const coach = role("coach");
    if (coach) {
      coach.innerHTML = "";
      coach.classList.remove("visible");
    }
    state.partialMoves = [];
    state.source = null;
    state.gameKey = "";
    state.freeMoveAnalysis = null;
    state.pendingFreeMoveKey = "";
    state.observedFen = "";
    state.branchExplorer = null;
    renderMoves([]);
    setStatus("Finding the finished PGN...");

    const run = { cancelled: false, engine: null };
    state.run = run;

    try {
      const source = await resolveSource(pastedPgn);
      ensureRunActive(run);
      const hash = window.ChessCoachPgn.hashString(source.pgn);
      const cacheKey = `${CACHE_PREFIX}d${DEPTH}:${source.site}:${source.gameId || "manual"}:${hash}`;
      state.source = source;
      state.gameKey = `${source.site}:${source.gameId || hash}`;
      const cached = await storageGetAnalysis(cacheKey);
      ensureRunActive(run);

      if (cached) {
        state.result = cached;
        state.partialMoves = cached.moves;
        state.currentPly = cached.moves.length ? cached.moves[cached.moves.length - 1].ply : 0;
        state.observedFen = cached.moves.length ? cached.moves[cached.moves.length - 1].afterFen : startingFen();
        setStatus("Loaded cached analysis.");
        setProgress(1, 1);
        renderSummary(cached.summary);
        renderPhaseSummary(cached.phaseSummary);
        renderEvalGraph(cached.moves);
        renderMoves(cached.moves);
        renderCoach(cached.moves);
        updateBoardOverlay();
        return;
      }

      const scriptUrl = chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.js");
      const wasmUrl = chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.wasm");

      const result = await window.ChessCoachAnalyzer.analyzeGame({
        pgn: source.pgn,
        scriptUrl,
        wasmUrl,
        depth: DEPTH,
        multiPv: MULTI_PV,
        signal: run,
        engineFactory: () => {
          run.engine = new window.ChessCoachExtensionEngine.OffscreenEngine({ depth: DEPTH });
          return run.engine;
        },
        onProgress: (progress) => {
          if (state.disposed || run.cancelled || state.run !== run) return;
          state.partialMoves.push(progress.move);
          state.currentPly = progress.move.ply;
          setStatus(`Analyzed ${progress.done} of ${progress.total} moves.`);
          setProgress(progress.done, progress.total);
          renderSummary(summarizeMoves(state.partialMoves));
          renderEvalGraph(state.partialMoves);
          renderMoves(state.partialMoves);
          renderCoach(state.partialMoves);
          updateBoardOverlay();
        }
      });

      ensureRunActive(run);
      state.result = result;
      state.partialMoves = result.moves;
      state.currentPly = result.moves.length ? result.moves[result.moves.length - 1].ply : 0;
      state.observedFen = result.moves.length ? result.moves[result.moves.length - 1].afterFen : startingFen();
      try {
        await storageSetAnalysis(cacheKey, result);
      } catch (_error) {
        // Caching is an optimization; analysis results should still render if storage is full.
      }
      ensureRunActive(run);
      setStatus("Analysis complete.");
      setProgress(1, 1);
      renderSummary(result.summary);
      renderPhaseSummary(result.phaseSummary);
      renderEvalGraph(result.moves);
      renderMoves(result.moves);
      renderCoach(result.moves);
      updateBoardOverlay();
    } catch (error) {
      if (state.disposed) return;
      if (error.code === "NEEDS_PASTE") {
        showPaste(true);
      }
      if (error.code === "GAME_NOT_FINISHED") {
        showPaste(false);
      }
      setStatus(error.message || String(error));
      setProgress(0, 1);
    } finally {
      if (state.run === run) {
        state.run = null;
      }
      if (!state.disposed) {
        setRunning(false);
      }
    }
  }

  function stop(showStatus = true) {
    if (!state.run) return;
    state.run.cancelled = true;
    if (state.run.engine) {
      state.run.engine.terminate();
    }
    if (showStatus) {
      setStatus("Stopping analysis...");
    }
  }

  function removeBoardOverlay() {
    const overlay = document.getElementById(BOARD_OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function closePanel(options) {
    if (state.disposed) return false;

    const shouldRememberDismissal = !options || options.rememberDismissal !== false;
    if (shouldRememberDismissal) {
      rememberPanelDismissed();
    }
    stop(false);
    state.disposed = true;
    if (monitorId !== null) {
      clearInterval(monitorId);
      monitorId = null;
    }
    removeBoardOverlay();
    host.remove();
    if (globalThis.ChessCoachClosePanel === closePanel) {
      delete globalThis.ChessCoachClosePanel;
    }
    return true;
  }

  function activatePlyFromEvent(event, navigateBoard) {
    const target = event.target && event.target.closest ? event.target.closest("[data-ply]") : null;
    if (!target) return;

    const ply = Number(target.getAttribute("data-ply"));
    if (!Number.isFinite(ply)) return;
    event.preventDefault();
    selectPly(ply, navigateBoard);
  }

  function activateBranchFromEvent(event) {
    const actionTarget = event.target && event.target.closest ? event.target.closest("[data-branch-action]") : null;
    if (actionTarget) {
      const actionName = actionTarget.getAttribute("data-branch-action");
      event.preventDefault();
      if (actionName === "prev") stepBranchExplorer(-1);
      if (actionName === "next") stepBranchExplorer(1);
      if (actionName === "exit") exitBranchExplorer();
      return;
    }

    const branchTarget = event.target && event.target.closest ? event.target.closest("[data-branch-index]") : null;
    if (!branchTarget) return;
    event.preventDefault();
    startBranchExplorer(Number(branchTarget.getAttribute("data-branch-index")));
  }

  function bindEvents() {
    action("analyze").addEventListener("click", () => analyze(""));
    action("analyze-paste").addEventListener("click", () => analyze(role("pgn").value));
    action("stop").addEventListener("click", () => stop());
    action("close").addEventListener("click", closePanel);
    role("eval-graph").addEventListener("click", (event) => activatePlyFromEvent(event, true));
    role("eval-graph").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        activatePlyFromEvent(event, true);
      }
    });
    role("table").addEventListener("click", (event) => activatePlyFromEvent(event, true));
    role("coach").addEventListener("click", activateBranchFromEvent);
    role("coach").addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        activateBranchFromEvent(event);
      }
    });
  }

  function configureSupportLink() {
    const donationUrl = window.ChessCoachConfig && window.ChessCoachConfig.donationUrl;
    const support = role("support");
    if (!support || !donationUrl) return;
    support.href = donationUrl;
    support.classList.add("visible");
  }

  placeHost();
  setHtml();
  configureSupportLink();
  bindEvents();
  globalThis.ChessCoachClosePanel = closePanel;

  let lastHref = location.href;
  monitorId = setInterval(() => {
    if (state.disposed) return;
    if (location.href !== lastHref) {
      lastHref = location.href;
      const visibleGameKey = currentGameKey();
      if (shouldResetForNavigation(visibleGameKey)) {
        resetForNewGame();
      }
    }
    if (state.result || state.partialMoves.length) updateBoardOverlay();
  }, 500);
})();
