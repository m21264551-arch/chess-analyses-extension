# Chrome Web Store Listing

## Product Details

Name:
Post-Game Chess Coach

Short description:
Local post-game chess analysis for completed Chess.com and Lichess games.

Detailed description:
Post-Game Chess Coach adds a compact analysis panel to completed Chess.com and Lichess games. It fetches the finished-game PGN when available, runs bundled Stockfish locally in Chrome, and shows move grades, best moves, and short principal variations.

Features:
- Analyze completed standard chess games from Chess.com and Lichess.
- Run analysis locally with the packaged Stockfish engine.
- Show move grades such as Best, Excellent, Inaccuracy, Mistake, and Blunder.
- Highlight the current reviewed move and suggested best move on supported boards.
- Cache analysis results in Chrome local storage for faster repeat viewing.
- Paste a PGN manually when automatic Chess.com extraction is not available.

Important notes:
- This extension is for post-game review only.
- It blocks unfinished games and does not provide live-game assistance.
- Move labels are local heuristics based on Stockfish evaluations.
- Brilliant and Great labels are not official Chess.com review labels.
- V1 supports standard chess games from the normal starting position.

Suggested category:
Education, Games, or Productivity depending on the closest category available in the dashboard.

Language:
English

## Graphic Assets

Store icon:
assets/icons/icon128.png

Screenshots:
assets/listing/screenshot-analysis-panel.png
assets/listing/screenshot-board-overlay.png

Small promo tile:
assets/listing/small-promo-tile.png

Marquee promo tile:
assets/listing/marquee-promo-tile.png

## Privacy Practices

Single purpose:
Post-Game Chess Coach helps users review completed Chess.com and Lichess games by fetching a finished-game PGN, running bundled Stockfish locally, and showing move grades and best-line hints in the browser.

Privacy claim:
This extension analyzes completed chess games locally in Chrome. It does not collect, sell, share, or send personal information to the developer. It does not use tracking, ads, analytics, or remote code. When you analyze a game, the extension may request the game PGN from Chess.com or Lichess using the page you are viewing or their public game export endpoints. Analysis results are stored only in Chrome local storage on your device so repeated reviews can load faster.

Remote code declaration:
No. The extension does not execute remotely hosted code. All JavaScript and WebAssembly are packaged with the extension, including the Stockfish worker files in vendor/stockfish. The manifest allows `wasm-unsafe-eval` only so Chrome can compile the packaged Stockfish WASM file locally.

Data collection declaration:
The developer does not collect user data. Game PGNs and analysis results are processed locally in Chrome and stored only in Chrome local storage on the user's device.

## Permission Justifications

activeTab:
Used only after the user clicks the extension action on a Chess.com or Lichess tab. It lets the popup inspect the current tab and open the packaged analysis panel on that tab.

Host permissions:
Required only for finished-game PGN retrieval from Chess.com and Lichess. The extension fetches a Lichess game export for the game being viewed or a Chess.com public monthly PGN archive to locate the viewed completed game. No other sites are requested.

offscreen:
Runs the bundled Stockfish worker in an offscreen extension document so chess analysis can run locally without opening a visible extension page.

Remote code:
The extension does not use remote code. Stockfish JavaScript and WASM files are included in the extension package and loaded with chrome.runtime.getURL. No executable code is fetched from the web.

scripting:
Injects only packaged extension scripts into the current supported chess tab when the user clicks Open panel in the popup. This provides a manual fallback for tabs that were already open before the content script loaded.

storage:
Stores analysis results in Chrome local storage on the user's device so previously reviewed games can load faster. The data is not sent to the developer.

Host permission for lichess.org/game/export:
Fetches the PGN for the completed Lichess game the user is viewing.

Host permission for api.chess.com/pub/player:
Fetches public monthly PGN archives to locate the completed Chess.com game the user is viewing when the page does not expose the PGN directly.

## Reviewer Test Instructions

1. Load the extension in Chrome.
2. Open a completed standard game on Lichess or Chess.com.
3. If the panel does not appear automatically, click the extension icon and choose Open panel.
4. Click Analyze.
5. If Chess.com PGN detection is unavailable on the page, paste a completed standard PGN into the panel and click Analyze PGN.
6. Confirm that games with Result "*" are blocked until the game is complete.
