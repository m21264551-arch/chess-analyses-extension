let engine = null;
let engineDepth = 14;
let engineSessionId = "";

function assertSessionId(message) {
  if (!message.sessionId || typeof message.sessionId !== "string") {
    throw new Error("Missing engine session.");
  }
}

function reserveEngineSession(message) {
  assertSessionId(message);

  if (engineSessionId && engineSessionId !== message.sessionId) {
    throw new Error("Stockfish is already analyzing another game.");
  }

  engineSessionId = message.sessionId;
}

function getEngine(depth) {
  engineDepth = depth || engineDepth;
  if (!engine) {
    engine = new ChessCoachStockfish.StockfishEngine({
      scriptUrl: chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.js"),
      wasmUrl: chrome.runtime.getURL("vendor/stockfish/stockfish-18-lite-single.wasm"),
      depth: engineDepth
    });
  }
  return engine;
}

async function handleEngineMessage(message) {
  if (message.type === "engine-init") {
    reserveEngineSession(message);
    await getEngine(message.depth).init();
    return { ready: true };
  }

  if (message.type === "engine-evaluate") {
    reserveEngineSession(message);
    if (!message.fen) {
      throw new Error("Missing FEN for engine evaluation.");
    }
    return getEngine(message.depth).evaluate(message.fen, message.options || {});
  }

  if (message.type === "engine-terminate") {
    assertSessionId(message);
    if (engineSessionId && engineSessionId !== message.sessionId) {
      return { stopped: false };
    }

    if (engine) {
      engine.terminate();
      engine = null;
    }
    engineSessionId = "";
    return { stopped: true };
  }

  throw new Error(`Unknown engine message: ${message.type}`);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen-engine") {
    return false;
  }

  handleEngineMessage(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
