const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const { Chess } = require("../vendor/chess/chess.js");
const grading = require("../src/core/grading.js");
const stockfishTools = require("../src/core/stockfish-engine.js");
const pgnTools = require("../src/core/pgn.js");
const analyzer = require("../src/core/analyzer.js");
const lichess = require("../src/sites/lichess.js");
const chesscom = require("../src/sites/chesscom.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function makeChessComDoc({ scripts = [], anchors = [], times = [], dataUsernames = [], attributes = {}, moveTexts = [], bodyText = "" } = {}) {
  function decodeHtml(value) {
    return String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  const documentElement = {
    innerHTML: [
      ...scripts,
      ...anchors.map((href) => `<a href="${href}"></a>`),
      ...dataUsernames.map((username) => `<span data-username="${username}"></span>`)
    ].join("\n")
  };

  return {
    documentElement,
    createElement() {
      return {
        value: "",
        set innerHTML(value) {
          this.value = decodeHtml(value);
        }
      };
    },
    querySelectorAll(selector) {
      if (selector === "script") {
        return scripts.map((textContent) => ({ textContent }));
      }
      if (selector === 'a[href*="/member/"]') {
        return anchors.map((href) => ({ href }));
      }
      if (selector === "time[datetime]") {
        return times.map((datetime) => ({ getAttribute: () => datetime }));
      }
      if (selector === "[data-username]") {
        return dataUsernames.map((username) => ({ getAttribute: () => username }));
      }
      if (/move|moves/i.test(selector)) {
        return moveTexts.map((text) => ({ textContent: text, innerText: text }));
      }
      const attributeMatch = selector.match(/^\[([^\]]+)\]$/);
      if (attributeMatch && Object.prototype.hasOwnProperty.call(attributes, attributeMatch[1])) {
        return [{ getAttribute: () => attributes[attributeMatch[1]] }];
      }
      return [];
    },
    body: {
      textContent: bodyText,
      innerText: bodyText
    }
  };
}

test("classifies centipawn loss thresholds", () => {
  assert.equal(grading.classifyMove({ loss: 0, playedWasBest: true }), "Best");
  assert.equal(grading.classifyMove({ loss: 20 }), "Excellent");
  assert.equal(grading.classifyMove({ loss: 50 }), "Good");
  assert.equal(grading.classifyMove({ loss: 100 }), "Inaccuracy");
  assert.equal(grading.classifyMove({ loss: 200 }), "Mistake");
  assert.equal(grading.classifyMove({ loss: 300 }), "Blunder");
});

test("classifies book and missed tactical chances", () => {
  assert.equal(grading.classifyMove({ loss: 300, isBook: true }), "Book");
  assert.equal(
    grading.classifyMove({
      loss: 220,
      beforeScore: 350,
      playedScore: 130,
      tacticalSwing: 250,
      playedWasBest: false
    }),
    "Miss"
  );
});

test("classifies brilliant and great heuristics", () => {
  assert.equal(
    grading.classifyMove({
      loss: 12,
      beforeScore: 0,
      bestScore: 180,
      playedScore: 170,
      isSacrifice: true
    }),
    "Brilliant"
  );
  assert.equal(
    grading.classifyMove({
      loss: 30,
      beforeScore: 0,
      bestScore: 180,
      playedScore: 150,
      tacticalSwing: 180,
      isSacrifice: false
    }),
    "Great"
  );
});

test("converts mate scores to centipawns", () => {
  assert.equal(grading.scoreToCentipawns({ mate: 1 }), 99900);
  assert.equal(grading.scoreToCentipawns({ mate: -3 }), -99700);
});

test("parses UCI info lines", () => {
  const parsed = grading.parseUciInfo("info depth 10 multipv 2 score cp -34 nodes 12 pv e2e4 e7e5");
  assert.equal(parsed.depth, 10);
  assert.equal(parsed.multipv, 2);
  assert.deepEqual(parsed.score, { cp: -34 });
  assert.deepEqual(parsed.pv, ["e2e4", "e7e5"]);
});

