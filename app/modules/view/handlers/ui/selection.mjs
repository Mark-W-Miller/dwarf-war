// Selection UI side-effects: respond to selectionChange bus events
export function initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget, ensureMoveWidget }) {
  window.addEventListener('dw:selectionChange', (e) => {
    const sel = (e && e.detail && Array.isArray(e.detail.selection)) ? e.detail.selection : Array.from(state.selection || []);
    if (!sel || sel.length === 0) {
      state.hl?.removeAllMeshes?.();
      requestAnimationFrame(() => { state.hl?.removeAllMeshes?.(); });
      state.hl.isEnabled = true;
      ensureMoveWidget?.(); ensureRotWidget?.();
      return;
    }
    state.hl.isEnabled = true;
    ensureRotWidget?.(); ensureMoveWidget?.();

 });

}

// Pointer selection is handled by sceneHandlers; keep a no-op stub for compatibility
export function initPointerSelection(opts) {
  opts?.Log?.log?.('TRACE', 'selection:init', { mode: (opts?.state?.mode || null) });
}

// Compute the world-space center of the current space selection.
// Uses built meshes' bounding boxes for accuracy.
export function getSelectionCenter(state) {
  const ids = Array.from(state?.selection || []);
  if (!ids.length) return null;
  const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
  const entries = builtSpaces.filter(x => x && ids.includes(x.id));
  if (!entries.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const e of entries) {
    e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo();
    const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
    const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
    minX = Math.min(minX, bmin.x); minY = Math.min(minY, bmin.y); minZ = Math.min(minZ, bmin.z);
    maxX = Math.max(maxX, bmax.x); maxY = Math.max(maxY, bmax.y); maxZ = Math.max(maxZ, bmax.z);
  }
  if (!isFinite(minX)) return null;
  return new BABYLON.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

}

