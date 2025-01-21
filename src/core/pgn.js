(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ChessCoachPgn = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0
  };

  const MAX_ANALYSIS_PGN_CHARS = 200000;
  const MAX_ANALYSIS_PLIES = 500;

  function normalizePgn(pgn) {
    return String(pgn || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function getHeader(pgn, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = normalizePgn(pgn).match(new RegExp("\\[" + escaped + "\\s+\"([^\"]*)\"\\]", "i"));
    return match ? match[1] : "";
  }

  function isFinishedResult(result) {
    return result === "1-0" || result === "0-1" || result === "1/2-1/2";
  }

  function isUnsupportedVariant(headers) {
    const variant = String(headers.Variant || headers.Rules || "").toLowerCase();
    return Boolean(variant && variant !== "standard" && variant !== "chess");
  }

  function materialBalance(chess, color) {
    const board = chess.board();
    let white = 0;
    let black = 0;

    for (const row of board) {
      for (const piece of row) {
        if (!piece) continue;
        if (piece.color === "w") white += PIECE_VALUES[piece.type] || 0;
        if (piece.color === "b") black += PIECE_VALUES[piece.type] || 0;
      }
    }

    return color === "w" ? white - black : black - white;
  }

  function moveToUci(move) {
    return `${move.from}${move.to}${move.promotion || ""}`;
  }

  function getHeaders(chess) {
    return typeof chess.getHeaders === "function" ? chess.getHeaders() : chess.header();
  }

  function parseGamePgn(pgn, ChessCtor) {
    if (!ChessCtor) {
      throw new Error("Chess.js is not available.");
    }

    const clean = normalizePgn(pgn);
    if (!clean) {
      throw new Error("No PGN found.");
    }

    if (clean.length > MAX_ANALYSIS_PGN_CHARS) {
      const error = new Error("PGN is too large to analyze.");
      error.code = "PGN_TOO_LARGE";
      throw error;
    }

    const loaded = new ChessCtor();
    try {
      loaded.loadPgn(clean, { strict: false });
    } catch (error) {
      throw new Error(`Could not read PGN: ${error.message || error}`);
    }

    const headers = getHeaders(loaded);
    const result = headers.Result || getHeader(clean, "Result") || "*";

    if (!isFinishedResult(result)) {
      const error = new Error("Analysis is available after the game ends.");
      error.code = "GAME_NOT_FINISHED";
      throw error;
    }

    if (isUnsupportedVariant(headers)) {
      const error = new Error("This extension supports standard chess games only.");
      error.code = "UNSUPPORTED_VARIANT";
      throw error;
    }

    if (headers.SetUp === "1" || headers.FEN) {
      const error = new Error("Custom starting positions and Chess960 are not supported in v1.");
      error.code = "UNSUPPORTED_START";
      throw error;
    }

    const history = loaded.history({ verbose: true });
    if (!history.length) {
      throw new Error("The PGN has no moves to analyze.");
    }

    if (history.length > MAX_ANALYSIS_PLIES) {
      const error = new Error("Game is too long to analyze.");
      error.code = "PGN_TOO_LARGE";
      throw error;
    }

    const replay = new ChessCtor();
    const moves = [];

    for (const historicalMove of history) {
      const beforeFen = replay.fen();
      const color = replay.turn();
      const beforeMaterial = materialBalance(replay, color);
      const played = replay.move(historicalMove.san, { strict: false });

      if (!played) {
        throw new Error(`Could not replay move ${historicalMove.san}.`);
      }

      const afterMaterial = materialBalance(replay, color);
      moves.push({
        ply: moves.length + 1,
        moveNumber: Math.ceil((moves.length + 1) / 2),
        color,
        san: played.san,
        uci: moveToUci(played),
        piece: played.piece || "",
        from: played.from || "",
        to: played.to || "",
        flags: played.flags || "",
        beforeFen,
        afterFen: replay.fen(),
        materialDelta: afterMaterial - beforeMaterial,
        captured: played.captured || "",
        promotion: played.promotion || ""
      });
    }

    return {
      headers,
      result,
      moves,
      pgn: clean
    };
  }

  function splitPgnGames(pgnText) {
    const clean = normalizePgn(pgnText);
    if (!clean) return [];
    return clean
      .split(/\n(?=\[Event\s+")/g)
      .map((game) => game.trim())
      .filter(Boolean);
  }

  function selectGameFromArchive(archivePgn, gameId) {
    if (!gameId) return null;
    const id = String(gameId);
    return (
      splitPgnGames(archivePgn).find((game) => {
        const link = getHeader(game, "Link") || getHeader(game, "Site");
        return link.includes(id) || game.includes(`/game/live/${id}`) || game.includes(`/game/daily/${id}`);
      }) || null
    );
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  return {
    getHeader,
    hashString,
    isFinishedResult,
    materialBalance,
    MAX_ANALYSIS_PGN_CHARS,
    MAX_ANALYSIS_PLIES,
    normalizePgn,
    parseGamePgn,
    selectGameFromArchive,
    splitPgnGames
  };
});
