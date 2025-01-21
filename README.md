# Post-Game Chess Coach

Post-Game Chess Coach is a Manifest V3 Chrome extension for reviewing completed Chess.com and Lichess games.

It fetches a finished-game PGN when possible, runs the bundled Stockfish engine locally in Chrome, and shows move grades, best moves, and short principal variations. It blocks unfinished games so it is not useful for live-game assistance.

## What is included

- Content scripts for Chess.com and Lichess
- Local Stockfish 18 Lite JavaScript and WASM worker
- PGN parsing and move grading logic
- Chrome local storage cache for repeated reviews
- Chrome Web Store listing copy and privacy notes
- Node-based test runner for parser and grading behavior

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this repository folder.
5. Open a completed Chess.com or Lichess game and click **Analyze** in the panel.

## Test

```sh
node tests/run-tests.js
```

## Privacy model

The extension does not send game data to my server. PGNs and analysis results stay in the browser. Chess.com and Lichess requests are only used to retrieve the finished-game PGN for the page being reviewed.

## Limitations

- V1 supports standard chess from the normal starting position.
- Chess.com PGN extraction is best effort. If automatic lookup fails, paste a PGN into the panel.
- Labels such as `Best`, `Inaccuracy`, and `Blunder` are local heuristics from Stockfish evaluation changes.
