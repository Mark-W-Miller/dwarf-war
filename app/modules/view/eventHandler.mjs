import { makeDefaultBarrow, mergeInstructions, layoutBarrow, worldAabbFromSpace } from '../barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot, cloneForSave, inflateAfterLoad } from '../barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from '../barrow/builder.mjs';
import { VoxelType, decompressVox } from '../voxels/voxelize.mjs';
import { Log } from '../util/log.mjs';
import { renderDbView } from './dbView.mjs';

// Initialize all UI and scene event handlers that were previously in main.mjs
export function initEventHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateHud } = helpers;

  function logErr(ctx, e) {
    try { Log.log('ERROR', ctx, { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {}
  }
  function sLog(ev, data = {}) {
    try { Log.log('SELECT', ev, data); } catch {}
  }
  function mLog(ev, data = {}) {
    try { Log.log('MOVE', ev, data); } catch {}
  }

  // ——— Controls and elements ———
  const toggleRunBtn = document.getElementById('toggleRun');
  const resetBtn = document.getElementById('reset');
  const exportBtn = document.getElementById('export');
  const importBtn = document.getElementById('import');
  const importFile = document.getElementById('importFile');

  const tStepEl = document.getElementById('tStep');
  const txMinus = document.getElementById('txMinus');
  const txPlus = document.getElementById('txPlus');
  const tyMinus = document.getElementById('tyMinus');
  const tyPlus = document.getElementById('tyPlus');
  const tzMinus = document.getElementById('tzMinus');
  const tzPlus = document.getElementById('tzPlus');
  const spaceTypeEl = document.getElementById('spaceType');
  const spaceNameEl = document.getElementById('spaceName');
  const newSpaceBtn = document.getElementById('newSpace');
  const fitViewBtn = document.getElementById('fitView');
  const sizeXEl = document.getElementById('sizeX');
  const sizeYEl = document.getElementById('sizeY');
  const sizeZEl = document.getElementById('sizeZ');
  const showNamesCb = document.getElementById('showNames');
  const gridGroundCb = document.getElementById('gridGround');
  const gridXYCb = document.getElementById('gridXY');
  const gridYZCb = document.getElementById('gridYZ');
  const axisArrowsCb = document.getElementById('axisArrows');
  const resizeGridBtn = document.getElementById('resizeGrid');

  const panel = document.getElementById('rightPanel');
  const collapsePanelBtn = document.getElementById('collapsePanel');

  // ——————————— Resizable panel ———————————
  (function setupPanelResizer(){
    if (!panel) return;
    // Apply stored width
    try {
      const w = Number(localStorage.getItem('dw:ui:panelWidth')||'0')||0;
      if (w >= 240 && w <= Math.max(260, window.innerWidth - 80)) panel.style.width = w + 'px';
    } catch {}
    // Create resizer handle on the left edge
    const handle = document.createElement('div');
    handle.id = 'panelResizer';
    handle.style.position = 'absolute';
    handle.style.left = '-6px';
    handle.style.top = '0';
    handle.style.width = '8px';
    handle.style.height = '100%';
    handle.style.cursor = 'ew-resize';
    handle.style.background = 'transparent';
    handle.style.zIndex = '5';
    handle.title = 'Drag to resize panel';
    panel.appendChild(handle);

    let dragging = false; let startX = 0; let startW = 0;
    function onMove(e){
      if (!dragging) return;
      const dx = (startX - (e.clientX || 0)); // dragging left increases width
      let w = Math.round(startW + dx);
      const maxW = Math.max(260, window.innerWidth - 80);
      w = Math.max(240, Math.min(maxW, w));
      panel.style.width = w + 'px';
      try { localStorage.setItem('dw:ui:panelWidth', String(w)); } catch (e) { logErr('EH:panel:setWidth', e); }
    }
    function onUp(e){
      if (!dragging) return;
      dragging = false;
      try { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); } catch (e) { logErr('EH:panel:rmMouse', e); }
      try { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); } catch (e) { logErr('EH:panel:rmTouch', e); }
    }
    handle.addEventListener('mousedown', (e) => {
      if (panel.classList.contains('collapsed')) return;
      dragging = true; startX = e.clientX || 0; startW = panel.getBoundingClientRect().width;
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      e.preventDefault(); e.stopPropagation();
    });
    handle.addEventListener('touchstart', (e) => {
      if (panel.classList.contains('collapsed')) return;
      const t = e.touches && e.touches[0]; if (!t) return;
      dragging = true; startX = t.clientX; startW = panel.getBoundingClientRect().width;
      document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onUp);
      e.preventDefault(); e.stopPropagation();
    }, { passive:false });
    // Hide resizer when collapsed
    const obs = new MutationObserver(() => { handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block'; });
    try { obs.observe(panel, { attributes:true, attributeFilter:['class'] }); } catch (e) { logErr('EH:panel:obs', e); }
    handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block';
    window.addEventListener('resize', () => {
      // Clamp panel width on viewport resize
      try {
        const maxW = Math.max(260, window.innerWidth - 80);
        const cur = panel.getBoundingClientRect().width;
        if (cur > maxW) { panel.style.width = maxW + 'px'; localStorage.setItem('dw:ui:panelWidth', String(maxW)); }
      } catch (e) { logErr('EH:panel:clampWidth', e); }
    });
  })();

  // ——————————— Mode and run/pause ———————————
  document.querySelectorAll('input[name="mode"]').forEach(r => {
    r.addEventListener('change', () => setMode(r.value));
  });
  toggleRunBtn?.addEventListener('click', () => {
    setRunning(!state.running);
    if (toggleRunBtn) toggleRunBtn.textContent = state.running ? 'Pause' : 'Run';
    Log.log('UI', 'Toggle run', { running: state.running });
  });

  // ——————————— View toggles (names + grids) ———————————
  // Rotation helper: quaternion rotating from a to b
  function quatFromTo(vFrom, vTo) {
    const a = vFrom.clone(); try { a.normalize(); } catch {}
    const b = vTo.clone(); try { b.normalize(); } catch {}
    const dot = BABYLON.Vector3.Dot(a, b);
    if (dot > 0.999999) return BABYLON.Quaternion.Identity();
    if (dot < -0.999999) {
      let axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(1,0,0));
      if (axis.lengthSquared() < 1e-6) axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(0,0,1));
      try { axis.normalize(); } catch {}
      return BABYLON.Quaternion.RotationAxis(axis, Math.PI);
    }
    let axis = BABYLON.Vector3.Cross(a, b); try { axis.normalize(); } catch {}
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    return BABYLON.Quaternion.RotationAxis(axis, angle);
  }
  function readBool(key, dflt = true) { try { const v = localStorage.getItem(key); return v == null ? dflt : v !== '0'; } catch { return dflt; } }
  function writeBool(key, val) { try { localStorage.setItem(key, val ? '1' : '0'); } catch {} }

  if (showNamesCb) { showNamesCb.checked = readBool('dw:ui:showNames', true); }
  if (gridGroundCb) { gridGroundCb.checked = readBool('dw:ui:gridGround', true); }
  if (gridXYCb) { gridXYCb.checked = readBool('dw:ui:gridXY', true); }
  if (gridYZCb) { gridYZCb.checked = readBool('dw:ui:gridYZ', true); }
  if (axisArrowsCb) { axisArrowsCb.checked = readBool('dw:ui:axisArrows', true); }

  function applyTogglesFromUI() {
    if (showNamesCb) writeBool('dw:ui:showNames', !!showNamesCb.checked);
    if (gridGroundCb) writeBool('dw:ui:gridGround', !!gridGroundCb.checked);
    if (gridXYCb) writeBool('dw:ui:gridXY', !!gridXYCb.checked);
    if (gridYZCb) writeBool('dw:ui:gridYZ', !!gridYZCb.checked);
    if (axisArrowsCb) writeBool('dw:ui:axisArrows', !!axisArrowsCb.checked);
    try { applyViewToggles?.(); } catch (e) { logErr('EH:applyViewToggles', e); }
    try {
      Log.log('UI', 'View toggles', {
        names: !!showNamesCb?.checked,
        ground: !!gridGroundCb?.checked,
        xy: !!gridXYCb?.checked,
        yz: !!gridYZCb?.checked,
        arrows: !!axisArrowsCb?.checked
      });
    } catch {}
  }
  showNamesCb?.addEventListener('change', applyTogglesFromUI);
  gridGroundCb?.addEventListener('change', applyTogglesFromUI);
  gridXYCb?.addEventListener('change', applyTogglesFromUI);
  gridYZCb?.addEventListener('change', applyTogglesFromUI);
  axisArrowsCb?.addEventListener('change', applyTogglesFromUI);
  // Apply once on init
  applyTogglesFromUI();

  // ——————————— Debug helpers ———————————
  function pickDebugOn() { try { return localStorage.getItem('dw:debug:picking') === '1'; } catch (e) { logErr('EH:pickDebugOn', e); return false; } }
  function dPick(event, data) { if (!pickDebugOn()) return; try { Log.log('PICK', event, data); } catch (e) { logErr('EH:dPick', e); } }

  // Screen-space projection helper for robust angle computation
  function projectToScreen(v) {
    try {
      const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
      const proj = BABYLON.Vector3.Project(v, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport);
      return { x: proj.x, y: proj.y };
    } catch (e) { logErr('EH:projectToScreen', e); return { x: 0, y: 0 }; }
  }
  function angleToPointerFrom(centerWorld) {
    const scr = projectToScreen(centerWorld);
    const dx = (scene.pointerX - scr.x), dy = (scene.pointerY - scr.y);
    return Math.atan2(dy, dx);
  }

  // ——————————— Gizmo HUD (temporary) ———————————
  let _gizmoHudEl = null;
  let _gizmosSuppressed = false;
  function ensureGizmoHud() {
    if (_gizmoHudEl && document.body.contains(_gizmoHudEl)) return _gizmoHudEl;
    const el = document.createElement('div'); el.id = 'gizmoHud';
    el.style.position = 'absolute'; el.style.left = '10px'; el.style.top = '32px';
    el.style.background = 'rgba(10,14,18,0.85)'; el.style.border = '1px solid #1e2a30'; el.style.borderRadius = '6px';
    el.style.padding = '6px 8px'; el.style.color = '#e3edf3'; el.style.fontSize = '11px'; el.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    el.style.pointerEvents = 'none'; el.style.zIndex = '9999'; el.style.display = 'none';
    el.textContent = 'Gizmo Live';
    document.body.appendChild(el); _gizmoHudEl = el; return el;
  }
  function setGizmoHudVisible(v) { try { ensureGizmoHud().style.display = v ? 'block' : 'none'; } catch (e) { logErr('EH:setGizmoHudVisible', e); } }
  function renderGizmoHud({ selCount=0, center=null, deltaDeg=null, pickMode='-' }={}) {
    try {
      const el = ensureGizmoHud();
      const c = center ? { x: Number(center.x||0).toFixed(2), y: Number(center.y||0).toFixed(2), z: Number(center.z||0).toFixed(2) } : { x: '-', y: '-', z: '-' };
      const d = (deltaDeg == null || !isFinite(deltaDeg)) ? '-' : String(Math.round(deltaDeg));
      el.innerHTML = `
        <div style="opacity:0.8; font-weight:600; margin-bottom:2px;">Gizmo Live</div>
        <div>Sel: ${selCount}</div>
        <div>Center: ${c.x}, ${c.y}, ${c.z}</div>
        <div>Δ: ${d}°</div>
        <div>Mode: ${pickMode}</div>
      `;
    } catch (e) { logErr('EH:renderGizmoHud', e); }
  }

  // ——————————— Gizmo suppression for long ops ———————————
  function suppressGizmos(on) {
    _gizmosSuppressed = !!on;
    if (_gizmosSuppressed) {
      try { Log.log('GIZMO', 'Suppress on', { reason: 'voxel-op' }); } catch {}
      try { if (rotWidget) { rotWidget.dragging = false; rotWidget.preDrag = false; rotWidget.axis = null; } } catch {}
      try { if (moveWidget) { moveWidget.dragging = false; moveWidget.preDrag = false; moveWidget.axis = null; } } catch {}
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { setGizmoHudVisible(false); } catch {}
    } else {
      try { Log.log('GIZMO', 'Suppress off', {}); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
    }
  }
  try {
    window.addEventListener('dw:gizmos:disable', () => suppressGizmos(true));
    window.addEventListener('dw:gizmos:enable', () => suppressGizmos(false));
  } catch {}

  // Global enable/disable for gizmos during long operations (merge/bake/fill)
  function suppressGizmos(on) {
    _gizmosSuppressed = !!on;
    if (_gizmosSuppressed) {
      try { Log.log('GIZMO', 'Suppress on', { reason: 'voxel-op' }); } catch {}
      // Cancel any in-progress drags
      try { if (rotWidget) { rotWidget.dragging = false; rotWidget.preDrag = false; rotWidget.axis = null; } } catch {}
      try { if (moveWidget) { moveWidget.dragging = false; moveWidget.preDrag = false; moveWidget.axis = null; } } catch {}
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { setGizmoHudVisible(false); } catch {}
    } else {
      try { Log.log('GIZMO', 'Suppress off', {}); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
    }
  }
  try {
    window.addEventListener('dw:gizmos:disable', () => suppressGizmos(true));
    window.addEventListener('dw:gizmos:enable', () => suppressGizmos(false));
  } catch {}

  // ——————————— Cavern Mode + Scry Ball ———————————
  // Keep a reference to the scry ball and view state so we can restore War Room View
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function disposeScryBall() {
    try { state._scry.ball?.dispose?.(); } catch {}
    state._scry.ball = null;
  }

  function findScryWorldPosForSpace(space) {
    try {
      const s = space; if (!s) return null;
      const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
      if (!s.vox || !s.vox.size) {
        // No voxels yet: use the geometric center
        return new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      }
      const vox = decompressVox(s.vox);
      const nx = Math.max(1, vox.size?.x|0), ny = Math.max(1, vox.size?.y|0), nz = Math.max(1, vox.size?.z|0);
      const nTot = nx*ny*nz;
      const data = Array.isArray(vox.data) ? vox.data : [];
      const cxr = (nx * res) / 2, cyr = (ny * res) / 2, czr = (nz * res) / 2; // center in local units
      const idx = (x,y,z) => x + nx*(y + ny*z);
      let bestEmpty = { i:-1, d2: Infinity, x:0, y:0, z:0 };
      let bestSolid = { i:-1, d2: Infinity, x:0, y:0, z:0 };
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const i = idx(x,y,z);
            const v = data[i];
            if (v == null) continue;
            const lx = (x + 0.5) * res - cxr;
            const ly = (y + 0.5) * res - cyr;
            const lz = (z + 0.5) * res - czr;
            const d2 = lx*lx + ly*ly + lz*lz;
            if (v === VoxelType.Empty) {
              if (d2 < bestEmpty.d2) bestEmpty = { i, d2, x, y, z };
            } else if (v === VoxelType.Rock || v === VoxelType.Wall) {
              if (d2 < bestSolid.d2) bestSolid = { i, d2, x, y, z };
            }
          }
        }
      }
      const pick = (bestEmpty.i >= 0) ? bestEmpty : (bestSolid.i >= 0 ? bestSolid : null);
      if (!pick) return new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      // Convert local offset to world
      const local = new BABYLON.Vector3((pick.x + 0.5) * res - cxr, (pick.y + 0.5) * res - cyr, (pick.z + 0.5) * res - czr);
      const worldAligned = !!(s.vox && s.vox.worldAligned);
      let qMesh = BABYLON.Quaternion.Identity();
      try {
        if (!worldAligned) {
          const rx = Number(s.rotation?.x ?? 0) || 0;
          const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
          const rz = Number(s.rotation?.z ?? 0) || 0;
          qMesh = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        }
      } catch {}
      const rotM = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qMesh, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
      const localAfterRot = BABYLON.Vector3.TransformCoordinates(local, rotM);
      const origin = new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      return origin.add(localAfterRot);
    } catch (e) { logErr('EH:findScryWorldPosForSpace', e); return null; }
  }

  function ensureScryBallAt(pos, diameter) {
    try {
      if (!pos) return null;
      if (state._scry.ball && !state._scry.ball.isDisposed()) {
        state._scry.ball.position.copyFrom(pos);
        return state._scry.ball;
      }
      const dia = Math.max(0.1, Number(diameter) || 1);
      const m = BABYLON.MeshBuilder.CreateSphere('scryBall', { diameter: dia, segments: 16 }, scene);
      const mat = new BABYLON.StandardMaterial('scryBall:mat', scene);
      mat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 0.9);
      mat.emissiveColor = new BABYLON.Color3(0.15, 0.35, 0.65);
      mat.specularColor = new BABYLON.Color3(0,0,0);
      mat.alpha = 0.35; // misty translucent
      m.material = mat; m.isPickable = false; m.renderingGroupId = 3;
      m.position.copyFrom(pos);
      state._scry.ball = m;
      return m;
    } catch (e) { logErr('EH:ensureScryBallAt', e); return null; }
  }

  function enterCavernModeForSpace(spaceId) {
    try {
      const s = (state?.barrow?.spaces || []).find(x => x && x.id === spaceId);
      if (!s) return;
      state._scry.spaceId = s.id;
      sLog('cm:enter', { id: s.id });
      // Save War Room view
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
      // Place scry ball at center-most empty voxel (or solid fallback)
      const pos = findScryWorldPosForSpace(s) || new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
      ensureScryBallAt(pos, res * 0.8);
      // Switch materials to cavern style (opaque + textured)
      try {
        state._scry.prevWallOpacity = localStorage.getItem('dw:ui:wallOpacity');
        state._scry.prevRockOpacity = localStorage.getItem('dw:ui:rockOpacity');
      } catch {}
      try { localStorage.setItem('dw:viewMode', 'cavern'); } catch {}
      try { localStorage.setItem('dw:ui:wallOpacity', '100'); } catch {}
      try { localStorage.setItem('dw:ui:rockOpacity', '100'); } catch {}
      try { rebuildScene(); } catch (e) { logErr('EH:rebuildScene:cavern', e); }
      // Focus camera on scry ball, level with floor, much closer, no max constraint
      try {
        camera.target.copyFrom(pos);
        const vx = (s.size?.x||1) * res, vy = (s.size?.y||1) * res, vz = (s.size?.z||1) * res;
        const span = Math.max(vx, vy, vz);
        // Close-in radius: quarter of span, clamped to 2..12 voxels approx
        const rClose = Math.max(2*res, Math.min(12*res, span * 0.25));
        camera.radius = rClose;
        // Keep current yaw, ensure level with the floor
        camera.beta = Math.max(0.12, Math.min(Math.PI - 0.12, Math.PI/2));
        // Do not alter upperRadiusLimit; wheel acts as normal
      } catch {}
      try { setMode('cavern'); } catch {}
      // Remove gizmos in Cavern Mode
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { setGizmoHudVisible(false); } catch {}
      // Do not auto-exit cavern mode; only Escape key exits
    } catch (e) { logErr('EH:enterCavern', e); }
  }

  function exitCavernMode() {
    try {
      sLog('cm:exit', {});
      // Restore opacities and view mode
      try { if (state._scry.prevWallOpacity != null) localStorage.setItem('dw:ui:wallOpacity', state._scry.prevWallOpacity); } catch {}
      try { if (state._scry.prevRockOpacity != null) localStorage.setItem('dw:ui:rockOpacity', state._scry.prevRockOpacity); } catch {}
      try { localStorage.setItem('dw:viewMode', 'war'); } catch {}
      try { rebuildScene(); } catch (e) { logErr('EH:rebuildScene:war', e); }
      // Restore camera to the exact view when the space was double-clicked
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
      // Clear selection when returning to War Room
      try {
        state.selection.clear();
        rebuildHalos();
        try { disposeMoveWidget(); } catch {}
        try { disposeRotWidget(); } catch {}
        window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
        Log.log('UI', 'Deselect all on WRM return', {});
      } catch {}
      disposeScryBall();
      try { state.lockedVoxPick = null; } catch {}
      try { setMode(state._scry?.prev?.mode || 'edit'); } catch {}
      // Remove observer
      try { if (state._scry.exitObs) { engine.onBeginFrameObservable.remove(state._scry.exitObs); state._scry.exitObs = null; } } catch {}
    } catch (e) { logErr('EH:exitCavern', e); }
  }

  // Manual grid resize to fit all spaces
  resizeGridBtn?.addEventListener('click', () => {
    try { helpers.updateGridExtent?.(); } catch (e) { logErr('EH:updateGridExtent', e); }
    Log.log('UI', 'Resize Grid', {});
  });

  // ——————————— Reset/Export/Import ———————————
  resetBtn?.addEventListener('click', () => {
    disposeBuilt(state.built);
    state.barrow = makeDefaultBarrow();
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene();
    try { updateHud?.(); } catch (e) { logErr('EH:updateHud:reset', e); }
    Log.log('UI', 'Reset barrow', {});
    // After reset, center camera on origin so first new space defaults to (0,0,0)
    try { camera.target.set(0,0,0); } catch {}
  });

  exportBtn?.addEventListener('click', () => {
    // Export a compressed clone for storage parity
    const toExport = cloneForSave(state.barrow);
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${state.barrow.id || 'barrow'}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    Log.log('UI', 'Export barrow', { id: state.barrow.id });
  });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try {
      let data = JSON.parse(text);
      try { data = inflateAfterLoad(data); } catch (e2) { logErr('EH:inflateAfterLoad', e2); }
      disposeBuilt(state.built);
      state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
      layoutBarrow(state.barrow);
      state.built = buildSceneFromBarrow(scene, state.barrow);
      saveBarrow(state.barrow); snapshot(state.barrow);
      renderDbView(state.barrow);
      rebuildScene();
      try { updateHud?.(); } catch (e3) { logErr('EH:updateHud:import', e3); }
      try { Log.log('UI', 'Import barrow', { size: text.length }); } catch (e4) { logErr('EH:logImport', e4); }
    } catch (err) { console.error('Import failed', err); }
    if (importFile) importFile.value = '';
  });

  // ——————————— Name suggestion and validation ———————————
  function suggestSpaceName(baseType) {
    const base = (baseType || spaceTypeEl?.value || 'Space').toLowerCase();
    const used = new Set((state.barrow.spaces||[]).map(s => s.id));
    let n = 1; let candidate = base;
    while (used.has(candidate)) { candidate = `${base}-${++n}`; }
    return candidate;
  }
  function ensureNameInput() {
    if (!spaceNameEl) return;
    // If empty, suggest
    if (!spaceNameEl.value || spaceNameEl.value.trim() === '') {
      spaceNameEl.value = suggestSpaceName(spaceTypeEl?.value);
    }
    updateNewBtnEnabled();
  }
  function updateNewBtnEnabled() {
    const ok = (spaceNameEl?.value || '').trim().length >= 1;
    if (newSpaceBtn) { newSpaceBtn.disabled = !ok; }
  }
  spaceNameEl?.addEventListener('input', updateNewBtnEnabled);

  // ——————————— New Space ———————————
  newSpaceBtn?.addEventListener('click', () => {
    const type = spaceTypeEl?.value || 'Space';
    const res = state.barrow?.meta?.voxelSize || 10;
    // Read size inputs (voxels)
    let sx = Math.max(1, Math.round(Number(sizeXEl?.value || '200')));
    let sy = Math.max(1, Math.round(Number(sizeYEl?.value || '100')));
    let sz = Math.max(1, Math.round(Number(sizeZEl?.value || '200')));
    // Type-specific adjustments
    if (type === 'Carddon') {
      sy = Math.max(1, Math.round(0.5 * Math.max(sx, sz))); // half of largest horizontal dimension
      if (sizeYEl) sizeYEl.value = String(sy);
    }
    const size = { x: sx, y: sy, z: sz };
    // Read desired id from textbox and ensure uniqueness
    const desiredRaw = (spaceNameEl?.value || '').trim();
    const baseName = desiredRaw || suggestSpaceName(type);
    const used = new Set((state.barrow.spaces||[]).map(s => s.id));
    let n = 1; let id = baseName;
    while (used.has(id)) { id = `${baseName}-${++n}`; }
    // For the very first space (fresh DB), default origin to (0,0,0). Otherwise use camera target.
    const origin = ((state.barrow?.spaces||[]).length === 0)
      ? new BABYLON.Vector3(0,0,0)
      : camera.target.clone();
    const s = { id, type, res, size, origin: { x: origin.x, y: origin.y, z: origin.z }, chunks: {}, attrs: {} };

    // Simple non-overlap along +X
    const aabb = (sp) => {
      const w = sp.size.x * sp.res, h = sp.size.y * sp.res, d = sp.size.z * sp.res;
      const cx = sp.origin.x, cy = sp.origin.y, cz = sp.origin.z;
      return { min:{x:cx-w/2,y:cy-h/2,z:cz-d/2}, max:{x:cx+w/2,y:cy+h/2,z:cz+d/2} };
    };
    const inter = (A,B) => !(A.max.x < B.min.x || A.min.x > B.max.x || A.max.y < B.min.y || A.min.y > B.max.y || A.max.z < B.min.z || A.min.z > B.max.z);
    const existing = (state.barrow.spaces||[]).map(aabb);
    let bb = aabb(s);
    let tries = 0; const step = s.size.x * s.res * 1.1;
    while (existing.some(e => inter(bb, e)) && tries < 100) {
      s.origin.x += step; bb = aabb(s); tries++;
    }

    state.barrow.spaces = state.barrow.spaces || [];
    state.barrow.spaces.push(s);
    Log.log('UI', 'New space', { id: s.id, type: s.type, res: s.res, size: s.size, origin: s.origin });
    saveBarrow(state.barrow); snapshot(state.barrow);
    rebuildScene();
    renderDbView(state.barrow);
    // Focus camera
    camera.target.copyFrom(new BABYLON.Vector3(s.origin.x, s.origin.y, s.origin.z));
    // Select the newly created space
    try { state.selection.clear(); state.selection.add(s.id); rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
    scheduleGridUpdate();
    // Suggest next name
    ensureNameInput();
  });

  // ——————————— Fit view ———————————
  fitViewBtn?.addEventListener('click', () => camApi.fitViewSmart(state.barrow));

  // ——————————— Type defaults & size fields ———————————
  function defaultSizeForType(t) {
    // Base defaults
    let base;
    switch (t) {
      case 'Cavern': base = { x: 100, y: 75, z: 100 }; break;
      case 'Carddon': base = { x: 200, y: 15, z: 200 }; break;
      case 'Tunnel': base = { x: 100, y: 40, z: 20 }; break;
      case 'Room': base = { x: 10, y: 10, z: 10 }; break;
      case 'Space': base = { x: 5, y: 5, z: 5 }; break;
      default: base = { x: 200, y: 100, z: 200 }; break;
    }
    // Halve any dimension greater than 10
    const shrink = (n) => (n > 10 ? Math.round(n / 2) : n);
    return { x: shrink(base.x), y: shrink(base.y), z: shrink(base.z) };
  }
  function applyDefaultSizeFields() {
    const t = spaceTypeEl?.value || 'Space';
    const s = defaultSizeForType(t);
    if (sizeXEl) sizeXEl.value = String(s.x);
    if (sizeYEl) sizeYEl.value = String(s.y);
    if (sizeZEl) sizeZEl.value = String(s.z);
  }
  spaceTypeEl?.addEventListener('change', () => {
    applyDefaultSizeFields();
    Log.log('UI', 'Change type defaults', { type: spaceTypeEl.value, defaults: defaultSizeForType(spaceTypeEl.value) });
    // Suggest a name if empty
    ensureNameInput();
  });
  applyDefaultSizeFields();
  ensureNameInput();

  // ——————————— Transform buttons ———————————
  function bindTransformButtons() {
    const stepEl = tStepEl;
    const TSTEP_KEY = 'dw:ui:baseStep';
    function getBaseStep() {
      const data = Number(stepEl?.dataset?.base);
      if (isFinite(data) && data > 0) return data;
      const stored = Number(localStorage.getItem(TSTEP_KEY) || '10') || 10;
      return stored;
    }
    function setBaseStep(n) {
      const v = Math.max(0.01, Number(n) || 1);
      if (stepEl) stepEl.dataset.base = String(v);
      try { localStorage.setItem(TSTEP_KEY, String(v)); } catch {}
    }
    function effectiveStep() {
      const base = getBaseStep();
      const r = camera?.radius || 50;
      const norm = Math.max(0, r / 100);
      const mult = Math.max(1, Math.min(100, Math.sqrt(norm)));
      return base * mult;
    }
    function fmt(n) {
      if (!isFinite(n)) return '0';
      if (n >= 100) return String(Math.round(n));
      if (n >= 10) return String(Math.round(n));
      if (n >= 1) return String(Math.round(n));
      return String(Math.round(n * 100) / 100);
    }
    // Initialize base value once
    if (stepEl && !stepEl.dataset.base) { setBaseStep(Number(stepEl.value) || 10); }
    // Show effective step unless focused for editing
    function updateStepDisplay() {
      if (!stepEl) return;
      if (document.activeElement === stepEl) return; // do not override while editing
      stepEl.value = fmt(effectiveStep());
    }
    // Keep display in sync with camera zoom
    try { engine.onBeginFrameObservable.add(updateStepDisplay); } catch {}
    // Editing handlers: show base while focused, commit on blur
    stepEl?.addEventListener('focus', () => { try { stepEl.value = fmt(getBaseStep()); } catch {} });
    stepEl?.addEventListener('input', () => { setBaseStep(stepEl.value); });
    stepEl?.addEventListener('blur', () => { updateStepDisplay(); });
    // Step used for transforms
    function step() { return effectiveStep(); }
    function addRepeat(btn, fn){
      if (!btn) return;
      let timer = null;
      const fire = () => { if (_gizmosSuppressed) return; try { fn(); } catch {} };
      btn.addEventListener('mousedown', () => {
        if (timer) clearInterval(timer);
        fire();
        timer = setInterval(fire, 120);
      });
      ['mouseup','mouseleave'].forEach(ev => btn.addEventListener(ev, () => { if (timer) { clearInterval(timer); timer = null; } }));
    }
    addRepeat(txMinus, () => moveSelection(-step(),0,0));
    addRepeat(txPlus,  () => moveSelection( step(),0,0));
    addRepeat(tyMinus, () => moveSelection(0,-step(),0));
    addRepeat(tyPlus,  () => moveSelection(0, step(),0));
    addRepeat(tzMinus, () => moveSelection(0,0,-step()));
    addRepeat(tzPlus,  () => moveSelection(0,0, step()));
  }
  bindTransformButtons();

  // ——————————— Size fields ↔ selection binding ———————————
  function getSelectedSpaces() {
    try { const ids = Array.from(state.selection || []); const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s])); return ids.map(id => byId.get(id)).filter(Boolean); } catch { return []; }
  }
  function populateSizeFieldsFromSelection() {
    const sel = getSelectedSpaces(); if (!sel.length) return;
    // Pick the first non-voxelized space
    const s = sel.find(x => !x.vox) || sel[0]; if (!s) return;
    if (sizeXEl) sizeXEl.value = String(Math.max(1, Math.round(Number(s.size?.x || 1))));
    if (sizeYEl) sizeYEl.value = String(Math.max(1, Math.round(Number(s.size?.y || 1))));
    if (sizeZEl) sizeZEl.value = String(Math.max(1, Math.round(Number(s.size?.z || 1))));
  }
  // Update fields on selection & DB edits
  window.addEventListener('dw:selectionChange', populateSizeFieldsFromSelection);
  window.addEventListener('dw:dbEdit', populateSizeFieldsFromSelection);
  window.addEventListener('dw:transform', populateSizeFieldsFromSelection);
  // Keep contact shadow in sync with selection
  try {
    window.addEventListener('dw:selectionChange', updateContactShadowPlacement);
    window.addEventListener('dw:transform', updateContactShadowPlacement);
  } catch {}

  function applySizeField(axis, value) {
    const v = Math.max(1, Math.round(Number(value || '')));
    const sel = getSelectedSpaces(); if (!sel.length) return;
    let changed = false;
    for (const s of sel) {
      if (s.vox) continue; // do not mutate voxelized spaces via simple size fields
      const cur = Number(s.size?.[axis] || 0);
      if (!s.size) s.size = { x: 1, y: 1, z: 1 };
      if (cur !== v) { s.size[axis] = v; changed = true; }
    }
    if (changed) {
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
      try { rebuildScene(); } catch {}
      // Tear down any gizmos tied to deleted meshes
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { scheduleGridUpdate(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'resize', axis, value: v, selection: Array.from(state.selection) } })); } catch {}
    }
  }
  sizeXEl?.addEventListener('change', () => applySizeField('x', sizeXEl.value));
  sizeYEl?.addEventListener('change', () => applySizeField('y', sizeYEl.value));
  sizeZEl?.addEventListener('change', () => applySizeField('z', sizeZEl.value));
  // Also respond on input for quicker feedback
  sizeXEl?.addEventListener('input', () => applySizeField('x', sizeXEl.value));
  sizeYEl?.addEventListener('input', () => applySizeField('y', sizeYEl.value));
  sizeZEl?.addEventListener('input', () => applySizeField('z', sizeZEl.value));

  // ——————————— Rotation widget (Y-axis) ———————————
  let rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '', mStartX: 0, mStartY: 0 };
  let _lastDbRefresh = 0;
  function disposeRotWidget() {
    try {
      for (const k of ['x','y','z']) { try { rotWidget.meshes[k]?.dispose?.(); } catch {} }
      try { rotWidget.groupNode?.dispose?.(); } catch {}
      Log.log('GIZMO', 'Dispose rot widget', { id: rotWidget.spaceId });
    } catch {}
    rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '' };
  }
  function ensureRotWidget() {
      if (_gizmosSuppressed) { try { disposeRotWidget(); setGizmoHudVisible(false); } catch {} return; }
      try { if (state.mode === 'cavern') { disposeRotWidget(); setGizmoHudVisible(false); return; } } catch {}
    try {
      try { Log.log('GIZMO', 'Ensure widget', { selection: Array.from(state.selection||[]) }); } catch {}
      // Support single or multi selection
      const sel = Array.from(state.selection || []).filter(id => (state?.built?.spaces || []).some(x => x.id === id));
      if (sel.length < 1) { Log.log('GIZMO', 'No widget: empty selection', { count: 0 }); disposeRotWidget(); return; }
      // Suppress rotation gizmo for voxelized spaces
      try {
        const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
        const anyVox = sel.some(id => !!byId.get(id)?.vox);
        if (anyVox) { disposeRotWidget(); Log.log('GIZMO', 'Skip rot widget for voxelized selection', { sel }); return; }
      } catch {}
      const isGroup = sel.length > 1;
      const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0];
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => sel.includes(x.id));
      if (entries.length < 1) { disposeRotWidget(); return; }
      const primary = entries[0];
      const mesh = primary.mesh;
      // Compute ring radii from bounds (single or group)
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let com = new BABYLON.Vector3(0,0,0); let mass = 0;
      for (const e of entries) {
        try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
        const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
        const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
        minX = Math.min(minX, bmin.x); minY = Math.min(minY, bmin.y); minZ = Math.min(minZ, bmin.z);
        maxX = Math.max(maxX, bmax.x); maxY = Math.max(maxY, bmax.y); maxZ = Math.max(maxZ, bmax.z);
        const cx = (bmin.x + bmax.x) / 2, cy = (bmin.y + bmax.y) / 2, cz = (bmin.z + bmax.z) / 2;
        const dx = (bmax.x - bmin.x), dy = (bmax.y - bmin.y), dz = (bmax.z - bmin.z);
        const m = Math.max(1e-6, dx * dy * dz);
        com.x += cx * m; com.y += cy * m; com.z += cz * m; mass += m;
      }
      if (!isFinite(minX) || !isFinite(maxX)) { disposeRotWidget(); return; }
      if (mass > 0) { com.x /= mass; com.y /= mass; com.z /= mass; }
      const halfX = Math.max(0.1, (maxX - minX) / 2);
      const halfY = Math.max(0.1, (maxY - minY) / 2);
      const halfZ = Math.max(0.1, (maxZ - minZ) / 2);
      // Apply user scale to gizmo diameters
      const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100;
      const gScale = Math.max(0.1, scalePct / 100);
      const radY = Math.max(halfX, halfZ) * 1.05 * gScale; // ring in XZ plane => rotate around Y
      const radX = Math.max(halfY, halfZ) * 1.05 * gScale; // ring in YZ plane => rotate around X
      const radZ = Math.max(halfX, halfY) * 1.05 * gScale; // ring in XY plane => rotate around Z
      const thicknessY = Math.max(0.08, radY * 0.085);
      const thicknessX = Math.max(0.08, radX * 0.085);
      const thicknessZ = Math.max(0.08, radZ * 0.085);
      // Rebuild if missing or different target
      const id = primary.id;
      if (!rotWidget.meshes.y || rotWidget.group !== isGroup || rotWidget.groupKey !== groupKey || (rotWidget.meshes.y.isDisposed && rotWidget.meshes.y.isDisposed())) {
        disposeRotWidget();
        // Y ring (base ring, will orient to surface axis if provided)
        const diamY = radY * 2;
        const ringY = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Y:${isGroup ? 'group' : id}`, { diameter: diamY, thickness: thicknessY, tessellation: 96 }, scene);
        const matY = new BABYLON.StandardMaterial(`rotGizmo:Y:${id}:mat`, scene);
        const baseY = new BABYLON.Color3(0.2, 0.9, 0.2); // green
        matY.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.05);
        matY.emissiveColor = baseY.clone();
        try { matY.metadata = { baseColor: baseY.clone() }; } catch {}
        matY.specularColor = new BABYLON.Color3(0,0,0);
        matY.zOffset = 4;
        ringY.material = matY; ringY.isPickable = true; ringY.alwaysSelectAsActiveMesh = true; ringY.renderingGroupId = 2;
        // X ring
        const diamX = radX * 2;
        const ringX = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:X:${isGroup ? 'group' : id}`, { diameter: diamX, thickness: thicknessX, tessellation: 96 }, scene);
        const matX = new BABYLON.StandardMaterial(`rotGizmo:X:${id}:mat`, scene);
        const baseX = new BABYLON.Color3(0.95, 0.1, 0.1); // red
        matX.diffuseColor = new BABYLON.Color3(0.2, 0.05, 0.05);
        matX.emissiveColor = baseX.clone();
        try { matX.metadata = { baseColor: baseX.clone() }; } catch {}
        matX.specularColor = new BABYLON.Color3(0,0,0);
        matX.zOffset = 4;
        ringX.rotation.z = Math.PI / 2; // plane YZ
        ringX.material = matX; ringX.isPickable = true; ringX.alwaysSelectAsActiveMesh = true; ringX.renderingGroupId = 2;
        // Z ring
        const diamZ = radZ * 2;
        const ringZ = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Z:${isGroup ? 'group' : id}`, { diameter: diamZ, thickness: thicknessZ, tessellation: 96 }, scene);
        const matZ = new BABYLON.StandardMaterial(`rotGizmo:Z:${id}:mat`, scene);
        const baseZ = new BABYLON.Color3(0.1, 0.1, 0.95); // blue
        matZ.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.2);
        matZ.emissiveColor = baseZ.clone();
        try { matZ.metadata = { baseColor: baseZ.clone() }; } catch {}
        matZ.specularColor = new BABYLON.Color3(0,0,0);
        matZ.zOffset = 4;
        ringZ.rotation.x = Math.PI / 2; // plane XY
        ringZ.material = matZ; ringZ.isPickable = true; ringZ.alwaysSelectAsActiveMesh = true; ringZ.renderingGroupId = 2;
        // Parent rings
        if (isGroup) {
          const group = new BABYLON.TransformNode(`rotGizmoGroup`, scene);
          group.position.copyFrom(com);
          ringX.parent = group; ringY.parent = group; ringZ.parent = group;
          rotWidget.groupNode = group;
        } else {
          try { ringX.parent = mesh; ringY.parent = mesh; ringZ.parent = mesh; ringX.position.set(0,0,0); ringY.position.set(0,0,0); ringZ.position.set(0,0,0); } catch {}
        }
        // Assign
        rotWidget.meshes = { x: ringX, y: ringY, z: ringZ };
        rotWidget.mats = { x: matX, y: matY, z: matZ };
        rotWidget.baseDiam = { x: diamX, y: diamY, z: diamZ };
        rotWidget.spaceId = isGroup ? 'group' : id;
        rotWidget.group = isGroup; rotWidget.groupIDs = sel.slice(); rotWidget.groupCenter = com; rotWidget.groupKey = groupKey;
        Log.log('GIZMO', 'Create rot widget', { id: rotWidget.spaceId, radius: { x: radX, y: radY, z: radZ }, diameter: { x: diamX, y: diamY, z: diamZ } });
      }
      // Update size and position for all rings
      try {
        const desiredX = Math.max(0.001, radX * 2);
        const desiredY = Math.max(0.001, radY * 2);
        const desiredZ = Math.max(0.001, radZ * 2);
        const sx = Math.max(0.001, desiredX / (rotWidget.baseDiam.x || desiredX));
        const sy = Math.max(0.001, desiredY / (rotWidget.baseDiam.y || desiredY));
        const sz = Math.max(0.001, desiredZ / (rotWidget.baseDiam.z || desiredZ));
        rotWidget.meshes.x.scaling.set(sx, sx, sx);
        rotWidget.meshes.y.scaling.set(sy, sy, sy);
        rotWidget.meshes.z.scaling.set(sz, sz, sz);
        if (isGroup) {
          try { rotWidget.groupNode.position.copyFrom(com); } catch {}
          try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
        } else {
          try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
        }
      } catch {}
      // Default visual: all rings dim
      try { setRingsDim(); } catch {}
    } catch (e) { try { disposeRotWidget(); } catch {} }
  }

  function updateRotWidgetFromMesh(mesh) {
    if (!rotWidget?.meshes?.y || !mesh) return;
    // Avoid resizing during active drag to prevent visual jumps
    if (rotWidget.dragging) return;
    try {
      const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) return;
      const min = bb.minimumWorld, max = bb.maximumWorld;
      const halfX = Math.max(0.1, (max.x - min.x) / 2);
      const halfY = Math.max(0.1, (max.y - min.y) / 2);
      const halfZ = Math.max(0.1, (max.z - min.z) / 2);
      const radY = Math.max(halfX, halfZ) * 1.05;
      const radX = Math.max(halfY, halfZ) * 1.05;
      const radZ = Math.max(halfX, halfY) * 1.05;
      const desiredX = Math.max(0.001, radX * 2);
      const desiredY = Math.max(0.001, radY * 2);
      const desiredZ = Math.max(0.001, radZ * 2);
      const sx = Math.max(0.001, desiredX / (rotWidget.baseDiam.x || desiredX));
      const sy = Math.max(0.001, desiredY / (rotWidget.baseDiam.y || desiredY));
      const sz = Math.max(0.001, desiredZ / (rotWidget.baseDiam.z || desiredZ));
      rotWidget.meshes.x.scaling.set(sx, sx, sx);
      rotWidget.meshes.y.scaling.set(sy, sy, sy);
      rotWidget.meshes.z.scaling.set(sz, sz, sz);
      try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
    } catch {}
  }
  // no global canvas event blocking; we detach only camera pointer input during gizmo drag
  let _lastPickMissLog = 0;
  function pickPointOnYPlane(y) { return pickPointOnPlane(new BABYLON.Vector3(1e-30,1,1e-30), new BABYLON.Vector3(0,y,0)); }
  function pickPointOnPlane(normal, point) {
    try {
      let n = normal.clone(); n.normalize();
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const ro = ray.origin, rd = ray.direction;
      const eps = 1e-6;
      let denom = BABYLON.Vector3.Dot(n, rd);
      if (Math.abs(denom) < eps) {
        // Nudge plane normal slightly towards camera to avoid parallel cases
        try {
          const fwd = camera.getForwardRay()?.direction || new BABYLON.Vector3(0,0,1);
          n = n.add(fwd.scale(0.001)); n.normalize();
          denom = BABYLON.Vector3.Dot(n, rd);
        } catch {}
      }
      if (Math.abs(denom) < eps) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: ray parallel to plane', { normal: n.asArray() }); } catch {} }
        return null;
      }
      const t = BABYLON.Vector3.Dot(point.subtract(ro), n) / denom;
      if (!isFinite(t) || t < 0) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: behind origin', { t }); } catch {} }
        return null;
      }
      const pt = ro.add(rd.scale(t));
      return pt;
    } catch (e) { try { Log.log('GIZMO', 'Pick error', { err: String(e) }); } catch {}; return null; }
  }
  function getSelectedSpaceAndMesh() {
    const sel = Array.from(state.selection || []);
    if (sel.length !== 1) return { space: null, mesh: null, id: null };
    const id = sel[0];
    const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || null;
    const space = (state?.barrow?.spaces || []).find(x => x.id === id) || null;
    return { space, mesh, id };
  }

  // ——————————— Live intersection preview (selected vs others) ———————————
  const liveIx = new Map(); // key -> mesh
  const ixLastExact = new Map(); // key -> last CSG timestamp
  const ixMat = (() => {
    try {
      const m = new BABYLON.StandardMaterial('ixLive:mat', scene);
      m.diffuseColor = new BABYLON.Color3(0,0,0);
      m.emissiveColor = new BABYLON.Color3(0.95, 0.9, 0.2);
      m.alpha = 0.25; m.specularColor = new BABYLON.Color3(0,0,0); m.zOffset = 3;
      return m;
    } catch { return null; }
  })();

  // ——————————— Contact shadow (visual aid) ———————————
  state._contactShadow = state._contactShadow || { mesh: null, ids: [] };
  function disposeContactShadow() {
    try { state._contactShadow.mesh?.dispose?.(); } catch {}
    state._contactShadow.mesh = null; state._contactShadow.ids = [];
  }
  function ensureContactShadow() {
    try {
      if (state._contactShadow.mesh && !state._contactShadow.mesh.isDisposed()) return state._contactShadow.mesh;
      const disc = BABYLON.MeshBuilder.CreateDisc('contactShadow', { radius: 1, tessellation: 64 }, scene);
      disc.rotation.x = Math.PI / 2; // XZ plane
      const mat = new BABYLON.StandardMaterial('contactShadow:mat', scene);
      // Artificial, light-independent, yellow "shadow" — toned down
      mat.diffuseColor = new BABYLON.Color3(0.85, 0.80, 0.20);
      mat.emissiveColor = new BABYLON.Color3(0.35, 0.33, 0.10);
      mat.alpha = 0.28; // subtler
      try { mat.backFaceCulling = false; } catch {}
      try { mat.zOffset = 2; } catch {}
      try { mat.disableLighting = false; } catch {}
      mat.specularColor = new BABYLON.Color3(0,0,0);
      disc.material = mat; disc.isPickable = false; disc.renderingGroupId = 1;
      state._contactShadow.mesh = disc; return disc;
    } catch { return null; }
  }
  function updateContactShadowPlacement() {
    try {
      const ids = Array.from(state.selection || []);
      if (!ids.length) { disposeContactShadow(); return; }
      const mesh = ensureContactShadow(); if (!mesh) return;
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => ids.includes(x.id)); if (!entries.length) { disposeContactShadow(); return; }
      // Aggregate AABB over selection
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const e of entries) {
        try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
        const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
        const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
        minX = Math.min(minX, bmin.x); maxX = Math.max(maxX, bmax.x);
        minY = Math.min(minY, bmin.y); maxY = Math.max(maxY, bmax.y);
        minZ = Math.min(minZ, bmin.z); maxZ = Math.max(maxZ, bmax.z);
      }
      if (!isFinite(minX)) { disposeContactShadow(); return; }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      // Always sit on the ground plane (y≈0), independent of light
      const y = 0.0;
      const rx = Math.max(0.2, (maxX - minX) / 2);
      const rz = Math.max(0.2, (maxZ - minZ) / 2);
      // Footprint sizing: prefer a broad elliptical pad, clamp aspect to avoid toothpick
      const base = Math.max(rx, rz) * 1.5; // major radius
      const minorBase = Math.min(rx, rz) * 1.5;
      const minor = Math.max(base * 0.6, minorBase); // ensure at least 60% of major
      let sx = base, sz = minor;
      if (rz > rx) { sx = minor; sz = base; }
      // Enforce a minimum size
      sx = Math.max(3.0, sx);
      sz = Math.max(3.0, sz);
      mesh.position.set(cx, y + 0.01, cz);
      // Disc is built in XY; scale x/y for X/Z footprint; keep z=1
      mesh.scaling.x = sx;
      mesh.scaling.y = sz;
      mesh.scaling.z = 1;
      state._contactShadow.ids = ids;
    } catch {}
  }
  function disposeLiveIntersections(){
    try { for (const m of liveIx.values()) { try { state.hl?.removeMesh(m); } catch {}; try { m.dispose(); } catch {} } } catch {}
    liveIx.clear();
  }
  function aabbForSpace(space) {
    const res = (space?.res || (state.barrow?.meta?.voxelSize || 1));
    const w = Math.max(0, (space?.size?.x || 0) * res);
    const h = Math.max(0, (space?.size?.y || 0) * res);
    const d = Math.max(0, (space?.size?.z || 0) * res);
    const cx = space?.origin?.x || 0, cy = space?.origin?.y || 0, cz = space?.origin?.z || 0;
    return { min:{x:cx-w/2,y:cy-h/2,z:cz-d/2}, max:{x:cx+w/2,y:cy+h/2,z:cz+d/2} };
  }
  function updateLiveIntersectionsFor(selectedId){
    try {
      if (!selectedId) { disposeLiveIntersections(); return; }
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      const selEntry = builtSpaces.find(x => x.id === selectedId); if (!selEntry?.mesh) { disposeLiveIntersections(); return; }
      const bba = selEntry.mesh.getBoundingInfo()?.boundingBox; if (!bba) { disposeLiveIntersections(); return; }
      const amin = bba.minimumWorld, amax = bba.maximumWorld;
      const seen = new Set();
      const exactOn = (() => { try { return localStorage.getItem('dw:ui:exactCSG') === '1'; } catch { return false; } })();
      const canCSG = exactOn && !!(BABYLON && BABYLON.CSG);
      for (const entry of builtSpaces) {
        if (!entry || entry.id === selectedId || !entry.mesh) continue;
        const bbb = entry.mesh.getBoundingInfo()?.boundingBox; if (!bbb) continue;
        const bmin = bbb.minimumWorld, bmax = bbb.maximumWorld;
        const ixmin = { x: Math.max(amin.x, bmin.x), y: Math.max(amin.y, bmin.y), z: Math.max(amin.z, bmin.z) };
        const ixmax = { x: Math.min(amax.x, bmax.x), y: Math.min(amax.y, bmax.y), z: Math.min(amax.z, bmax.z) };
        const dx = ixmax.x - ixmin.x, dy = ixmax.y - ixmin.y, dz = ixmax.z - ixmin.z;
        const key = `live:${selectedId}&${entry.id}`;
        if (dx > 0.001 && dy > 0.001 && dz > 0.001) {
          seen.add(key);
          const cx = (ixmin.x + ixmax.x) / 2, cy = (ixmin.y + ixmax.y) / 2, cz = (ixmin.z + ixmax.z) / 2;
          if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz) || !isFinite(dx) || !isFinite(dy) || !isFinite(dz)) continue;

          let mesh = liveIx.get(key);
          if (canCSG) {
            const now = performance.now();
            const last = ixLastExact.get(key) || 0;
            const needExact = (!mesh) || (now - last > 220);
            if (needExact) {
              try {
                if (mesh) { try { state.hl?.removeMesh(mesh); } catch {}; try { mesh.dispose(); } catch {}; liveIx.delete(key); }
                const csgA = BABYLON.CSG.FromMesh(selEntry.mesh);
                const csgB = BABYLON.CSG.FromMesh(entry.mesh);
                const inter = csgA.intersect(csgB);
                const csgMesh = inter.toMesh(key, ixMat || undefined, scene, true);
                csgMesh.isPickable = false; csgMesh.renderingGroupId = 1;
                liveIx.set(key, csgMesh);
                ixLastExact.set(key, now);
                try { state.hl?.addMesh(csgMesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
              } catch {
                // If exact fails on first pass, fallback to AABB to show something
                if (!mesh) {
                  const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
                  if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
                  liveIx.set(key, box);
                  box.position.set(cx, cy, cz);
                  try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
                }
              }
            } else {
              // keep existing CSG mesh until next exact tick (no AABB toggling)
            }
          } else {
            // AABB-only preview
            if (!mesh) {
              mesh = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) mesh.material = ixMat;
              mesh.isPickable = false; mesh.renderingGroupId = 1;
              liveIx.set(key, mesh);
              mesh.position.set(cx, cy, cz);
              try { state.hl?.addMesh(mesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            } else {
              try { state.hl?.removeMesh(mesh); mesh.dispose(); } catch {}
              const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
              liveIx.set(key, box);
              box.position.set(cx, cy, cz);
              try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            }
          }
        } else {
          // remove if existed
          if (liveIx.has(key)) { try { const old = liveIx.get(key); state.hl?.removeMesh(old); old?.dispose(); } catch {}; liveIx.delete(key); ixLastExact.delete(key); }
        }
      }
      // cleanup any not seen
      for (const [k, m] of Array.from(liveIx.entries())) {
        if (!k.startsWith(`live:${selectedId}&`) || !seen.has(k)) { try { state.hl?.removeMesh(m); m.dispose(); } catch {}; liveIx.delete(k); ixLastExact.delete(k); }
      }
    } catch {}
  }

  // Update selection OBB lines live (dispose and rebuild for selected ids)
  function updateSelectionObbLive() {
    try {
      const ids = Array.from(state.selection || []);
      if (!ids.length) return;
      const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
      for (const id of ids) {
        const s = byId.get(id); if (!s) continue;
        // dispose old
        try { const prev = state.selObb?.get?.(id); if (prev) { prev.dispose?.(); state.selObb.delete?.(id); } } catch {}
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
        const hx = w/2, hy = h/2, hz = d/2;
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
        const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const mtx = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
        const locals = [
          new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz),
          new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz),
          new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz),
          new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz)
        ];
        const cs = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, mtx));
        const edges = [
          [cs[0], cs[1]], [cs[1], cs[3]], [cs[3], cs[2]], [cs[2], cs[0]],
          [cs[4], cs[5]], [cs[5], cs[7]], [cs[7], cs[6]], [cs[6], cs[4]],
          [cs[0], cs[4]], [cs[1], cs[5]], [cs[2], cs[6]], [cs[3], cs[7]]
        ];
        const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:obb:${id}`, { lines: edges }, scene);
        lines.color = new BABYLON.Color3(0.1, 0.9, 0.9);
        lines.isPickable = false; lines.renderingGroupId = 3;
        try { state.selObb?.set?.(id, lines); } catch {}
      }
    } catch {}
  }

  // Update move disc position to follow current selection bottom and center
  function updateMoveDiscPlacement() {
    try {
      if (!moveWidget?.disc) return;
      // Do not change the drag plane while dragging; keep disc on the locked plane
      if (moveWidget.dragging) {
        const ids = Array.from(state.selection || []);
        if (!ids.length) return;
        const center = moveWidget.group ? (moveWidget.groupCenter || new BABYLON.Vector3(0,0,0)) : ((state?.built?.spaces||[]).find(x => ids.includes(x.id))?.mesh?.position || new BABYLON.Vector3(0,0,0));
        moveWidget.disc.position.x = center.x;
        moveWidget.disc.position.z = center.z;
        const yLocked = (moveWidget.dragPlaneY != null) ? moveWidget.dragPlaneY : moveWidget.planeY;
        moveWidget.disc.position.y = yLocked;
        return;
      }
      const ids = Array.from(state.selection || []);
      if (!ids.length) return;
      const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
      let minY = Infinity;
      for (const id of ids) {
        const s = byId.get(id); if (!s) continue;
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const y0 = (s.origin?.y||0) - ((s.size?.y||0) * sr)/2;
        if (y0 < minY) minY = y0;
      }
      if (!isFinite(minY)) minY = 0;
      const center = moveWidget.group ? (moveWidget.groupCenter || new BABYLON.Vector3(0,0,0)) : ((state?.built?.spaces||[]).find(x => ids.includes(x.id))?.mesh?.position || new BABYLON.Vector3(0,0,0));
      moveWidget.disc.position.x = center.x;
      moveWidget.disc.position.z = center.z;
      moveWidget.disc.position.y = minY;
      moveWidget.planeY = minY;
    } catch {}
  }

  // ——————————— Move widget (drag on XZ plane) ———————————
  let moveWidget = { mesh: null, root: null, arrowMeshes: [], disc: null, spaceId: null, dragging: false, preDrag: false, mode: 'axis', downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, planeY: 0, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '', axis: null, axisStart: 0 };
  function disposeMoveWidget() {
    try {
      try { for (const m of moveWidget.arrowMeshes || []) { try { m.dispose(); } catch {} } } catch {}
      moveWidget.arrowMeshes = [];
      try { moveWidget.disc?.dispose?.(); } catch {}
      if (moveWidget.root) { try { moveWidget.root.dispose(); } catch {} }
      // Fallback cleanup by name in case references were lost
      try { (scene.meshes||[]).filter(m => (m?.name||'').startsWith('moveGizmo:')).forEach(m => { try { m.dispose(); } catch {} }); } catch {}
    } catch {}
    moveWidget = { mesh: null, root: null, arrowMeshes: [], disc: null, spaceId: null, dragging: false, preDrag: false, mode: 'axis', downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, planeY: 0, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '', axis: null, axisStart: 0 };
  }
  function ensureMoveWidget() {
      if (_gizmosSuppressed) { try { disposeMoveWidget(); } catch {} return; }
      try { if (state.mode === 'cavern') { disposeMoveWidget(); return; } } catch {}
    try {
      const sel = Array.from(state.selection || []);
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => sel.includes(x.id));
      if (entries.length < 1) { disposeMoveWidget(); return; }
      // Allow move gizmo for voxelized and non-voxelized spaces alike
      const isGroup = sel.length > 1;
      const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0];
      let id = entries[0].id;
      let rad = 1; let center = null;
      let planeY = 0;
      if (isGroup) {
        // Compute group bbox and center of mass for radius and position
        let minX = Infinity, minY = Infinity, minZ = Infinity; let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let cx = 0, cy = 0, cz = 0, mass = 0;
        for (const e of entries) {
          try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
          const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
          const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
          minX = Math.min(minX, bmin.x); maxX = Math.max(maxX, bmax.x);
          minY = Math.min(minY, bmin.y); maxY = Math.max(maxY, bmax.y);
          minZ = Math.min(minZ, bmin.z); maxZ = Math.max(maxZ, bmax.z);
          const cxi = (bmin.x + bmax.x) / 2, cyi = (bmin.y + bmax.y) / 2, czi = (bmin.z + bmax.z) / 2;
          const dx = (bmax.x - bmin.x), dy = (bmax.y - bmin.y), dz = (bmax.z - bmin.z);
          const m = Math.max(1e-6, dx * dy * dz);
          cx += cxi * m; cy += cyi * m; cz += czi * m; mass += m;
        }
        if (mass > 0) { cx /= mass; cy /= mass; cz /= mass; }
        center = new BABYLON.Vector3(cx, cy, cz);
        const halfX = Math.max(0.1, (maxX - minX) / 2);
        const halfZ = Math.max(0.1, (maxZ - minZ) / 2);
        rad = Math.max(halfX, halfZ) * 0.9;
        planeY = isFinite(minY) ? minY : 0;
        id = 'group';
      } else {
        const mesh = entries[0].mesh;
        const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) { disposeMoveWidget(); return; }
        const min = bb.minimumWorld, max = bb.maximumWorld;
        const halfX = Math.max(0.1, (max.x - min.x) / 2);
        const halfZ = Math.max(0.1, (max.z - min.z) / 2);
        rad = Math.max(halfX, halfZ) * 0.9; // slightly inside
        center = new BABYLON.Vector3((min.x+max.x)/2, (min.y+max.y)/2, (min.z+max.z)/2);
        planeY = min.y;
      }
      try {
        const byId = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
        const voxed = sel.map(id => ({ id, vox: !!byId.get(id)?.vox }));
        mLog('widget:build', { isGroup, ids: sel, planeY, center: { x:center.x, y:center.y, z:center.z }, rad, voxed });
      } catch {}
      if (!moveWidget.root || moveWidget.group !== isGroup || moveWidget.groupKey !== groupKey || (moveWidget.root.isDisposed && moveWidget.root.isDisposed())) {
        disposeMoveWidget();
        const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100;
        const gScale = Math.max(0.1, scalePct / 100);
        const len = Math.max(0.8, rad * 1.2 * gScale);
        const shaft = Math.max(0.04, len * 0.05);
        const tipLen = Math.max(0.08, len * 0.18);
        const tipDia = shaft * 2.2;
        const root = new BABYLON.TransformNode(`moveGizmo:root:${id}`, scene);
        const mkArrow = (axis, color) => {
          const name = `moveGizmo:${axis}:${id}`;
          const shaftMesh = BABYLON.MeshBuilder.CreateCylinder(`${name}:shaft`, { height: len - tipLen, diameter: shaft }, scene);
          const tipMesh = BABYLON.MeshBuilder.CreateCylinder(`${name}:tip`, { height: tipLen, diameterTop: 0, diameterBottom: tipDia, tessellation: 24 }, scene);
          const mat = new BABYLON.StandardMaterial(`${name}:mat`, scene);
          mat.diffuseColor = color.scale(0.25); mat.emissiveColor = color.clone(); mat.specularColor = new BABYLON.Color3(0,0,0);
          shaftMesh.material = mat; tipMesh.material = mat;
          shaftMesh.isPickable = true; tipMesh.isPickable = true; shaftMesh.alwaysSelectAsActiveMesh = true; tipMesh.alwaysSelectAsActiveMesh = true;
          shaftMesh.renderingGroupId = 2; tipMesh.renderingGroupId = 2;
          shaftMesh.parent = root; tipMesh.parent = root;
          if (axis === 'x') { shaftMesh.rotation.z = -Math.PI/2; tipMesh.rotation.z = -Math.PI/2; shaftMesh.position.x = (len - tipLen)/2; tipMesh.position.x = len - tipLen/2; }
          else if (axis === 'y') { shaftMesh.position.y = (len - tipLen)/2; tipMesh.position.y = len - tipLen/2; }
          else { shaftMesh.rotation.x = Math.PI/2; tipMesh.rotation.x = Math.PI/2; shaftMesh.position.z = (len - tipLen)/2; tipMesh.position.z = len - tipLen/2; }
          shaftMesh.name = name; tipMesh.name = name;
          try { moveWidget.arrowMeshes.push(shaftMesh, tipMesh); } catch {}
        };
        moveWidget.root = root; moveWidget.mesh = root; moveWidget.spaceId = id; moveWidget.group = isGroup; moveWidget.groupIDs = sel.slice(); moveWidget.groupKey = groupKey;
        // Only keep Y arrow (green) — remove X (red) and Z (blue)
        mkArrow('y', new BABYLON.Color3(0.2, 0.95, 0.2));
        // Ground-plane drag disc (XZ plane)
        try {
          const discR = Math.max(0.6, rad * 0.9 * gScale);
          const disc = BABYLON.MeshBuilder.CreateDisc(`moveGizmo:disc:${id}`, { radius: discR, tessellation: 64 }, scene);
          const dmat = new BABYLON.StandardMaterial(`moveGizmo:disc:${id}:mat`, scene);
          dmat.diffuseColor = new BABYLON.Color3(0.15, 0.5, 0.95); dmat.emissiveColor = new BABYLON.Color3(0.12, 0.42, 0.85); dmat.alpha = 0.18; dmat.specularColor = new BABYLON.Color3(0,0,0);
          disc.material = dmat; disc.isPickable = true; disc.alwaysSelectAsActiveMesh = true; disc.renderingGroupId = 2;
          disc.rotation.x = Math.PI / 2; // lie on XZ
          moveWidget.disc = disc;
        } catch {}
      }
      // Position root
      if (isGroup) {
        try { moveWidget.root.parent = null; } catch {}
        try { moveWidget.root.position.copyFrom(center); } catch {}
        moveWidget.groupCenter = center;
        moveWidget.startCenter = null;
      } else {
        const mesh = entries[0].mesh;
        try { moveWidget.root.parent = null; } catch {}
        try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
        const bb = mesh.getBoundingInfo()?.boundingBox; const min = bb?.minimumWorld, max = bb?.maximumWorld;
        const c = (min && max) ? new BABYLON.Vector3((min.x+max.x)/2, (min.y+max.y)/2, (min.z+max.z)/2) : mesh.position.clone();
        try { moveWidget.root.position.copyFrom(c); } catch {}
      }
      // Position the plane disc over XZ at lowest AABB Y, centered in XZ on current gizmo center
      try {
        const p = isGroup ? center : (entries[0]?.mesh?.position || center);
        moveWidget.planeY = planeY || 0;
        if (moveWidget.disc) { moveWidget.disc.position.x = p.x; moveWidget.disc.position.y = moveWidget.planeY; moveWidget.disc.position.z = p.z; }
      } catch {}
    } catch { try { disposeMoveWidget(); } catch {} }
  }

  // Pointer interactions for rotation widget
  let _lastGizmoClick = 0;
  const _GIZMO_DCLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  scene.onPointerObservable.add((pi) => {
    // Block gizmo input while suppressed (voxelizing)
    if (_gizmosSuppressed) {
      try { if (rotWidget) { rotWidget.dragging = false; rotWidget.preDrag = false; rotWidget.axis = null; } } catch {}
      try { if (moveWidget) { moveWidget.dragging = false; moveWidget.preDrag = false; moveWidget.axis = null; } } catch {}
      return;
    }
    // Edit mode: space selection; Cavern mode: voxel lock selection
    if (state.mode === 'cavern') {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (rotWidget.dragging || moveWidget.dragging) return;
      const ev = pi.event || window.event;
      sLog('cm:pointerdown', { x: scene.pointerX, y: scene.pointerY, button: ev?.button, meta: !!ev?.metaKey, shift: !!ev?.shiftKey });
      try {
        const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
        if (!isLeft) return;
        // Resolve active space
        const sid = state._scry?.spaceId || (Array.from(state.selection || [])[0] || null);
        const s = (state?.barrow?.spaces || []).find(x => x && x.id === sid);
        if (!s || !s.vox || !s.vox.size) return;
        // Use current hover pick if available, else compute quickly (reuse DDA setup)
        let pick = s.voxPick;
        if (!pick) {
          const vox = decompressVox(s.vox);
          const nx = Math.max(1, vox.size?.x || 1);
          const ny = Math.max(1, vox.size?.y || 1);
          const nz = Math.max(1, vox.size?.z || 1);
          const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
          const roW = ray.origin.clone(), rdW = ray.direction.clone();
          const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
          let q = BABYLON.Quaternion.Identity();
          const worldAligned = !!(s.vox && s.vox.worldAligned);
          try {
            if (!worldAligned) {
              const rx = Number(s.rotation?.x ?? 0) || 0;
              const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
              const rz = Number(s.rotation?.z ?? 0) || 0;
              q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
            }
          } catch {}
          const qInv = BABYLON.Quaternion.Inverse(q);
          const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
          const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
          const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
          const minX = -(nx * res) / 2, maxX = +(nx * res) / 2;
          const minY = -(ny * res) / 2, maxY = +(ny * res) / 2;
          const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
          const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
          const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
          const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
          const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
          const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
          const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
          if (tmax >= Math.max(0, tmin)) {
            const EPS = 1e-6; let t = Math.max(tmin, 0) + EPS;
            const toIdx = (x, y, z) => ({
              ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))),
              iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))),
              iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))),
            });
            let pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
            let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
            const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0);
            const stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0);
            const stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
            const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
            let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
            let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
            let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
            const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity;
            const tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity;
            const tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
            let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
            const yCut = ny - hideTop;
            const data = Array.isArray(vox.data) ? vox.data : [];
            let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
            while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
              if (iy < yCut) {
                const flat = ix + nx * (iy + ny * iz);
                const v = data[flat] ?? VoxelType.Uninstantiated;
                if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
                  pick = { x: ix, y: iy, z: iz, v };
                  break;
                }
              }
              if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
              else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
              else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
            }
          }
        }
        if (!pick) return;
        // Lock selection and persist
        s.voxPick = pick;
        state.lockedVoxPick = { id: s.id, x: pick.x, y: pick.y, z: pick.z, v: pick.v };
        state.lastVoxPick = { ...state.lockedVoxPick };
        try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: pick.x, j: pick.y, k: pick.z, v: pick.v } })); } catch {}
        try { rebuildHalos(); } catch {}
        dPick('voxelPick:lock', { id: s.id, x: pick.x, y: pick.y, z: pick.z });
        sLog('cm:lockVoxel', { id: s.id, x: pick.x, y: pick.y, z: pick.z });
        ev.preventDefault(); ev.stopPropagation();
      } catch {}
      return;
    }
    if (state.mode !== 'edit') return;
    const type = pi.type;
    if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
      if (pick?.hit && pick.pickedMesh) {
        const nm = String(pick.pickedMesh.name || '');
        const mY = rotWidget.meshes?.y, mX = rotWidget.meshes?.x, mZ = rotWidget.meshes?.z;
        let axis = null;
        if (nm.startsWith('rotGizmo:Y:') && pick.pickedMesh === mY) axis = 'y';
        else if (nm.startsWith('rotGizmo:X:') && pick.pickedMesh === mX) axis = 'x';
        else if (nm.startsWith('rotGizmo:Z:') && pick.pickedMesh === mZ) axis = 'z';
        if (axis) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          rotWidget.axis = axis;
          rotWidget.preDrag = false;
          rotWidget.downX = scene.pointerX; rotWidget.downY = scene.pointerY;
          dPick('preDrag:rot', { axis, x: rotWidget.downX, y: rotWidget.downY });
          try { setRingActive(axis); } catch {}
          // Initialize local-axis rotation baseline and start dragging immediately
          try {
            const ax = rotWidget.axis || 'y';
            const sel = Array.from(state.selection || []);
            const isGroup = (sel.length > 1);
            if (isGroup) {
              // Group baseline: world axis and center-of-mass
              const axisWorld = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
              rotWidget.axisWorld = axisWorld.clone();
              const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
              const p0 = pickPointOnPlane(axisWorld, center) || center.clone();
              let ref = p0.subtract(center);
              ref = ref.subtract(axisWorld.scale(BABYLON.Vector3.Dot(ref, axisWorld)));
              if (ref.lengthSquared() < 1e-6) ref = new BABYLON.Vector3(1,0,0); else ref.normalize();
              rotWidget.refWorld = ref;
              // Screen-space baseline angle around the projected center (robust if plane pick fails)
              try { rotWidget.startAngle = angleToPointerFrom(center); } catch {}
              rotWidget.mStartX = scene.pointerX; rotWidget.mStartY = scene.pointerY;
              // Snapshot starts for each selected mesh
              const map = new Map();
              for (const id of rotWidget.groupIDs || []) {
                const m = (state?.built?.spaces || []).find(x => x.id === id)?.mesh; if (!m) continue;
                try { if (!m.rotationQuaternion) m.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0); } catch {}
                map.set(id, { q: m.rotationQuaternion?.clone ? m.rotationQuaternion.clone() : null, p: m.position?.clone ? m.position.clone() : new BABYLON.Vector3(m.position.x, m.position.y, m.position.z) });
              }
              rotWidget.startById = map; rotWidget.dragging = true;
            } else {
              // Single baseline: local axis
              const { space, mesh } = getSelectedSpaceAndMesh(); if (!mesh) return;
              const center = mesh.position.clone();
              const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
              rotWidget.axisLocal = axisLocal.clone();
              if (!mesh.rotationQuaternion) {
                mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x || 0, mesh.rotation.y || 0, mesh.rotation.z || 0);
              }
              rotWidget.startQuat = mesh.rotationQuaternion.clone();
              const wm = mesh.getWorldMatrix();
              const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
              const p0 = pickPointOnPlane(nWorld, center) || center.clone();
              const inv = BABYLON.Matrix.Invert(wm);
              const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
              let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal)));
              if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0); else refLocal.normalize();
              rotWidget.refLocal = refLocal; rotWidget.dragging = true;
            }
            const canvas = engine.getRenderingCanvas();
            camera.inputs?.attached?.pointers?.detachControl(canvas);
            try { const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); } catch {}
          } catch {}
          // Gizmo double-click opens DB for selected space
          try {
            const now = performance.now();
            if (now - _lastGizmoClick <= _GIZMO_DCLICK_MS) {
              const { id } = getSelectedSpaceAndMesh();
              if (id) window.dispatchEvent(new CustomEvent('dw:showDbForSpace', { detail: { id } }));
            }
            _lastGizmoClick = now;
          } catch {}
        }
      }
      // Move widget start
      // Prefer the ground-plane disc if under the cursor to ensure plane moves
      let pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:'));
      if (!pick2?.hit) {
        pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
      }
      if (pick2?.hit && pick2.pickedMesh && String(pick2.pickedMesh.name||'').startsWith('moveGizmo:')) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        // Prepare possible drag
        moveWidget.preDrag = true;
        moveWidget.downX = scene.pointerX; moveWidget.downY = scene.pointerY;
        const _nm = String(pick2.pickedMesh.name||'');
        try { const m = _nm.match(/^moveGizmo:(y):/i); moveWidget.axis = m ? m[1].toLowerCase() : null; } catch { moveWidget.axis = null; }
        moveWidget.mode = _nm.startsWith('moveGizmo:disc:') ? 'plane' : 'axis';
        dPick('preDrag:move', { x: moveWidget.downX, y: moveWidget.downY, mode: moveWidget.mode, axis: moveWidget.axis });
        mLog('press', { picked: _nm, mode: moveWidget.mode, axis: moveWidget.axis });
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERUP) {
      if (rotWidget.dragging) {
        rotWidget.dragging = false;
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.attachControl(canvas, true);
          try { const pe = pi.event; if (pe && pe.pointerId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(pe.pointerId); } catch {}
          Log.log('GIZMO', 'Drag end', { id: rotWidget.spaceId, action: 'attachCameraPointers' });
        } catch {}
        // Persist rotation using quaternion → Euler
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
            try {
              const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
              space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
              const deg = Math.round((e.y * 180 / Math.PI) * 10) / 10;
              Log.log('GIZMO', 'Persist rotation', { id: rotWidget.spaceId, euler: { x: e.x, y: e.y, z: e.z }, degY: deg });
            } catch {}
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
      // Clear pending pre-drag state on mouse up
      rotWidget.preDrag = false;
      moveWidget.preDrag = false;
      if (moveWidget.dragging) {
        moveWidget.dragging = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); const pe = pi.event; if (pe && pe.pointerId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(pe.pointerId); Log.log('GIZMO', 'Move end', { id: moveWidget.spaceId }); } catch {}
        try {
          const selNow = Array.from(state.selection || []);
          const isGroup = selNow.length > 1;
          if (isGroup) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of moveWidget.groupIDs || []) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              sp.origin = { x: m2.position.x, y: m2.position.y, z: m2.position.z };
            }
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          } else {
            const { space, mesh } = getSelectedSpaceAndMesh();
            if (space && mesh) {
              // Persist origin
              space.origin = space.origin || { x: 0, y: 0, z: 0 };
              space.origin.x = mesh.position.x;
              space.origin.y = mesh.position.y;
              space.origin.z = mesh.position.z;
              Log.log('GIZMO', 'Persist move', { id: moveWidget.spaceId, origin: space.origin });
              saveBarrow(state.barrow); snapshot(state.barrow);
              renderDbView(state.barrow);
              scheduleGridUpdate();
              try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const selNowGlobal = Array.from(state.selection || []);
      const isGroupGlobal = selNowGlobal.length > 1;
      const { space, mesh, id } = getSelectedSpaceAndMesh(); if (!isGroupGlobal && !mesh) return;
      // Hover highlight for rotation rings when not dragging/pre-dragging any gizmo
      try {
        if (!rotWidget.dragging && !rotWidget.preDrag && !moveWidget.dragging && !moveWidget.preDrag) {
          const hp = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
          let hAxis = null;
          if (hp?.hit && hp.pickedMesh) {
            const n = String(hp.pickedMesh.name || '');
            if (n.startsWith('rotGizmo:Y:') && rotWidget.meshes?.y && hp.pickedMesh === rotWidget.meshes.y) hAxis = 'y';
            else if (n.startsWith('rotGizmo:X:') && rotWidget.meshes?.x && hp.pickedMesh === rotWidget.meshes.x) hAxis = 'x';
            else if (n.startsWith('rotGizmo:Z:') && rotWidget.meshes?.z && hp.pickedMesh === rotWidget.meshes.z) hAxis = 'z';
          }
          if (hAxis) {
            if (rotWidget.activeAxis !== hAxis) { try { setRingActive(hAxis); } catch {} }
          } else {
            if (rotWidget.activeAxis) { try { setRingsDim(); } catch {} }
          }
        }
      } catch {}
      const dragThreshold = 6; // pixels
      // Possibly start rotation drag if moved enough after pressing ring
      if (!rotWidget.dragging && rotWidget.preDrag) {
        const dx = (scene.pointerX - rotWidget.downX); const dy = (scene.pointerY - rotWidget.downY);
        if (Math.hypot(dx, dy) >= dragThreshold) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const ax = rotWidget.axis || 'y';
          const center = mesh.position.clone();
          // Local axis unit vector
          const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
          rotWidget.axisLocal = axisLocal.clone();
          // Ensure quaternion use
          try {
            if (!mesh.rotationQuaternion) {
              mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x || 0, mesh.rotation.y || 0, mesh.rotation.z || 0);
            }
          } catch {}
          rotWidget.startQuat = (mesh.rotationQuaternion && mesh.rotationQuaternion.clone) ? mesh.rotationQuaternion.clone() : null;
          // World plane normal from current local axis
          const wm = mesh.getWorldMatrix();
          const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
          const p0 = pickPointOnPlane(nWorld, center) || center.clone();
          // Build reference vector in LOCAL space (project p0 to local plane)
          const inv = BABYLON.Matrix.Invert(wm);
          const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
          let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal)));
          if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0);
          else refLocal.normalize();
          rotWidget.refLocal = refLocal;
          rotWidget.dragging = true; rotWidget.preDrag = false;
          try {
            const canvas = engine.getRenderingCanvas();
            camera.inputs?.attached?.pointers?.detachControl(canvas);
            Log.log('GIZMO', 'Drag start', { id: rotWidget.spaceId, axis: ax, startAngle: rotWidget.startAngle, startRot: rotWidget.startRot, action: 'detachCameraPointers' });
          } catch {}
          dPick('dragStart:rot', {});
          // Hide built intersections during drag to avoid stale boxes
          try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
          // Sync DB view immediately with current values
          try {
            if (space) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              try { const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y; } catch {}
              renderDbView(state.barrow);
            }
          } catch {}
        }
      }
      // Rotation drag
      if (rotWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const ax = rotWidget.axis || 'y';
        const sel = Array.from(state.selection || []);
        const isGroup = (sel.length > 1);
        let delta = 0;
        if (isGroup) {
          // Screen-space angle delta around projected center (stable across camera angles)
          const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
          let ok = true;
          try {
            const angNow = angleToPointerFrom(center);
            const ang0 = rotWidget.startAngle || angNow;
            delta = angNow - ang0;
          } catch { ok = false; }
          // Fallback: derive delta from mouse movement if projection fails
          if (!isFinite(delta) || Math.abs(delta) < 1e-6 || ok === false) {
            const dx = (scene.pointerX - rotWidget.mStartX);
            const sens2 = (() => { try { return Math.max(0.0005, Math.min(0.01, Number(localStorage.getItem('dw:ui:rotSens') || '0.008')/100)); } catch { return 0.008/100; } })();
            delta = dx * sens2 * Math.PI; // screen pixels to radians
          }
          // normalize to [-pi, pi]
          if (delta > Math.PI) delta -= 2*Math.PI; else if (delta < -Math.PI) delta += 2*Math.PI;
          // Apply to each selected mesh
          const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })();
          const nWorld = rotWidget.axisWorld || new BABYLON.Vector3(0,1,0);
          const qRot = BABYLON.Quaternion.RotationAxis(nWorld, sens * delta);
          // Build rotation matrix from axis/angle (avoid Matrix.FromQuaternion which may not exist in CDN build)
          const mRot = BABYLON.Matrix.RotationAxis(nWorld, sens * delta);
          for (const id of rotWidget.groupIDs || []) {
            const entry = (state?.built?.spaces || []).find(x => x.id === id); if (!entry?.mesh) continue;
            const start = rotWidget.startById?.get?.(id);
            if (!start) continue;
            const m = entry.mesh;
            // Position
            const p0 = start.p || m.position;
            const rel = p0.subtract(center);
            const relRot = BABYLON.Vector3.TransformCoordinates(rel, mRot);
            const pNew = center.add(relRot);
            m.position.copyFrom(pNew);
            // Orientation (world axis pre-multiply)
            try {
              const q0 = start.q || m.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0);
              m.rotationQuaternion = qRot.multiply ? qRot.multiply(q0) : q0;
              m.rotation.set(0,0,0);
            } catch {}
            try { m.computeWorldMatrix(true); m.refreshBoundingInfo(); } catch {}
          }
          rotWidget.lastRot = delta;
          try { renderGizmoHud({ selCount: sel.length, center, deltaDeg: (delta*180/Math.PI), pickMode: 'screen|mouse' }); } catch {}
        } else {
          // Single: local space delta
          const center = mesh.position.clone();
          const axisLocal = rotWidget.axisLocal || ((ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1));
          const wm = mesh.getWorldMatrix();
          const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
          const p = pickPointOnPlane(nWorld, center); if (!p) return;
          const inv = BABYLON.Matrix.Invert(wm);
          const pLocal = BABYLON.Vector3.TransformCoordinates(p, inv);
          let curLocal = pLocal.subtract(axisLocal.scale(BABYLON.Vector3.Dot(pLocal, axisLocal)));
          if (curLocal.lengthSquared() < 1e-8) return; curLocal.normalize();
          const refLocal = rotWidget.refLocal || new BABYLON.Vector3(1,0,0);
          const crossL = BABYLON.Vector3.Cross(refLocal, curLocal);
          const s = BABYLON.Vector3.Dot(axisLocal, crossL);
          const c = BABYLON.Vector3.Dot(refLocal, curLocal);
          delta = Math.atan2(s, c);
          try {
            const qStart = rotWidget.startQuat || mesh.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
            mesh.rotationQuaternion = (qStart.clone ? qStart.clone() : qStart);
            const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })();
            mesh.rotate(axisLocal, sens * delta, BABYLON.Space.LOCAL);
            mesh.rotation.set(0,0,0);
          } catch {}
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
          rotWidget.lastRot = delta;
          try { renderGizmoHud({ selCount: 1, center, deltaDeg: (delta*180/Math.PI), pickMode: 'plane' }); } catch {}
        }
        try { updateRotWidgetFromMesh(mesh); } catch {}
        // Live update model rotation and DB (throttled), and always log drag update for visibility
        try {
          const selLive = Array.from(state.selection || []);
          const isGroupLive = selLive.length > 1;
          if (isGroupLive) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of selLive) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
              sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
            }
          } else if (space && mesh) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
            const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
            space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
          }
          const now = performance.now();
          if (now - _lastDbRefresh > 60) {
            _lastDbRefresh = now;
            const deg = (delta * 180 / Math.PI);
            Log.log('GIZMO', 'Drag update', { id: rotWidget.spaceId, axis: ax, delta, deg: isFinite(deg) ? Math.round(deg*10)/10 : null });
            try { renderDbView(state.barrow); } catch {}
          }
          // Live intersection preview (use any id in selection for highlight updates)
          try { if (!isGroupLive) updateLiveIntersectionsFor(id); else if (selLive.length) updateLiveIntersectionsFor(selLive[0]); } catch {}
        } catch {}
        return;
      }
      // Possibly start move drag if moved enough after pressing gizmo
      if (!moveWidget.dragging && moveWidget.preDrag) {
        const dx = (scene.pointerX - moveWidget.downX); const dy = (scene.pointerY - moveWidget.downY);
        if (Math.hypot(dx, dy) >= dragThreshold) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const selNow = Array.from(state.selection || []);
          const isGroup = selNow.length > 1;
          const isPlane = (moveWidget.mode === 'plane');
          const axis = (moveWidget.axis === 'x') ? new BABYLON.Vector3(1,0,0) : (moveWidget.axis === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
          const view = camera.getForwardRay().direction.clone();
          let n = isPlane ? new BABYLON.Vector3(0,1,0) : BABYLON.Vector3.Cross(axis, BABYLON.Vector3.Cross(view, axis));
          if (!isPlane) {
            if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(0,1,0));
            if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(1,0,0));
          }
          try { n.normalize(); } catch {}
          mLog('drag:init', { isGroup, isPlane, axis: moveWidget.axis, planeY: moveWidget.planeY, dragPlaneY: moveWidget.dragPlaneY, n: { x: n.x, y: n.y, z: n.z } });
          if (isGroup) {
            const center = moveWidget.groupCenter || new BABYLON.Vector3(0,0,0);
            // Lock plane Y at drag start
            if (isPlane && (moveWidget.dragPlaneY == null)) moveWidget.dragPlaneY = moveWidget.planeY || 0;
            const base0 = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : center;
            const p0 = pickPointOnPlane(n, base0) || base0.clone();
            moveWidget.axisStart = isPlane ? 0 : BABYLON.Vector3.Dot(p0, axis);
            moveWidget.startPoint = p0.clone();
            moveWidget.startCenter = center.clone ? center.clone() : new BABYLON.Vector3(center.x, center.y, center.z);
            moveWidget.startById = new Map();
            moveWidget.groupIDs = selNow.slice();
            for (const id2 of moveWidget.groupIDs) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              moveWidget.startById.set(id2, m2.position?.clone ? m2.position.clone() : new BABYLON.Vector3(m2.position.x, m2.position.y, m2.position.z));
            }
            moveWidget.planeNormal = n.clone();
            moveWidget.dragging = true; moveWidget.preDrag = false;
            try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', isPlane ? 'Group Plane Move start' : 'Group Move start', { ids: moveWidget.groupIDs, mode: moveWidget.mode, axis: moveWidget.axis }); } catch {}
          } else {
            const mref = (state?.built?.spaces || []).find(x => x.id === selNow[0])?.mesh; if (!mref) return;
            const center = mref.position.clone();
            if (isPlane && (moveWidget.dragPlaneY == null)) moveWidget.dragPlaneY = moveWidget.planeY || 0;
            const base0 = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : center;
            const p0 = pickPointOnPlane(n, base0) || base0.clone();
            moveWidget.axisStart = isPlane ? 0 : BABYLON.Vector3.Dot(p0, axis);
            moveWidget.startPoint = p0.clone();
            moveWidget.startCenter = center.clone();
            moveWidget.planeNormal = n.clone();
            moveWidget.dragging = true; moveWidget.preDrag = false;
            try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', isPlane ? 'Plane Move start' : 'Move start', { id: moveWidget.spaceId, mode: moveWidget.mode, axis: moveWidget.axis, start: center }); } catch {}
          }
          dPick('dragStart:move', {});
          try { mLog('drag:start', { mode: moveWidget.mode, axis: moveWidget.axis, startPoint: { x: moveWidget.startPoint.x, y: moveWidget.startPoint.y, z: moveWidget.startPoint.z }, startCenter: { x: moveWidget.startCenter.x, y: moveWidget.startCenter.y, z: moveWidget.startCenter.z }, axisStart: moveWidget.axisStart }); } catch {}
          // Hide built intersections during drag to avoid stale boxes
          try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
        }
      }
      // Move drag
      if (moveWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const selNow = Array.from(state.selection || []);
        const isGroup = selNow.length > 1;
        const isPlane = (moveWidget.mode === 'plane');
        const axis = (moveWidget.axis === 'x') ? new BABYLON.Vector3(1,0,0) : (moveWidget.axis === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
        if (isGroup) {
          const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
          const basePt = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : (moveWidget.startCenter || new BABYLON.Vector3(0,0,0));
          const p = pickPointOnPlane(n, basePt); if (!p) return;
          let deltaScalar = 0; let deltaVec = null;
          if (isPlane) { deltaVec = p.subtract(moveWidget.startPoint || basePt); }
          else { const s = BABYLON.Vector3.Dot(p, axis); deltaScalar = s - (moveWidget.axisStart || 0); }
          for (const id2 of moveWidget.groupIDs || []) {
            const entry = (state?.built?.spaces || []).find(x => x.id === id2); if (!entry?.mesh) continue;
            const startPos = moveWidget.startById?.get?.(id2); if (!startPos) continue;
            const targetPos = isPlane ? startPos.add(deltaVec) : startPos.add(axis.scale(deltaScalar));
            const m2 = entry.mesh; m2.position.copyFrom(targetPos);
            try { m2.computeWorldMatrix(true); m2.refreshBoundingInfo(); } catch {}
          }
          const targetCenter = isPlane ? (moveWidget.startCenter || new BABYLON.Vector3(0,0,0)).add(deltaVec) : (moveWidget.startCenter || new BABYLON.Vector3(0,0,0)).add(axis.scale(deltaScalar));
          try { moveWidget.root.position.copyFrom(targetCenter); } catch {}
          try { updateMoveDiscPlacement(); } catch {}
          try { updateContactShadowPlacement(); } catch {}
          moveWidget.groupCenter = targetCenter;
          // Keep rotation gizmo (group rings) following
          try { if (rotWidget.group && rotWidget.groupNode) rotWidget.groupNode.position.copyFrom(targetCenter); } catch {}
          // Persist model origins live (throttled with DB refresh debounce)
          try {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of moveWidget.groupIDs || []) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              sp.origin = { x: m2.position.x, y: m2.position.y, z: m2.position.z };
            }
            const now = performance.now();
            if (now - _lastDbRefresh > 60) {
              _lastDbRefresh = now;
              Log.log('GIZMO', isPlane ? 'Group Plane Move update' : 'Group Move update', { ids: moveWidget.groupIDs, mode: moveWidget.mode, axis: moveWidget.axis });
              try { renderDbView(state.barrow); } catch {}
              try { updateSelectionObbLive(); } catch {}
            }
          } catch {}
        } else {
          const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
          const basePt = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : (moveWidget.startCenter || mesh.position || new BABYLON.Vector3(0,0,0));
          const p = pickPointOnPlane(n, basePt); if (!p) return;
          let target;
          if (isPlane) {
            const deltaVec = p.subtract(moveWidget.startPoint || basePt);
            target = (moveWidget.startCenter || mesh.position).add(deltaVec);
          } else {
            const s = BABYLON.Vector3.Dot(p, axis);
            const deltaScalar = s - (moveWidget.axisStart || 0);
            target = (moveWidget.startCenter || mesh.position).add(axis.scale(deltaScalar));
          }
          try {
            const now = performance.now();
            moveWidget._lastLog = moveWidget._lastLog || 0;
            if (now - moveWidget._lastLog > 100) {
              moveWidget._lastLog = now;
              mLog('drag:update', { isPlane, basePt: { x: basePt.x, y: basePt.y, z: basePt.z }, target: { x: target.x, y: target.y, z: target.z }, dragPlaneY: moveWidget.dragPlaneY });
            }
          } catch {}
          mesh.position.copyFrom(target);
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
          try { if (moveWidget.root) moveWidget.root.position.copyFrom(target); } catch {}
          try { updateMoveDiscPlacement(); } catch {}
          try { updateContactShadowPlacement(); } catch {}
          try { updateRotWidgetFromMesh(mesh); } catch {}
          try {
            if (space) {
              space.origin = space.origin || { x: 0, y: 0, z: 0 };
              space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
              const now = performance.now();
              if (now - _lastDbRefresh > 60) { _lastDbRefresh = now; Log.log('GIZMO', isPlane ? 'Plane Move update' : 'Move update', { id: moveWidget.spaceId, mode: moveWidget.mode, axis: moveWidget.axis, origin: space.origin }); try { renderDbView(state.barrow); } catch {} }
              try { updateLiveIntersectionsFor(id); } catch {}
            }
          } catch {}
          try { updateSelectionObbLive(); } catch {}
        }
      }
      }
  });

  // Live voxel hover selection on mouse move
  (function setupVoxelHover(){
    let _lastMoveAt = 0;
    scene.onPointerObservable.add((pi) => {
      try {
        if (pi.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;
        if (rotWidget.dragging || moveWidget.dragging) return;
        // Active space: prefer current selection (single) else cavern focus (while in cavern)
        let activeId = null;
        const sel = Array.from(state.selection || []);
        if (sel.length === 1) activeId = sel[0];
        else if (state.mode === 'cavern' && state._scry?.spaceId) activeId = state._scry.spaceId;
        if (!activeId) return;
        const s = (state?.barrow?.spaces || []).find(x => x && x.id === activeId);
        if (!s || !s.vox || !s.vox.size) return;
        // If voxel selection is locked for this space, do not update on hover
        if (state.lockedVoxPick && state.lockedVoxPick.id === s.id) return;
        const now = performance.now ? performance.now() : Date.now();
        if (now - _lastMoveAt < 25) return; // throttle ~40 Hz
        _lastMoveAt = now;
        // DDA pick identical to click path
        const vox = decompressVox(s.vox);
        const nx = Math.max(1, vox.size?.x || 1);
        const ny = Math.max(1, vox.size?.y || 1);
        const nz = Math.max(1, vox.size?.z || 1);
        const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
        const roW = ray.origin.clone(), rdW = ray.direction.clone();
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        let q = BABYLON.Quaternion.Identity();
        const worldAligned = !!(s.vox && s.vox.worldAligned);
        try {
          if (!worldAligned) {
            const rx = Number(s.rotation?.x ?? 0) || 0;
            const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
            const rz = Number(s.rotation?.z ?? 0) || 0;
            q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
          }
        } catch {}
        const qInv = BABYLON.Quaternion.Inverse(q);
        const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
        const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
        const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
        const minX = -(nx * res) / 2, maxX = +(nx * res) / 2;
        const minY = -(ny * res) / 2, maxY = +(ny * res) / 2;
        const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
        const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
        const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
        const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
        const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
        const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
        const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
        if (!(tmax >= Math.max(0, tmin))) return;
        const EPS = 1e-6; let t = Math.max(tmin, 0) + EPS;
        const toIdx = (x, y, z) => ({
          ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))),
          iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))),
          iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))),
        });
        let pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
        let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
        const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0);
        const stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0);
        const stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
        const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
        let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
        let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
        let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
        const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity;
        const tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity;
        const tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
        let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
        const yCut = ny - hideTop;
        const data = Array.isArray(vox.data) ? vox.data : [];
        let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
        let changed = false;
        while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
          if (iy < yCut) {
            const flat = ix + nx * (iy + ny * iz);
            const v = data[flat] ?? VoxelType.Uninstantiated;
            if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
              const prev = s.voxPick;
              if (!prev || prev.x !== ix || prev.y !== iy || prev.z !== iz) changed = true;
              s.voxPick = { x: ix, y: iy, z: iz, v };
              break;
            }
          }
          if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
          else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
          else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
        }
        if (changed) {
          try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: s.voxPick.x, j: s.voxPick.y, k: s.voxPick.z, v: s.voxPick.v } })); } catch {}
        }
      } catch {}
    });
  })();

  // Global pointerup failsafe (release outside canvas)
  window.addEventListener('pointerup', () => {
    try {
      if (rotWidget.dragging) {
        rotWidget.dragging = false; rotWidget.preDrag = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        // Persist latest rotation
        try {
          const sel = Array.from(state.selection || []);
          if (sel.length > 1) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of sel) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              try {
                const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
                sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
              } catch {}
            }
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          } else {
            const { space, mesh } = getSelectedSpaceAndMesh();
            if (space && mesh) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              try {
                const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
                space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
              } catch {}
              saveBarrow(state.barrow); snapshot(state.barrow);
              renderDbView(state.barrow);
              scheduleGridUpdate();
              try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          }
        } catch {}
      }
      if (moveWidget.dragging) {
        moveWidget.dragging = false; moveWidget.preDrag = false;
        try { moveWidget.dragPlaneY = null; } catch {}
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        // Persist latest origin
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            space.origin = space.origin || { x: 0, y: 0, z: 0 };
            space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          }
        } catch {}
      }
      try { setRingsDim(); } catch {}
    } catch {}
  }, { passive: true });

  // ——————————— Pointer selection & double-click ———————————
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  let lastPickName = null;
  let lastPickTime = 0;
  function setRingsDim() {
    try {
      const mats = rotWidget?.mats || {};
      const dims = 0.35;
      for (const k of ['x','y','z']) {
        const m = mats[k]; if (!m) continue;
        const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1));
        m.emissiveColor = base.scale(dims);
        m.diffuseColor = base.scale(0.05 + 0.15 * dims);
      }
      rotWidget.activeAxis = null;
    } catch {}
  }
  function setRingActive(axis) {
    try {
      const mats = rotWidget?.mats || {};
      const kActive = 1.1, kDim = 0.35;
      for (const k of ['x','y','z']) {
        const m = mats[k]; if (!m) continue;
        const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1));
        const kf = (k === axis) ? kActive : kDim;
        m.emissiveColor = base.scale(kf);
        m.diffuseColor = base.scale(0.05 + 0.15 * kf);
      }
      rotWidget.activeAxis = axis;
    } catch {}
  }
  scene.onPointerObservable.add((pi) => {
    if (_gizmosSuppressed) {
      try { if (rotWidget) { rotWidget.dragging = false; rotWidget.preDrag = false; rotWidget.axis = null; } } catch {}
      try { if (moveWidget) { moveWidget.dragging = false; moveWidget.preDrag = false; moveWidget.axis = null; } } catch {}
      try { Log.log('GIZMO', 'Pointer blocked during voxel-op', { type: pi.type }); } catch {}
      return;
    }
    if (state.mode !== 'edit') return;
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    if (rotWidget.dragging || moveWidget.dragging) return; // do not interfere while dragging gizmo
    const ev = pi.event || window.event;
    dPick('pointerdown', { x: scene.pointerX, y: scene.pointerY });
    sLog('edit:pointerdown', { x: scene.pointerX, y: scene.pointerY });
    let pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (m) => {
        if (!m || typeof m.name !== 'string') return false;
        const n = m.name;
        if (n.startsWith('space:')) {
          // Only pick the base space mesh (no suffix like :label or :wall)
          const rest = n.slice('space:'.length);
          return !rest.includes(':');
        }
        return n.startsWith('cavern:');
      }
    );
    dPick('primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null });
    sLog('edit:primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null });
    // Fallback: robust ray/mesh intersection if Babylon pick misses
    if (!pick?.hit || !pick.pickedMesh) {
      try {
        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
        let best = null;
        for (const entry of (state?.built?.spaces || [])) {
          const mesh = entry?.mesh; if (!mesh) continue;
          const info = ray.intersectsMesh(mesh, false);
          if (info?.hit) {
            if (!best || info.distance < best.distance) best = { info, mesh, id: entry.id };
          }
        }
        if (best) {
          pick = { hit: true, pickedMesh: best.mesh, distance: best.info.distance };
          dPick('fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance });
          sLog('edit:fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance });
        } else {
          dPick('fallbackPickMiss', {});
          sLog('edit:fallbackPickMiss', {});
        }
      } catch {}
    }
    if (!pick?.hit || !pick.pickedMesh) {
      // Cmd-left-click on empty space deselects all
      try {
        const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
        const isCmd = !!(ev && ev.metaKey);
        if (isLeft && isCmd) {
          state.selection.clear();
          sLog('edit:deselectAll', { via: 'cmd-left-empty' });
          // Aggressive cleanup of any auxiliary gizmo/preview meshes to avoid artifacts
          try { disposeLiveIntersections(); } catch {}
          try { disposeMoveWidget(); } catch {}
          try { disposeRotWidget(); } catch {}
          try { disposeContactShadow(); } catch {}
          rebuildHalos();
          try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
          // One extra render to flush outline/highlight changes
          try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
        }
      } catch {}
      return;
    }
    const pickedName = pick.pickedMesh.name; // space:<id> or cavern:<id> or space:<id>:label
    let id = '';
    let name = pickedName;
    if (pickedName.startsWith('space:')) {
      const rest = pickedName.slice('space:'.length);
      // Extract bare id before any suffix like :label or :wall:...
      id = rest.split(':')[0];
      name = 'space:' + id; // normalize for double-click detection
    } else if (pickedName.startsWith('cavern:')) {
      id = pickedName.slice('cavern:'.length);
      name = 'cavern:' + id;
    }
    dPick('selectId', { id, name });
    sLog('edit:selectId', { id, name });
    // Selection requires cmd-left-click (meta + left button)
    try {
      const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
      const isCmd = !!(ev && ev.metaKey);
      if (isLeft && isCmd) {
        // Cmd-left on an already selected space toggles it off (deselect)
        if (state.selection.has(id)) {
          state.selection.delete(id);
          sLog('edit:updateSelection', { selection: Array.from(state.selection), via: 'cmd-left:toggle-off', id });
        } else if (ev && ev.shiftKey) {
          // Cmd+Shift adds without clearing
          state.selection.add(id);
          sLog('edit:updateSelection', { selection: Array.from(state.selection), via: 'cmd-left+shift:add', id });
        } else {
          // Cmd-left on a different target becomes single selection
          state.selection.clear();
          state.selection.add(id);
          sLog('edit:updateSelection', { selection: Array.from(state.selection), via: 'cmd-left:single', id });
        }
        rebuildHalos();
        try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
        ensureRotWidget(); ensureMoveWidget(); disposeLiveIntersections();
        try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      }
    } catch {}

    // Handle double-click/tap with adjustable threshold
    const now = performance.now();
    if (name === lastPickName && (now - lastPickTime) <= DOUBLE_CLICK_MS) {
      dPick('doubleClick', { name, id });
      sLog('edit:doubleClick', { name, id });
      // Double-click enters Cavern Mode for spaces
      if (name.startsWith('space:')) {
        try { enterCavernModeForSpace(id); } catch {}
      } else {
        try { camApi.centerOnMesh(pick.pickedMesh); } catch (err) { Log.log('ERROR', 'Center on item failed', { error: String(err) }); }
      }
    }
    lastPickName = name;
    lastPickTime = now;

    // If a voxelized space is selected and clicked, compute the voxel indices at the picked point and emit an event
    try {
      if (name.startsWith('space:')) {
        const s = (state?.barrow?.spaces || []).find(x => x && x.id === id);
        if (s && s.vox && s.vox.size) {
          const vox = decompressVox(s.vox);
          const nx = Math.max(1, vox.size?.x || 1);
          const ny = Math.max(1, vox.size?.y || 1);
          const nz = Math.max(1, vox.size?.z || 1);
          const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
          // Ray-grid DDA: walk cells along camera ray, skipping hidden (exposed) layers and empty/uninstantiated
          // Transform ray into space-local coordinates (voxel axes)
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
          const roW = ray.origin.clone(), rdW = ray.direction.clone();
          const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
          let q = BABYLON.Quaternion.Identity();
          const worldAligned = !!(s.vox && s.vox.worldAligned);
          try {
            if (!worldAligned) {
              const rx = Number(s.rotation?.x ?? 0) || 0;
              const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
              const rz = Number(s.rotation?.z ?? 0) || 0;
              q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
            } else {
              q = BABYLON.Quaternion.Identity();
            }
          } catch {}
          const qInv = BABYLON.Quaternion.Inverse(q);
          const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
          const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
          const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
          // Local AABB in voxel space
          const minX = -(nx * res) / 2, maxX = +(nx * res) / 2;
          const minY = -(ny * res) / 2, maxY = +(ny * res) / 2;
          const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
          const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
          const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
          const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
          const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
          const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
          const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
          if (!(tmax >= Math.max(0, tmin))) { dPick('voxelPick:rayMissAABB', {}); return; }
          const EPS = 1e-6;
          let t = Math.max(tmin, 0) + EPS;
          const pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
          const toIdx = (x, y, z) => ({
            ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))),
            iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))),
            iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))),
          });
          let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
          const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0);
          const stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0);
          const stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
          const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
          let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
          let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
          let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
          const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity;
          const tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity;
          const tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
          // Respect expose-top slicing: ignore cells with y >= yCut
          let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
          const yCut = ny - hideTop;
          const data = Array.isArray(vox.data) ? vox.data : [];
          let found = false;
          let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
          while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
            if (iy < yCut) {
              const flat = ix + nx * (iy + ny * iz);
              const v = data[flat] ?? VoxelType.Uninstantiated;
              if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
                try { s.voxPick = { x: ix, y: iy, z: iz, v }; } catch {}
                try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: ix, j: iy, k: iz, v } })); } catch {}
                dPick('voxelPick:DDA', { id: s.id, ix, iy, iz, v });
                found = true;
                break;
              }
            }
            // advance to next cell boundary
            if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
            else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
            else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
          }
          if (!found) dPick('voxelPick:notFound', { id: s.id });
        }
      }
    } catch (e) { logErr('EH:voxelPick', e); }
  });

  // ——————————— Keyboard: Delete non-voxelized selected spaces ———————————
  window.addEventListener('keydown', (e) => {
    try {
      // Escape exits Cavern Mode immediately
      if (e.key === 'Escape') {
        if (state.mode === 'cavern') { e.preventDefault(); e.stopPropagation(); exitCavernMode(); return; }
      }

      if (state.mode !== 'edit') return;
      const k = e.key;
      if (k !== 'Delete' && k !== 'Backspace') return;
      // Ignore when typing in inputs or contentEditable
      const t = e.target;
      const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : '';
      const isEditable = (tag === 'input') || (tag === 'textarea') || (t && t.isContentEditable) || (tag === 'select');
      if (isEditable) return;
      if (rotWidget.dragging || moveWidget.dragging || rotWidget.preDrag || moveWidget.preDrag) return;
      const ids = Array.from(state.selection || []);
      if (!ids.length) return;
      const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
      const toDelete = ids.filter(id => { const s = byId.get(id); return s && !s.vox; });
      const skipped = ids.filter(id => { const s = byId.get(id); return s && !!s.vox; });
      if (!toDelete.length) return;
      e.preventDefault(); e.stopPropagation();
      // Remove from model
      const before = state.barrow.spaces.length;
      state.barrow.spaces = (state.barrow.spaces||[]).filter(s => !toDelete.includes(s.id));
      // Clear selection; keep any skipped (voxelized) selected
      state.selection.clear();
      for (const id of skipped) state.selection.add(id);
      // Persist + rebuild
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
      // Dispose any existing gizmos tied to removed meshes before rebuild
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { rebuildScene(); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { scheduleGridUpdate(); } catch {}
      try { rebuildHalos(); } catch {}
      // Re-evaluate gizmos for current selection (may be empty or voxelized)
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      try { Log.log('UI', 'Delete spaces', { removed: toDelete, keptVoxelized: skipped, before, after: state.barrow.spaces.length }); } catch {}
    } catch {}
  });

  // ——————————— Window resize ———————————
  window.addEventListener('resize', () => engine.resize());

  // ——————————— Panel collapse ———————————
  const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
  function applyPanelCollapsed(collapsed) {
    if (!panel || !collapsePanelBtn) return;
    panel.classList.toggle('collapsed', !!collapsed);
    collapsePanelBtn.textContent = collapsed ? '⟩' : '⟨⟩';
  }
  applyPanelCollapsed(localStorage.getItem(PANEL_STATE_KEY) === '1');
  collapsePanelBtn?.addEventListener('click', () => {
    const next = !panel.classList.contains('collapsed');
    applyPanelCollapsed(next);
    try { localStorage.setItem(PANEL_STATE_KEY, next ? '1' : '0'); } catch {}
  });

  // ——————————— Tabs setup ———————————
  (function setupTabs() {
    const panelContent = document.querySelector('.panel-content');
    if (!panelContent) return;
    // Create tabs bar and panes
    const tabsBar = document.createElement('div'); tabsBar.className = 'tabs';
    const tabEditBtn = document.createElement('button'); tabEditBtn.className = 'tab active'; tabEditBtn.dataset.tab = 'tab-edit'; tabEditBtn.textContent = 'Edit';
    const tabDbBtn = document.createElement('button'); tabDbBtn.className = 'tab'; tabDbBtn.dataset.tab = 'tab-db'; tabDbBtn.textContent = 'Database';
    const tabSettingsBtn = document.createElement('button'); tabSettingsBtn.className = 'tab'; tabSettingsBtn.dataset.tab = 'tab-settings'; tabSettingsBtn.textContent = 'Settings';
    tabsBar.appendChild(tabEditBtn); tabsBar.appendChild(tabDbBtn);
    tabsBar.appendChild(tabSettingsBtn);

    const editPane = document.createElement('div'); editPane.id = 'tab-edit'; editPane.className = 'tab-pane active';
    const dbPane = document.createElement('div'); dbPane.id = 'tab-db'; dbPane.className = 'tab-pane';
    const settingsPane = document.createElement('div'); settingsPane.id = 'tab-settings'; settingsPane.className = 'tab-pane';

    // Move existing children into editPane
    const existing = Array.from(panelContent.childNodes);
    panelContent.textContent = '';
    panelContent.appendChild(tabsBar);
    panelContent.appendChild(editPane);
    panelContent.appendChild(dbPane);
    panelContent.appendChild(settingsPane);
    for (const node of existing) editPane.appendChild(node);

    // Split the first row: move Reset/Export/Import controls into DB pane
    const firstRow = editPane.querySelector('.row');
    if (firstRow) {
      const dbRow = document.createElement('div'); dbRow.className = 'row';
      const idsToMove = ['reset','export','import','importFile'];
      for (const id of idsToMove) {
        const el = firstRow.querySelector('#' + id) || editPane.querySelector('#' + id);
        if (el) dbRow.appendChild(el);
      }
      if (dbRow.childElementCount > 0) dbPane.appendChild(dbRow);
    }

    // Add twist-open database view container
    const dbView = document.createElement('div');
    dbView.id = 'dbView';
    dbView.className = 'db-view';
    dbPane.appendChild(dbView);
    // Populate the database view now that the container exists
    try { renderDbView(state.barrow); } catch {}

    function activate(tabId) {
      try {
        // Toggle all panes generically
        const panes = panelContent.querySelectorAll('.tab-pane');
        panes.forEach(p => p.classList.toggle('active', p.id === tabId));
        // Toggle all tabs generically
        const tabs = tabsBar.querySelectorAll('.tab');
        tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        // Notify listeners about tab change
        try { window.dispatchEvent(new CustomEvent('dw:tabChange', { detail: { id: tabId } })); } catch {}
      } catch {}
    }
    // Generic delegation: any button with class 'tab' switches panes
    tabsBar.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.tab') : null;
      if (!btn || !btn.dataset || !btn.dataset.tab) return;
      activate(btn.dataset.tab);
    });
    // Notify others that tabs are ready
    try { window.dispatchEvent(new CustomEvent('dw:tabsReady', { detail: {} })); } catch {}
  })();

  // ——————————— DB edit events ———————————
  window.addEventListener('dw:dbEdit', (e) => {
    const { path, value, prev } = e.detail || {};
    try {
      // Ensure unique space id on rename
      const m = String(path || '').match(/^spaces\.(\d+)\.id$/);
      if (m) {
        const idx = Number(m[1]);
        const arr = state.barrow.spaces || [];
        if (arr[idx]) {
          const desired = String(value || '').trim();
          if (desired.length >= 1) {
            const used = new Set(arr.map((s, i) => i === idx ? null : (s?.id || '')).filter(Boolean));
            let candidate = desired; let n = 1;
            while (used.has(candidate)) candidate = `${desired}-${++n}`;
            arr[idx].id = candidate;
            // Update selection if needed
            if (prev && state.selection.has(prev)) { state.selection.delete(prev); state.selection.add(candidate); try { rebuildHalos(); } catch (e2) { logErr('EH:rebuildHalos:rename', e2); } }
          }
        }
      }
    } catch (e) { logErr('EH:dbEdit:rename', e); }
    try { saveBarrow(state.barrow); snapshot(state.barrow); } catch (e) { logErr('EH:dbEdit:saveSnapshot', e); }
    try { rebuildScene(); } catch (e) { logErr('EH:dbEdit:rebuildScene', e); }
    try { renderDbView(state.barrow); } catch (e) { logErr('EH:dbEdit:renderDbView', e); }
    try { scheduleGridUpdate(); } catch (e) { logErr('EH:dbEdit:scheduleGridUpdate', e); }
    try { applyViewToggles?.(); } catch (e) { logErr('EH:dbEdit:applyViewToggles', e); }
    try { updateHud?.(); } catch (e) { logErr('EH:dbEdit:updateHud', e); }
    try { ensureRotWidget(); ensureMoveWidget(); } catch (e) { logErr('EH:dbEdit:ensureWidgets', e); }
  });

  // ——————————— External transforms (buttons/commands) ———————————
  window.addEventListener('dw:transform', (e) => {
    try { ensureRotWidget(); ensureMoveWidget(); rebuildHalos(); } catch {}
  });

  // ——————————— DB navigation and centering ———————————
  // Center camera when a DB row (space summary) is clicked
  window.addEventListener('dw:dbRowClick', (e) => {
    const { type, id, shiftKey } = e.detail || {};
    if (type !== 'space' || !id) return;
    try {
      const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || scene.getMeshByName(`space:${id}`);
      if (mesh) camApi.centerOnMesh(mesh);
      // Update selection to the clicked space and refresh halos (support shift to toggle)
      try {
        if (shiftKey) {
          if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
        } else {
          state.selection.clear(); state.selection.add(id);
        }
        rebuildHalos(); ensureRotWidget(); ensureMoveWidget();
        window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
      } catch {}
      Log.log('UI', 'DB row center', { id });
    } catch (err) { Log.log('ERROR', 'Center from DB failed', { id, error: String(err) }); }
  });

  // Open the Database tab and expand to a specific space
  window.addEventListener('dw:showDbForSpace', (e) => {
    const { id } = e.detail || {};
    if (!id) return;
    try {
      // Ensure panel is expanded/visible
      try { applyPanelCollapsed(false); localStorage.setItem(PANEL_STATE_KEY, '0'); } catch {}
      // Activate DB tab
      const dbBtn = document.querySelector('.tabs .tab[data-tab="tab-db"]');
      dbBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Ensure dbView exists
      const dbView = document.getElementById('dbView'); if (!dbView) return;
      // Open Spaces section
      const spaces = dbView.querySelector('#dbSpaces'); if (spaces) spaces.open = true;
      // Open specific space details and scroll into view
      let target = null;
      try { target = dbView.querySelector(`details[data-space-id="${id}"]`); } catch {}
      if (!target) {
        target = Array.from(dbView.querySelectorAll('details[data-space-id]')).find(d => (d.dataset.spaceId || '') === String(id));
      }
      if (target) {
        target.open = true;
        // Open nested transform sections as well
        try { target.querySelectorAll('details[data-section]').forEach(sec => { sec.open = true; }); } catch {}
        try { target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { target.scrollIntoView(); }
        // Flash highlight the target for a moment
        try {
          target.classList.add('flash-highlight');
          setTimeout(() => target.classList.remove('flash-highlight'), 1300);
        } catch {}
      }
    } catch (err) { Log.log('ERROR', 'Open DB to space failed', { id, error: String(err) }); }
  });
}