test("parses finished PGN", () => {
  const parsed = pgnTools.parseGamePgn(
    `[Event "Unit"]
[Site "https://lichess.org/abcdefgh"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`,
    Chess
  );
  assert.equal(parsed.result, "1-0");
  assert.equal(parsed.moves.length, 7);
  assert.equal(parsed.moves[0].uci, "e2e4");
});

test("analyzes moves with a stubbed engine", async () => {
  const pgn = `[Event "Stub"]
[Result "1-0"]

1. h4 e5 1-0`;
  const parsed = pgnTools.parseGamePgn(pgn, Chess);
  const beforeScores = new Map([
    [parsed.moves[0].beforeFen, { bestMove: parsed.moves[0].uci, cp: 100 }],
    [parsed.moves[1].beforeFen, { bestMove: "g8f6", cp: 100 }]
  ]);
  const afterScores = new Map([
    [parsed.moves[0].afterFen, { cp: -95 }],
    [parsed.moves[1].afterFen, { cp: 260 }]
  ]);

  class StubEngine {
    async init() {}
    terminate() {}
    async evaluate(fen, options) {
      if (options.multiPv > 1) {
        const entry = beforeScores.get(fen);
        return {
          bestMove: entry.bestMove,
          lines: [{ score: { cp: entry.cp }, pv: [entry.bestMove] }]
        };
      }
      const entry = afterScores.get(fen);
      return {
        bestMove: "a7a6",
        lines: [{ score: { cp: entry.cp }, pv: ["a7a6"] }]
      };
    }
  }

  const result = await analyzer.analyzeGame({
    pgn,
    ChessCtor: Chess,
    engineFactory: () => new StubEngine()
  });

  assert.equal(result.moves[0].grade, "Best");
  assert.equal(result.moves[1].grade, "Blunder");
  assert.match(result.moves[1].coachNote, /e5 is a blunder/i);
  assert.match(result.moves[1].coachNote, /Nf6/);
  assert.doesNotMatch(result.moves[1].coachNote, /3\.6 pawns/);
  assert.ok(result.moves[1].branches.length >= 1);
  assert.deepEqual(result.moves[1].branches[0].pvUci, ["g8f6"]);
  assert.equal(result.summary.Best, 1);
  assert.equal(result.summary.Blunder, 1);
});

test("analyzes a single branch move", async () => {
  const before = new Chess();
  const beforeFen = before.fen();
  const beforeMaterial = pgnTools.materialBalance(before, "w");
  const played = before.move("e4");
  const afterMaterial = pgnTools.materialBalance(before, "w");
  const move = {
    ply: 1,
    moveNumber: 1,
    color: "w",
    san: played.san,
    uci: "e2e4",
    piece: played.piece,
    from: played.from,
    to: played.to,
    beforeFen,
    afterFen: before.fen(),
    materialDelta: afterMaterial - beforeMaterial,
    captured: played.captured || ""
  };

  class StubEngine {
    async init() {}
    terminate() {}
    async evaluate(fen, options) {
      if (options.multiPv > 1) {
        assert.equal(fen, beforeFen);
        return {
          bestMove: "e2e4",
          lines: [
            { score: { cp: 35 }, pv: ["e2e4", "e7e5"] },
            { score: { cp: 20 }, pv: ["d2d4", "d7d5"] }
          ]
        };
      }
      assert.equal(fen, move.afterFen);
      return {
        bestMove: "e7e5",
        lines: [{ score: { cp: -32 }, pv: ["e7e5"] }]
      };
    }
  }

  const result = await analyzer.analyzeMove({
    move,
    ChessCtor: Chess,
    engineFactory: () => new StubEngine()
  });

  assert.equal(result.grade, "Best");
  assert.match(result.coachNote, /e4 is best/i);
  assert.equal(result.branches[0].pvUci[0], "e2e4");
});

