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

function ensureCors(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } catch {}
}

const server = http.createServer((req, res) => {
  ensureCors(res);
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname, searchParams } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204); return res.end();
  }

  if (pathname === '/log' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      // Store as-is if JSON parse fails
      try {
        const obj = JSON.parse(raw);
        // Decide session based on raw payload so sanitation doesn't hide intent
        function isSessionStartRaw(o) {
          try {
            return !!(o && (
              (o.event === 'start') ||
              (o.event === 'session:start') ||
              (o.session === 'start')
            ));
          } catch { return false; }
        }
        // Sanitize: drop t/at/app and type universally
        function sanitize(o) {
          try {
            if (o && typeof o === 'object') {
              delete o.t; delete o.at; delete o.app; delete o.type;
            }
          } catch {}
          return o;
        }
        if (isSessionStartRaw(obj)) {
          try { fs.writeFileSync(LOG_PATH, ''); } catch {}
        }
        const clean = sanitize(obj);
        append(JSON.stringify(clean));
      } catch {
        // Keep NDJSON form for non-JSON bodies
        append(JSON.stringify({ raw }));
      }
      res.writeHead(204); res.end();
    });
    return;
  }

  if (pathname === '/log' && req.method === 'GET') {
    try {
      // Clear request via query: /log?session=start
      const sess = searchParams.get('session');
      if (sess && sess.toLowerCase() === 'start') {
        try { fs.writeFileSync(LOG_PATH, ''); } catch {}
        res.writeHead(204); return res.end();
      }
      const startParam = searchParams.get('start');
      const format = (searchParams.get('format') || 'ndjson').toLowerCase();
      const start = startParam != null ? Math.max(0, Number(startParam) || 0) : 0;
      let buf = Buffer.alloc(0);
      let size = 0;
      try {
        const stat = fs.statSync(LOG_PATH);
        size = stat.size;
        const fd = fs.openSync(LOG_PATH, 'r');
        try {
          const length = Math.max(0, size - start);
          if (length > 0) {
            buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, start);
          }
        } finally { fs.closeSync(fd); }
      } catch {
        // no file yet → empty
        size = 0; buf = Buffer.alloc(0);
      }
      res.setHeader('X-Log-Size', String(size));
      res.setHeader('X-Log-Start', String(start));
      if (format === 'text') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(buf);
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      return res.end(buf);
    } catch (e) {
      res.writeHead(500); return res.end('error reading log');
    }
  }

  if (pathname === '/log' && req.method === 'DELETE') {
    try { fs.writeFileSync(LOG_PATH, ''); } catch {}
    res.writeHead(204); return res.end();
  }

  res.writeHead(404); return res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[error-reporter] listening on http://localhost:${PORT}/log, writing to ${LOG_PATH}`);
  // Optional: truncate on startup to avoid stale logs (no marker)
  try { fs.writeFileSync(LOG_PATH, ''); } catch (e) { console.error('truncate failed', e); }
});
