// Floating Log window (overlay) with filters and entries
export function initLogWindow({ Log }) {
  let root = document.getElementById('logWindow');
  if (root && root._inited) {
    const api = root._api; return api || { open: () => { root.style.display='block'; }, close: () => { root.style.display='none'; }, toggle: () => { root.style.display = (root.style.display==='none'||!root.style.display)?'block':'none'; } };
  }
  root = document.createElement('div'); root.id = 'logWindow'; root.style.cssText = [
    'position:fixed','right:24px','top:64px','width:500px','height:360px','background:#0b1116','color:#cfe1ea',
    'border:1px solid #1e2a30','border-radius:8px','box-shadow:0 8px 20px rgba(0,0,0,0.45)','z-index:2002','display:none',
    'overflow:hidden','backdrop-filter: blur(2px)'
  ].join(';');
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
    function onMove(e){ if(!dragging) return; const dx=(e.clientX||0)-sx; const dy=(e.clientY||0)-sy; const rightPx = Math.max(8, window.innerWidth - (start.x + dx)); const topPx = Math.max(8, start.y + dy); root.style.right = rightPx + 'px'; root.style.top = topPx + 'px'; }
    function onUp(){ dragging=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
  })();

  const selected = new Set();
  function renderFilters() {
    const classes = Array.from(Log.getClasses()).sort();
    if (selected.size === 0) classes.forEach(c => selected.add(c)); else classes.forEach(c => { if (!selected.has(c)) selected.add(c); });
    filtersBox.innerHTML='';
    classes.forEach(c => {
      const label=document.createElement('label'); label.style.cssText='display:inline-flex;align-items:center;gap:6px;';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=selected.has(c);
      cb.addEventListener('change', ()=>{ if(cb.checked) selected.add(c); else selected.delete(c); renderEntries(); });
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
    open(){ root.style.display='block'; renderFilters(); renderEntries(); },
    close(){ root.style.display='none'; },
    toggle(){ if (root.style.display==='none' || !root.style.display) this.open(); else this.close(); },
  };
  root._inited = true; root._api = api;
  return api;
}

