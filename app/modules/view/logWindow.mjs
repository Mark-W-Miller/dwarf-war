import { Log } from '../util/log.mjs';

// Floating log window (spawned by header button)
export function initLogWindow() {
  let win = document.getElementById('dwLogWindow');
  if (!win) {
    win = document.createElement('div'); win.id = 'dwLogWindow';
    Object.assign(win.style, {
      position: 'fixed', right: '16px', top: '64px', width: '480px', height: '360px',
      background: 'rgba(10,14,18,0.95)', border: '1px solid #1e2a30', borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)', color: '#e3edf3', zIndex: 2000,
      display: 'none', overflow: 'hidden'
    });
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(20,26,32,0.95)', cursor: 'move' });
    const title = document.createElement('div'); title.textContent = 'Log'; title.style.fontWeight = '600';
    const btns = document.createElement('div'); btns.style.display = 'flex'; btns.style.gap = '6px';
    const copyBtn = document.createElement('button'); copyBtn.className = 'btn'; copyBtn.textContent = 'Copy';
    const clearBtn = document.createElement('button'); clearBtn.className = 'btn warn'; clearBtn.textContent = 'Clear';
    const closeBtn = document.createElement('button'); closeBtn.className = 'icon-btn'; closeBtn.textContent = '✕';
    btns.appendChild(copyBtn); btns.appendChild(clearBtn); btns.appendChild(closeBtn);
    header.appendChild(title); header.appendChild(btns);
    const body = document.createElement('div');
    Object.assign(body.style, { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 10px', height: 'calc(100% - 42px)' });
    const filtersBox = document.createElement('div'); Object.assign(filtersBox.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    const entries = document.createElement('div'); Object.assign(entries.style, { flex: 1, minHeight: 0, overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid #1e2a30', borderRadius: '6px', padding: '8px', background: '#0f151a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px' });
    body.appendChild(filtersBox); body.appendChild(entries);
    // Resizer handles: right edge, bottom edge, and bottom-right corner
    const resizerCorner = document.createElement('div');
    Object.assign(resizerCorner.style, { position: 'absolute', right: '0', bottom: '0', width: '14px', height: '14px', cursor: 'nwse-resize', background: 'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 70%)' });
    const resizerRight = document.createElement('div');
    Object.assign(resizerRight.style, { position: 'absolute', right: '0', top: '0', width: '6px', height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.06)' });
    const resizerBottom = document.createElement('div');
    Object.assign(resizerBottom.style, { position: 'absolute', left: '0', bottom: '0', width: '100%', height: '6px', cursor: 'ns-resize', background: 'rgba(255,255,255,0.06)' });
    win.appendChild(header); win.appendChild(body); win.appendChild(resizerCorner); win.appendChild(resizerRight); win.appendChild(resizerBottom); document.body.appendChild(win);

    // Drag move
    let dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
    const onMove = (e) => { if (!dragging) return; const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0; const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0; const dx = x - sx, dy = y - sy; win.style.right = ''; win.style.left = Math.max(8, startLeft + dx) + 'px'; win.style.top = Math.max(8, startTop + dy) + 'px'; };
    function saveGeom() {
      try {
        const r = win.getBoundingClientRect();
        const geom = { left: r.left, top: r.top, width: r.width, height: r.height };
        localStorage.setItem('dw:log:geom', JSON.stringify(geom));
      } catch {}
    }
    const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); saveGeom(); };
    header.addEventListener('mousedown', (e) => { dragging = true; sx = e.clientX||0; sy = e.clientY||0; const r = win.getBoundingClientRect(); startLeft = r.left; startTop = r.top; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
    header.addEventListener('touchstart', (e) => { const t=e.touches&&e.touches[0]; if(!t) return; dragging=true; sx=t.clientX; sy=t.clientY; const r=win.getBoundingClientRect(); startLeft=r.left; startTop=r.top; document.addEventListener('touchmove', onMove, {passive:false}); document.addEventListener('touchend', onUp); }, {passive:false});

    // Resize: shared helpers
    function attachResize(elem, mode) {
      let resizing = false, sw = 0, sh = 0, startW = 0, startH = 0;
      const onResizeMove = (e) => {
        if (!resizing) return;
        const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
        const y = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;
        const dx = x - sw, dy = y - sh;
        let w = startW, h = startH;
        if (mode === 'corner' || mode === 'right') w = Math.max(360, startW + dx);
        if (mode === 'corner' || mode === 'bottom') h = Math.max(220, startH + dy);
        win.style.width = w + 'px'; win.style.height = h + 'px';
      };
      const onResizeUp = () => {
        resizing = false;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeUp);
        document.removeEventListener('touchmove', onResizeMove);
        document.removeEventListener('touchend', onResizeUp);
        saveGeom();
      };
      elem.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        resizing = true; sw = e.clientX||0; sh = e.clientY||0;
        const r = win.getBoundingClientRect(); startW = r.width; startH = r.height;
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeUp);
      });
      elem.addEventListener('touchstart', (e) => {
        const t = e.touches && e.touches[0]; if (!t) return;
        e.preventDefault(); e.stopPropagation();
        resizing = true; sw = t.clientX; sh = t.clientY;
        const r = win.getBoundingClientRect(); startW = r.width; startH = r.height;
        document.addEventListener('touchmove', onResizeMove, { passive: false });
        document.addEventListener('touchend', onResizeUp);
      }, { passive: false });
    }
    attachResize(resizerCorner, 'corner');
    attachResize(resizerRight, 'right');
    attachResize(resizerBottom, 'bottom');

    // Filters and entries
    const selected = new Set();
    function renderFilters() {
      const classes = Array.from(Log.getClasses()).sort();
      if (selected.size === 0) classes.forEach(c => selected.add(c)); else classes.forEach(c => { if (!selected.has(c)) selected.add(c); });
      filtersBox.innerHTML='';
      classes.forEach(c => { const label=document.createElement('label'); label.style.display='inline-flex'; label.style.alignItems='center'; label.style.gap='6px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=selected.has(c); cb.addEventListener('change', () => { if(cb.checked) selected.add(c); else selected.delete(c); renderEntries(); }); label.appendChild(cb); label.appendChild(document.createTextNode(c)); filtersBox.appendChild(label); });
    }
    function renderEntries() {
      const list = Log.getEntries();
      const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
      const lines = filtered.slice(-1000).map(e => { const t=new Date(e.time).toLocaleTimeString(); const d = e.data != null ? ` ${JSON.stringify(e.data, (k,v)=> (typeof v==='number'? parseFloat(Number(v).toPrecision(2)) : v))}` : ''; return `[${t}] [${e.cls}] ${e.msg}${d}`; });
      entries.textContent = lines.join('\n'); entries.scrollTop = entries.scrollHeight;
    }
    Log.on(() => { renderFilters(); renderEntries(); });
    copyBtn.addEventListener('click', async () => {
      try {
        const list = Log.getEntries();
        const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
        // Build from the end within a character budget so it can be pasted here comfortably
        const MAX_CHARS = 8000; // ~8KB budget
        const chunks = [];
        let used = 0;
        for (let i = filtered.length - 1; i >= 0; i--) {
          const e = filtered[i];
          const t = new Date(e.time).toISOString();
          const d = e.data != null ? ` ${JSON.stringify(e.data)}` : '';
          const line = `[${t}] [${e.cls}] ${e.msg}${d}`;
          const extra = (chunks.length === 0 ? 0 : 1) + line.length; // +\n except first
          if (used + extra > MAX_CHARS) {
            if (chunks.length === 0) { chunks.push(line.slice(-(MAX_CHARS))); used = MAX_CHARS; }
            break;
          }
          chunks.push(line); used += extra;
        }
        const text = chunks.reverse().join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
        else { const ta=document.createElement('textarea'); ta.style.position='fixed'; ta.style.opacity='0'; ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
        copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 1000);
      } catch {
        copyBtn.textContent = 'Copy failed'; setTimeout(() => copyBtn.textContent = 'Copy', 1200);
      }
    });
    clearBtn.addEventListener('click', () => { try { Log.clear(); } catch {} });
    closeBtn.addEventListener('click', () => { win.style.display='none'; });

    // Restore geometry if present
    try {
      const g = JSON.parse(localStorage.getItem('dw:log:geom')||'null');
      if (g && isFinite(g.left) && isFinite(g.top) && isFinite(g.width) && isFinite(g.height)) {
        win.style.right = '';
        win.style.left = g.left + 'px';
        win.style.top = g.top + 'px';
        win.style.width = Math.max(360, g.width) + 'px';
        win.style.height = Math.max(220, g.height) + 'px';
      }
    } catch {}

    // initial paint
    renderFilters(); renderEntries();
  }
  // toggle open
  win.style.display = (win.style.display==='none'||!win.style.display) ? 'block' : 'none';
}
