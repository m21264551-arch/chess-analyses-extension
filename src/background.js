const ALLOWED_FETCHES = [
  /^https:\/\/lichess\.org\/game\/export\/[A-Za-z0-9]{8}(?:\?.*)?$/,
  /^https:\/\/api\.chess\.com\/pub\/player\/[^/?#]+\/games\/archives$/,
  /^https:\/\/api\.chess\.com\/pub\/player\/[^/?#]+\/games\/\d{4}\/\d{2}\/pgn$/
];

const OFFSCREEN_URL = "src/offscreen/offscreen.html";
const MAX_FETCH_TEXT_CHARS = 5000000;
let creatingOffscreenDocument = null;

function isAllowedUrl(url) {
  return ALLOWED_FETCHES.some((pattern) => pattern.test(url));
}

async function fetchText(url) {
  if (!isAllowedUrl(url)) {
    throw new Error("Blocked fetch target.");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/x-chess-pgn,text/plain;q=0.9,*/*;q=0.1"
    },
    credentials: "omit",
    cache: "no-store"
  });

  const text = await response.text();
  if (text.length > MAX_FETCH_TEXT_CHARS) {
    throw new Error("Fetched PGN data is too large.");
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text
  };
}

async function hasOffscreenDocument() {
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }

  if (chrome.runtime && typeof chrome.runtime.getContexts === "function") {
    const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });
    return contexts.length > 0;
  }

  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "Run the packaged Stockfish worker for local post-game chess analysis."
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }
  await creatingOffscreenDocument;
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    ...message,
    target: "offscreen-engine"
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Offscreen engine did not respond.");
  }
  return response.payload;
}

function sendAsyncResponse(sendResponse, promise) {
  promise
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "fetch-pgn" || typeof message.url !== "string") {
    if (!message || message.target !== "background-engine") {
      return false;
    }

    return sendAsyncResponse(sendResponse, sendToOffscreen(message));
  }

  return sendAsyncResponse(sendResponse, fetchText(message.url));
});
