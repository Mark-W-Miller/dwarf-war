#!/usr/bin/env node
// Local Assistant HTTP server
// Endpoints:
//   POST /parse-instructions { text } -> instructions JSON
//   POST /parse-commands { text } -> [commands]
//   POST /execute { barrow, commands } -> { barrow, messages }
//   POST /execute-text { barrow, text } -> { barrow, messages }
//   GET  /health -> { ok: true }

import http from 'http';
import { parse } from 'url';

import { parseInstructions, parseCommands } from '../../app/modules/assistant/nlParser.mjs';
import { executeCommands } from '../../app/modules/assistant/commands.mjs';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function send(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = parse(req.url || '/');

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true });

  if (req.method === 'POST' && pathname === '/parse-instructions') {
    try {
      const { text } = await readJson(req);
      const data = parseInstructions(String(text || ''));
      return send(res, 200, data);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (req.method === 'POST' && pathname === '/parse-commands') {
    try {
      const { text } = await readJson(req);
      const cmds = parseCommands(String(text || ''));
      return send(res, 200, cmds);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (req.method === 'POST' && pathname === '/execute') {
    try {
      const { barrow, commands } = await readJson(req);
      const result = executeCommands(barrow || {}, Array.isArray(commands) ? commands : []);
      return send(res, 200, result);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (req.method === 'POST' && pathname === '/execute-text') {
    try {
      const { barrow, text } = await readJson(req);
      const cmds = parseCommands(String(text || ''));
      const result = executeCommands(barrow || {}, cmds);
      return send(res, 200, result);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[local-assistant] Listening on http://localhost:${PORT}`);
});

