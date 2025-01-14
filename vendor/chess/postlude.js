(function () {
  const exported = (globalThis.module && globalThis.module.exports) || globalThis.exports || {};
  globalThis.ChessCoachVendor = globalThis.ChessCoachVendor || {};
  globalThis.ChessCoachVendor.Chess = exported.Chess;
  globalThis.ChessCoachVendor.chess = exported;
  delete globalThis.module;
  delete globalThis.exports;
})();
