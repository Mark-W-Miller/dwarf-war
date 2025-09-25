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
      const data = { app: 'dwarf-war', at: Date.now(), type: 'log', ...obj };
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
