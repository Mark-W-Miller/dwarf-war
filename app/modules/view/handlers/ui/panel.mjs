// Panel UI: resizer and collapse/expand behavior

import { initLogWindow } from '../../logWindow.mjs';

export function initPanelUI({ panel, collapsePanelBtn, engine, Log }) {
  if (!panel) return;
  // Resizer
  try {
    const w = Number(localStorage.getItem('dw:ui:panelWidth')||'0')||0;
    if (w >= 240 && w <= Math.max(260, window.innerWidth - 80)) panel.style.width = w + 'px';
  } catch {}
  const handle = document.createElement('div');
  handle.id = 'panelResizer';
  Object.assign(handle.style, { position:'absolute', left:'-6px', top:'0', width:'8px', height:'100%', cursor:'ew-resize', background:'transparent', zIndex:'5' });
  handle.title = 'Drag to resize panel';
  panel.appendChild(handle);
  let dragging = false; let startX = 0; let startW = 0;
  function onMove(e){ if (!dragging) return; const dx = (startX - (e.clientX || 0)); let w = Math.round(startW + dx); const maxW = Math.max(260, window.innerWidth - 80); w = Math.max(240, Math.min(maxW, w)); panel.style.width = w + 'px'; try { localStorage.setItem('dw:ui:panelWidth', String(w)); } catch {} }
  function onUp(){ if (!dragging) return; dragging = false; try { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); } catch {} }
  handle.addEventListener('mousedown', (e) => { if (panel.classList.contains('collapsed')) return; dragging = true; startX = e.clientX || 0; startW = panel.getBoundingClientRect().width; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); e.preventDefault(); e.stopPropagation(); });
  handle.addEventListener('touchstart', (e) => { if (panel.classList.contains('collapsed')) return; const t = e.touches && e.touches[0]; if (!t) return; dragging = true; startX = t.clientX; startW = panel.getBoundingClientRect().width; document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onUp); e.preventDefault(); e.stopPropagation(); }, { passive:false });
  const obs = new MutationObserver(() => { handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block'; });
  try { obs.observe(panel, { attributes:true, attributeFilter:['class'] }); } catch {}
  handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block';
  window.addEventListener('resize', () => { try { const maxW = Math.max(260, window.innerWidth - 80); const cur = panel.getBoundingClientRect().width; if (cur > maxW) { panel.style.width = maxW + 'px'; localStorage.setItem('dw:ui:panelWidth', String(maxW)); } } catch {} });

  // Collapse/expand
  const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
  function applyPanelCollapsed(collapsed) {
    panel.classList.toggle('collapsed', !!collapsed);
    if (!collapsePanelBtn) return;
    collapsePanelBtn.textContent = collapsed ? '⟩' : '⟨⟩';
    try {
      if (collapsed) {
        const rect = panel.getBoundingClientRect();
        const w = rect.width || 320; const tab = 36;
        panel.style.right = `${-(Math.max(40, w) - tab)}px`;
        panel.style.pointerEvents = 'none';
        const topPx = Math.max(8, rect.top);
        Object.assign(collapsePanelBtn.style, { position:'fixed', right:'12px', top:`${topPx+8}px`, zIndex:'2001', pointerEvents:'auto', padding:'8px 10px', borderRadius:'8px' });
        collapsePanelBtn.title = 'Expand Panel';
      } else {
        panel.style.right = ''; panel.style.pointerEvents='';
        Object.assign(collapsePanelBtn.style, { position:'', right:'', top:'', zIndex:'', pointerEvents:'', padding:'', borderRadius:'' });
        collapsePanelBtn.title = 'Collapse/Expand';
      }
    } catch {}
  }
  try { applyPanelCollapsed(localStorage.getItem(PANEL_STATE_KEY) === '1'); } catch {}
  collapsePanelBtn?.addEventListener('click', () => { const next = !panel.classList.contains('collapsed'); applyPanelCollapsed(next); try { localStorage.setItem(PANEL_STATE_KEY, next ? '1' : '0'); } catch {} });

  // Header quick-open buttons for Log and Settings tabs
  try {
    const logBtn = document.getElementById('logOpen');
    const settingsBtn = document.getElementById('settingsOpen');
    // Initialize floating log window (once)
    const logWin = initLogWindow({ Log });
    const activate = (tabId) => {
      try {
        const btn = document.querySelector(`.tabs .tab[data-tab="${tabId}"]`);
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        else window.dispatchEvent(new CustomEvent('dw:tabChange', { detail: { id: tabId } }));
      } catch {}
    };
    logBtn?.addEventListener('click', () => { try { logWin.toggle(); } catch {} });
    settingsBtn?.addEventListener('click', () => activate('tab-settings'));
  } catch {}

  return { applyPanelCollapsed };
}
