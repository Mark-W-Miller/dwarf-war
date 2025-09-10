#!/usr/bin/env node
// Minimal local error receiver that app can POST to via sendBeacon/fetch.
// Writes JSON lines to .assistant.log at repo root.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ? Number(process.env.PORT) : 6060;
const ROOT = path.resolve(process.cwd(), '.');
const LOG_PATH = path.join(ROOT, '.assistant.log');

function append(line) {
  try { fs.appendFileSync(LOG_PATH, line + '\n'); }
  catch (e) { console.error('append failed', e); }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/log') {
    res.writeHead(404); return res.end('not found');
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    // Store as-is if JSON parse fails
    try {
      const obj = JSON.parse(raw);
      const line = JSON.stringify({ t: Date.now(), ...obj });
      append(line);
    } catch {
      append(JSON.stringify({ t: Date.now(), raw }));
    }
    res.writeHead(204); res.end();
  });
});

server.listen(PORT, () => {
  console.log(`[error-reporter] listening on http://localhost:${PORT}/log, writing to ${LOG_PATH}`);
});

