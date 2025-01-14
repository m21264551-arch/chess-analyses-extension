(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ChessCoachLichess = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseGameIdFromUrl(urlLike) {
    const url = new URL(String(urlLike));
    if (url.hostname !== "lichess.org") return "";

    const path = url.pathname;
    const direct = path.match(/^\/([A-Za-z0-9]{8})(?:\/(?:white|black))?\/?$/);
    if (direct) return direct[1];

    const analysis = path.match(/^\/analysis\/game\/([A-Za-z0-9]{8})/);
    if (analysis) return analysis[1];

    return "";
  }

  function buildExportUrl(gameId) {
    const params = new URLSearchParams({
      moves: "true",
      tags: "true",
      clocks: "false",
      evals: "false",
      opening: "true",
      literate: "false"
    });
    return `https://lichess.org/game/export/${gameId}?${params.toString()}`;
  }

  async function getPgn(context) {
    const gameId = parseGameIdFromUrl(context.locationHref);
    if (!gameId) {
      throw new Error("Open a completed Lichess game to analyze it.");
    }

    const response = await context.fetchPgn(buildExportUrl(gameId));
    if (!response.ok || !response.payload || !response.payload.ok) {
      throw new Error(`Could not fetch Lichess PGN${response.payload ? ` (${response.payload.status})` : ""}.`);
    }

    return {
      site: "lichess",
      gameId,
      pgn: response.payload.text
    };
  }

  return {
    buildExportUrl,
    getPgn,
    parseGameIdFromUrl
  };
});
