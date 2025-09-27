// Selection UI side-effects: respond to selectionChange bus events
export function initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget, ensureMoveWidget }) {
  try {
    window.addEventListener('dw:selectionChange', (e) => {
      try {
        const sel = (e && e.detail && Array.isArray(e.detail.selection)) ? e.detail.selection : Array.from(state.selection || []);
        if (!sel || sel.length === 0) {
          try { state.hl?.removeAllMeshes?.(); } catch {}
          try { requestAnimationFrame(() => { try { state.hl?.removeAllMeshes?.(); } catch {} }); } catch {}
          try { state.hl.isEnabled = true; } catch {}
          try { ensureMoveWidget?.(); ensureRotWidget?.(); } catch {}
          return;
        }
        try { state.hl.isEnabled = true; } catch {}
        try { ensureRotWidget?.(); ensureMoveWidget?.(); } catch {}
      } catch {}
    });
  } catch {}
}

