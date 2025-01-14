(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../core/pgn.js"));
  } else {
    const api = factory(root.ChessCoachPgn);
    root.ChessCoachChessCom = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (pgnTools) {
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

  function looksLikePgn(value) {
    const text = String(value || "");
    return /\[Event\s+"/.test(text) && /\s(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(text.trim());
  }

  function extractPgnFromPage(doc) {
    const attributes = ["pgn", "data-pgn", "data-game-pgn"];
    for (const attribute of attributes) {
      for (const node of doc.querySelectorAll(`[${attribute}]`)) {
        const value = decodeHtml(node.getAttribute(attribute) || "", doc);
        if (looksLikePgn(value)) return value;
      }
    }

    for (const script of doc.querySelectorAll("script")) {
      const text = script.textContent || "";
      const match = text.match(/(\[Event\\?["\s][\s\S]{80,}?(?:1-0|0-1|1\/2-1\/2|\*)\\?n?)/);
      if (match) {
        const decoded = decodeHtml(match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'), doc);
        if (looksLikePgn(decoded)) return decoded;
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

  function deriveArchiveCandidates(doc, locationHref) {
    const usernames = unique(
      Array.from(doc.querySelectorAll('a[href*="/member/"]'))
        .map((anchor) => {
          const match = anchor.href.match(/\/member\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]).toLowerCase() : "";
        })
    ).slice(0, 2);

    const dates = [];
    for (const time of doc.querySelectorAll("time[datetime]")) {
      const parsed = new Date(time.getAttribute("datetime"));
      if (!Number.isNaN(parsed.getTime())) dates.push(parsed);
    }

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

  async function fetchFromArchives(context, doc) {
    const candidates = deriveArchiveCandidates(doc, context.locationHref);
    if (!candidates.gameId || !candidates.usernames.length) return null;

    for (const username of candidates.usernames) {
      for (const monthPath of candidates.months) {
        const response = await context.fetchPgn(buildArchiveUrl(username, monthPath));
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

    const archived = await fetchFromArchives(context, doc);
    if (archived) return archived;

    const error = new Error("Could not find the Chess.com PGN automatically.");
    error.code = "NEEDS_PASTE";
    throw error;
  }

  return {
    buildArchiveUrl,
    deriveArchiveCandidates,
    extractPgnFromPage,
    getPgn,
    parseGameIdFromUrl
  };
});
