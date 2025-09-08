// Simple in-app logger with class-based filtering and subscribers

export const Log = (() => {
  const entries = []; // { time, cls, msg, data }
  const classes = new Set();
  const subs = new Set();

  function notify() {
    for (const fn of subs) {
      try { fn({ entries: [...entries], classes: new Set(classes) }); } catch {}
    }
  }

  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    off(fn) { subs.delete(fn); },
    log(cls, msg, data) {
      const e = { time: Date.now(), cls: String(cls || 'LOG'), msg: String(msg || ''), data };
      entries.push(e);
      classes.add(e.cls);
      // Also forward to console for dev visibility
      try { console.log(`[${e.cls}]`, e.msg, e.data ?? ''); } catch {}
      notify();
      return e;
    },
    getEntries() { return entries; },
    getClasses() { return new Set(classes); }
  };
})();

