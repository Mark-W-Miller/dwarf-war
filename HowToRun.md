# How to Run

## Prerequisites
- Modern desktop browser (Chrome, Edge, Firefox, or Safari).
- Internet access for Babylon.js CDN assets.
- Node.js 18+ only if you want the optional local error log receiver.

## Run the editor
1) From the repo root, open `app/index.html` directly in your browser (no build or dev server required).
2) Interact with the editor; UI state and barrow data are persisted in `localStorage`.

### Optional: local error log receiver
1) In a terminal, run `node dev/error-reporter.mjs`.
2) In the browser console, enable sending with `localStorage['dw:dev:sendErrors'] = '1'`.
3) The receiver listens on `http://localhost:6060/log` and appends logs to `.assistant.log` (see `README.md` for endpoints).
