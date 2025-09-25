# Local Dev Servers and Logging

This repo includes a tiny static server for the app and a minimal log receiver so you can capture browser logs/errors into a file during development.

## Quick Start

- Start the log receiver (writes to `.assistant.log`):
  - `node dev/error-reporter.mjs`
- Start the static server (serves `app/index.html`):
  - `node dev/static-server.mjs`
- Open the app:
  - http://localhost:8080 (redirects to `/app/index.html`)

On localhost, the app auto‑enables log forwarding on page load. No manual toggles needed.

## What Gets Captured

- Global `error` and `unhandledrejection` events
- `console.error` and `console.warn`
- `console.log/info/debug` (enabled by default on localhost)
- In‑app `Log.log()` entries (UI/HILITE/etc.)

## Where Logs Go

- File: `.assistant.log` (repo root)
- HTTP API (CORS enabled) on the log receiver:
  - `POST /log` — append a JSON object or raw text; stored as NDJSON with a timestamp
  - `GET /log?start=0&format=ndjson|text` — read log from a byte offset (0 = from the beginning)
    - Response headers: `X-Log-Size` (current file size), `X-Log-Start` (echoed offset)
  - `DELETE /log` — truncate the log file

Examples:
- Tail the file: `tail -f .assistant.log`
- From the server: `curl -s 'http://localhost:6060/log?start=0&format=text'`
- Clear: `curl -s -X DELETE 'http://localhost:6060/log'`
- Incremental read: first GET → note `X-Log-Size`, next GET with `start=<previous size>`

## Controls and Opt‑Out

- Settings tab toggles (in the app UI):
  - “Send Errors to Local Server”
  - “Send App Logs to Local Server”
- LocalStorage flags (persist across reloads):
  - `dw:dev:sendErrors = '1'|'0'`
  - `dw:dev:sendLogs = '1'|'0'`

These are auto‑set to `'1'` on localhost at page start. Turn off in Settings or via the console if needed.

## Troubleshooting

- 404 `/main.mjs` when loading `/`:
  - The dev server redirects `/` → `/app/index.html`. Refresh http://localhost:8080.
- No entries in `.assistant.log`:
  - Ensure the receiver is running: `node dev/error-reporter.mjs`
  - Confirm you’re on localhost (auto‑forwarding only turns on for local dev)
  - Try a quick test in the browser console:
    - `setTimeout(() => { throw new Error('test error'); }, 0)`
- Changing ports:
  - Receiver: `PORT=6061 node dev/error-reporter.mjs`
  - Static server: `PORT=5173 node dev/static-server.mjs`

## Implementation Notes

- Early prelude in `app/index.html` enables forwarding at startup and bridges `console.*`.
- `sendBeacon` uses `text/plain` for broad compatibility; falls back to `fetch(..., keepalive:true)`.
- Receiver appends a startup marker so you can segment sessions without clearing the file.

## Assistant Signals (On-Demand Watching)

From the app Settings tab under “Assistant Controls” you can send control signals into the log for the assistant to react to:

- Start Watch — writes `{ type: 'control', event: 'watch:on' }`
- Stop Watch — writes `{ type: 'control', event: 'watch:off' }`
- Checkpoint — writes `{ type: 'control', event: 'checkpoint' }`

Use these to tell the assistant when to begin/stop tailing and summarizing your actions. You can also trigger them manually:

```
curl -X POST http://localhost:6060/log \
  -H 'Content-Type: application/json' \
  -d '{"type":"control","event":"watch:on","app":"dwarf-war"}'
```
