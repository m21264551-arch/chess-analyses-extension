const PANEL_DISMISSED_KEY = "chess-coach-panel-dismissed";
const BOOTSTRAP_FILES = [
  "src/config.js",
  "src/content/content.js"
];
const DEPENDENCY_FILES = [
  "vendor/chess/prelude.js",
  "vendor/chess/chess.js",
  "vendor/chess/postlude.js",
  "src/core/grading.js",
  "src/core/pgn.js",
  "src/core/extension-engine.js",
  "src/core/stockfish-engine.js",
  "src/core/analyzer.js",
  "src/sites/lichess.js",
  "src/sites/chesscom.js"
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
    func: (dismissedKey) => ({
      hasPanel: Boolean(document.getElementById("chess-coach-panel")),
      isDismissed: (() => {
        try {
          return sessionStorage.getItem(dismissedKey) === "1";
        } catch (_error) {
          return false;
        }
      })(),
      hasDependencies: Boolean(
        globalThis.ChessCoachAnalyzer &&
          globalThis.ChessCoachPgn &&
          globalThis.ChessCoachGrading &&
          globalThis.ChessCoachExtensionEngine &&
          globalThis.ChessCoachVendor &&
          globalThis.ChessCoachVendor.Chess
      )
    }),
    args: [PANEL_DISMISSED_KEY]
  });
  return injection && injection.result ? injection.result : { hasPanel: false, isDismissed: false, hasDependencies: false };
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

    let injectedState = await getInjectedState(tab.id);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (dismissedKey) => {
        try {
          sessionStorage.removeItem(dismissedKey);
        } catch (_error) {
          // Some pages can block storage access; the explicit open should still continue.
        }
      },
      args: [PANEL_DISMISSED_KEY]
    });

    if (!injectedState.hasPanel) {
      setStatus(injectedState.isDismissed ? "Reopening panel..." : "Opening panel...");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: BOOTSTRAP_FILES
      });
      injectedState = await getInjectedState(tab.id);
    }

    if (!injectedState.hasDependencies) {
      setStatus("Loading analysis tools...");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: DEPENDENCY_FILES
      });
    }

    setStatus(injectedState.hasPanel ? "Panel is ready on this tab." : "Panel opened on this tab.");
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
      func: (dismissedKey) => {
        try {
          sessionStorage.setItem(dismissedKey, "1");
        } catch (_error) {
          // Closing the visible panel should not fail because storage is unavailable.
        }

        if (typeof globalThis.ChessCoachClosePanel === "function") {
          return globalThis.ChessCoachClosePanel();
        }

        const panel = document.getElementById("chess-coach-panel");
        const overlay = document.getElementById("chess-coach-board-overlay");
        if (overlay) overlay.remove();
        if (panel) panel.remove();
        return Boolean(panel || overlay);
      },
      args: [PANEL_DISMISSED_KEY]
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
    setStatus("Tab reloaded. Open the panel again when you want it.");
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
