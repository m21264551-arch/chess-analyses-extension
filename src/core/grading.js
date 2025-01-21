(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ChessCoachGrading = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MATE_CP = 100000;

  const LABELS = {
    BOOK: "Book",
    BRILLIANT: "Brilliant",
    BEST: "Best",
    GREAT: "Great",
    EXCELLENT: "Excellent",
    GOOD: "Good",
    INACCURACY: "Inaccuracy",
    MISTAKE: "Mistake",
    MISS: "Miss",
    BLUNDER: "Blunder"
  };
  const GRADE_ORDER = [
    LABELS.BOOK,
    LABELS.BRILLIANT,
    LABELS.BEST,
    LABELS.GREAT,
    LABELS.EXCELLENT,
    LABELS.GOOD,
    LABELS.INACCURACY,
    LABELS.MISTAKE,
    LABELS.MISS,
    LABELS.BLUNDER
  ];
  const GRADE_SORT = new Map(GRADE_ORDER.map((label, index) => [label, index]));

  function scoreToCentipawns(score) {
    if (!score) return 0;
    if (Number.isFinite(score.cp)) return score.cp;
    if (Number.isFinite(score.mate)) {
      const sign = score.mate >= 0 ? 1 : -1;
      const distancePenalty = Math.min(Math.abs(score.mate), 100) * 100;
      return sign * (MATE_CP - distancePenalty);
    }
    return 0;
  }

  function parseUciInfo(line) {
    const tokens = String(line || "").trim().split(/\s+/);
    if (tokens[0] !== "info") return null;

    const parsed = {
      multipv: 1,
      depth: null,
      score: null,
      pv: []
    };

    for (let i = 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "depth") parsed.depth = Number(tokens[++i]);
      if (token === "multipv") parsed.multipv = Number(tokens[++i]);
      if (token === "score") {
        const type = tokens[++i];
        const value = Number(tokens[++i]);
        parsed.score = type === "mate" ? { mate: value } : { cp: value };
      }
      if (token === "pv") {
        parsed.pv = tokens.slice(i + 1);
        break;
      }
    }

    return parsed.score ? parsed : null;
  }

  function normalizeLoss(loss) {
    if (!Number.isFinite(loss)) return 0;
    return Math.max(0, Math.round(loss));
  }

  function classifyMove(input) {
    const loss = normalizeLoss(input.loss);
    const improvement = (input.playedScore || 0) - (input.beforeScore || 0);
    const tacticalSwing = Number.isFinite(input.tacticalSwing)
      ? Math.abs(input.tacticalSwing)
      : Math.abs((input.bestScore || 0) - (input.beforeScore || 0));

    if (input.isBook) {
      return LABELS.BOOK;
    }

    if (input.isSacrifice && loss <= 25 && improvement >= -25) {
      return LABELS.BRILLIANT;
    }

    if (input.playedWasBest || loss <= 10) {
      return LABELS.BEST;
    }

    if (loss <= 40 && (tacticalSwing >= 150 || improvement >= 120)) {
      return LABELS.GREAT;
    }

    if (
      input.missedOpportunity ||
      (!input.playedWasBest && loss >= 120 && (input.beforeScore || 0) >= 150 && (input.playedScore || 0) > -150 && tacticalSwing >= 150)
    ) {
      return LABELS.MISS;
    }

    if (loss <= 25) return LABELS.EXCELLENT;
    if (loss <= 60) return LABELS.GOOD;
    if (loss <= 120) return LABELS.INACCURACY;
    if (loss <= 250) return LABELS.MISTAKE;
    return LABELS.BLUNDER;
  }

  function gradeSortValue(label) {
    return GRADE_SORT.has(label) ? GRADE_SORT.get(label) : -1;
  }

  return {
    GRADE_ORDER,
    LABELS,
    MATE_CP,
    classifyMove,
    gradeSortValue,
    normalizeLoss,
    parseUciInfo,
    scoreToCentipawns
  };
});
