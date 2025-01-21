(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./pgn.js"),
      require("./grading.js"),
      require("./stockfish-engine.js"),
      require("../../vendor/chess/chess.js").Chess
    );
  } else {
    const api = factory(
      root.ChessCoachPgn,
      root.ChessCoachGrading,
      root.ChessCoachStockfish,
      root.ChessCoachVendor && root.ChessCoachVendor.Chess
    );
    root.ChessCoachAnalyzer = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (pgnTools, grading, stockfishTools, browserChess) {
  const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 0
  };

  const PIECE_NAMES = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king"
  };

  const BOOK_LINES = [
    ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7"],
    ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d4", "e5d4"],
    ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4", "e5d4", "f3d4"],
    ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3"],
    ["e2e4", "e7e6", "d2d4", "d7d5"],
    ["e2e4", "c7c6", "d2d4", "d7d5"],
    ["e2e4", "d7d6", "d2d4", "g8f6", "b1c3", "g7g6"],
    ["e2e4", "d7d5", "e4d5", "d8d5"],
    ["e2e4", "g8f6", "e4e5", "f6d5", "d2d4", "d7d6"],
    ["e2e4", "g7g6", "d2d4", "f8g7"],
    ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6"],
    ["d2d4", "d7d5", "c2c4", "c7c6", "g1f3", "g8f6"],
    ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4", "d7d6"],
    ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"],
    ["d2d4", "d7d5", "c1f4", "g8f6", "e2e3", "e7e6", "g1f3"],
    ["d2d4", "f7f5", "c2c4", "g8f6", "g2g3"],
    ["c2c4", "e7e5", "b1c3", "g8f6", "g2g3", "d7d5"],
    ["g1f3", "d7d5", "c2c4", "e7e6", "g2g3", "g8f6"]
  ];

  const BOOK_INDEX = buildBookIndex(BOOK_LINES);

  function buildBookIndex(lines) {
    const index = Object.create(null);
    for (const line of lines) {
      for (let i = 0; i < line.length; i += 1) {
        const prefix = line.slice(0, i).join(" ");
        if (!index[prefix]) index[prefix] = new Set();
        index[prefix].add(line[i]);
      }
    }

    return Object.fromEntries(Object.entries(index).map(([prefix, moves]) => [prefix, Array.from(moves)]));
  }

  function isBookMove(historyUci, uci, ply) {
    if (!uci || ply > 16) return false;
    const moves = BOOK_INDEX[historyUci.join(" ")] || [];
    return moves.includes(uci);
  }

  function ensureNotCancelled(signal) {
    if (signal && signal.cancelled) {
      const error = new Error("Analysis stopped.");
      error.code = "STOPPED";
      throw error;
    }
  }

  function analysisChessCtor(options) {
    const ChessCtor = (options && options.ChessCtor) || browserChess;
    if (!pgnTools || !grading || !stockfishTools || !ChessCtor) {
      throw new Error("Analysis dependencies are not available.");
    }
    return ChessCtor;
  }

  function createEngine(options) {
    if (options.engineFactory) return options.engineFactory();
    return new stockfishTools.StockfishEngine({
      scriptUrl: options.scriptUrl,
      wasmUrl: options.wasmUrl,
      depth: options.depth || 14
    });
  }

  async function disposeEngine(engine, options) {
    if (options.disposeEngine === false || !engine || typeof engine.terminate !== "function") return;
    await engine.terminate();
  }

  function moveColorName(color) {
    return color === "w" ? "White" : "Black";
  }

  function uciToSan(uci, fen, ChessCtor) {
    if (!uci || uci === "(none)") return "";
    try {
      const chess = new ChessCtor(fen);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined
      });
      return move ? move.san : uci;
    } catch (_error) {
      return uci;
    }
  }

  function lineToSan(pv, fen, ChessCtor, maxMoves) {
    if (!Array.isArray(pv) || !pv.length) return "";
    try {
      const chess = new ChessCtor(fen);
      const sanMoves = [];
      for (const uci of pv.slice(0, maxMoves || 5)) {
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.slice(4, 5) || undefined
        });
        if (!move) break;
        sanMoves.push(move.san);
      }
      return sanMoves.join(" ");
    } catch (_error) {
      return pv.slice(0, maxMoves || 5).join(" ");
    }
  }

  function pieceName(type) {
    return PIECE_NAMES[String(type || "").toLowerCase()] || "piece";
  }

  function opponent(color) {
    return color === "w" ? "b" : "w";
  }

  function moveLabel(move) {
    if (!move) return "";
    return `${move.moveNumber}${move.color === "b" ? "..." : "."} ${move.san}`;
  }

  function moveInfoForUci(uci, fen, ChessCtor) {
    if (!uci || uci === "(none)" || uci.length < 4) return null;
    try {
      const chess = new ChessCtor(fen);
      const played = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined
      });
      if (!played) return null;
      return {
        ...played,
        givesCheck: /[+#]/.test(played.san),
        checkmate: /#/.test(played.san)
      };
    } catch (_error) {
      return null;
    }
  }

  function attackersFor(chess, square, color) {
    if (typeof chess.attackers !== "function") return [];
    try {
      return chess.attackers(square, color) || [];
    } catch (_error) {
      return [];
    }
  }

  function leastAttackerValue(chess, squares) {
    return squares.reduce((lowest, square) => {
      const piece = chess.get(square);
      const value = piece ? PIECE_VALUES[piece.type] || 0 : 0;
      return lowest === 0 || value < lowest ? value : lowest;
    }, 0);
  }

  function hangingMovedPiece(move, ChessCtor) {
    if (!move.uci || move.uci.length < 4) return null;
    try {
      const to = move.uci.slice(2, 4);
      const chess = new ChessCtor(move.afterFen);
      const piece = chess.get(to);
      if (!piece || piece.type === "k") return null;

      const attackers = attackersFor(chess, to, opponent(piece.color));
      if (!attackers.length) return null;

      const defenders = attackersFor(chess, to, piece.color);
      const pieceValue = PIECE_VALUES[piece.type] || 0;
      const cheapestAttacker = leastAttackerValue(chess, attackers);
      const canWinMaterial = cheapestAttacker > 0 && pieceValue > 0 && cheapestAttacker < pieceValue;

      if (!defenders.length || canWinMaterial) {
        return {
          piece: pieceName(piece.type),
          square: to,
          defended: Boolean(defenders.length)
        };
      }
    } catch (_error) {
      return null;
    }

    return null;
  }

  function fenWithTurn(fen, color) {
    const parts = String(fen || "").split(" ");
    if (parts.length < 2) return fen;
    parts[1] = color;
    return parts.join(" ");
  }

  function materialGainDescription(move) {
    const captured = String(move && move.captured || "").toLowerCase();
    const delta = Number(move && move.materialDelta) || 0;
    if (captured === "q" || delta >= 850) return "it wins queen-level material";
    if (captured === "r" || delta >= 450) return "it wins a rook";
    if (captured === "b" || captured === "n" || delta >= 250) return `it wins a ${captured === "b" ? "bishop" : captured === "n" ? "knight" : "minor piece"}`;
    if (captured === "p" || delta >= 90) return "it wins a pawn";
    return "";
  }

  function squareToPoint(square) {
    return {
      file: square.charCodeAt(0) - 97,
      rank: Number(square[1]) - 1
    };
  }

  function pointToSquare(file, rank) {
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return "";
    return `${String.fromCharCode(97 + file)}${rank + 1}`;
  }

  function rayDirections(type) {
    const diagonals = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ];
    const lines = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    if (type === "b") return diagonals;
    if (type === "r") return lines;
    if (type === "q") return diagonals.concat(lines);
    return [];
  }

  function pinOrSkewerMotif(move, ChessCtor) {
    if (!move.uci || move.uci.length < 4) return "";
    try {
      const to = move.uci.slice(2, 4);
      const chess = new ChessCtor(move.afterFen);
      const movedPiece = chess.get(to);
      if (!movedPiece || !rayDirections(movedPiece.type).length) return "";

      const start = squareToPoint(to);
      for (const [fileStep, rankStep] of rayDirections(movedPiece.type)) {
        const pieces = [];
        let file = start.file + fileStep;
        let rank = start.rank + rankStep;
        while (file >= 0 && file <= 7 && rank >= 0 && rank <= 7) {
          const square = pointToSquare(file, rank);
          const piece = chess.get(square);
          if (piece) pieces.push({ square, piece });
          file += fileStep;
          rank += rankStep;
        }

        const first = pieces[0];
        const second = pieces[1];
        if (!first || first.piece.color === movedPiece.color || !second || second.piece.color === movedPiece.color) continue;
        if (first.piece.type !== "k" && second.piece.type === "k") {
          return `it pins the ${pieceName(first.piece.type)} on ${first.square} to the king`;
        }
        if (first.piece.type === "k" && (PIECE_VALUES[second.piece.type] || 0) >= 500) {
          return `it skewers the king to the ${pieceName(second.piece.type)} on ${second.square}`;
        }
      }
    } catch (_error) {
      return "";
    }

    return "";
  }

  function movedPieceCaptureTargets(move, ChessCtor) {
    if (!move.uci || move.uci.length < 4) return [];
    try {
      const to = move.uci.slice(2, 4);
      const chess = new ChessCtor(fenWithTurn(move.afterFen, move.color));
      return chess
        .moves({ square: to, verbose: true })
        .filter((candidate) => candidate.captured)
        .map((candidate) => ({
          san: candidate.san,
          square: candidate.to,
          piece: candidate.captured,
          value: PIECE_VALUES[candidate.captured] || 0
        }))
        .filter((target) => target.value >= 300)
        .sort((a, b) => b.value - a.value);
    } catch (_error) {
      return [];
    }
  }

  function targetListText(targets) {
    const names = targets.slice(0, 2).map((target) => `${pieceName(target.piece)} on ${target.square}`);
    if (names.length <= 1) return names[0] || "";
    return `${names[0]} and ${names[1]}`;
  }

  function forkMotif(move, moveInfo, ChessCtor) {
    const targets = movedPieceCaptureTargets(move, ChessCtor);
    if (moveInfo && moveInfo.givesCheck && targets.length) {
      return `it comes with check while also attacking the ${targetListText(targets)}`;
    }
    if (targets.length >= 2) {
      return `it creates a fork by attacking the ${targetListText(targets)}`;
    }
    return "";
  }

  function quietMoveIdea(move, moveInfo) {
    const piece = String((moveInfo && moveInfo.piece) || move.piece || "").toLowerCase();
    const san = String(move.san || "");
    const to = move.to || (move.uci && move.uci.slice(2, 4)) || "";
    const from = move.from || (move.uci && move.uci.slice(0, 2)) || "";

    if (/^O-O/.test(san)) return "it gets the king safe and brings a rook closer to the game";
    if (piece === "p" && /^[de][45]$/.test(to)) return "it takes central space and gives your pieces better squares";
    if ((piece === "n" || piece === "b") && (from[1] === "1" || from[1] === "8")) {
      return `it develops a ${pieceName(piece)} instead of leaving it on the back rank`;
    }
    if (piece === "r") return "it improves rook activity and puts pressure on open lines";
    if (piece === "q") return "it improves the queen's activity without losing time to a tactic";
    return "it is mainly an optimization move: it improves the piece placement without creating a new weakness";
  }

  function positiveMoveIdea(details) {
    const moveInfo = moveInfoForUci(details.uci, details.beforeFen, details.ChessCtor);
    const ideas = [];

    if (moveInfo && moveInfo.checkmate) {
      ideas.push("delivers checkmate");
    }

    const gain = materialGainDescription(details);
    if (gain) {
      ideas.push(gain);
    }

    const fork = forkMotif(details, moveInfo, details.ChessCtor);
    if (fork) {
      ideas.push(fork);
    }

    const pin = pinOrSkewerMotif(details, details.ChessCtor);
    if (pin) {
      ideas.push(pin);
    }

    if (moveInfo && moveInfo.givesCheck && !ideas.some((idea) => /check/.test(idea))) {
      ideas.push("it comes with check, so the opponent has to answer your threat first");
    }

    if (!ideas.length) {
      ideas.push(quietMoveIdea(details, moveInfo));
    }

    const selected = ideas.slice(0, 2);
    if (selected.length <= 1) return selected[0] || "";
    return `${selected[0]}. It also ${selected[1].replace(/^it\s+/i, "")}`;
  }

  function continuationSentence(details) {
    if (!details.pv) return "";
    return `A natural continuation is ${details.pv}; the point is the idea, not memorizing the whole line.`;
  }

  function gradePhrase(grade) {
    if (grade === grading.LABELS.GREAT) return "a great move";
    if (grade === grading.LABELS.BOOK) return "book";
    if (grade === grading.LABELS.MISS) return "a miss";
    if (grade === grading.LABELS.INACCURACY) return "an inaccuracy";
    if (grade === grading.LABELS.MISTAKE) return "a mistake";
    if (grade === grading.LABELS.BLUNDER) return "a blunder";
    return String(grade || "move").toLowerCase();
  }

  function isOpeningIssueGrade(grade) {
    return (
      grade === grading.LABELS.INACCURACY ||
      grade === grading.LABELS.MISTAKE ||
      grade === grading.LABELS.MISS ||
      grade === grading.LABELS.BLUNDER
    );
  }

  function isHeuristicNoteGrade(grade) {
    return (
      grade === grading.LABELS.BOOK ||
      grade === grading.LABELS.BRILLIANT ||
      grade === grading.LABELS.GREAT ||
      grade === grading.LABELS.MISS
    );
  }

  function coachPositiveSentence(details) {
    const idea = positiveMoveIdea(details);
    if (/wins (?:queen|a rook|a bishop|a knight|a minor piece|a pawn)/i.test(idea)) {
      return ensureSentence(sentenceCase(idea));
    }
    if (/\bfork\b/i.test(idea)) {
      return ensureSentence(sentenceCase(idea.replace(/^it creates/i, "this creates").replace(/^it comes/i, "this comes")));
    }
    if (/\bpins?\b|\bskewers?\b/i.test(idea)) {
      return ensureSentence(sentenceCase(idea));
    }
    if (/\bcheck\b/i.test(idea)) {
      return "A forcing check. The opponent has to answer before doing anything else.";
    }
    if (/\bcentral space\b|\bbetter squares\b/i.test(idea)) {
      return "Good thinking! This takes space and gives your pieces better squares.";
    }
    if (/\bdevelops\b|\bactivity\b|\bactive\b|\boptimization\b|\bpiece placement\b/i.test(idea)) {
      return "Good thinking! This move puts your piece into a stronger, more active position.";
    }
    return "They are right on target.";
  }

  function nonKingMaterial(fen, ChessCtor) {
    try {
      const chess = new ChessCtor(fen);
      let total = 0;
      let queens = 0;
      let pieces = 0;
      for (const row of chess.board()) {
        for (const piece of row) {
          if (!piece || piece.type === "k") continue;
          total += PIECE_VALUES[piece.type] || 0;
          if (piece.type === "q") queens += 1;
          if (piece.type !== "p") pieces += 1;
        }
      }
      return { total, queens, pieces };
    } catch (_error) {
      return { total: 7800, queens: 2, pieces: 14 };
    }
  }

  function isEndgameFen(fen, ChessCtor) {
    const material = nonKingMaterial(fen, ChessCtor);
    return material.total <= 2600 || (material.queens === 0 && material.pieces <= 4);
  }

  function phaseForMove(move, isBook, ChessCtor) {
    if (isEndgameFen(move.beforeFen, ChessCtor)) return "Endgame";
    if (isBook || move.ply <= 16) return "Opening";
    return "Middlegame";
  }

  function formatMoverEval(score) {
    if (!Number.isFinite(score)) return "unclear";
    if (Math.abs(score) >= grading.MATE_CP - 10000) {
      return score >= 0 ? "winning by force" : "getting mated";
    }
    const sign = score >= 0 ? "+" : "-";
    return `${sign}${(Math.abs(score) / 100).toFixed(2)}`;
  }

  function formatLoss(loss) {
    const normalized = grading.normalizeLoss(loss);
    if (normalized >= grading.MATE_CP - 10000) return "a forced-mate swing";
    if (normalized < 100) return `${normalized} centipawns`;
    const pawns = normalized / 100;
    return `about ${pawns.toFixed(pawns >= 10 ? 0 : 1)} pawns`;
  }

  function gradeArticle(grade) {
    return /^[aeiou]/i.test(String(grade || "")) ? "an" : "a";
  }

  function sentenceCase(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return value[0].toUpperCase() + value.slice(1);
  }

  function ensureSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return /[.!?]$/.test(value) ? value : `${value}.`;
  }

  function materialCoachPhrase(move) {
    const delta = Number(move && move.materialDelta) || 0;
    if (delta <= -850) return "it gave up queen-level material";
    if (delta <= -450) return "it gave up rook-level material";
    if (delta <= -250) return "it gave up at least a minor piece of material";
    if (delta >= 250 && move && move.captured) {
      return "the capture won material, but the resulting position was still worse than the best line";
    }
    return "";
  }

  function hasMatingScore(line) {
    return Boolean(line && line.score && Number.isFinite(line.score.mate) && line.score.mate > 0);
  }

  function isMissedOpportunity(details) {
    if (details.playedWasBest || details.isBook) return false;
    if (hasMatingScore(details.bestLine) && details.playedScore < grading.MATE_CP - 10000) return true;
    return (
      details.loss >= 120 &&
      details.beforeScore >= 150 &&
      details.playedScore > -150 &&
      details.tacticalSwing >= 150
    );
  }

  function pushMotif(motifs, type, text) {
    if (!motifs.some((motif) => motif.type === type)) {
      motifs.push({ type, text });
    }
  }

  function detectMotifs(details) {
    const motifs = [];
    const bestInfo = moveInfoForUci(details.bestMove, details.move.beforeFen, details.ChessCtor);

    if (hasMatingScore(details.bestLine) && details.missedOpportunity) {
      pushMotif(motifs, "missed-mate", "there was a forced mate available");
    }

    if (details.playedScore <= -grading.MATE_CP + 10000) {
      pushMotif(motifs, "allowed-mate", "it lets the opponent force mate");
    }

    if (bestInfo && bestInfo.captured && details.loss >= 80) {
      pushMotif(
        motifs,
        "missed-capture",
        `the engine's line starts by capturing a ${pieceName(bestInfo.captured)} with ${bestInfo.san}`
      );
    }

    if (bestInfo && bestInfo.givesCheck && details.loss >= 80) {
      pushMotif(motifs, "missed-check", `${bestInfo.san} was the forcing move`);
    }

    const hanging = hangingMovedPiece(details.move, details.ChessCtor);
    if (hanging && details.loss >= 60) {
      pushMotif(
        motifs,
        "hanging-piece",
        `the moved ${hanging.piece} on ${hanging.square} can be attacked${hanging.defended ? " by a cheaper piece" : " with no defender"}`
      );
    }

    if (details.move.materialDelta <= -250) {
      pushMotif(motifs, "material-loss", `it gave up ${materialLossDescription(details.move.materialDelta)}`);
    }

    if (details.move.captured && details.move.materialDelta >= 250 && details.loss >= 120) {
      pushMotif(motifs, "bad-capture", "the capture won material, but the resulting position was still worse than the best line");
    }

    return motifs;
  }

  function materialLossDescription(delta) {
    if (delta <= -850) return "queen-level material";
    if (delta <= -450) return "rook-level material";
    return "at least a minor piece";
  }

  function motifReason(motifs) {
    if (!Array.isArray(motifs) || !motifs.length) return "";
    return motifs.slice(0, 2).map((motif) => motif.text).join(". Also, ");
  }

  function coachEvalContext(details) {
    const colorName = details.colorName || "The moving side";
    return `For context, ${colorName}'s evaluation changed from ${formatMoverEval(details.evalBefore)} to ${formatMoverEval(details.evalAfter)}.`;
  }

  function betterMoveSentence(details) {
    const best = details.bestSan || details.bestMove || "";
    if (!best) return "";
    if (details.pv) {
      return `A cleaner plan was ${best}, with a sample line starting ${details.pv}.`;
    }
    return `A cleaner plan was ${best}.`;
  }

  function coachReason(details) {
    const tacticalReason = motifReason(details.motifs);
    if (tacticalReason) return tacticalReason;

    const materialText = materialCoachPhrase(details);
    if (materialText) return materialText;

    const best = details.bestSan || details.bestMove || "";
    if (best) {
      return `${best} dealt with the position more directly, while ${details.san} gave the opponent easier play`;
    }

    return "it gave the opponent easier play";
  }

  function buildCoachNote(details) {
    const grade = details.grade;
    const best = details.bestSan || details.bestMove || "";
    const betterMove = betterMoveSentence(details);
    const reason = ensureSentence(sentenceCase(coachReason(details)));

    if (grade === grading.LABELS.BOOK) {
      return `${details.san} is book. This follows a known opening plan.`;
    }

    if (grade === grading.LABELS.BRILLIANT) {
      return `${details.san} is brilliant. ${coachPositiveSentence(details)}`;
    }

    if (grade === grading.LABELS.BEST) {
      return `${details.san} is best. ${coachPositiveSentence(details)}`;
    }

    if (grade === grading.LABELS.GREAT) {
      return `${details.san} is a great move. ${coachPositiveSentence(details)}`;
    }

    if (grade === grading.LABELS.EXCELLENT) {
      return `${details.san} is excellent. ${coachPositiveSentence(details)}`;
    }

    if (grade === grading.LABELS.GOOD) {
      return `${details.san} is good. ${coachPositiveSentence(details)} ${best && best !== details.san ? `${best} was cleaner.` : ""}`;
    }

    if (grade === grading.LABELS.MISS) {
      return `${details.san} is a miss. ${reason} ${betterMove}`;
    }

    return `${details.san} is ${gradePhrase(grade)}. ${reason} ${betterMove}`;
  }

  function moveDetailsForUci(uci, baseMove, ChessCtor) {
    if (!uci || uci === "(none)" || uci.length < 4) return null;
    try {
      const chess = new ChessCtor(baseMove.beforeFen);
      const beforeMaterial = pgnTools.materialBalance(chess, baseMove.color);
      const played = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined
      });
      if (!played) return null;
      const afterMaterial = pgnTools.materialBalance(chess, baseMove.color);
      return {
        ply: baseMove.ply,
        moveNumber: baseMove.moveNumber,
        color: baseMove.color,
        san: played.san,
        uci,
        piece: played.piece || "",
        from: played.from || "",
        to: played.to || "",
        flags: played.flags || "",
        captured: played.captured || "",
        promotion: played.promotion || "",
        materialDelta: afterMaterial - beforeMaterial,
        beforeFen: baseMove.beforeFen,
        afterFen: chess.fen(),
        ChessCtor
      };
    } catch (_error) {
      return null;
    }
  }

  function buildBranches(lines, baseMove, ChessCtor) {
    if (!Array.isArray(lines) || !lines.length) return [];
    return lines.slice(0, 3).map((line, index) => {
      const uci = line && line.pv && line.pv[0] ? line.pv[0] : "";
      const details = moveDetailsForUci(uci, baseMove, ChessCtor);
      if (!details) return null;
      const pv = lineToSan(line.pv, baseMove.beforeFen, ChessCtor, 6);
      return {
        rank: index + 1,
        san: details.san,
        uci,
        eval: line && line.score ? Math.round(grading.scoreToCentipawns(line.score)) : 0,
        pv,
        pvSans: pv ? pv.split(/\s+/).filter(Boolean) : [],
        pvUci: Array.isArray(line.pv) ? line.pv.slice(0, 6) : [],
        note: coachPositiveSentence(details)
      };
    }).filter(Boolean);
  }

  function summarize(results) {
    return results.reduce((summary, move) => {
      summary[move.grade] = (summary[move.grade] || 0) + 1;
      return summary;
    }, {});
  }

  function openingNameFromHeaders(headers) {
    return headers.Opening || headers.ECO || headers.Variant || "";
  }

  function worstMove(moves) {
    if (!moves.length) return null;
    return moves.reduce((worst, move) => {
      if (!worst) return move;
      if ((move.loss || 0) > (worst.loss || 0)) return move;
      const gradingDelta = grading.gradeSortValue(move.grade) - grading.gradeSortValue(worst.grade);
      return gradingDelta > 0 ? move : worst;
    }, null);
  }

  function phaseLine(label, moves) {
    if (!moves.length) return `${label}: no ${label.toLowerCase()} phase detected.`;
    const worst = worstMove(moves);
    if (!worst || !worst.loss) return `${label}: ${moves.length} moves reviewed without a major engine swing.`;
    return `${label}: biggest swing was ${moveLabel(worst)} (${worst.grade}, ${formatLoss(worst.loss)}).`;
  }

  function buildPhaseSummary(parsed, moves) {
    const openingName = openingNameFromHeaders(parsed.headers || "");
    const bookMoves = moves.filter((move) => move.grade === grading.LABELS.BOOK);
    const openingMoves = moves.filter((move) => move.phase === "Opening");
    const firstOpeningIssue = openingMoves.find((move) => isOpeningIssueGrade(move.grade));
    const lastBook = bookMoves.length ? bookMoves[bookMoves.length - 1] : null;
    const lines = [];

    if (openingName && lastBook) {
      lines.push(`Opening: ${openingName}; local book through ${moveLabel(lastBook)}.`);
    } else if (openingName) {
      lines.push(`Opening: ${openingName}.`);
    } else if (lastBook) {
      lines.push(`Opening: local book through ${moveLabel(lastBook)}.`);
    } else {
      lines.push("Opening: no local book line matched.");
    }

    if (firstOpeningIssue) {
      lines.push(`First opening issue: ${moveLabel(firstOpeningIssue)} (${firstOpeningIssue.grade}, ${formatLoss(firstOpeningIssue.loss)}).`);
    }

    lines.push(phaseLine("Middlegame", moves.filter((move) => move.phase === "Middlegame")));
    lines.push(phaseLine("Endgame", moves.filter((move) => move.phase === "Endgame")));

    return {
      openingName,
      lastBookMove: lastBook ? moveLabel(lastBook) : "",
      firstOpeningIssue: firstOpeningIssue ? moveLabel(firstOpeningIssue) : "",
      lines
    };
  }

  async function analyzeMoveWithEngine(move, engine, options) {
    const ChessCtor = options.ChessCtor || browserChess;
    const before = await engine.evaluate(move.beforeFen, {
      multiPv: options.multiPv || 3,
      depth: options.depth || 14
    });
    ensureNotCancelled(options.signal);
    const after = await engine.evaluate(move.afterFen, {
      multiPv: 1,
      depth: options.depth || 14
    });

    const bestLine = before.lines[0];
    const secondLine = before.lines[1];
    const afterLine = after.lines[0];
    if (!bestLine || !bestLine.score || !afterLine || !afterLine.score) {
      throw new Error("Stockfish did not return a usable evaluation.");
    }

    const beforeScore = grading.scoreToCentipawns(bestLine.score);
    const secondScore = secondLine && secondLine.score ? grading.scoreToCentipawns(secondLine.score) : beforeScore;
    const playedScore = -grading.scoreToCentipawns(afterLine.score);
    const loss = Math.max(0, beforeScore - playedScore);
    const bestMove = before.bestMove || (bestLine.pv && bestLine.pv[0]) || "";
    const playedWasBest = Boolean(bestMove && move.uci === bestMove);
    const isSacrifice = move.materialDelta <= -250;
    const tacticalSwing = beforeScore - secondScore;
    const isBook = Boolean(options.isBook);
    const missedOpportunity = isMissedOpportunity({
      bestLine,
      beforeScore,
      playedScore,
      loss,
      tacticalSwing,
      playedWasBest,
      isBook
    });
    const motifs = detectMotifs({
      move,
      ChessCtor,
      bestMove,
      bestLine,
      beforeScore,
      playedScore,
      loss,
      tacticalSwing,
      missedOpportunity
    });
    const phase = phaseForMove(move, isBook, ChessCtor);
    const grade = grading.classifyMove({
      loss,
      beforeScore,
      bestScore: beforeScore,
      playedScore,
      tacticalSwing,
      playedWasBest,
      isSacrifice,
      isBook,
      missedOpportunity
    });
    const bestSan = uciToSan(bestMove, move.beforeFen, ChessCtor);
    const pv = lineToSan(bestLine.pv, move.beforeFen, ChessCtor, 6);

    return {
      ply: move.ply,
      moveNumber: move.moveNumber,
      color: move.color,
      colorName: moveColorName(move.color),
      san: move.san,
      uci: move.uci,
      piece: move.piece || "",
      from: move.from || "",
      to: move.to || "",
      beforeFen: move.beforeFen,
      afterFen: move.afterFen,
      grade,
      phase,
      motifs,
      loss: Math.round(loss),
      evalBefore: Math.round(beforeScore),
      evalAfter: Math.round(playedScore),
      bestMove,
      bestSan,
      pv,
      branches: buildBranches(before.lines, move, ChessCtor),
      coachNote: buildCoachNote({
        ...move,
        grade,
        loss,
        evalBefore: beforeScore,
        evalAfter: playedScore,
        bestMove,
        bestSan,
        pv,
        motifs,
        ChessCtor,
        colorName: moveColorName(move.color)
      }),
      heuristicNote: isHeuristicNoteGrade(grade)
        ? "Extension heuristic, not Chess.com's exact review label."
        : ""
    };
  }

  async function analyzeMove(options) {
    ensureNotCancelled(options.signal);

    const ChessCtor = analysisChessCtor(options);
    const engine = createEngine(options);

    try {
      await engine.init();
      ensureNotCancelled(options.signal);
      return await analyzeMoveWithEngine(options.move, engine, {
        ...options,
        ChessCtor
      });
    } finally {
      await disposeEngine(engine, options);
    }
  }

  async function analyzeGame(options) {
    ensureNotCancelled(options.signal);

    const ChessCtor = analysisChessCtor(options);

    const parsed = pgnTools.parseGamePgn(options.pgn, ChessCtor);
    ensureNotCancelled(options.signal);

    const engine = createEngine(options);

    const results = [];
    const historyUci = [];

    try {
      ensureNotCancelled(options.signal);
      await engine.init();
      for (let index = 0; index < parsed.moves.length; index += 1) {
        ensureNotCancelled(options.signal);
        const move = parsed.moves[index];
        const isBook = isBookMove(historyUci, move.uci, move.ply);
        const result = await analyzeMoveWithEngine(move, engine, {
          ...options,
          ChessCtor,
          isBook
        });
        results.push(result);
        historyUci.push(move.uci);

        if (typeof options.onProgress === "function") {
          options.onProgress({
            done: index + 1,
            total: parsed.moves.length,
            move: result
          });
        }
      }
    } finally {
      await disposeEngine(engine, options);
    }

    return {
      headers: parsed.headers,
      result: parsed.result,
      moves: results,
      summary: summarize(results),
      phaseSummary: buildPhaseSummary(parsed, results)
    };
  }

  return {
    analyzeGame,
    analyzeMove,
    buildCoachNote,
    buildPhaseSummary,
    lineToSan,
    summarize,
    uciToSan
  };
});