test("explains top moves with chess ideas instead of engine agreement", () => {
  const chess = new Chess("4k2r/6B1/8/8/8/8/8/4K3 w - - 0 1");
  const beforeFen = chess.fen();
  const played = chess.move({ from: "g7", to: "h8" });
  const note = analyzer.buildCoachNote({
    grade: "Best",
    san: played.san,
    uci: "g7h8",
    piece: played.piece,
    from: played.from,
    to: played.to,
    captured: played.captured,
    materialDelta: 500,
    beforeFen,
    afterFen: chess.fen(),
    evalBefore: 49,
    evalAfter: 52,
    pv: "Bxh8 Nh6 Ne2",
    motifs: [],
    ChessCtor: Chess,
    colorName: "White"
  });

  assert.match(note, /Bxh8 is best/i);
  assert.match(note, /wins a rook/i);
  assert.doesNotMatch(note, /Stockfish|top choice|matched the engine/i);
});

test("does not initialize an engine after cancellation", async () => {
  const pgn = `[Event "Cancelled"]
[Result "1-0"]

1. e4 e5 1-0`;
  let initialized = false;

  class StubEngine {
    async init() {
      initialized = true;
    }
    terminate() {}
    async evaluate() {
      throw new Error("evaluate should not run");
    }
  }

  await assert.rejects(
    () =>
      analyzer.analyzeGame({
        pgn,
        ChessCtor: Chess,
        signal: { cancelled: true },
        engineFactory: () => new StubEngine()
      }),
    /Analysis stopped/
  );
  assert.equal(initialized, false);
});

