// Simple in-app logger with class-based filtering and subscribers

export const Log = (() => {
  const entries = []; // { time, cls, msg, data }
  const classesRuntime = new Set(); // seen this session
  const classesAll = new Set(); // persisted across sessions
  const subs = new Set();

  function sendToReceiver(obj) {
    try {
      const flag = localStorage.getItem('dw:dev:sendLogs');
      if (flag !== '1') return;
    } catch { return; }
    try {
      const url = 'http://localhost:6060/log';
      const data = { type: 'log', ...obj };
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(data)], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(url, blob);
        return;
      }
      fetch(url, { method: 'POST', body: JSON.stringify(data), keepalive: true, mode: 'no-cors' }).catch(() => {});
    } catch {}
  }

  // Load persisted classes once
  try {
    const raw = localStorage.getItem('dw:log:classes');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const c of arr) classesAll.add(String(c));
    }
  } catch {}

  function persistAll() {
    try { localStorage.setItem('dw:log:classes', JSON.stringify(Array.from(classesAll))); } catch {}
  }

  function notify() {
    // Union of runtime and persisted classes
    const union = new Set([...classesAll, ...classesRuntime]);
    for (const fn of subs) {
      try { fn({ entries: [...entries], classes: union }); } catch {}
    }
  }

  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    off(fn) { subs.delete(fn); },
    clear() {
      try { entries.length = 0; } catch {}
      try { classesRuntime.clear(); } catch {}
      // Intentionally do NOT clear classesAll — we “remember all levels ever seen”
      notify();
    },
    log(cls, msg, data) {
      const e = { time: Date.now(), cls: String(cls || 'LOG'), msg: String(msg || ''), data };
      entries.push(e);
      classesRuntime.add(e.cls);
      if (!classesAll.has(e.cls)) { classesAll.add(e.cls); persistAll(); }
      // Also forward to console for dev visibility
      try { console.log(`[${e.cls}]`, e.msg, e.data ?? ''); } catch {}
      // Forward to local receiver when enabled
      try { sendToReceiver({ time: e.time, cls: e.cls, msg: e.msg, data: e.data }); } catch {}
      notify();
      return e;
    },
    getEntries() { return entries; },
    // Returns union of runtime + persisted classes
    getClasses() { return new Set([...classesAll, ...classesRuntime]); }
  };
})();

// ————— Logging helpers (centralized) —————
// Error logging with normalized payload
export function logErr(ctx, e) {
  try {
    Log.log('ERROR', String(ctx || ''), {
      error: String(e && e.message ? e.message : e),
      stack: e && e.stack ? String(e.stack) : undefined
    });
  } catch {}
}

// Category shorthands
export function sLog(event, data = {}) { try { Log.log('SELECT', event, data); } catch {} }
export function mLog(event, data = {}) { try { Log.log('MOVE', event, data); } catch {} }
export function inputLog(kind, msg, data = {}) { try { Log.log('INPUT', `${kind}:${msg}`, data); } catch {} }

// Input modifier/combination helpers (shared by handlers)
export function modsOf(ev) {
  return {
    cmd: !!(ev && ev.metaKey),
    ctrl: !!(ev && ev.ctrlKey),
    shift: !!(ev && ev.shiftKey),
    alt: !!(ev && ev.altKey)
  };
}

export function comboName(button, mods) {
  const parts = [];
  if (mods?.cmd) parts.push('cmd');
  if (mods?.ctrl) parts.push('ctrl');
  if (mods?.shift) parts.push('shift');
  if (mods?.alt) parts.push('alt');
  const btn = (button === 2) ? 'RC' : (button === 1) ? 'MC' : 'LC';
  parts.push(btn);
  return parts.join('-');
}

// Pick debug toggle and helpers
export function pickDebugOn() { try { return localStorage.getItem('dw:debug:picking') === '1'; } catch { return false; } }
// Gated pick logger (respects Pick Debug setting)
export function dPick(event, data = {}) { if (!pickDebugOn()) return; try { Log.log('PICK', event, data); } catch {} }
// Ungated pick logger (always logs)
export function pickLog(event, data = {}) { try { Log.log('PICK', event, data); } catch {} }
