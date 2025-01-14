const SCRIPT_FILES = [
  "vendor/chess/prelude.js",
  "vendor/chess/chess.js",
  "vendor/chess/postlude.js",
  "src/core/grading.js",
  "src/core/pgn.js",
  "src/core/extension-engine.js",
  "src/core/stockfish-engine.js",
  "src/core/analyzer.js",
  "src/sites/lichess.js",
  "src/sites/chesscom.js",
  "src/config.js",
  "src/content/content.js"
];

const SUPPORTED_HOSTS = [/^https:\/\/([^/]+\.)?chess\.com\//, /^https:\/\/lichess\.org\//];

const statusEl = document.getElementById("status");
const openButton = document.getElementById("open-panel");
const closeButton = document.getElementById("close-panel");
const reloadButton = document.getElementById("reload-tab");
const supportLink = document.getElementById("support-link");

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getInjectedState(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      hasPanel: Boolean(document.getElementById("chess-coach-panel")),
      hasDependencies: Boolean(
        globalThis.ChessCoachAnalyzer &&
          globalThis.ChessCoachPgn &&
          globalThis.ChessCoachGrading &&
          globalThis.ChessCoachVendor &&
          globalThis.ChessCoachVendor.Chess
      )
    })
  });
  return injection && injection.result ? injection.result : { hasPanel: false, hasDependencies: false };
}

function isSupportedUrl(url) {
  return SUPPORTED_HOSTS.some((pattern) => pattern.test(url || ""));
}

async function openPanel() {
  openButton.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !isSupportedUrl(tab.url)) {
      setStatus("Open a Chess.com or Lichess page first.");
      return;
    }

    const injectedState = await getInjectedState(tab.id);
    if (injectedState.hasPanel) {
      setStatus("Panel is already open on this tab.");
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: injectedState.hasDependencies ? ["src/content/content.js"] : SCRIPT_FILES
    });
    setStatus("Panel opened on this tab.");
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    openButton.disabled = false;
  }
}

async function closePanel() {
  closeButton.disabled = true;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !isSupportedUrl(tab.url)) {
      setStatus("Open a Chess.com or Lichess page first.");
      return;
    }

    const [closed] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof globalThis.ChessCoachClosePanel === "function") {
          return globalThis.ChessCoachClosePanel();
        }

        const panel = document.getElementById("chess-coach-panel");
        const overlay = document.getElementById("chess-coach-board-overlay");
        if (overlay) overlay.remove();
        if (panel) panel.remove();
        return Boolean(panel || overlay);
      }
    });

    setStatus(closed && closed.result ? "Panel closed on this tab." : "Panel is not open on this tab.");
  } catch (error) {
    setStatus(error.message || String(error));
  } finally {
    closeButton.disabled = false;
  }
}

async function reloadTab() {
  const tab = await getActiveTab();
  if (tab && tab.id) {
    await chrome.tabs.reload(tab.id);
    setStatus("Tab reloaded. The panel should appear after the page finishes loading.");
  }
}

openButton.addEventListener("click", openPanel);
closeButton.addEventListener("click", closePanel);
reloadButton.addEventListener("click", reloadTab);

getActiveTab().then((tab) => {
  if (tab && isSupportedUrl(tab.url)) {
    setStatus("Click Open panel, then use Analyze after the game is finished.");
  }
});

const donationUrl = globalThis.ChessCoachConfig && globalThis.ChessCoachConfig.donationUrl;
if (donationUrl) {
  supportLink.href = donationUrl;
  supportLink.classList.add("visible");
}