test("marks local book moves and builds a phase summary", async () => {
  const pgn = `[Event "Book"]
[Opening "Ruy Lopez"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;
  const parsed = pgnTools.parseGamePgn(pgn, Chess);

  class StubEngine {
    async init() {}
    terminate() {}
    async evaluate(fen, options) {
      const move = parsed.moves.find((candidate) => candidate.beforeFen === fen || candidate.afterFen === fen);
      const bestMove = move ? move.uci : "a2a3";
      if (options.multiPv > 1) {
        return {
          bestMove,
          lines: [
            { score: { cp: 100 }, pv: [bestMove] },
            { score: { cp: 95 }, pv: [bestMove] }
          ]
        };
      }
      return {
        bestMove: "a7a6",
        lines: [{ score: { cp: -98 }, pv: ["a7a6"] }]
      };
    }
  }

  const result = await analyzer.analyzeGame({
    pgn,
    ChessCtor: Chess,
    engineFactory: () => new StubEngine()
  });

  assert.equal(result.moves.length, 4);
  assert.deepEqual(result.moves.map((move) => move.grade), ["Book", "Book", "Book", "Book"]);
  assert.equal(result.moves[0].phase, "Opening");
  assert.equal(result.summary.Book, 4);
  assert.match(result.moves[0].coachNote, /book/i);
  assert.match(result.phaseSummary.lines[0], /Ruy Lopez/);
  assert.match(result.phaseSummary.lines[0], /2\.\.\. Nc6/);
});

test("explains missed tactical opportunities", async () => {
  const pgn = `[Event "Miss"]
[Result "1-0"]

1. e4 d5 2. h4 e6 1-0`;
  const parsed = pgnTools.parseGamePgn(pgn, Chess);

  class StubEngine {
    async init() {}
    terminate() {}
    async evaluate(fen, options) {
      const beforeMove = parsed.moves.find((move) => move.beforeFen === fen);
      const afterMove = parsed.moves.find((move) => move.afterFen === fen);
      const isMissedCapture = beforeMove && beforeMove.san === "h4";

      if (options.multiPv > 1) {
        const bestMove = isMissedCapture ? "e4d5" : beforeMove.uci;
        return {
          bestMove,
          lines: [
            { score: { cp: isMissedCapture ? 300 : 100 }, pv: [bestMove] },
            { score: { cp: isMissedCapture ? 0 : 95 }, pv: [bestMove] }
          ]
        };
      }

      return {
        bestMove: "a7a6",
        lines: [{ score: { cp: afterMove && afterMove.san === "h4" ? -50 : -98 }, pv: ["a7a6"] }]
      };
    }
  }

  const result = await analyzer.analyzeGame({
    pgn,
    ChessCtor: Chess,
    engineFactory: () => new StubEngine()
  });
  const missed = result.moves.find((move) => move.san === "h4");

  assert.equal(missed.grade, "Miss");
  assert.match(missed.coachNote, /capturing a pawn/i);
  assert.match(missed.coachNote, /exd5/);
  assert.equal(result.summary.Miss, 1);
});

test("blocks unfinished games", () => {
  assert.throws(
    () =>
      pgnTools.parseGamePgn(
        `[Event "Live"]
[Result "*"]

1. e4 *`,
        Chess
      ),
    /after the game ends/
  );
});

test("blocks unfinished Chess.com visible move-list PGNs", () => {
  assert.throws(
    () =>
      pgnTools.parseGamePgn(
        `[Event "Chess.com visible game"]
[Result "*"]
[ChessCoachVisibleMoveList "1"]

1. e4 e5 *`,
        Chess
      ),
    /after the game ends/
  );
});

test("rejects malformed PGN", () => {
  assert.throws(() => pgnTools.parseGamePgn("not a pgn", Chess), /Could not read PGN|no moves/i);
});

test("rejects oversized PGNs before analysis", () => {
  const hugePgn = `[Event "Huge"]
[Result "1-0"]

${"1. e4 e5 ".repeat(Math.ceil(pgnTools.MAX_ANALYSIS_PGN_CHARS / 9))}1-0`;

  assert.throws(() => pgnTools.parseGamePgn(hugePgn, Chess), /too large/i);
});

test("rejects games with too many plies", () => {
  const moves = [];
  for (let moveNumber = 1; moveNumber <= 251; moveNumber += 1) {
    const whiteMove = moveNumber % 2 ? "Nf3" : "Ng1";
    const blackMove = moveNumber % 2 ? "Nf6" : "Ng8";
    moves.push(`${moveNumber}. ${whiteMove} ${blackMove}`);
  }

  assert.throws(
    () =>
      pgnTools.parseGamePgn(
        `[Event "Long"]
[Result "1/2-1/2"]

${moves.join(" ")} 1/2-1/2`,
        Chess
      ),
    /too long/i
  );
});

test("selects a Chess.com game from monthly PGN archive", () => {
  const archive = `[Event "Other"]
[Site "https://www.chess.com/game/live/111"]
[Result "0-1"]

1. e4 e5 0-1

[Event "Target"]
[Link "https://www.chess.com/game/live/222"]
[Result "1-0"]

1. d4 d5 1-0`;
  const selected = pgnTools.selectGameFromArchive(archive, "222");
  assert.match(selected, /Target/);
});

test("extracts escaped Chess.com PGN from page scripts", () => {
  const pgn = `[Event "Script"]
[Site "https://www.chess.com/game/live/222"]
[Result "1-0"]

1. d4 d5 1-0`;
  const doc = makeChessComDoc({
    scripts: [`window.__STATE__ = {"game":{"pgn":${JSON.stringify(pgn)}}};`]
  });
  assert.equal(chesscom.extractPgnFromPage(doc), pgn);
});

test("builds a PGN from the finished visible Chess.com move list", () => {
  const doc = makeChessComDoc({
    moveTexts: ["Moves 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 White won"]
  });
  const pgn = chesscom.extractPgnFromVisibleMoveList(doc, "https://www.chess.com/game/live/333", Chess);
  const parsed = pgnTools.parseGamePgn(pgn, Chess);

  assert.match(pgn, /\[ChessCoachVisibleMoveList "1"\]/);
  assert.equal(parsed.moves.length, 6);
  assert.equal(parsed.result, "1-0");
  assert.equal(parsed.moves[5].san, "a6");
});

test("ignores unfinished visible Chess.com move lists", () => {
  const doc = makeChessComDoc({
    moveTexts: ["Moves 1. e4 e5 2. Nf3 Nc6"]
  });

  assert.equal(chesscom.extractPgnFromVisibleMoveList(doc, "https://www.chess.com/game/live/333", Chess), "");
});

test("discovers Chess.com archive months when page dates are missing", async () => {
  const archive = `[Event "Target"]
[Link "https://www.chess.com/game/live/222"]
[Result "1-0"]

1. d4 d5 1-0`;
  const calls = [];
  const doc = makeChessComDoc({
    scripts: ['{"white":{"username":"ArchiveHero"},"black":{"username":"Rival"}}']
  });

  const source = await chesscom.getPgn({
    document: doc,
    locationHref: "https://www.chess.com/game/live/222",
    fetchPgn: async (url) => {
      calls.push(url);
      if (url === "https://api.chess.com/pub/player/archivehero/games/archives") {
        return {
          ok: true,
          payload: {
            ok: true,
            text: JSON.stringify({
              archives: [
                "https://api.chess.com/pub/player/archivehero/games/2025/01",
                "https://api.chess.com/pub/player/archivehero/games/2025/02"
              ]
            })
          }
        };
      }
      if (url === "https://api.chess.com/pub/player/archivehero/games/2025/02/pgn") {
        return { ok: true, payload: { ok: true, text: archive } };
      }
      return { ok: true, payload: { ok: false, status: 404, text: "" } };
    }
  });

  assert.match(source.pgn, /Target/);
  assert.ok(calls.includes("https://api.chess.com/pub/player/archivehero/games/archives"));
});

test("parses Lichess game IDs", () => {
  assert.equal(lichess.parseGameIdFromUrl("https://lichess.org/AbC123xY/black"), "AbC123xY");
  assert.equal(lichess.parseGameIdFromUrl("https://lichess.org/analysis/game/abcdefgh"), "abcdefgh");
  assert.equal(lichess.parseGameIdFromUrl("https://lichess.org/study/abcdefgh"), "");
});

test("parses Chess.com game IDs and archive URLs", () => {
  assert.equal(chesscom.parseGameIdFromUrl("https://www.chess.com/game/live/123456789"), "123456789");
  assert.equal(
    chesscom.buildArchivesUrl("Hikaru"),
    "https://api.chess.com/pub/player/hikaru/games/archives"
  );
  assert.equal(
    chesscom.buildArchiveUrl("Hikaru", "2025/02"),
    "https://api.chess.com/pub/player/hikaru/games/2025/02/pgn"
  );
});

test("rejects concurrent Stockfish evaluations", async () => {
  const originalWorker = global.Worker;

  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
      this.commands = [];
    }

    postMessage(command) {
      this.commands.push(command);
      if (command === "uci") {
        queueMicrotask(() => this.emit("uciok"));
      }
      if (command === "isready") {
        queueMicrotask(() => this.emit("readyok"));
      }
      if (command.startsWith("go ")) {
        setTimeout(() => {
          this.emit("info depth 1 multipv 1 score cp 22 pv e2e4");
          this.emit("bestmove e2e4");
        }, 30);
      }
    }

    emit(line) {
      if (this.onmessage) {
        this.onmessage({ data: line });
      }
    }

    terminate() {}
  }

  global.Worker = FakeWorker;
  try {
    const engine = new stockfishTools.StockfishEngine({
      scriptUrl: "fake-stockfish.js",
      wasmUrl: "fake-stockfish.wasm",
      depth: 1
    });
    const fen = new Chess().fen();
    const first = engine.evaluate(fen, { depth: 1, multiPv: 1 });

    await assert.rejects(() => engine.evaluate(fen, { depth: 1, multiPv: 1 }), /already running/);
    const result = await first;
    assert.equal(result.bestMove, "e2e4");
    engine.terminate();
  } finally {
    global.Worker = originalWorker;
  }
});

test("Stockfish smoke test", async () => {
  const enginePath = path.resolve(__dirname, "../vendor/stockfish/stockfish-18-lite-single.js");
  const child = spawn(process.execPath, [enginePath], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Stockfish smoke test timed out."));
    }, 20000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("bestmove ")) {
        clearTimeout(timer);
        child.stdin.write("quit\n");
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!output.includes("bestmove ")) {
        reject(new Error(`Stockfish exited early with code ${code}: ${output}`));
      }
    });
  });

  child.stdin.write("uci\n");
  child.stdin.write("isready\n");
  child.stdin.write("position startpos\n");
  child.stdin.write("go depth 1\n");
  await done;
  assert.match(output, /uciok/);
  assert.match(output, /readyok/);
  assert.match(output, /bestmove/);
});

(async () => {
  for (const item of tests) {
    await item.fn();
    console.log(`ok - ${item.name}`);
  }
  console.log(`${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
