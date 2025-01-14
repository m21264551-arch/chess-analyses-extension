# Post-Game Chess Coach

A no-build Manifest V3 Chrome extension that adds a local post-game analysis panel to Chess.com and Lichess.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository folder.
4. Open a completed Chess.com or Lichess game and click **Analyze** in the injected panel.

The extension blocks unfinished games and does not submit moves or provide live-game assistance.

## Test

Run:

```sh
/Applications/Codex.app/Contents/Resources/node tests/run-tests.js
```

or any local Node.js binary:

```sh
node tests/run-tests.js
```

## Notes

- Move labels are local heuristics based on Stockfish evaluations. `Brilliant` and `Great` are not exact Chess.com review labels.
- V1 supports standard chess games from the normal starting position.
- Chess.com automatic PGN extraction is best effort. If the page or monthly archive lookup does not expose the PGN, paste a PGN into the panel.
