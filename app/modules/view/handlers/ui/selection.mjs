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

// Pointer selection is handled by sceneHandlers; keep a no-op stub for compatibility
export function initPointerSelection(opts) {
  try { opts?.Log?.log?.('TRACE', 'selection:init', { mode: (opts?.state?.mode || null) }); } catch {}
}

// Compute the world-space center of the current space selection.
// Uses built meshes' bounding boxes for accuracy.
export function getSelectionCenter(state) {
  try {
    const ids = Array.from(state?.selection || []);
    if (!ids.length) return null;
    const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
    const entries = builtSpaces.filter(x => x && ids.includes(x.id));
    if (!entries.length) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const e of entries) {
      try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
      const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
      const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
      minX = Math.min(minX, bmin.x); minY = Math.min(minY, bmin.y); minZ = Math.min(minZ, bmin.z);
      maxX = Math.max(maxX, bmax.x); maxY = Math.max(maxY, bmax.y); maxZ = Math.max(maxZ, bmax.z);
    }
    if (!isFinite(minX)) return null;
    return new BABYLON.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  } catch { return null; }
}

