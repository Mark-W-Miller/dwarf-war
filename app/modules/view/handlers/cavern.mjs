// Cavern mode enter/exit helpers extracted from eventHandler.mjs
// Relies on scry API for scryball placement and lifecycle

export function initCavernApi({ scene, engine, camera, state, helpers = {}, scryApi = {}, Log }) {
  const {
    rebuildScene = () => {},
    rebuildHalos = () => {},
    setMode = () => {},
    setGizmoHudVisible = () => {},
    disposeMoveWidget = () => {},
    disposeRotWidget = () => {},
  } = helpers;

  function enterCavernModeForSpace(spaceId) {
    try {
      const s = (state?.barrow?.spaces || []).find(x => x && x.id === spaceId);
      if (!s) return;
      state._scry.spaceId = s.id;
      try { Log?.log('SELECT', 'cm:enter', { id: s.id }); } catch {}
      // Save War Room camera view
      try {
        state._scry.prev = {
          target: camera.target.clone(),
          radius: camera.radius,
          upper: camera.upperRadiusLimit,
          alpha: camera.alpha,
          beta: camera.beta,
          mode: state.mode,
        };
      } catch {}
      // Position scry ball: saved per-space pos, else center-most voxel
      let pos = null;
      try {
        const key = 'dw:scry:pos:' + s.id;
        const saved = localStorage.getItem(key);
        if (saved) { const o = JSON.parse(saved); if (o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z)) pos = new BABYLON.Vector3(o.x, o.y, o.z); }
      } catch {}
      if (!pos) pos = (scryApi.findScryWorldPosForSpace?.(s)) || new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
      try { scryApi.ensureScryBallAt?.(pos, res * 0.8); } catch {}
      // Switch materials to cavern style (opaque + textured)
      try { state._scry.prevWallOpacity = localStorage.getItem('dw:ui:wallOpacity'); state._scry.prevRockOpacity = localStorage.getItem('dw:ui:rockOpacity'); } catch {}
      try { localStorage.setItem('dw:viewMode', 'cavern'); } catch {}
      try { localStorage.setItem('dw:ui:wallOpacity', '100'); } catch {}
      try { localStorage.setItem('dw:ui:rockOpacity', '100'); } catch {}
      try { rebuildScene(); } catch (e) { try { Log?.log('ERROR', 'EH:rebuildScene:cavern', { error: String(e) }); } catch {} }
      // Focus camera on scry ball
      try {
        camera.target.copyFrom(pos);
        const vx = (s.size?.x||1) * res, vy = (s.size?.y||1) * res, vz = (s.size?.z||1) * res;
        const span = Math.max(vx, vy, vz);
        const rClose = Math.max(2*res, Math.min(12*res, span * 0.25));
        camera.radius = rClose;
        camera.beta = Math.max(0.12, Math.min(Math.PI - 0.12, Math.PI/2));
      } catch {}
      try { setMode('cavern'); } catch {}
      // Remove gizmos in Cavern Mode
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { setGizmoHudVisible(false); } catch {}
    } catch (e) { try { Log?.log('ERROR', 'EH:enterCavern', { error: String(e) }); } catch {} }
  }

  function exitCavernMode() {
    try {
      try { scryApi.exitScryMode?.(); } catch {}
      try { Log?.log('SELECT', 'cm:exit', {}); } catch {}
      // Restore opacities and view mode
      try {
        const defWall = '60', defRock = '85';
        const prevWall = (state._scry.prevWallOpacity != null) ? state._scry.prevWallOpacity : defWall;
        const prevRock = (state._scry.prevRockOpacity != null) ? state._scry.prevRockOpacity : defRock;
        localStorage.setItem('dw:ui:wallOpacity', prevWall);
        localStorage.setItem('dw:ui:rockOpacity', prevRock);
      } catch {}
      try { localStorage.setItem('dw:viewMode', 'war'); } catch {}
      try { rebuildScene(); } catch (e) { try { Log?.log('ERROR', 'EH:rebuildScene:war', { error: String(e) }); } catch {} }
      try { state._scry.prevWallOpacity = null; state._scry.prevRockOpacity = null; } catch {}
      // Restore camera
      try {
        const p = state._scry.prev;
        if (p) {
          camera.target.copyFrom(p.target);
          camera.radius = p.radius;
          camera.upperRadiusLimit = (p.upper != null) ? p.upper : camera.upperRadiusLimit;
          camera.alpha = (p.alpha != null) ? p.alpha : camera.alpha;
          camera.beta = (p.beta != null) ? p.beta : camera.beta;
        }
      } catch {}
      // Clear selection
      try {
        state.selection.clear();
        rebuildHalos();
        try { disposeMoveWidget(); } catch {}
        try { disposeRotWidget(); } catch {}
        window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
        Log?.log('UI', 'Deselect all on WRM return', {});
      } catch {}
      try { scryApi.disposeScryBall?.(); } catch {}
      try { state.lockedVoxPick = null; } catch {}
      try { setMode(state._scry?.prev?.mode || 'edit'); } catch {}
      try { if (state._scry.exitObs) { engine.onBeginFrameObservable.remove(state._scry.exitObs); state._scry.exitObs = null; } } catch {}
    } catch (e) { try { Log?.log('ERROR', 'EH:exitCavern', { error: String(e) }); } catch {} }
  }

  return { enterCavernModeForSpace, exitCavernMode };
}

