(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../core/pgn.js"));
  } else {
    const api = factory(root.ChessCoachPgn);
    root.ChessCoachChessCom = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (pgnTools) {
  const MAX_ARCHIVE_MONTH_FETCHES = 12;

  function parseGameIdFromUrl(urlLike) {
    const url = new URL(String(urlLike));
    if (!/(\.|^)chess\.com$/.test(url.hostname)) return "";
    const match = url.pathname.match(/\/game\/(?:live|daily|computer)\/(\d+)/);
    return match ? match[1] : "";
  }

  function decodeHtml(value, doc) {
    const textarea = doc.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function decodeJsonString(value) {
    try {
      return JSON.parse(`"${String(value || "")}"`);
    } catch (_error) {
      return String(value || "");
    }
  }

  function maybeDecodeUri(value) {
    const text = String(value || "");
    if (!/%(?:5B|0A|22|20)/i.test(text)) return text;
    try {
      return decodeURIComponent(text);
    } catch (_error) {
      return text;
    }
  }

  function normalizeEscapedPgn(value, doc) {
    return maybeDecodeUri(decodeHtml(String(value || ""), doc))
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .trim();
  }

  function looksLikePgn(value) {
    const text = String(value || "");
    return /\[Event\s+"/.test(text) && /\s(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(text.trim());
  }

  function decodedPgnCandidate(value, doc) {
    const decoded = normalizeEscapedPgn(value, doc);
    if (looksLikePgn(decoded)) return decoded;

    const start = decoded.indexOf("[Event ");
    if (start === -1) return "";

    const sliced = decoded.slice(start).trim();
    if (looksLikePgn(sliced)) return sliced;

    return "";
  }

  function extractPgnFromPage(doc) {
    const attributes = ["pgn", "data-pgn", "data-game-pgn"];
    for (const attribute of attributes) {
      for (const node of doc.querySelectorAll(`[${attribute}]`)) {
        const value = decodedPgnCandidate(node.getAttribute(attribute) || "", doc);
        if (value) return value;
      }
    }

    for (const script of doc.querySelectorAll("script")) {
      const text = script.textContent || "";

      const pgnFieldPattern = /"pgn"\s*:\s*"((?:\\.|[^"\\]){80,})"/gi;
      let pgnFieldMatch = null;
      while ((pgnFieldMatch = pgnFieldPattern.exec(text))) {
        const decoded = decodedPgnCandidate(decodeJsonString(pgnFieldMatch[1]), doc);
        if (decoded) return decoded;
      }

      const directMatch = text.match(/(\[Event\\?["\s][\s\S]{80,}?(?:1-0|0-1|1\/2-1\/2|\*)\\?n?)/);
      if (directMatch) {
        const decoded = decodedPgnCandidate(directMatch[1], doc);
        if (decoded) return decoded;
      }
    }

    return "";
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function monthKey(date) {
    return {
      year: String(date.getUTCFullYear()),
      month: String(date.getUTCMonth() + 1).padStart(2, "0")
    };
  }

  function normalizeUsername(value) {
    const username = String(value || "").trim();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(username)) return "";
    return username.toLowerCase();
  }

  function collectUsernamesFromText(text) {
    const values = [];
    const patterns = [
      /\/member\/([A-Za-z0-9_-]{2,40})(?=[/?#"'&<\s]|$)/gi,
      /"username"\s*:\s*"([A-Za-z0-9_-]{2,40})"/gi,
      /"userName"\s*:\s*"([A-Za-z0-9_-]{2,40})"/gi,
      /"login"\s*:\s*"([A-Za-z0-9_-]{2,40})"/gi,
      /data-username=["']([A-Za-z0-9_-]{2,40})["']/gi
    ];

    for (const pattern of patterns) {
      let match = null;
      while ((match = pattern.exec(text))) {
        values.push(normalizeUsername(match[1]));
      }
    }

    return values;
  }

  function collectDatesFromText(text) {
    const dates = [];
    const timestampPattern = /"(?:end_time|endTime|start_time|startTime|timestamp)"\s*:\s*(\d{10,13})/gi;
    let timestampMatch = null;
    while ((timestampMatch = timestampPattern.exec(text))) {
      const raw = Number(timestampMatch[1]);
      const millis = raw > 9999999999 ? raw : raw * 1000;
      const parsed = new Date(millis);
      if (!Number.isNaN(parsed.getTime())) dates.push(parsed);
    }

    const datePattern = /"(?:date|endDate|startDate|UTCDate)"\s*:\s*"(\d{4})[.-](\d{2})[.-](\d{2})"/gi;
    let dateMatch = null;
    while ((dateMatch = datePattern.exec(text))) {
      const parsed = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
      if (!Number.isNaN(parsed.getTime())) dates.push(parsed);
    }

    return dates;
  }

  function nodeText(node) {
    return String((node && (node.innerText || node.textContent)) || "").trim();
  }

  function normalizeMoveListText(text) {
    return String(text || "")
      .replace(/[\u2654\u265A]/g, "K")
      .replace(/[\u2655\u265B]/g, "Q")
      .replace(/[\u2656\u265C]/g, "R")
      .replace(/[\u2657\u265D]/g, "B")
      .replace(/[\u2658\u265E]/g, "N")
      .replace(/[\u2026]/g, "...")
      .replace(/\b([KQRBN])\s+(x?[a-h][1-8](?:=[QRBN])?[+#]?)/g, "$1$2")
      .replace(/\b(\d+)\s*\.\s*\.\s*\./g, " $1... ")
      .replace(/\b(\d+)\s*\./g, " $1. ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanSanToken(token) {
    return String(token || "")
      .trim()
      .replace(/^[([{]+|[)\]},;:]+$/g, "")
      .replace(/[!?]+$/g, "")
      .replace(/^0-0-0/i, "O-O-O")
      .replace(/^0-0/i, "O-O");
  }

  function isLikelySan(token) {
    return /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/.test(token);
  }

  function extractSanMovesFromText(text) {
    return normalizeMoveListText(text)
      .split(/\s+/)
      .map(cleanSanToken)
      .filter((token) => !/^\d+\.(?:\.\.)?$/.test(token))
      .filter(isLikelySan);
  }

  function detectResultFromText(text) {
    const value = String(text || "");
    if (/\b1-0\b/.test(value)) return "1-0";
    if (/\b0-1\b/.test(value)) return "0-1";
    if (/\b1\/2-1\/2\b/.test(value)) return "1/2-1/2";
    if (/\b(?:draw|drawn|stalemate|insufficient material|agreement)\b/i.test(value)) return "1/2-1/2";
    if (/\b(?:white won|black resigned|black lost|black abandoned)\b/i.test(value)) return "1-0";
    if (/\b(?:black won|white resigned|white lost|white abandoned)\b/i.test(value)) return "0-1";
    return "";
  }

  function candidateMoveLists(doc) {
    const selectors = [
      "[class*='move-list']",
      "[class*='vertical-move-list']",
      "[class*='analysis-move']",
      "[class*='moves']",
      "wc-move-list",
      "vertical-move-list"
    ];
    const texts = [];

    for (const selector of selectors) {
      try {
        for (const node of doc.querySelectorAll(selector)) {
          const text = nodeText(node);
          if (text) texts.push(text);
        }
      } catch (_error) {
        // Selector support can vary in tests and page fragments.
      }
    }

    const bodyText = doc.body ? nodeText(doc.body) : "";
    if (bodyText) texts.push(bodyText);

    return unique(texts)
      .map((text) => ({
        text,
        sans: extractSanMovesFromText(text)
      }))
      .filter((candidate) => candidate.sans.length >= 2);
  }

  function replaySanMoves(sans, ChessCtor) {
    if (!ChessCtor) return { moves: [], result: "" };

    const chess = new ChessCtor();
    const moves = [];
    for (const san of sans) {
      try {
        const move = chess.move(san, { strict: false });
        if (!move) break;
        moves.push(move.san);
      } catch (_error) {
        break;
      }
    }

    let result = "";
    if (typeof chess.isCheckmate === "function" && chess.isCheckmate()) {
      result = chess.turn() === "w" ? "0-1" : "1-0";
    } else if (typeof chess.isDraw === "function" && chess.isDraw()) {
      result = "1/2-1/2";
    }

    return { moves, result };
  }

  function formatMoveText(sans, result) {
    const pairs = [];
    for (let index = 0; index < sans.length; index += 2) {
      const moveNumber = Math.floor(index / 2) + 1;
      const white = sans[index] || "";
      const black = sans[index + 1] || "";
      pairs.push(`${moveNumber}. ${white}${black ? ` ${black}` : ""}`);
    }
    return `${pairs.join(" ")} ${result || "*"}`.trim();
  }

  function extractPgnFromVisibleMoveList(doc, locationHref, ChessCtor) {
    const candidates = candidateMoveLists(doc);
    if (!candidates.length || !ChessCtor) return "";

    let best = { moves: [], result: "", text: "" };
    for (const candidate of candidates) {
      const replayed = replaySanMoves(candidate.sans, ChessCtor);
      if (replayed.moves.length > best.moves.length) {
        best = { ...replayed, text: candidate.text };
      }
    }

    if (best.moves.length < 2) return "";

    const result = detectResultFromText(candidates.map((candidate) => candidate.text).join(" ")) || best.result;
    if (!pgnTools.isFinishedResult(result)) return "";

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    return `[Event "Chess.com visible game"]
[Site "${String(locationHref || "https://www.chess.com").replace(/"/g, "")}"]
[Date "${date}"]
[Result "${result}"]
[ChessCoachVisibleMoveList "1"]

${formatMoveText(best.moves, result)}`;
  }

  function deriveArchiveCandidates(doc, locationHref) {
    const scriptText = Array.from(doc.querySelectorAll("script"))
      .map((script) => script.textContent || "")
      .join("\n");
    const htmlText = doc.documentElement && doc.documentElement.innerHTML ? doc.documentElement.innerHTML : "";
    const usernames = unique([
      ...Array.from(doc.querySelectorAll('a[href*="/member/"]')).map((anchor) => {
        const match = anchor.href.match(/\/member\/([^/?#]+)/i);
        return match ? normalizeUsername(decodeURIComponent(match[1])) : "";
      }),
      ...Array.from(doc.querySelectorAll("[data-username]")).map((node) => normalizeUsername(node.getAttribute("data-username"))),
      ...collectUsernamesFromText(scriptText),
      ...collectUsernamesFromText(htmlText)
    ]).slice(0, 8);

    const dates = [];
    for (const time of doc.querySelectorAll("time[datetime]")) {
      const parsed = new Date(time.getAttribute("datetime"));
      if (!Number.isNaN(parsed.getTime())) dates.push(parsed);
    }
    dates.push(...collectDatesFromText(scriptText));
    dates.push(...collectDatesFromText(htmlText));

    const now = new Date();
    dates.push(now);
    dates.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    dates.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));

    const months = unique(dates.map((date) => {
      const key = monthKey(date);
      return `${key.year}/${key.month}`;
    })).slice(0, 3);

    return {
      gameId: parseGameIdFromUrl(locationHref),
      usernames,
      months
    };
  }

  function buildArchiveUrl(username, monthPath) {
    return `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/${monthPath}/pgn`;
  }

  function buildArchivesUrl(username) {
    return `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`;
  }

  function archiveUrlToPgn(url) {
    const clean = String(url || "").replace(/\/$/, "");
    if (!/^https:\/\/api\.chess\.com\/pub\/player\/[^/?#]+\/games\/\d{4}\/\d{2}$/i.test(clean)) {
      return "";
    }
    return `${clean}/pgn`;
  }

  async function fetchArchiveUrls(context, username) {
    const response = await context.fetchPgn(buildArchivesUrl(username));
    if (!response.ok || !response.payload || !response.payload.ok) return [];

    try {
      const parsed = JSON.parse(response.payload.text);
      const archives = Array.isArray(parsed.archives) ? parsed.archives : [];
      return archives.map(archiveUrlToPgn).filter(Boolean).reverse().slice(0, MAX_ARCHIVE_MONTH_FETCHES);
    } catch (_error) {
      return [];
    }
  }

  async function archiveUrlsForUsername(context, username, months) {
    const guessedUrls = months.map((monthPath) => buildArchiveUrl(username, monthPath));
    const discoveredUrls = await fetchArchiveUrls(context, username);
    return unique([...guessedUrls, ...discoveredUrls]);
  }

  async function fetchFromArchives(context, doc) {
    const candidates = deriveArchiveCandidates(doc, context.locationHref);
    if (!candidates.gameId || !candidates.usernames.length) return null;

    for (const username of candidates.usernames) {
      const archiveUrls = await archiveUrlsForUsername(context, username, candidates.months);
      for (const archiveUrl of archiveUrls) {
        const response = await context.fetchPgn(archiveUrl);
        if (!response.ok || !response.payload || !response.payload.ok) continue;
        const selected = pgnTools.selectGameFromArchive(response.payload.text, candidates.gameId);
        if (selected) {
          return {
            site: "chess.com",
            gameId: candidates.gameId,
            pgn: selected
          };
        }
      }
    }

    return null;
  }

  async function getPgn(context) {
    const doc = context.document;
    const gameId = parseGameIdFromUrl(context.locationHref);
    const pagePgn = extractPgnFromPage(doc);
    if (pagePgn) {
      return {
        site: "chess.com",
        gameId,
        pgn: pagePgn
      };
    }

    const visiblePgn = extractPgnFromVisibleMoveList(doc, context.locationHref, context.ChessCtor);
    if (visiblePgn) {
      return {
        site: "chess.com",
        gameId,
        source: "visible-move-list",
        pgn: visiblePgn
      };
    }

    const archived = await fetchFromArchives(context, doc);
    if (archived) return archived;

    const error = new Error("Could not find the Chess.com PGN automatically.");
    error.code = "NEEDS_PASTE";
    throw error;
  }

  return {
    buildArchiveUrl,
    buildArchivesUrl,
    deriveArchiveCandidates,
    extractPgnFromPage,
    extractPgnFromVisibleMoveList,
    getPgn,
    parseGameIdFromUrl
  };
});
