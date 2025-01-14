(function () {
  const EXTENSION_ID = "chess-coach-panel";
  const BOARD_OVERLAY_ID = "chess-coach-board-overlay";
  const DEPTH = 14;
  const MULTI_PV = 3;
  const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
  const CACHE_PREFIX = "analysis:v5:";
  const MAX_CACHE_ENTRIES = 20;
  const MAX_CACHE_ENTRY_CHARS = 1000000;

  if (window.top !== window || document.getElementById(EXTENSION_ID)) {
    return;
  }

  if (typeof globalThis.ChessCoachClosePanel === "function") {
    try {
      globalThis.ChessCoachClosePanel();
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
      host.style.width = "360px";
      document.documentElement.appendChild(host);
    }
  }

  function setHtml() {
    shadow.innerHTML = `
      <style>
        :host { all: initial; color-scheme: light; }
        .panel {
          box-sizing: border-box;
          width: 360px;
          max-height: min(760px, calc(100vh - 96px));
          overflow: hidden;
          border: 1px solid #cfd7dc;
          border-radius: 8px;
          background: #f9fbfb;
          box-shadow: 0 16px 48px rgba(33, 43, 54, 0.20);
          color: #172026;
          font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: #18323a;
          color: #f6fbfb;
        }
        .title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .header-actions {
          display: flex;
          align-items: center;
          flex: 0 0 auto;
          gap: 8px;
        }
        .badge {
          border-radius: 999px;
          background: #d6f26b;
          color: #1f2a12;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
        }
        .body {
          padding: 12px 14px 14px;
          overflow: auto;
          max-height: calc(min(760px, 100vh - 96px) - 48px);
        }
        .actions {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
        }
        button {
          appearance: none;
          border: 1px solid #9bb0b8;
          border-radius: 6px;
          background: #ffffff;
          color: #172026;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          min-height: 32px;
          padding: 6px 10px;
        }
        button.icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          min-height: 28px;
          padding: 0;
          border-color: rgba(246, 251, 251, 0.42);
          background: rgba(255, 255, 255, 0.12);
          color: #f6fbfb;
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
        }
        button.icon-button:hover,
        button.icon-button:focus-visible {
          background: rgba(255, 255, 255, 0.22);
        }
        button.primary {
          background: #167a72;
          border-color: #167a72;
          color: #ffffff;
        }
        button:disabled {
          cursor: default;
          opacity: 0.55;
        }
        .status {
          min-height: 20px;
          margin-bottom: 10px;
          color: #43515a;
        }
        .progress {
          height: 8px;
          overflow: hidden;
          border-radius: 999px;
          background: #e5ecef;
          margin-bottom: 10px;
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
          gap: 6px;
          margin: 8px 0 12px;
        }
        .summary > span {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          border: 1px solid #d9e1e5;
          border-radius: 6px;
          background: #ffffff;
          padding: 5px 7px;
          white-space: nowrap;
        }
        textarea {
          box-sizing: border-box;
          width: 100%;
          min-height: 120px;
          resize: vertical;
          border: 1px solid #b9c7ce;
          border-radius: 6px;
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
          border-collapse: collapse;
          background: #ffffff;
          border: 1px solid #d9e1e5;
          border-radius: 6px;
          overflow: hidden;
        }
        th, td {
          border-bottom: 1px solid #edf1f3;
          padding: 6px 6px;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: #eef4f4;
          color: #43515a;
          font-size: 11px;
          text-transform: uppercase;
        }
        tr:last-child td {
          border-bottom: 0;
        }
        .move {
          font-weight: 700;
        }
        .grade {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 2px 7px 2px 3px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
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
          border: 1px solid #d9e1e5;
          border-radius: 6px;
          background: #ffffff;
          padding: 8px 9px;
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
          border: 1px solid #b6d7cc;
          border-left: 4px solid #167a72;
          border-radius: 6px;
          background: #eefaf6;
          padding: 8px 9px;
        }
        .coach.visible {
          display: block;
        }
        .coach-title {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 3px;
          color: #167a72;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        .coach-move {
          color: #172026;
          text-transform: none;
        }
        .coach-text {
          color: #172026;
          font-size: 12px;
          line-height: 1.4;
        }
        .grade-label {
          min-width: 0;
        }
        .Book { background: #e9edf3; color: #26323f; }
        .Brilliant { background: #d7f4ff; color: #083849; }
        .Best { background: #d9f3da; color: #173d19; }
        .Great { background: #e8f8b8; color: #263300; }
        .Excellent { background: #e6f5db; color: #2e4a18; }
        .Good { background: #eef2da; color: #414212; }
        .Inaccuracy { background: #fff0b8; color: #5c3b00; }
        .Mistake { background: #ffd9bf; color: #6a2100; }
        .Miss { background: #ffe6ba; color: #673800; }
        .Blunder { background: #ffd5dd; color: #6b111f; }
        .grade-icon-book { background: #627386; }
        .grade-icon-brilliant { background: #18a7d5; }
        .grade-icon-best { background: #2c9f48; }
        .grade-icon-great { background: #6cbf2d; }
        .grade-icon-excellent { background: #65ad43; }
        .grade-icon-good { background: #91a057; }
        .grade-icon-inaccuracy { background: #e5a91f; color: #2f2300; }
        .grade-icon-mistake { background: #e56f2c; }
        .grade-icon-miss { background: #d88718; }
        .grade-icon-blunder { background: #d9334f; }
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
          border: 1px solid #18a7d5;
          border-radius: 6px;
          background: #d7f4ff;
          color: #083849;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 8px;
          text-decoration: none;
        }
        .support.visible {
          display: inline-block;
        }
      </style>
      <section class="panel" part="panel">
        <div class="header">
          <div class="title">Post-Game Chess Coach</div>
          <div class="header-actions">
            <div class="badge">Local</div>
            <button class="icon-button" data-action="close" type="button" aria-label="Close panel" title="Close panel">×</button>
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

  function currentGameKey() {
    const adapter = siteAdapter();
    if (!adapter || typeof adapter.parseGameIdFromUrl !== "function") return "";
    const id = adapter.parseGameIdFromUrl(location.href);
    if (!id) return "";
    return `${location.hostname.includes("lichess") ? "lichess" : "chess.com"}:${id}`;
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
      fetchPgn
    });
  }

  function renderSummary(summary) {
    const container = role("summary");
    if (!container) return;
    const labels = window.ChessCoachGrading.LABELS;
    const order = [
      labels.BOOK,
      labels.BRILLIANT,
      labels.BEST,
      labels.GREAT,
      labels.EXCELLENT,
      labels.GOOD,
      labels.INACCURACY,
      labels.MISTAKE,
      labels.MISS,
      labels.BLUNDER
    ];
    container.innerHTML = order
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
    const move = selectedCoachMove(moves);
    if (!move || !move.coachNote) {
      container.classList.remove("visible");
      container.innerHTML = "";
      return;
    }

    const label = `${move.moveNumber}${move.color === "b" ? "..." : "."} ${move.san}`;
    container.classList.add("visible");
    container.innerHTML = `
      <div class="coach-title"><span>Coach</span><span class="coach-move">${escapeHtml(label)} - ${escapeHtml(move.grade)}</span></div>
      <div class="coach-text">${escapeHtml(move.coachNote)}</div>
    `;
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
          <tr${currentClass}>
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
      <svg aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
        <defs>
          <marker id="chess-coach-arrow-head" markerWidth="18" markerHeight="18" refX="14" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,12 L14,6 z" fill="#23c76f"></path>
          </marker>
        </defs>
        <line data-role="best-arrow-shadow" x1="0" y1="0" x2="0" y2="0" stroke="#18323a" stroke-width="8" stroke-linecap="round" opacity="0.18"></line>
        <line data-role="best-arrow" x1="0" y1="0" x2="0" y2="0" stroke="#23c76f" stroke-width="5" stroke-linecap="round" opacity="0.82" marker-end="url(#chess-coach-arrow-head)"></line>
      </svg>
      <div data-role="played-square" style="position:absolute;border:3px solid rgba(35,199,111,.72);background:rgba(35,199,111,.15);box-sizing:border-box"></div>
      <div data-role="grade-badge" style="position:absolute;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;color:#fff;font:900 12px/1 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 5px 14px rgba(0,0,0,.24),inset 0 0 0 2px rgba(255,255,255,.5)"></div>
      <div data-role="best-label" style="position:absolute;padding:4px 6px;border-radius:5px;background:rgba(24,50,58,.88);color:#fff;font:700 10px/1.2 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 5px 14px rgba(0,0,0,.18);white-space:nowrap"></div>
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
    const boardArray = Array.from({ length: 8 }, () => Array(8).fill(""));

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
      boardArray[8 - rank][file - 1] = symbol;
    }

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

  function pieceSymbolFromClasses(classes) {
    const text = classes.map((className) => className.toLowerCase());
    const color = text.includes("white") ? "w" : text.includes("black") ? "b" : "";
    const typeMap = {
      pawn: "p",
      knight: "n",
      bishop: "b",
      rook: "r",
      queen: "q",
      king: "k"
    };
    const typeName = Object.keys(typeMap).find((name) => text.includes(name));
    if (!color || !typeName) return "";

    const type = typeMap[typeName];
    return color === "w" ? type.toUpperCase() : type;
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
    const boardArray = Array.from({ length: 8 }, () => Array(8).fill(""));

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

  function findMoveForCurrentBoard() {
    const moves = state.result ? state.result.moves : state.partialMoves;
    if (!moves || !moves.length) return null;

    const board = findBoardElement();
    if (!board) return null;

    const placement = parseBoardPlacement(board);
    if (!placement) return null;
    if (placement === START_PLACEMENT) {
      state.currentPly = 0;
      return null;
    }

    const matches = moves.filter((move) => String(move.afterFen || "").split(" ")[0] === placement);
    if (!matches.length) return null;

    if (!state.currentPly) return matches[matches.length - 1];
    return matches.reduce((best, move) => {
      return Math.abs(move.ply - state.currentPly) < Math.abs(best.ply - state.currentPly) ? move : best;
    }, matches[0]);
  }

  function updateBoardOverlay() {
    if (state.disposed) return;

    const previousPly = state.currentPly;
    const move = findMoveForCurrentBoard();
    const board = findBoardElement();
    const overlay = ensureBoardOverlay();
    if (!overlay) return;

    if (!move || !board || !move.bestMove || move.bestMove.length < 4) {
      overlay.style.display = "none";
      if (previousPly !== state.currentPly) {
        renderMoves(state.result ? state.result.moves : state.partialMoves);
        renderCoach(state.result ? state.result.moves : state.partialMoves);
      }
      return;
    }

    state.currentPly = move.ply;
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

    overlay.style.display = "block";
    overlay.style.left = `${geometry.left}px`;
    overlay.style.top = `${geometry.top}px`;
    overlay.style.width = `${size}px`;
    overlay.style.height = `${size}px`;

    for (const line of [arrow, arrowShadow]) {
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
    }

    playedSquare.style.left = `${playedTo.x - playedTo.squareSize / 2}px`;
    playedSquare.style.top = `${playedTo.y - playedTo.squareSize / 2}px`;
    playedSquare.style.width = `${playedTo.squareSize}px`;
    playedSquare.style.height = `${playedTo.squareSize}px`;

    badge.textContent = gradeGlyph(move.grade);
    badge.style.background = gradeColor(move.grade);
    badge.title = move.grade;
    badge.style.left = `${playedTo.x + playedTo.squareSize / 2 - 34}px`;
    badge.style.top = `${playedTo.y - playedTo.squareSize / 2 + 6}px`;

    label.textContent = move.bestSan ? `Best: ${move.bestSan}` : `Best: ${move.bestMove}`;
    label.style.left = `${Math.min(size - 92, Math.max(4, to.x + inset * 0.6))}px`;
    label.style.top = `${Math.min(size - 26, Math.max(4, to.y - playedTo.squareSize / 2 - 26))}px`;

    if (previousPly !== state.currentPly) {
      renderMoves(state.result ? state.result.moves : state.partialMoves);
      renderCoach(state.result ? state.result.moves : state.partialMoves);
    }
  }

  function resetForNewGame() {
    state.result = null;
    state.partialMoves = [];
    state.currentPly = 0;
    state.gameKey = "";
    setStatus("Ready after a completed game.");
    setProgress(0, 1);
    const summary = role("summary");
    if (summary) summary.innerHTML = "";
    renderPhaseSummary(null);
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
    const glyphs = {
      Book: "B",
      Brilliant: "!!",
      Best: "✓",
      Great: "!",
      Excellent: "!",
      Good: "✓",
      Inaccuracy: "?!",
      Mistake: "?",
      Miss: "!",
      Blunder: "??"
    };
    return glyphs[grade] || "?";
  }

  function gradeColor(grade) {
    const colors = {
      Book: "#627386",
      Brilliant: "#18a7d5",
      Best: "#2c9f48",
      Great: "#6cbf2d",
      Excellent: "#65ad43",
      Good: "#91a057",
      Inaccuracy: "#e5a91f",
      Mistake: "#e56f2c",
      Miss: "#d88718",
      Blunder: "#d9334f"
    };
    return colors[grade] || "#18323a";
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

    setRunning(true);
    setProgress(0, 1);
    showPaste(false);
    const summary = role("summary");
    if (summary) summary.innerHTML = "";
    renderPhaseSummary(null);
    const coach = role("coach");
    if (coach) {
      coach.innerHTML = "";
      coach.classList.remove("visible");
    }
    state.partialMoves = [];
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
        setStatus("Loaded cached analysis.");
        setProgress(1, 1);
        renderSummary(cached.summary);
        renderPhaseSummary(cached.phaseSummary);
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
          renderMoves(state.partialMoves);
          renderCoach(state.partialMoves);
          updateBoardOverlay();
        }
      });

      ensureRunActive(run);
      state.result = result;
      state.partialMoves = result.moves;
      state.currentPly = result.moves.length ? result.moves[result.moves.length - 1].ply : 0;
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

  function closePanel() {
    if (state.disposed) return false;

    stop(false);
    state.disposed = true;
    if (monitorId !== null) {
      clearInterval(monitorId);
      monitorId = null;
    }
    removeBoardOverlay();
    host.remove();
    return true;
  }

  function bindEvents() {
    action("analyze").addEventListener("click", () => analyze(""));
    action("analyze-paste").addEventListener("click", () => analyze(role("pgn").value));
    action("stop").addEventListener("click", () => stop());
    action("close").addEventListener("click", closePanel);
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
      if (state.gameKey && visibleGameKey !== state.gameKey) {
        resetForNewGame();
      }
    }
    if (state.result || state.partialMoves.length) updateBoardOverlay();
  }, 500);
})();
