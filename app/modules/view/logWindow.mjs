// Floating Log window (overlay) with filters and entries
export function initLogWindow({ Log }) {
  let root = document.getElementById('logWindow');
  if (root && root._inited) {
    const api = root._api; return api || { open: () => { root.style.display='block'; }, close: () => { root.style.display='none'; }, toggle: () => { root.style.display = (root.style.display==='none'||!root.style.display)?'block':'none'; } };
  }
  const POS_KEY = 'dw:ui:logWinPos';
  const SIZE_KEY = 'dw:ui:logWinSize';
  const MIN_W = 480; // ensure roomy default and min sizes
  const MIN_H = 300;
  const OPEN_KEY = 'dw:ui:logWinOpen';
  let savedOpen = false;
  try { savedOpen = (localStorage.getItem(OPEN_KEY) === '1'); } catch {}
  root = document.createElement('div'); root.id = 'logWindow'; root.style.cssText = [
    'position:fixed','right:24px','top:64px','width:1000px','height:720px','min-width:'+MIN_W+'px','min-height:'+MIN_H+'px','background:#0b1116','color:#cfe1ea',
    'border:1px solid #1e2a30','border-radius:8px','box-shadow:0 8px 20px rgba(0,0,0,0.45)','z-index:2002','display:none',
    'overflow:hidden','backdrop-filter: blur(2px)','resize:both','box-sizing:border-box'
  ].join(';');
  // Apply saved window position (persisted until the window is closed)
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.top)) {
      root.style.right = Math.max(8, Math.floor(saved.right)) + 'px';
      root.style.top = Math.max(8, Math.floor(saved.top)) + 'px';
    }
  } catch {}
  // Apply saved window size if present
  try {
    const sz = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    if (sz && Number.isFinite(sz.w) && Number.isFinite(sz.h)) {
      root.style.width = Math.max(MIN_W, Math.floor(sz.w)) + 'px';
      root.style.height = Math.max(MIN_H, Math.floor(sz.h)) + 'px';
    }
  } catch {}
  const header = document.createElement('div'); header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#0f151a;border-bottom:1px solid #1e2a30;padding:6px 8px;cursor:move;';
  const title = document.createElement('div'); title.textContent = 'Log'; title.style.fontWeight = '600';
  const hdrBtns = document.createElement('div'); hdrBtns.style.display='flex'; hdrBtns.style.gap='6px';
  const btnClear = document.createElement('button'); btnClear.className='btn warn'; btnClear.textContent='Clear';
  const btnCopy = document.createElement('button'); btnCopy.className='btn'; btnCopy.textContent='Copy';
  const btnClose = document.createElement('button'); btnClose.className='icon-btn'; btnClose.textContent='✕'; btnClose.title='Close';
  hdrBtns.appendChild(btnCopy); hdrBtns.appendChild(btnClear); hdrBtns.appendChild(btnClose);
  header.appendChild(title); header.appendChild(hdrBtns);
  const content = document.createElement('div'); content.style.cssText='display:flex;flex-direction:column;gap:6px;padding:8px;height:calc(100% - 36px);';
  const filtersBox = document.createElement('div'); filtersBox.id='logClassFiltersWin'; filtersBox.style.cssText='display:flex;flex-wrap:wrap;gap:8px;';
  const entries = document.createElement('div'); entries.id='logEntriesWin'; entries.style.cssText='white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:12px;flex:1;min-height:0;overflow:auto;border:1px solid #1e2a30;border-radius:6px;padding:8px;background:#0f151a;';
  content.appendChild(filtersBox); content.appendChild(entries);
  root.appendChild(header); root.appendChild(content); document.body.appendChild(root);

  // Dragging
  (function enableDrag(){
    let dragging=false, sx=0, sy=0, start={x:0,y:0};
    header.addEventListener('mousedown', (e)=>{ dragging=true; sx=e.clientX||0; sy=e.clientY||0; const r=root.getBoundingClientRect(); start={x:r.right, y:r.top}; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); });
    function onMove(e){
      if(!dragging) return;
      const dx=(e.clientX||0)-sx; const dy=(e.clientY||0)-sy;
      const rightPx = Math.max(8, window.innerWidth - (start.x + dx));
      const topPx = Math.max(8, start.y + dy);
      root.style.right = rightPx + 'px';
      root.style.top = topPx + 'px';
      try { localStorage.setItem(POS_KEY, JSON.stringify({ right: rightPx, top: topPx })); } catch {}
    }
    function onUp(){ dragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); try { const r = parseInt(root.style.right)||24, t = parseInt(root.style.top)||64; localStorage.setItem(POS_KEY, JSON.stringify({ right: r, top: t })); } catch {} }
  })();

  // Resize handle (bottom-right corner)
  (function enableResize(){
    const grip = document.createElement('div');
    grip.title = 'Resize';
    grip.style.position = 'absolute';
    grip.style.right = '6px';
    grip.style.bottom = '6px';
    grip.style.width = '14px';
    grip.style.height = '14px';
    grip.style.cursor = 'se-resize';
    grip.style.opacity = '0.9';
    grip.style.borderRight = '2px solid #2a3a44';
    grip.style.borderBottom = '2px solid #2a3a44';
    grip.style.transform = 'rotate(0deg)';
    grip.style.boxSizing = 'border-box';
    grip.style.zIndex = '3';
    grip.style.pointerEvents = 'auto';
    root.appendChild(grip);

    let resizing = false, sx = 0, sy = 0, startW = 0, startH = 0;
    function onMove(e){
      if (!resizing) return;
      const dx = (e.clientX||0) - sx; const dy = (e.clientY||0) - sy;
      const w = Math.max(MIN_W, startW + dx);
      const h = Math.max(MIN_H, startH + dy);
      root.style.width = w + 'px';
      root.style.height = h + 'px';
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })); } catch {}
      e.preventDefault();
    }
    function onUp(){ resizing = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    grip.addEventListener('mousedown', (e) => {
      resizing = true; sx = e.clientX||0; sy = e.clientY||0; const r = root.getBoundingClientRect(); startW = r.width; startH = r.height; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); e.stopPropagation();
    });
    // Touch support
    grip.addEventListener('touchstart', (e) => {
      const t = e.touches && e.touches[0]; if (!t) return;
      resizing = true; sx = t.clientX||0; sy = t.clientY||0; const r = root.getBoundingClientRect(); startW = r.width; startH = r.height; document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onUp); e.preventDefault(); e.stopPropagation();
    }, { passive:false });
  })();

  // Persist native CSS resize changes as well (when dragging edges/corners)
  try {
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) {
        if (ent.target !== root) continue;
        const rect = ent.contentRect || root.getBoundingClientRect();
        const w = Math.max(MIN_W, Math.floor(rect.width));
        const h = Math.max(MIN_H, Math.floor(rect.height));
        try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })); } catch {}
      }
    });
    ro.observe(root);
  } catch {}

  const SELECTED_KEY = 'dw:log:selected';
  const selected = new Set();
  // Load persisted selection
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach(c => selected.add(String(c)));
    }
  } catch {}
  function renderFilters() {
    const classes = Array.from(Log.getClasses()).sort();
    // If no persisted selection yet, default-select all current classes and persist once
    if (selected.size === 0 && classes.length > 0) {
      classes.forEach(c => selected.add(c));
      try { localStorage.setItem(SELECTED_KEY, JSON.stringify(Array.from(selected))); } catch {}
    }
    filtersBox.innerHTML='';
    classes.forEach(c => {
      const label=document.createElement('label'); label.style.cssText='display:inline-flex;align-items:center;gap:6px;';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=selected.has(c);
      cb.addEventListener('change', ()=>{
        if(cb.checked) selected.add(c); else selected.delete(c);
        try { localStorage.setItem(SELECTED_KEY, JSON.stringify(Array.from(selected))); } catch {}
        renderEntries();
      });
      label.appendChild(cb); label.appendChild(document.createTextNode(c)); filtersBox.appendChild(label);
    });
  }
  function renderEntries() {
    const list = Log.getEntries();
    const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
    const lines = filtered.slice(-800).map(e => {
      const t = new Date(e.time).toLocaleTimeString();
      const d = e.data != null ? ` ${JSON.stringify(e.data, (k,v) => (typeof v === 'number' ? parseFloat(Number(v).toPrecision(2)) : v))}` : '';
      return `[${t}] [${e.cls}] ${e.msg}${d}`;
    });
    entries.textContent = lines.join('\n'); entries.scrollTop = entries.scrollHeight;
  }
  Log.on(() => { renderFilters(); renderEntries(); });
  btnClear.addEventListener('click', () => { try { Log.clear(); } catch {} });
  btnCopy.addEventListener('click', async () => {
    try {
      const list = Log.getEntries(); const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
      const text = filtered.map(e => { const t=new Date(e.time).toLocaleTimeString(); const d=e.data!=null?` ${JSON.stringify(e.data, (k,v)=> (typeof v==='number'?parseFloat(Number(v).toPrecision(2)):v))}`:''; return `[${t}] [${e.cls}] ${e.msg}${d}`; }).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else { const ta=document.createElement('textarea'); ta.style.position='fixed'; ta.style.opacity='0'; ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      btnCopy.textContent='Copied!'; setTimeout(()=>{ btnCopy.textContent='Copy'; }, 1200);
    } catch { btnCopy.textContent='Copy failed'; setTimeout(()=>{ btnCopy.textContent='Copy'; }, 1500); }
  });
  btnClose.addEventListener('click', () => { root.style.display='none'; });

  const api = {
    open(){ try { localStorage.setItem(OPEN_KEY, '1'); } catch {} root.style.display='block'; renderFilters(); renderEntries(); },
    close(){ try { localStorage.setItem(OPEN_KEY, '0'); } catch {} root.style.display='none'; },
    toggle(){ if (root.style.display==='none' || !root.style.display) this.open(); else this.close(); },
  };
  root._inited = true; root._api = api;
  // Restore open state across reloads
  if (savedOpen) { try { api.open(); } catch {} } else { try { api.close(); } catch {} }
  return api;
}
