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
    const s = (state?.barrow?.spaces || []).find(x => x && x.id === spaceId);
    if (!s) return;
    state._scry.spaceId = s.id;
    Log?.log('SELECT', 'cm:enter', { id: s.id });
    // Save War Room camera view
    state._scry.prev = {
      target: camera.target.clone(),
      radius: camera.radius,
      upper: camera.upperRadiusLimit,
      alpha: camera.alpha,
      beta: camera.beta,
      mode: state.mode,
 };

    // Position scry ball: saved per-space pos, else center-most voxel
    let pos = null;
    const key = 'dw:scry:pos:' + s.id;
    const saved = localStorage.getItem(key);
    if (saved) { const o = JSON.parse(saved); if (o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z)) pos = new BABYLON.Vector3(o.x, o.y, o.z); }

    if (!pos) pos = (scryApi.findScryWorldPosForSpace?.(s)) || new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
    const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
    scryApi.ensureScryBallAt?.(pos, res * 0.8);
    // Switch materials to cavern style (opaque + textured)
    state._scry.prevWallOpacity = localStorage.getItem('dw:ui:wallOpacity'); state._scry.prevRockOpacity = localStorage.getItem('dw:ui:rockOpacity');
    localStorage.setItem('dw:viewMode', 'cavern');
    localStorage.setItem('dw:ui:wallOpacity', '100');
    localStorage.setItem('dw:ui:rockOpacity', '100');
    rebuildScene();
    // Focus camera on scry ball
    camera.target.copyFrom(pos);
    const vx = (s.size?.x||1) * res, vy = (s.size?.y||1) * res, vz = (s.size?.z||1) * res;
    const span = Math.max(vx, vy, vz);
    const rClose = Math.max(2*res, Math.min(12*res, span * 0.25));
    camera.radius = rClose;
    camera.beta = Math.max(0.12, Math.min(Math.PI - 0.12, Math.PI/2));

    scryApi.enterScryMode?.();

    setMode('cavern');
    // Remove gizmos in Cavern Mode
    disposeMoveWidget();
    disposeRotWidget();
    setGizmoHudVisible(false);

  }

  function exitCavernMode() {
    scryApi.exitScryMode?.();
    Log?.log('SELECT', 'cm:exit', {});
    // Restore opacities and view mode
    const defWall = '60', defRock = '85';
    const prevWall = (state._scry.prevWallOpacity != null) ? state._scry.prevWallOpacity : defWall;
    const prevRock = (state._scry.prevRockOpacity != null) ? state._scry.prevRockOpacity : defRock;
    localStorage.setItem('dw:ui:wallOpacity', prevWall);
    localStorage.setItem('dw:ui:rockOpacity', prevRock);

    localStorage.setItem('dw:viewMode', 'war');
    rebuildScene();
    state._scry.prevWallOpacity = null; state._scry.prevRockOpacity = null;
    // Restore camera
    const p = state._scry.prev;
    if (p) {
      camera.target.copyFrom(p.target);
      camera.radius = p.radius;
      camera.upperRadiusLimit = (p.upper != null) ? p.upper : camera.upperRadiusLimit;
      camera.alpha = (p.alpha != null) ? p.alpha : camera.alpha;
      camera.beta = (p.beta != null) ? p.beta : camera.beta;
    }

    // Clear selection
    state.selection.clear();
    rebuildHalos();
    disposeMoveWidget();
    disposeRotWidget();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
    Log?.log('UI', 'Deselect all on WRM return', {});

    scryApi.disposeScryBall?.();
    state.lockedVoxPick = null;
    setMode(state._scry?.prev?.mode || 'edit');
    if (state._scry.exitObs) { engine.onBeginFrameObservable.remove(state._scry.exitObs); state._scry.exitObs = null; }

  }

  return { enterCavernModeForSpace, exitCavernMode };
}
