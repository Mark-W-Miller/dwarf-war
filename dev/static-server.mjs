#!/usr/bin/env node
// Tiny static file server for local development (no deps).
// Serves the repository root; default route maps to app/index.html.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = path.resolve(process.cwd(), '.');

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.txt':  'text/plain; charset=utf-8',
}));

function setCors(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  } catch {}
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.replace(/\+/g, ' '));
  const p = path.normalize(decoded).replace(/^\/+/, '');
  const full = path.join(root, p);
  if (!full.startsWith(root)) return null; // path traversal
  return full;
}

function serveFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Try index.html in directory
      const idx = path.join(filePath, 'index.html');
      if (fs.existsSync(idx)) return serveFile(res, idx);
      res.writeHead(403); return res.end('Forbidden');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME.get(ext) || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    // Make HTML/JS uncacheable during dev
    if (ext === '.html' || ext === '.htm' || ext === '.js' || ext === '.mjs') {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { res.writeHead(500); res.end('Read error'); });
    res.writeHead(200);
    stream.pipe(res);
  } catch (e) {
    if (e && e.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(500); res.end('Error'); }
  }
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url || '/', 'http://localhost');
  let pathname = url.pathname;

  // Default route → redirect to /app/index.html so relative paths resolve correctly
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: '/app/index.html' });
    return res.end();
  }

  const full = safeJoin(ROOT, pathname);
  if (!full) { res.writeHead(400); return res.end('Bad path'); }
  return serveFile(res, full);
});

server.listen(PORT, () => {
  console.log(`[live-server] Serving ${ROOT} on http://localhost:${PORT} (default: /app/index.html)`);
});
