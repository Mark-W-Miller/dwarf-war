// Error banner (top of screen) — extracted from eventHandler.mjs
// Usage: initErrorBar(Log) once on startup; it subscribes to Log and shows latest ERROR entries.

export function initErrorBar(Log) {
  let _errBar = null;
  let _errList = null;
  let _errTimer = null;

  function ensureErrorBar() {
    if (_errBar && document.body.contains(_errBar)) return _errBar;
    const bar = document.createElement('div');
    bar.id = 'errorBanner';
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '2000';
    bar.style.display = 'none';
    bar.style.background = 'rgba(180,0,0,0.92)';
    bar.style.color = '#fff';
    bar.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    bar.style.fontSize = '12px';
    bar.style.padding = '6px 10px';
    bar.style.borderBottom = '1px solid rgba(255,255,255,0.25)';
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    const title = document.createElement('div');
    title.textContent = 'Errors';
    title.style.fontWeight = '600';
    title.style.marginRight = '8px';
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Dismiss';
    btn.style.background = 'transparent';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '14px';
    btn.onclick = () => { bar.style.display = 'none'; };
    head.appendChild(title);
    head.appendChild(btn);
    const list = document.createElement('div');
    list.style.marginTop = '4px';
    bar.appendChild(head);
    bar.appendChild(list);
    document.body.appendChild(bar);
    _errBar = bar;
    _errList = list;
    return bar;
  }

  function showErrorMessage(cls, msg, data) {
    try {
      ensureErrorBar();
      const line = document.createElement('div');
      const at = new Date().toLocaleTimeString();
      let detail = '';
      try { if (data && (data.error || data.message)) detail = ` — ${String(data.error || data.message)}`; } catch {}
      line.textContent = `[${at}] ${msg}${detail}`;
      _errList.appendChild(line);
      _errBar.style.display = 'block';
      // Keep last 6 lines
      try { while (_errList.childElementCount > 6) _errList.removeChild(_errList.firstChild); } catch {}
      // Auto-hide after 10s if no new errors
      if (_errTimer) { clearTimeout(_errTimer); _errTimer = null; }
      _errTimer = setTimeout(() => { try { _errBar.style.display = 'none'; } catch {} }, 10000);
    } catch {}
  }

  try {
    Log.on(({ entries }) => {
      const last = entries && entries.length ? entries[entries.length - 1] : null;
      if (!last) return;
      if (String(last.cls).toUpperCase() === 'ERROR') {
        showErrorMessage(last.cls, last.msg, last.data);
      }
    });
  } catch {}

  return { showErrorMessage };
}

