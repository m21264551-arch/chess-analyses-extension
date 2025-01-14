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

  function materialCoachPhrase(move) {
    const delta = Number(move && move.materialDelta) || 0;
    if (delta <= -850) return " It also gave up queen-level material.";
    if (delta <= -450) return " It also gave up rook-level material.";
    if (delta <= -250) return " It also gave up at least a minor piece of material.";
    if (delta >= 250 && move && move.captured) {
      return " Even though it won material, the resulting position was still worse than the best line.";
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

  function buildCoachNote(details) {
    const grade = details.grade;
    const best = details.bestSan || details.bestMove || "";
    const comparison = best ? ` compared with ${best}` : " compared with the engine's top move";
    const colorName = details.colorName || "The moving side";
    const evalText = `${colorName}'s eval went from ${formatMoverEval(details.evalBefore)} to ${formatMoverEval(details.evalAfter)}.`;
    const lineText = details.pv ? ` The cleaner line starts ${details.pv}.` : "";
    const materialText = materialCoachPhrase(details);
    const tacticalReason = motifReason(details.motifs);

    if (grade === grading.LABELS.BOOK) {
      return `${details.san} was book because it follows a common opening line. ${evalText}${lineText}`;
    }

    if (grade === grading.LABELS.BRILLIANT) {
      return `${details.san} was brilliant because it kept the engine eval strong while giving up material for activity. ${evalText}${lineText}`;
    }

    if (grade === grading.LABELS.BEST) {
      return `${details.san} was best because it matched Stockfish's top choice. ${evalText}${lineText}`;
    }

    if (grade === grading.LABELS.GREAT) {
      return `${details.san} was a great move because it stayed close to the best line and found a sharp improvement. ${evalText}${lineText}`;
    }

    if (grade === grading.LABELS.EXCELLENT || grade === grading.LABELS.GOOD) {
      return `${details.san} was ${grade.toLowerCase()} because it only gave up ${formatLoss(details.loss)}${comparison}. ${evalText}${lineText}`;
    }

    if (grade === grading.LABELS.MISS) {
      return `${details.san} was a miss because ${tacticalReason || `it let a ${formatLoss(details.loss)} chance slip`}. ${evalText}${lineText}`;
    }

    return `${details.san} was ${gradeArticle(grade)} ${String(grade || "move").toLowerCase()} because ${tacticalReason || `it gave up ${formatLoss(details.loss)}${comparison}`}. ${evalText}${tacticalReason ? "" : materialText}${lineText}`;
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
    const firstOpeningIssue = openingMoves.find((move) => {
      return [grading.LABELS.INACCURACY, grading.LABELS.MISTAKE, grading.LABELS.MISS, grading.LABELS.BLUNDER].includes(move.grade);
    });
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

  async function analyzeGame(options) {
    ensureNotCancelled(options.signal);

    const ChessCtor = options.ChessCtor || browserChess;
    if (!pgnTools || !grading || !stockfishTools || !ChessCtor) {
      throw new Error("Analysis dependencies are not available.");
    }

    const parsed = pgnTools.parseGamePgn(options.pgn, ChessCtor);
    ensureNotCancelled(options.signal);

    const engine = options.engineFactory
      ? options.engineFactory()
      : new stockfishTools.StockfishEngine({
          scriptUrl: options.scriptUrl,
          wasmUrl: options.wasmUrl,
          depth: options.depth || 14
        });

    const results = [];
    const historyUci = [];

    try {
      ensureNotCancelled(options.signal);
      await engine.init();
      for (let index = 0; index < parsed.moves.length; index += 1) {
        ensureNotCancelled(options.signal);
        const move = parsed.moves[index];
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
        const isBook = isBookMove(historyUci, move.uci, move.ply);
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

        const result = {
          ply: move.ply,
          moveNumber: move.moveNumber,
          color: move.color,
          colorName: moveColorName(move.color),
          san: move.san,
          uci: move.uci,
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
            colorName: moveColorName(move.color)
          }),
          heuristicNote: [grading.LABELS.BOOK, grading.LABELS.BRILLIANT, grading.LABELS.GREAT, grading.LABELS.MISS].includes(grade)
            ? "Extension heuristic, not Chess.com's exact review label."
            : ""
        };
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
      if (options.disposeEngine !== false && engine && typeof engine.terminate === "function") {
        await engine.terminate();
      }
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
    buildCoachNote,
    buildPhaseSummary,
    lineToSan,
    summarize,
    uciToSan
  };
});
