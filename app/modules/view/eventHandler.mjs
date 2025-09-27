import { saveBarrow, snapshot } from '../barrow/store.mjs';
import { VoxelType, decompressVox } from '../voxels/voxelize.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { Log } from '../util/log.mjs';
import { renderDbView } from './dbView.mjs';
import { initErrorBar } from './errorBar.mjs';
import { initDbUiHandlers } from './handlers/ui/db.mjs';
import { initGizmoHandlers, initTransformGizmos } from './handlers/gizmo.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initPanelUI } from './handlers/ui/panel.mjs';
import { initSelectionUI } from './handlers/ui/selection.mjs';
import { initTabsUI } from './handlers/ui/tabs.mjs';

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
  // Gizmo integration placeholders (populated by handlers/gizmo.mjs)
  let _gizmosSuppressed = false;
  let _gizmo = null;
  let setGizmoHudVisible = (v) => {};
  let renderGizmoHud = () => {};
  let suppressGizmos = (on) => { _gizmosSuppressed = !!on; };
  // Move gizmo stubs until gizmo API is bound
  let moveWidget = { dragging: false, preDrag: false, axis: null };
  let ensureMoveWidget = () => {};
  let disposeMoveWidget = () => {};
  let _GIZMO_DCLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  // ——————————— Error banner ———————————
  try { initErrorBar(Log); } catch {}
  // Unified input logging helpers
  function inputLog(kind, msg, data = {}) { try { Log.log('INPUT', `${kind}:${msg}`, data); } catch {} }
  function modsOf(ev) {
    return {
      cmd: !!(ev && ev.metaKey),
      ctrl: !!(ev && ev.ctrlKey),
      shift: !!(ev && ev.shiftKey),
      alt: !!(ev && ev.altKey)
    };
  }
  function comboName(button, mods) {
    const parts = [];
    if (mods?.cmd) parts.push('cmd');
    if (mods?.ctrl) parts.push('ctrl');
    if (mods?.shift) parts.push('shift');
    if (mods?.alt) parts.push('alt');
    const btn = (button === 2) ? 'RC' : (button === 1) ? 'MC' : 'LC';
    parts.push(btn);
    return parts.join('-');
  }

  // ——————————— Camera target helpers ———————————
  function getSelectionCenter() {
    try {
      const ids = Array.from(state.selection || []);
      if (!ids.length) return null;
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      const entries = builtSpaces.filter(x => ids.includes(x.id)); if (!entries.length) return null;
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
  function getVoxelPickWorldCenter() {
    try {
      // Prefer the last pick remembered globally
      let pid = null, px = null, py = null, pz = null;
      if (state && state.lastVoxPick && state.lastVoxPick.id) {
        pid = state.lastVoxPick.id; px = state.lastVoxPick.x; py = state.lastVoxPick.y; pz = state.lastVoxPick.z;
      } else {
        const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
        if (!picks.length) return null;
        const p = picks[picks.length - 1]; pid = p.id; px = p.x; py = p.y; pz = p.z;
      }
      const s = (state?.barrow?.spaces || []).find(x => x && x.id === pid);
      if (!s || !s.vox || !s.vox.size) return null;
      const vox = s.vox;
      const nx = Math.max(1, vox.size?.x || 1);
      const ny = Math.max(1, vox.size?.y || 1);
      const nz = Math.max(1, vox.size?.z || 1);
      const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
      const minX = -(nx * res) / 2, minY = -(ny * res) / 2, minZ = -(nz * res) / 2;
      const lx = minX + (px + 0.5) * res;
      const ly = minY + (py + 0.5) * res;
      const lz = minZ + (pz + 0.5) * res;
      const worldAligned = !!(vox && vox.worldAligned);
      let v = new BABYLON.Vector3(lx, ly, lz);
      if (!worldAligned) {
        const rx = Number(s.rotation?.x ?? 0) || 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
        const rz = Number(s.rotation?.z ?? 0) || 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero());
        v = BABYLON.Vector3.TransformCoordinates(v, m);
      }
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      v.x += cx; v.y += cy; v.z += cz;
      return v;
    } catch { return null; }
  }

  // Center for Proposed Path (PP) gizmo: center on selected PP nodes/segments or whole path
  function getConnectSelectionCenter() {
    try {
      const path = (state && state._connect && Array.isArray(state._connect.path)) ? state._connect.path : [];
      const sel = (state && state._connect && state._connect.sel) ? Array.from(state._connect.sel) : [];
      if (!path || path.length < 2) return null;
      if (sel && sel.length) {
        let cx=0, cy=0, cz=0, n=0;
        for (const sid of sel) {
          const s = String(sid||'');
          if (s.startsWith('connect:node:')) {
            const i = Number(s.split(':').pop()); const p = path[i]; if (!p) continue; cx+=p.x; cy+=p.y; cz+=p.z; n++;
          } else if (s.startsWith('connect:seg:')) {
            const i = Number(s.split(':').pop()); const p0 = path[i], p1 = path[i+1]; if (!p0||!p1) continue; cx += (p0.x+p1.x)/2; cy += (p0.y+p1.y)/2; cz += (p0.z+p1.z)/2; n++;
          }
        }
        if (n>0) return new BABYLON.Vector3(cx/n, cy/n, cz/n);
      }
      // Fallback to whole path AABB center
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
      for (const p of path) { if (!p) continue; if (p.x<minX)minX=p.x; if (p.y<minY)minY=p.y; if (p.z<minZ)minZ=p.z; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; if(p.z>maxZ)maxZ=p.z; }
      if (!isFinite(minX)) return null;
      return new BABYLON.Vector3((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2);
    } catch { return null; }
  }

  // ——— Controls and elements ———
  const toggleRunBtn = document.getElementById('toggleRun');
  // DB tab (reset/export/import) elements are handled in handlers/ui/db.mjs

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
  const sizeLockEl = document.getElementById('sizeLock');
  const showNamesCb = document.getElementById('showNames');
  const gridGroundCb = document.getElementById('gridGround');
  const gridXYCb = document.getElementById('gridXY');
  const gridYZCb = document.getElementById('gridYZ');
  const axisArrowsCb = document.getElementById('axisArrows');
  const resizeGridBtn = document.getElementById('resizeGrid');

  const panel = document.getElementById('rightPanel');
  const collapsePanelBtn = document.getElementById('collapsePanel');

  // Panel resizer/collapse handled in ui/panel.mjs

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

  // ——————————— Proportional size linking ———————————
  (function setupProportionalSize(){
    if (!sizeXEl || !sizeYEl || !sizeZEl) return;
    // Persist setting
    try { if (sizeLockEl) sizeLockEl.checked = readBool('dw:ui:sizeProp', false); } catch {}
    sizeLockEl?.addEventListener('change', () => { writeBool('dw:ui:sizeProp', !!sizeLockEl.checked); });
    // Track last values to compute scale factors
    let last = {
      x: Number(sizeXEl.value||'0')||0,
      y: Number(sizeYEl.value||'0')||0,
      z: Number(sizeZEl.value||'0')||0
    };
    let reentrant = false;
    function clamp(v){ v = Math.round(Number(v)||0); return Math.max(1, v); }
    function handle(axis){
      if (reentrant) return;
      const locked = !!sizeLockEl?.checked;
      const cur = {
        x: clamp(sizeXEl.value),
        y: clamp(sizeYEl.value),
        z: clamp(sizeZEl.value)
      };
      if (!locked) { last = cur; return; }
      let base = last[axis] || 1;
      if (!isFinite(base) || base <= 0) base = 1;
      const nowVal = cur[axis];
      const scale = nowVal / base;
      if (!isFinite(scale) || scale <= 0) { last = cur; return; }
      const nx = clamp(last.x * scale);
      const ny = clamp(last.y * scale);
      const nz = clamp(last.z * scale);
      reentrant = true;
      if (axis !== 'x') sizeXEl.value = String(nx);
      if (axis !== 'y') sizeYEl.value = String(ny);
      if (axis !== 'z') sizeZEl.value = String(nz);
      reentrant = false;
      last = {
        x: clamp(sizeXEl.value),
        y: clamp(sizeYEl.value),
        z: clamp(sizeZEl.value)
      };
      // Persist to current selection for the axes we auto-updated
      try {
        const sel = Array.from(state.selection || []);
        if (sel.length > 0) {
          if (axis !== 'x') applySizeField('x', sizeXEl.value);
          if (axis !== 'y') applySizeField('y', sizeYEl.value);
          if (axis !== 'z') applySizeField('z', sizeZEl.value);
        }
      } catch {}
    }
    sizeXEl.addEventListener('input', () => handle('x'));
    sizeYEl.addEventListener('input', () => handle('y'));
    sizeZEl.addEventListener('input', () => handle('z'));
    // Keep baseline in sync when external code updates fields after selection/transform
    function syncLast(){
      last = {
        x: clamp(sizeXEl.value),
        y: clamp(sizeYEl.value),
        z: clamp(sizeZEl.value)
      };
    }
    try { window.addEventListener('dw:selectionChange', syncLast); } catch {}
    try { window.addEventListener('dw:dbEdit', syncLast); } catch {}
    try { window.addEventListener('dw:transform', syncLast); } catch {}
  })();

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

  // Gizmo HUD + suppression now provided by handlers/gizmo.mjs

  // ——————————— Cavern Mode + Scry Ball ———————————
  // Keep a reference to the scry ball and view state so we can restore War Room View
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  /* BEGIN moved to handlers/scry.mjs and handlers/cavern.mjs */
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
      m.material = mat; m.isPickable = true; m.renderingGroupId = 3;
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
      // Place scry ball: prefer saved position for this space, else center-most empty voxel (or solid fallback)
      let pos = null;
      try {
        const key = 'dw:scry:pos:' + s.id;
        const saved = localStorage.getItem(key);
        if (saved) {
          const o = JSON.parse(saved);
          if (o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z)) pos = new BABYLON.Vector3(o.x, o.y, o.z);
        }
      } catch {}
      if (!pos) pos = findScryWorldPosForSpace(s) || new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
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
      // Exit scryball mode if active
      try { exitScryMode(); } catch {}
      sLog('cm:exit', {});
      // Restore opacities and view mode
      try {
        const defWall = '60', defRock = '85';
        const prevWall = (state._scry.prevWallOpacity != null) ? state._scry.prevWallOpacity : defWall;
        const prevRock = (state._scry.prevRockOpacity != null) ? state._scry.prevRockOpacity : defRock;
        localStorage.setItem('dw:ui:wallOpacity', prevWall);
        localStorage.setItem('dw:ui:rockOpacity', prevRock);
      } catch {}
      try { localStorage.setItem('dw:viewMode', 'war'); } catch {}
      try { rebuildScene(); } catch (e) { logErr('EH:rebuildScene:war', e); }
      // Clear saved prevs to avoid leaking across sessions
      try { state._scry.prevWallOpacity = null; state._scry.prevRockOpacity = null; } catch {}
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
  /* END moved */

  // ——————————— Scryball Mode ———————————
  function voxelValueAtWorld(space, wx, wy, wz) {
    try { return _vox?.voxelValueAtWorld?.(space, wx, wy, wz); } catch { return VoxelType.Uninstantiated; }
  }

  // Helper: perform voxel pick at current pointer for a given space and dispatch dw:voxelPick
  function doVoxelPickAtPointer(s) {
    try {
      if (!s || !s.vox || !s.vox.size) return;
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
      let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
      const yCut = ny - hideTop;
      const data = Array.isArray(vox.data) ? vox.data : [];
      let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
      while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
        if (iy < yCut) {
          const flat = ix + nx * (iy + ny * iz);
          const v = data[flat] ?? VoxelType.Uninstantiated;
          if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
            try { s.voxPick = { x: ix, y: iy, z: iz, v }; } catch {}
            try {
              const worldAligned = !!(s.vox && s.vox.worldAligned);
              const rx = Number(s.rotation?.x || 0), ry = (typeof s.rotation?.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0, rz = Number(s.rotation?.z || 0);
              const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
              const lx = (ix + 0.5) * res - centerX;
              const ly = (iy + 0.5) * res - centerY;
              const lz = (iz + 0.5) * res - centerZ;
              sLog('voxelPick:hit', { id: s.id, i: ix, j: iy, k: iz, v, worldAligned, rot: { rx, ry, rz }, local: { lx, ly, lz } });
            } catch {}
            try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: ix, j: iy, k: iz, v } })); } catch {}
            return;
          }
        }
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
        else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
        else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
      }
    } catch (e) { logErr('EH:doVoxelPick', e); }
  }

  // Helper: compute first solid voxel hit under current pointer for space (without side effects)
  // Returns { hit:true, t, ix, iy, iz, v } or null
  function voxelHitAtPointerForSpace(s) {
    try {
      if (!s || !s.vox || !s.vox.size) return null;
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
      if (!(tmax >= Math.max(0, tmin))) return null;
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
            return { hit: true, t, ix, iy, iz, v };
          }
        }
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
        else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
        else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
      }
      return null;
    } catch { return null; }
  }

  function enterScryMode() {
    try {
      if (state.mode !== 'cavern') return;
      const ball = state._scry?.ball; if (!ball) return;
      state._scry.scryMode = true;
      Log.log('SCRY', 'enter', {});
      // Disable camera keyboard controls so arrows don't tilt/rotate the camera
      try {
        state._scry._camKeys = {
          up: (camera.keysUp || []).slice(),
          down: (camera.keysDown || []).slice(),
          left: (camera.keysLeft || []).slice(),
          right: (camera.keysRight || []).slice()
        };
        camera.keysUp = [];
        camera.keysDown = [];
        camera.keysLeft = [];
        camera.keysRight = [];
      } catch {}
      // Visual glow via highlight layer + outline
      try { if (state.hl && state._scry?.ball) { state.hl.addMesh(state._scry.ball, new BABYLON.Color3(0.4, 0.85, 1.0)); } } catch {}
      try {
        if (state._scry?.ball) {
          state._scry.ball.outlineColor = new BABYLON.Color3(0.35, 0.9, 1.0);
          state._scry.ball.outlineWidth = 0.02;
          state._scry.ball.renderOutline = true;
        }
      } catch {}
      // Keep camera locked to the scry ball
      try {
        if (state._scry.scryObs) { engine.onBeginFrameObservable.remove(state._scry.scryObs); state._scry.scryObs = null; }
        state._scry.scryObs = engine.onBeginFrameObservable.add(() => {
          try {
            if (state._scry?.ball) {
              // Lock camera on scry ball
              camera.target.copyFrom(state._scry.ball.position);
              // Apply rotate + move per frame based on keyState
              try {
                const ks = state._scry.keyState || {};
                const dt = (engine.getDeltaTime ? engine.getDeltaTime()/1000 : 1/60);
                const s = (state?.barrow?.spaces || []).find(x => x && x.id === state._scry.spaceId);
                if (s) {
                  // Rotation
                  if (ks.left || ks.right) {
                    const degPerSec = ks.shift ? 120 : 60;
                    const dirYaw = ks.left ? 1 : -1; // CCW for left
                    const delta = (degPerSec * Math.PI / 180) * dirYaw * dt;
                    camera.alpha = (camera.alpha + delta) % (Math.PI * 2);
                    if (camera.alpha < 0) camera.alpha += Math.PI * 2;
                  }
                  // Movement (Meta+Up/Down = vertical Y, Up/Down = ground-plane forward/back)
                  const moveSign = (ks.up ? 1 : 0) + (ks.down ? -1 : 0);
                  if (moveSign !== 0) {
                    const ball2 = state._scry.ball;
                    const pos = ball2.position.clone();
                    const isVert = !!ks.meta;
                    let dir;
                    if (isVert) {
                      dir = new BABYLON.Vector3(0, moveSign, 0);
                    } else {
                      const fwd = camera.getForwardRay()?.direction.clone() || new BABYLON.Vector3(0,0,1);
                      fwd.y = 0; try { fwd.normalize(); } catch {}
                      dir = fwd.scale(moveSign);
                    }
                    const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
                    let scryMult = 1.0; try { const raw = Number(localStorage.getItem('dw:ui:scrySpeed') || '100'); if (isFinite(raw) && raw > 0) scryMult = (raw > 5) ? (raw/100) : raw; } catch {}
                    const base = (isVert ? Math.max(0.06, res * 0.6) : Math.max(0.1, res * 0.9) * 2) * (ks.shift ? 2.0 : 1.0) * scryMult;
                    const dist = base * Math.max(0.016, dt) * (isVert ? 3 : 6);
                    const seg  = Math.max(isVert ? 0.04 : 0.08, res * (isVert ? 0.15 : 0.25));
                    const radius = Math.max(0.15, (res * 0.8) / 2);
                    const nSteps = Math.max(1, Math.ceil(dist / seg));
                    const inc = dir.scale(dist / nSteps);
                    function canOccupy(px, py, pz) {
                      const offsets = [ {x:0,z:0}, {x:radius*0.5,z:0}, {x:-radius*0.5,z:0}, {x:0,z:radius*0.5}, {x:0,z:-radius*0.5} ];
                      for (const o of offsets) {
                        const hit = (() => { try { const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : []; for (const sp of spaces) { if (!sp || !sp.vox) continue; const v = voxelValueAtWorld(sp, px + o.x, py, pz + o.z); if (v === VoxelType.Rock || v === VoxelType.Wall) return true; } return false; } catch { return false; } })();
                        if (hit) return false;
                      }
                      return true;
                    }
                    let next = pos.clone(); let blocked = false;
                    for (let i = 0; i < nSteps; i++) {
                      const cand = next.add(inc);
                      if (canOccupy(cand.x, cand.y, cand.z)) { next.copyFrom(cand); }
                      else { blocked = true; break; }
                    }
                    if (!next.equals(pos)) {
                      ball2.position.copyFrom(next); camera.target.copyFrom(next);
                      // Persist per-space scry position (throttled)
                      try {
                        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        const lastT = state._scry._lastSaveT || 0;
                        if (now - lastT > 120) {
                          state._scry._lastSaveT = now;
                          const key = 'dw:scry:pos:' + state._scry.spaceId;
                          localStorage.setItem(key, JSON.stringify({ x: next.x, y: next.y, z: next.z }));
                        }
                      } catch {}
                    }
                    if (blocked) { try { Log.log('COLLIDE', 'scry:block', { from: pos, to: next, vert: isVert }); } catch {} }
                  }
                }
              } catch {}
              // Constrain camera position by walls/rock in the active space
              const s = (state?.barrow?.spaces || []).find(x => x && x.id === state._scry.spaceId);
              if (s && s.vox) {
                const t = camera.target;
                const cp = camera.position.clone();
                const v = cp.subtract(t);
                const dist = v.length();
                if (dist > 1e-3) {
                  v.scaleInPlace(1 / dist); // v = dir from target to camera
                  const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
                  const step = Math.max(0.15, res * 0.25);
                  let maxFree = dist;
                  let hit = false;
                  for (let d = step; d <= dist; d += step) {
                    const p = new BABYLON.Vector3(t.x + v.x * d, t.y + v.y * d, t.z + v.z * d);
                    // Clamp if any space has solid at this sample point
                    let hitAny = false; try { const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : []; for (const sp of spaces) { if (!sp || !sp.vox) continue; const vv = voxelValueAtWorld(sp, p.x, p.y, p.z); if (vv === VoxelType.Rock || vv === VoxelType.Wall) { hitAny = true; break; } } } catch {}
                    if (hitAny) {
                      hit = true; maxFree = Math.max(step * 0.5, d - step * 0.6); break;
                    }
                  }
                  if (hit && maxFree < dist - 1e-3) {
                    camera.inertialRadiusOffset = 0;
                    camera.radius = Math.max(0.5, maxFree);
                    // Throttled collision log
                    try {
                      const now = performance.now ? performance.now() : Date.now();
                      state._scry._collLogT = state._scry._collLogT || 0;
                      if (now - state._scry._collLogT > 180) {
                        state._scry._collLogT = now;
                        Log.log('COLLIDE', 'cam:clamp', { desired: dist, clamped: camera.radius, step });
                      }
                    } catch {}
                  }
                }
              }
            }
          } catch {}
        });
      } catch {}
      // Track keys for simultaneous rotate + move; handled per-frame in scryObs
      state._scry.keyState = { up:false, down:false, left:false, right:false, shift:false, meta:false };
      try { if (state._scry.scryKeys) window.removeEventListener('keydown', state._scry.scryKeys); } catch {}
      try { if (state._scry.scryKeysUp) window.removeEventListener('keyup', state._scry.scryKeysUp); } catch {}
      state._scry.scryKeys = (e) => {
        if (!state._scry?.scryMode) return;
        const k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Shift' || k === 'Meta') {
          e.preventDefault(); e.stopPropagation();
          if (k === 'ArrowUp') state._scry.keyState.up = true;
          if (k === 'ArrowDown') state._scry.keyState.down = true;
          if (k === 'ArrowLeft') state._scry.keyState.left = true;
          if (k === 'ArrowRight') state._scry.keyState.right = true;
          if (k === 'Shift') state._scry.keyState.shift = true;
          if (k === 'Meta') state._scry.keyState.meta = true;
        }
      };
      state._scry.scryKeysUp = (e) => {
        if (!state._scry?.scryMode) return;
        const k = e.key;
        if (k === 'ArrowUp') state._scry.keyState.up = false;
        if (k === 'ArrowDown') state._scry.keyState.down = false;
        if (k === 'ArrowLeft') state._scry.keyState.left = false;
        if (k === 'ArrowRight') state._scry.keyState.right = false;
        if (k === 'Shift') state._scry.keyState.shift = false;
        if (k === 'Meta') { state._scry.keyState.meta = false; state._scry.keyState.up = false; state._scry.keyState.down = false; }
      };
      window.addEventListener('keydown', state._scry.scryKeys, { passive:false });
      window.addEventListener('keyup', state._scry.scryKeysUp, { passive:false });
      // Safety: clear modifier/key state on window blur to avoid sticky movement
      try {
        if (state._scry._onBlur) window.removeEventListener('blur', state._scry._onBlur);
        state._scry._onBlur = () => { try { state._scry.keyState = { up:false, down:false, left:false, right:false, shift:false, meta:false }; } catch {} };
        window.addEventListener('blur', state._scry._onBlur);
      } catch {}
    } catch (e) { logErr('EH:enterScry', e); }
  }

  function exitScryMode() {
    try {
      if (!state._scry?.scryMode) return;
      // Persist final scry position for this space
      try {
        const id = state._scry.spaceId;
        const b = state._scry.ball;
        if (id && b && !b.isDisposed()) {
          const key = 'dw:scry:pos:' + id;
          localStorage.setItem(key, JSON.stringify({ x: b.position.x, y: b.position.y, z: b.position.z }));
        }
      } catch {}
      state._scry.scryMode = false;
      try { if (state._scry.scryObs) { engine.onBeginFrameObservable.remove(state._scry.scryObs); state._scry.scryObs = null; } } catch {}
      try { if (state._scry.scryKeys) { window.removeEventListener('keydown', state._scry.scryKeys); state._scry.scryKeys = null; } } catch {}
      // Restore camera keyboard controls
      try {
        if (state._scry._camKeys) {
          camera.keysUp = state._scry._camKeys.up || camera.keysUp;
          camera.keysDown = state._scry._camKeys.down || camera.keysDown;
          camera.keysLeft = state._scry._camKeys.left || camera.keysLeft;
          camera.keysRight = state._scry._camKeys.right || camera.keysRight;
          state._scry._camKeys = null;
        }
      } catch {}
      // Remove glow
      try { if (state.hl && state._scry?.ball) state.hl.removeMesh(state._scry.ball); } catch {}
      try { if (state._scry?.ball) state._scry.ball.renderOutline = false; } catch {}
      Log.log('SCRY', 'exit', {});
    } catch (e) { logErr('EH:exitScry', e); }
  }

  // Double-click on scry ball enters scry mode
  try {
    scene.onPointerObservable.add((pi) => {
      try {
        if (pi.type !== BABYLON.PointerEventTypes.POINTERDOUBLETAP) return;
        if (state.mode !== 'cavern') return;
        const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'scryBall');
        if (pick?.hit && pick.pickedMesh && pick.pickedMesh.name === 'scryBall') enterScryMode();
      } catch {}
    });
  } catch {}

  // Manual grid resize to fit all spaces
  resizeGridBtn?.addEventListener('click', () => {
    try { helpers.updateGridExtent?.(); } catch (e) { logErr('EH:updateGridExtent', e); }
    Log.log('UI', 'Resize Grid', {});
  });

  // Reset/Export/Import moved to handlers/ui/db.mjs

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
function disposeRotWidget() {
    try { _gizmo?.disposeRotWidget?.(); } catch {}
  }
function ensureRotWidget() {
      try { _gizmo?.ensureRotWidget?.(); } catch {}
  }

function updateRotWidgetFromMesh(mesh) {
    try { _gizmo?.updateRotWidgetFromMesh?.(mesh); } catch {}
  }
  function pickPointOnYPlane(y) { return pickPointOnPlane(new BABYLON.Vector3(1e-30,1,1e-30), new BABYLON.Vector3(0,y,0)); }
function pickPointOnPlane(normal, point) {
    try { return _gizmo?.pickPointOnPlane?.(normal, point) || null; } catch { return null; }
  }
  function getSelectedSpaceAndMesh() {
    const sel = Array.from(state.selection || []);
    if (sel.length !== 1) return { space: null, mesh: null, id: null };
    const id = sel[0];
    const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || null;
    const space = (state?.barrow?.spaces || []).find(x => x.id === id) || null;
    return { space, mesh, id };
  }

  // Utility: axis-aligned bounds for a space in world coordinates
  function aabbForSpace(space) {
    const res = (space?.res || (state.barrow?.meta?.voxelSize || 1));
    const w = Math.max(0, (space?.size?.x || 0) * res);
    const h = Math.max(0, (space?.size?.y || 0) * res);
    const d = Math.max(0, (space?.size?.z || 0) * res);
    const cx = space?.origin?.x || 0, cy = space?.origin?.y || 0, cz = space?.origin?.z || 0;
    return { min:{x:cx-w/2,y:cy-h/2,z:cz-d/2}, max:{x:cx+w/2,y:cy+h/2,z:cz+d/2} };
  }

  // ——————————— Live intersection preview moved to gizmo ———————————

  // ——————————— Contact shadow (moved to gizmo) ———————————
  function updateContactShadowPlacement() { try { _gizmo?.updateContactShadowPlacement?.(); } catch {} }
  function disposeContactShadow() { try { _gizmo?.disposeContactShadow?.(); } catch {} }
  function disposeLiveIntersections(){ try { _gizmo?.disposeLiveIntersections?.(); } catch {} }
  function updateLiveIntersectionsFor(selectedId){ try { _gizmo?.updateLiveIntersectionsFor?.(selectedId); } catch {} }

  // Update selection OBB lines live (dispose and rebuild for selected ids)
  function updateSelectionObbLive() { try { _gizmo?.updateSelectionObbLive?.(); } catch {} }

  // Update move disc position to follow current selection bottom and center
  // updateMoveDiscPlacement is now internal to gizmo

  // ——————————— Move widget moved to gizmo ———————————

  // Pointer interactions for rotation widget
  let _lastGizmoClick = 0;
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
      // Detect double-click on scry ball using the same threshold as edit double-click
      try {
        const pickBall = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'scryBall');
        if (pickBall?.hit && pickBall.pickedMesh) {
          const now = performance.now();
          const last = state._scry?.lastClickTime || 0;
          if ((now - last) <= DOUBLE_CLICK_MS) { enterScryMode(); state._scry.lastClickTime = 0; return; }
          state._scry.lastClickTime = now; return;
        }
      } catch (e) { logErr('EH:cm:pickBall', e); }
      // Always attempt a voxel pick for the space under the pointer (does not depend on selection)
      let _pointerSpaceId = null;
      try {
        const spacePick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && m.name.startsWith('space:'));
        if (spacePick?.hit && spacePick.pickedMesh) {
          const pickedName = String(spacePick.pickedMesh.name||'');
          _pointerSpaceId = pickedName.slice('space:'.length).split(':')[0];
          const s = (state?.barrow?.spaces || []).find(x => x && x.id === _pointerSpaceId);
          if (s && s.vox && s.vox.size) doVoxelPickAtPointer(s);
        }
      } catch (e) { logErr('EH:cm:voxelPickUnderPointer', e); }
      try {
        const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
        if (!isLeft) return;
        // Resolve active space: prefer the space under the pointer, then scry focus, then selection
        const sid = _pointerSpaceId || state._scry?.spaceId || (Array.from(state.selection || [])[0] || null);
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
    // Widget interactions (edit mode) are now handled in handlers/gizmo.mjs
    return;
    
  });

  // Live voxel hover moved to handlers/voxel.mjs; legacy listener disabled
  // Live voxel hover handled in voxel handlers (legacy removed)

  // Global pointerup failsafe (release outside canvas) — only handles voxel brush here
  window.addEventListener('pointerup', () => {
    try {
      if (voxBrush.active) {
        voxBrush.active = false; voxBrush.pointerId = null; voxBrush.lastAt = 0;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        try { inputLog('pointer', 'brush:end', {}); } catch {}
        try { setTimeout(() => { try { scene.render(); } catch {} }, 0); } catch {}
      }
    } catch {}
  }, { passive: true });

  // ——————————— Pointer selection & double-click ———————————
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  let lastPickName = null;
  let lastPickTime = 0;
  // Voxel brush-drag state (left mouse held while painting voxels)
  const _VOX_BRUSH_THROTTLE_MS = 16; // ~60 Hz
  let voxBrush = { active: false, lastAt: 0, pointerId: null };
function setRingsDim() { try { _gizmo?.setRingsDim?.(); } catch {} }
function setRingActive(axis) { try { _gizmo?.setRingActive?.(axis); } catch {} }

  // Keyboard logging (arrows + modifiers) without changing behavior
  ;(function setupKeyboardLogging(){
    try {
      function keyCombo(e){
        const mods = modsOf(e);
        const parts = [];
        if (mods.cmd) parts.push('cmd');
        if (mods.ctrl) parts.push('ctrl');
        if (mods.shift) parts.push('shift');
        if (mods.alt) parts.push('alt');
        parts.push(String(e.key||''));
        return parts.join('-');
      }
      function onKeyDown(e){
        try {
          if (!e || typeof e.key !== 'string') return;
          if (e.key.startsWith('Arrow')) {
            const inScry = !!(state?._scry?.scryMode);
            const decision = inScry ? 'scry:drive' : 'none';
            inputLog('keyboard', 'arrow', { combo: keyCombo(e), decision });
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            inputLog('keyboard', 'delete', { combo: keyCombo(e), selection: Array.from(state?.selection||[]) });
          }
        } catch {}
      }
      window.addEventListener('keydown', onKeyDown, { capture: true });
    } catch {}
  })();
  // Brush-select: while left mouse held after an initial voxel pick, keep adding voxels under the cursor
  // Pre-pointer capture: in Cavern mode, claim LMB early to prevent camera rotation; otherwise just observe
  ;(function setupPreVoxelBrushCapture(){
    try {
      scene.onPrePointerObservable.add((pi) => {
        try {
          if (state.mode !== 'edit' && state.mode !== 'cavern') return;
          if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
          if (_gizmosSuppressed || rotWidget.dragging || moveWidget.dragging) return;
          const ev = pi.event || window.event;
          const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
          const isCmd = !!(ev && ev.metaKey);
          const isShift = !!(ev && ev.shiftKey);
          const isCtrl = !!(ev && ev.ctrlKey);
          const isAlt = !!(ev && ev.altKey);
          const _mods = modsOf(ev);
          inputLog('pointer', 'down-capture', { combo: comboName(ev?.button, _mods), pointerType: ev?.pointerType || 'mouse', x: scene.pointerX, y: scene.pointerY });
          // In Cavern mode: start brush immediately on plain left click over a voxel to prevent camera rotation
          if (state.mode === 'cavern') {
            if (!isLeft) return;
            if (isCmd || isCtrl || isAlt) return; // respect modifier behaviors
            // Do not start brush if clicking the scry ball
            try {
              const pickScry = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'scryBall');
              if (pickScry?.hit) return;
            } catch {}
            // Do not start brush if clicking a gizmo
            try {
              const onGizmo = (() => {
                const g1 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
                const g2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
                return !!(g1?.hit || g2?.hit);
              })();
              if (onGizmo) return;
            } catch {}
            // Find nearest voxel hit among all spaces
            let vBest = null;
            try {
              for (const sp of (state?.barrow?.spaces || [])) {
                if (!sp || !sp.vox || !sp.vox.size) continue;
                const hit = voxelHitAtPointerForSpace(sp);
                if (hit && isFinite(hit.t) && (vBest == null || hit.t < vBest.t)) vBest = { ...hit, id: sp.id };
              }
            } catch {}
            if (!vBest) return;
            // Begin brush: detach camera pointers and capture pointer, update voxel selection
            try {
              const canvas = engine.getRenderingCanvas();
              camera.inputs?.attached?.pointers?.detachControl(canvas);
              if (ev && ev.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
            } catch {}
            voxBrush.active = true; voxBrush.pointerId = ev && ev.pointerId != null ? ev.pointerId : null; voxBrush.lastAt = 0;
            try {
              const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
              state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
              if (isShift) {
                if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
              } else {
                state.voxSel = [{ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v }];
              }
              rebuildHalos();
            } catch {}
            inputLog('pointer', 'brush:start', { combo: comboName(ev?.button, _mods), id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, add: !!isShift });
            // Stop downstream processing (camera + other observers)
            try { ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
            try { pi.skipOnPointerObservable = true; } catch {}
            return;
          }
          // In Edit mode: do not start brush here; main handler will manage selection, double-click, and brush
        } catch {}
      });
    } catch {}
  })();

  // ——————————— View (camera) manipulations moved to handlers/view.mjs ———————————
  try { initViewManipulations({ scene, engine, camera, state, helpers: { getSelectionCenter, getVoxelPickWorldCenter } }); } catch (e) { logErr('EH:view:init', e); }

  // ——————————— Gizmo pre-capture moved to handlers/gizmo.mjs ———————————
  try { initGizmoHandlers({ scene, engine, camera, state }); } catch (e) { logErr('EH:gizmo:init', e); }
  // Bind transform gizmo API (rotate/move) from module into local names
  try {
    const giz = initTransformGizmos({
      scene, engine, camera, state,
      renderDbView,
      saveBarrow, snapshot, scheduleGridUpdate, rebuildScene,
      helpers: { updateContactShadowPlacement, updateSelectionObbLive, updateLiveIntersectionsFor }
    });
    // Bind state and core APIs
    _gizmo = giz;
    rotWidget = giz.rotWidget; moveWidget = giz.moveWidget;
    disposeRotWidget = giz.disposeRotWidget; ensureRotWidget = giz.ensureRotWidget;
    disposeMoveWidget = giz.disposeMoveWidget; ensureMoveWidget = giz.ensureMoveWidget;
    pickPointOnPlane = giz.pickPointOnPlane; setRingsDim = giz.setRingsDim; setRingActive = giz.setRingActive;
    updateRotWidgetFromMesh = giz.updateRotWidgetFromMesh; _GIZMO_DCLICK_MS = giz._GIZMO_DCLICK_MS;
    // Wrap HUD + suppression to keep local suppressed flag in sync
    const __setGizmoHudVisible = giz.setGizmoHudVisible;
    const __renderGizmoHud = giz.renderGizmoHud;
    const __suppressGizmos = giz.suppressGizmos;
    setGizmoHudVisible = (v) => { try { __setGizmoHudVisible(v); } catch {} };
    renderGizmoHud = (opts) => { try { __renderGizmoHud(opts||{}); } catch {} };
    suppressGizmos = (on) => { _gizmosSuppressed = !!on; try { __suppressGizmos(on); } catch {} };
    try { window.addEventListener('dw:gizmos:disable', () => suppressGizmos(true)); window.addEventListener('dw:gizmos:enable', () => suppressGizmos(false)); } catch {}
  } catch (e) { logErr('EH:gizmo:bind', e); }

  // ——————————— Voxel helpers init (hover + helpers) ———————————
  let _vox = null;
  try {
    _vox = initVoxelHandlers({ scene, engine, camera, state });
    _vox.initVoxelHover({ isGizmoBusy: () => { try { return !!(rotWidget?.dragging || moveWidget?.dragging); } catch { return false; } } });
  } catch (e) { logErr('EH:voxel:init', e); }

  // Selection UI side-effects moved to handlers/ui/selection.mjs
  try { initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget, ensureMoveWidget }); } catch {}

  // Brush-select: while left mouse held after an initial voxel pick, keep adding voxels under the cursor
  scene.onPointerObservable.add((pi) => {
    try {
      if (!voxBrush.active) return;
      if (pi.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;
      const now = performance.now ? performance.now() : Date.now();
      if (now - voxBrush.lastAt < _VOX_BRUSH_THROTTLE_MS) return;
      voxBrush.lastAt = now;
      // Find nearest voxel hit among all spaces
      let vBest = null;
      try {
        for (const sp of (state?.barrow?.spaces || [])) {
          if (!sp || !sp.vox || !sp.vox.size) continue;
          const hit = voxelHitAtPointerForSpace(sp);
          if (hit && isFinite(hit.t) && (vBest == null || hit.t < vBest.t)) vBest = { ...hit, id: sp.id };
        }
      } catch {}
      if (!vBest) return;
      const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
      state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
      if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) {
        state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
        // Redraw halos to reflect growing voxel selection
        try { rebuildHalos(); } catch {}
      }
      // Block camera rotation while brushing (already detached on start), also stop further pointer processing
      try { const ev = pi.event; ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
      try { pi.skipOnPointerObservable = true; } catch {}
    } catch {}
  });
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
    // Normalize button/modifiers once up front
    const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
    const isCmd = !!(ev && ev.metaKey);
    const isShift = !!(ev && ev.shiftKey);
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
      // No mesh hit
      if (isLeft) {
        // LC on empty: clear selection
        try { state.selection.clear(); } catch {}
        try { rebuildHalos(); } catch {}
        try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
        try { inputLog('pointer', 'select:deselectAll', { combo: comboName(ev?.button, modsOf(ev)), via: isCmd ? 'cmd-left-empty' : 'left-empty' }); } catch {}
      } else {
        try { inputLog('pointer', 'noHit:ignore', { combo: comboName(ev?.button, modsOf(ev)) }); } catch {}
      }
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
    // Cmd-Click selection (ignore gizmo/PP; operate on spaces)
    if (isCmd && isLeft) {
      if (name.startsWith('space:')) {
        if (isShift) {
          if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
        } else {
          state.selection.clear(); state.selection.add(id);
        }
        try { rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); } catch {}
        try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      }
      return;
    }
    dPick('selectId', { id, name });
    // Only compute voxel pick for plain LC (Cmd ignored per spec)
    sLog('edit:selectId', { id, name });
    // Double-click detection before handling plain-left voxel selection
    {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (name === lastPickName && (now - lastPickTime) <= DOUBLE_CLICK_MS) {
        dPick('doubleClick', { name, id });
        sLog('edit:doubleClick', { name, id });
        // Double-click enters Cavern Mode for spaces
        if (name.startsWith('space:')) {
          try { enterCavernModeForSpace(id); } catch {}
        } else {
          try { camApi.centerOnMesh(pick.pickedMesh); } catch (err) { Log.log('ERROR', 'Center on item failed', { error: String(err) }); }
        }
        lastPickName = '';
        lastPickTime = 0;
        return;
      }
      lastPickName = name;
      lastPickTime = now;
    }
    // If voxel hit exists on plain left click (no Cmd), handle voxel selection (do not select space)
    if (isLeft && !isCmd) {
      let vBest = null;
      try {
        // Find nearest voxel hit among all spaces
        for (const sp of (state?.barrow?.spaces || [])) {
          if (!sp || !sp.vox || !sp.vox.size) continue;
          const hit = voxelHitAtPointerForSpace(sp);
          if (hit && isFinite(hit.t) && (vBest == null || hit.t < vBest.t)) vBest = { ...hit, id: sp.id };
        }
      } catch {}
      if (vBest) {
        try {
          // Apply voxel selection semantics: shift adds, otherwise replace
          const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
          state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
          if (isShift) {
            if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
          } else {
            state.voxSel = [{ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v }];
          }
          // Begin brush mode: while mouse is down, add voxels under cursor; disable camera rotation during brush
          try {
            const canvas = engine.getRenderingCanvas();
            camera.inputs?.attached?.pointers?.detachControl(canvas);
            const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId);
            voxBrush.active = true; voxBrush.pointerId = pe && pe.pointerId != null ? pe.pointerId : null; voxBrush.lastAt = 0;
            // Prevent camera from starting a rotate on this gesture
            try { pe?.stopImmediatePropagation?.(); pe?.stopPropagation?.(); pe?.preventDefault?.(); } catch {}
            try { pi.skipOnPointerObservable = true; } catch {}
          } catch {}
          // Do not alter space selection; just redraw halos to show picks
          rebuildHalos();
          try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
          try { inputLog('pointer', 'voxel:pick', { combo: comboName(ev?.button, modsOf(ev)), id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, add: !!isShift }); } catch {}
        } catch {}
        return; // handled voxel selection
      }
    }

    // Selection rules (space selection)
    // Updated semantics:
    // - Cmd+Left: select this space (clear others)
    // - Shift+Cmd+Left: add this space to selection (multi-select)
    // - Plain Left: does NOT change space selection (voxel picks still allowed above)
    try {
      // isLeft/isCmd/isShift computed above
      if (!isLeft) { /* only act on left button */ }
      else if (!isCmd) {
        // Plain left-click: do not modify space selection
        return;
      } else {
        // Cmd held: prefer selecting the nearest voxel-backed space under the pointer if available
        try {
          let best = { t: Infinity, id: null };
          for (const sp of (state?.barrow?.spaces || [])) {
            if (!sp || !sp.vox || !sp.vox.size) continue;
            const hit = voxelHitAtPointerForSpace(sp);
            if (hit && isFinite(hit.t) && hit.t < best.t) best = { t: hit.t, id: sp.id };
          }
          if (best.id) { id = best.id; name = 'space:' + id; }
        } catch {}

        if (isShift) {
          // Shift+Cmd: multi-select (add-only)
          state.selection.add(id);
          const selNow = Array.from(state.selection);
          sLog('edit:updateSelection', { selection: selNow, via: 'shift-cmd-left:add', id });
          try { inputLog('pointer', 'select:add', { combo: comboName(ev?.button, modsOf(ev)), id, selection: selNow }); } catch {}
        } else {
          // Cmd only: single-select (clear others)
          state.selection.clear();
          state.selection.add(id);
          const selNow = Array.from(state.selection);
          sLog('edit:updateSelection', { selection: selNow, via: 'cmd-left:single', id });
          try { inputLog('pointer', 'select:single', { combo: comboName(ev?.button, modsOf(ev)), id, selection: selNow }); } catch {}
        }
        rebuildHalos();
        try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
        ensureRotWidget(); ensureMoveWidget(); disposeLiveIntersections();
        try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      }
    } catch {}

    // (double-click handled above)

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
      // Escape exits Cavern/Scry immediately; in War Room (edit) it clears selection
      if (e.key === 'Escape') {
        if (state._scry?.scryMode) { e.preventDefault(); e.stopPropagation(); exitScryMode(); return; }
        if (state.mode === 'cavern') { e.preventDefault(); e.stopPropagation(); exitCavernMode(); return; }
        // In War Room (edit) mode: clear selection
        if (state.mode === 'edit') {
          // Ignore when typing in inputs
          const t = e.target; const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : '';
          const isEditable = (tag === 'input') || (tag === 'textarea') || (t && t.isContentEditable) || (tag === 'select');
          if (!isEditable) {
            e.preventDefault(); e.stopPropagation();
            try { state.selection.clear(); } catch {}
            try { rebuildHalos(); } catch {}
            try { ensureRotWidget(); ensureMoveWidget(); } catch {}
            try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
            Log.log('UI', 'Clear selection (Esc)', {});
            return;
          }
        }
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
    try {
      if (collapsed) {
        // Slide panel off the right edge, leaving only the collapse control visible as a tab
        const rect = panel.getBoundingClientRect();
        const w = rect.width || 320;
        const tab = 36; // visible tab width for the collapse control
        panel.style.right = `${-(Math.max(40, w) - tab)}px`;
        panel.style.pointerEvents = 'none';
        // Keep the collapse button clickable and not hugging the browser scrollbar
        const topPx = Math.max(8, rect.top);
        collapsePanelBtn.style.position = 'fixed';
        collapsePanelBtn.style.right = '12px';
        collapsePanelBtn.style.top = `${topPx + 8}px`;
        collapsePanelBtn.style.zIndex = '2001';
        collapsePanelBtn.style.pointerEvents = 'auto';
        // Enlarge hit area
        collapsePanelBtn.style.padding = '8px 10px';
        collapsePanelBtn.style.borderRadius = '8px';
        collapsePanelBtn.title = 'Expand Panel';
      } else {
        // Restore panel position and button layout
        panel.style.right = '';
        panel.style.pointerEvents = '';
        collapsePanelBtn.style.position = '';
        collapsePanelBtn.style.right = '';
        collapsePanelBtn.style.top = '';
        collapsePanelBtn.style.zIndex = '';
        collapsePanelBtn.style.pointerEvents = '';
        collapsePanelBtn.style.padding = '';
        collapsePanelBtn.style.borderRadius = '';
        collapsePanelBtn.title = 'Collapse/Expand';
      }
    } catch {}
  }
  applyPanelCollapsed(localStorage.getItem(PANEL_STATE_KEY) === '1');
  collapsePanelBtn?.addEventListener('click', () => {
    const next = !panel.classList.contains('collapsed');
    applyPanelCollapsed(next);
    try { localStorage.setItem(PANEL_STATE_KEY, next ? '1' : '0'); } catch {}
  });

  // ——————————— Tabs setup ———————————
  (function setupTabs() {
    // Delegate creation of tabs/panes to initTabsUI
    let editPane = null, dbPane = null, settingsPane = null;
    try {
      const created = initTabsUI({ renderDbView, state, Log }) || {};
      editPane = created.editPane || document.getElementById('tab-edit');
      dbPane = created.dbPane || document.getElementById('tab-db');
      settingsPane = created.settingsPane || document.getElementById('tab-settings');
    } catch {}
    // If panes are missing, nothing to do
    if (!editPane) return;

    // ——— Voxel Operations (Edit tab, bottom section) ———
    (function addVoxelOpsSection(){
      try {
        const section = document.createElement('div');
        section.style.borderTop = '1px solid #1e2a30';
        section.style.marginTop = '10px';
        section.style.paddingTop = '8px';
        const title = document.createElement('h3');
        title.textContent = 'Voxel Operations (Selection)'; title.style.margin = '6px 0';
        const row = document.createElement('div'); row.className = 'row';
        const btnTunnel = document.createElement('button'); btnTunnel.className = 'btn'; btnTunnel.id = 'voxelAddTunnel'; btnTunnel.textContent = 'Add Tunnel Segment';
        const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'For each space with selected voxels, adds a box-shaped tunnel pointing outward from that space’s center through the voxel selection. Discontinuous voxel groups create multiple tunnel sprouts.';
        row.appendChild(btnTunnel);
        // Second row: Set selected voxels to Empty/Rock/Wall
        const rowSet = document.createElement('div'); rowSet.className = 'row';
        const btnEmpty = document.createElement('button'); btnEmpty.className = 'btn'; btnEmpty.title = 'Set selected voxels = Empty'; btnEmpty.textContent = 'Empty';
        const btnRock = document.createElement('button'); btnRock.className = 'btn'; btnRock.title = 'Set selected voxels = Rock'; btnRock.textContent = 'Rock';
        const btnWall = document.createElement('button'); btnWall.className = 'btn'; btnWall.title = 'Set selected voxels = Wall'; btnWall.textContent = 'Wall';
        const btnConnect = document.createElement('button'); btnConnect.className = 'btn'; btnConnect.id = 'voxelConnectSpaces'; btnConnect.textContent = 'Connect Spaces'; btnConnect.title = 'Propose a single most‑direct polyline path (≤30° slope) between two spaces’ voxel selections, then edit and finalize.';
        const btnFinalize = document.createElement('button'); btnFinalize.className = 'btn'; btnFinalize.id = 'voxelConnectFinalize'; btnFinalize.textContent = 'Finalize Path'; btnFinalize.title = 'Commit current proposed path to tunnels'; btnFinalize.style.display = 'none';
        rowSet.appendChild(btnEmpty); rowSet.appendChild(btnRock); rowSet.appendChild(btnWall); rowSet.appendChild(btnConnect); rowSet.appendChild(btnFinalize);
        // Min Tunnel Width control
        const minRow = document.createElement('div'); minRow.className = 'row';
        const minLabel = document.createElement('label'); minLabel.textContent = 'Min Tunnel Width (vox)'; minLabel.style.display = 'flex'; minLabel.style.alignItems = 'center'; minLabel.style.gap = '6px';
        const minInput = document.createElement('input'); minInput.type = 'number'; minInput.min = '1'; minInput.step = '1'; minInput.style.width = '72px';
        try { minInput.value = String(Math.max(1, Number(localStorage.getItem('dw:ops:minTunnelWidth') || '6')||6)); } catch { minInput.value = '6'; }
        minLabel.appendChild(minInput); minRow.appendChild(minLabel);
        // Build section
        section.appendChild(title); section.appendChild(row); section.appendChild(rowSet); section.appendChild(minRow); section.appendChild(hint);
        editPane.appendChild(section);

        function worldPointFromVoxelIndex(s, ix, iy, iz) {
          try {
            const res = s.vox?.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
            const nx = Math.max(1, s.vox?.size?.x || 1);
            const ny = Math.max(1, s.vox?.size?.y || 1);
            const nz = Math.max(1, s.vox?.size?.z || 1);
            const minX = -(nx * res) / 2, minY = -(ny * res) / 2, minZ = -(nz * res) / 2;
            const lx = minX + (ix + 0.5) * res;
            const ly = minY + (iy + 0.5) * res;
            const lz = minZ + (iz + 0.5) * res;
            const worldAligned = !!(s.vox && s.vox.worldAligned);
            let v = new BABYLON.Vector3(lx, ly, lz);
            if (!worldAligned) {
              const rx = Number(s.rotation?.x || 0) || 0;
              const ry = (typeof s.rotation?.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
              const rz = Number(s.rotation?.z || 0) || 0;
              const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
              const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero());
              v = BABYLON.Vector3.TransformCoordinates(v, m);
            }
            const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
            v.x += cx; v.y += cy; v.z += cz;
            return v;
          } catch { return null; }
        }

        function uniqueId(base) {
          const used = new Set((state?.barrow?.spaces||[]).map(sp => sp?.id).filter(Boolean));
          let i = 1; let id = `${base}-${i}`;
          while (used.has(id)) { i++; id = `${base}-${i}`; }
          return id;
        }

        // Helper: set selected voxels in-place to a given VoxelType value
        function applySetSelectedVoxels(value) {
          try {
            const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
            if (!picks.length) { Log.log('UI', 'Voxel set: no picks', {}); return; }
            const bySpace = new Map();
            for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
            const spacesById = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
            let changed = 0;
            for (const [sid, arr] of bySpace.entries()) {
              const s = spacesById.get(sid); if (!s || !s.vox || !s.vox.size || !Array.isArray(s.vox.data)) continue;
              const nx = Math.max(1, s.vox.size?.x|0), ny = Math.max(1, s.vox.size?.y|0), nz = Math.max(1, s.vox.size?.z|0);
              const idx = (x,y,z) => x + nx*(y + ny*z);
              for (const p of arr) {
                const x = p.x|0, y = p.y|0, z = p.z|0;
                if (x>=0 && y>=0 && z>=0 && x<nx && y<ny && z<nz) {
                  const i = idx(x,y,z);
                  if (s.vox.data[i] !== value) { s.vox.data[i] = value; changed++; }
                }
              }
              try { s.vox.worldAligned = true; } catch {}
            }
            if (changed > 0) {
              try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
              try { renderDbView(state.barrow); } catch {}
              try { rebuildScene(); } catch {}
              try { scheduleGridUpdate(); } catch {}
              try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-set', value, changed } })); } catch {}
              Log.log('UI', 'Voxel set: applied', { value, changed });
              // Keep voxel selection as-is
              try { rebuildHalos(); } catch {}
            } else {
              Log.log('UI', 'Voxel set: no changes', { value });
            }
          } catch (e) { logErr('EH:voxelSet', e); }
        }

        btnEmpty.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Empty));
        btnRock.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Rock));
        btnWall.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Wall));
        // Persist min tunnel width
        minInput.addEventListener('change', () => { try { const v = Math.max(1, Number(minInput.value)||6); localStorage.setItem('dw:ops:minTunnelWidth', String(v)); } catch {} });

        // Connect two spaces by a polyline path avoiding other spaces (approximate AABB routing)
        function segAabbIntersect(p0, p1, aabb, expand) {
          try {
            const min = { x: aabb.min.x - expand, y: aabb.min.y - expand, z: aabb.min.z - expand };
            const max = { x: aabb.max.x + expand, y: aabb.max.y + expand, z: aabb.max.z + expand };
            const dir = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
            let tmin = 0, tmax = 1;
            for (const ax of ['x','y','z']) {
              const d = dir[ax]; const o = p0[ax];
              if (Math.abs(d) < 1e-12) {
                if (o < min[ax] || o > max[ax]) return false;
              } else {
                const inv = 1 / d;
                let t1 = (min[ax] - o) * inv; let t2 = (max[ax] - o) * inv;
                if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
                if (tmax < tmin) return false;
              }
            }
            return tmax >= Math.max(0, tmin) && tmin <= 1 && tmax >= 0;
          } catch { return true; }
        }
        function pathAvoidingObstacles(start, end, obstacles, radius, upY) {
          const orders = [ ['x','y','z'], ['x','z','y'], ['y','x','z'], ['y','z','x'], ['z','x','y'], ['z','y','x'] ];
          function buildVia(order) {
            const p1 = new BABYLON.Vector3(start.x, start.y, start.z);
            const p2 = new BABYLON.Vector3(start.x, start.y, start.z);
            p1[order[0]] = end[order[0]];
            p2[order[0]] = end[order[0]]; p2[order[1]] = end[order[1]];
            return [p1, p2];
          }
          function clearPath(points) {
            for (let i = 0; i < points.length - 1; i++) {
              const a = points[i], b = points[i+1];
              for (const ob of obstacles) { if (segAabbIntersect(a, b, ob, radius)) return false; }
            }
            return true;
          }
          for (const ord of orders) {
            const [v1, v2] = buildVia(ord);
            const pts = [start, v1, v2, end];
            if (clearPath(pts)) return pts;
          }
          // Fallback: up-and-over
          const yHub = isFinite(upY) ? upY : (Math.max(...obstacles.map(o => o.max.y)) + radius * 2 + 2);
          const viaA = new BABYLON.Vector3(start.x, yHub, start.z);
          const viaB = new BABYLON.Vector3(end.x, yHub, end.z);
          const pts2 = [start, viaA, viaB, end];
          if (clearPath(pts2)) return pts2;
          return null;
        }
        function addTunnelsAlongSegment(p0, p1, opts) {
          const addedIds = [];
          try {
            const dirV = p1.subtract(p0); const dist = dirV.length(); if (!(dist > 1e-6)) return addedIds;
            const dir = dirV.scale(1 / dist);
            const baseRes = opts.baseRes;
            const cs = opts.cs; const Lvox = opts.Lvox;
            const halfLw = (Lvox * baseRes) / 2;
            const nSeg = Math.max(1, Math.ceil(dist / (Lvox * baseRes)));
            const step = dist / nSeg;
            for (let i = 0; i < nSeg; i++) {
              const segLen = Math.min(step, dist - i * step);
              const half = segLen / 2;
              let center = p0.add(dir.scale(i * step + half));
              if (opts.isFirst && i === 0) center = p0.add(dir.scale(half - opts.depthInside));
              if (opts.isLast && i === nSeg - 1) center = p1.subtract(dir.scale(half - opts.depthInside));
              const yaw = Math.atan2(dir.x, dir.z);
              const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)));
              const sizeVox = { x: cs, y: cs, z: Math.max(3, Math.round(segLen / baseRes)) };
              const id = uniqueId('connect-tunnel');
              const tunnel = { id, type: 'Tunnel', size: sizeVox, origin: { x: center.x, y: center.y, z: center.z }, res: baseRes, rotation: { x: pitch, y: yaw, z: 0 } };
              state.barrow.spaces.push(tunnel); addedIds.push(id);
            }
          } catch {}
          return addedIds;
        }
        // State for connection proposals
        // Connection/proposal state and helpers
        state._connect = state._connect || { props: [], pickObs: null, editObs: null, nodes: [], segs: [], path: null };
        function clearProposals() {
          try { Log.log('PATH', 'proposal:clear', { props: (state._connect.props||[]).length, nodes: (state._connect.nodes||[]).length, segs: (state._connect.segs||[]).length }); } catch {}
          try {
            for (const p of state._connect.props || []) { try { p.mesh?.dispose?.(); } catch {} }
            for (const n of state._connect.nodes || []) { try { n.mesh?.dispose?.(); } catch {} }
            for (const s of state._connect.segs || []) { try { s.mesh?.dispose?.(); } catch {} }
            try {
              if (state._connect.gizmo && state._connect.gizmo.root) { try { state._connect.gizmo.root.dispose(); } catch {} }
              if (state._connect.gizmo && state._connect.gizmo.parts) { for (const m of state._connect.gizmo.parts) { try { m.dispose(); } catch {} } }
            } catch {}
            try {
              if (state._connect.debug && state._connect.debug.marker) { try { state._connect.debug.marker.dispose(); } catch {} }
            } catch {}
          } catch {}
          state._connect.props = [];
          state._connect.nodes = [];
          state._connect.segs = [];
          state._connect.path = null;
          if (state._connect.pickObs) { try { scene.onPrePointerObservable.remove(state._connect.pickObs); } catch {}; state._connect.pickObs = null; }
          if (state._connect.editObs) { try { scene.onPrePointerObservable.remove(state._connect.editObs); } catch {}; state._connect.editObs = null; }
          try { btnFinalize.style.display = 'none'; } catch {}
          try { state._connect.debug = null; } catch {}
        }
        function segLen(a, b) { const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); }
        function pathLength(path) { let L=0; for (let i=0;i<path.length-1;i++) L+=segLen(path[i], path[i+1]); return L; }
        function slopeOK(a, b, maxDeg) {
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const horiz = Math.sqrt(dx*dx + dz*dz);
          if (horiz <= 1e-6) return Math.abs(dy) < 1e-6; // vertical not allowed unless ~0
          const ang = Math.atan2(Math.abs(dy), horiz) * 180/Math.PI;
          return ang <= maxDeg + 1e-3;
        }
        function enforceSlope(path, maxDeg) {
          const MAX_DEG = maxDeg || 30;
          if (!path || path.length < 2) return path;
          // Compute total horizontal (XZ) length and total vertical delta
          let Lxy = 0; let totalDy = path[path.length-1].y - path[0].y;
          for (let i=0;i<path.length-1;i++) { const a=path[i], b=path[i+1]; const dx=b.x-a.x, dz=b.z-a.z; Lxy += Math.sqrt(dx*dx+dz*dz); }
          const tanMax = Math.tan(MAX_DEG * Math.PI/180);
          const needLxy = Math.abs(totalDy) / Math.max(1e-6, tanMax);
          // If insufficient XY run, extend with a simple lateral detour around the midpoint
          let pts = path.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
          if (Lxy < needLxy - 1e-6) {
            const a = pts[0], b = pts[pts.length-1];
            let dir = new BABYLON.Vector3(b.x - a.x, 0, b.z - a.z);
            if (dir.lengthSquared() < 1e-6) dir = new BABYLON.Vector3(1,0,0); else dir.normalize();
            const perp = new BABYLON.Vector3(-dir.z, 0, dir.x);
            const add = (needLxy - Lxy);
            const off = Math.max(0.1, add / 2);
            // Build two detour points roughly along the midpoint
            const mid = new BABYLON.Vector3((a.x+b.x)/2, 0, (a.z+b.z)/2);
            const via1 = mid.add(perp.scale(off));
            const via2 = mid.subtract(perp.scale(off));
            // Insert into a simple 4-point path
            pts = [ new BABYLON.Vector3(a.x,a.y,a.z), new BABYLON.Vector3(via1.x, a.y, via1.z), new BABYLON.Vector3(via2.x, b.y, via2.z), new BABYLON.Vector3(b.x,b.y,b.z) ];
            // Recompute Lxy
            Lxy = 0; for (let i=0;i<pts.length-1;i++){ const p=pts[i], q=pts[i+1]; Lxy += Math.hypot(q.x-p.x, q.z-p.z); }
          }
          // Spread Y along XY progress to avoid vertical segments and keep constant slope across segments
          const out = [ new BABYLON.Vector3(pts[0].x, pts[0].y, pts[0].z) ];
          let acc = 0;
          for (let i=0;i<pts.length-1;i++) {
            const p = pts[i], q = pts[i+1];
            const dxy = Math.hypot(q.x-p.x, q.z-p.z);
            acc += dxy;
            const t = (Lxy > 0) ? (acc / Lxy) : 1;
            const y = pts[0].y + (totalDy * t);
            out.push(new BABYLON.Vector3(q.x, y, q.z));
          }
          return out;
        }
        function buildSinglePath(start, end, obstacles, radius, upY, maxSlopeDeg) {
          const candidates = [];
          // Straight if clear
          const straight = [start, end];
          const clearStraight = (() => { try { for (const ob of obstacles) { if (segAabbIntersect(start, end, ob, radius)) return false; } return true; } catch { return false; } })();
          if (clearStraight) candidates.push(straight);
          // Try routed (existing helper)
          const routed = pathAvoidingObstacles(start, end, obstacles, radius, upY);
          if (routed) candidates.push(routed);
          // Single-axis bends
          const axes = ['x','y','z'];
          for (const ax of axes) {
            const via = new BABYLON.Vector3(start.x, start.y, start.z); via[ax] = end[ax];
            const p = [start, via, end];
            let clear = true; for (let i=0;i<p.length-1;i++){ for (const ob of obstacles) { if (segAabbIntersect(p[i], p[i+1], ob, radius)) { clear = false; break; } } if(!clear) break; }
            if (clear) candidates.push(p);
          }
          // If none were clear, attempt a higher up-and-over and, failing that, accept straight as a last-resort
          if (!candidates.length) {
            try {
              const up2 = (isFinite(upY) ? upY : Math.max(...obstacles.map(o => o.max.y), 0)) + radius * 4 + 6;
              const viaA = new BABYLON.Vector3(start.x, up2, start.z);
              const viaB = new BABYLON.Vector3(end.x, up2, end.z);
              const pts2 = [start, viaA, viaB, end];
              let ok = true; for (let i=0;i<pts2.length-1;i++){ const a=pts2[i], b=pts2[i+1]; for (const ob of obstacles) { if (segAabbIntersect(a,b,ob,radius)) { ok = false; break; } } if(!ok) break; }
              if (ok) candidates.push(pts2);
            } catch {}
          }
          if (!candidates.length) {
            // Absolute fallback: straight path (may intersect obstacles); still enforce slope
            try { Log.log('UI', 'Connect: using fallback path through obstacles', {}); } catch {}
            candidates.push(straight);
          }
          // Enforce slope and choose the shortest adjusted path
          let best = null; let bestL = Infinity;
          for (const c of candidates) {
            const adj = enforceSlope(c, maxSlopeDeg||30);
            const L = pathLength(adj);
            if (L < bestL) { best = adj; bestL = L; }
          }
          return best;
        }
        function createProposalMeshesFromPath(path) {
          try {
            // Main polyline
            const pts = path.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
            const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: true }, scene);
            line.color = new BABYLON.Color3(0.55, 0.9, 1.0);
            line.isPickable = false; line.renderingGroupId = 3; // top overlay (max default group)
            state._connect.props.push({ name: 'connect:proposal', mesh: line, path });
            // Simple mode: no per-segment tubes; nearest segment computed analytically when needed
            // Elbow nodes (exclude endpoints)
            for (let i=1;i<pts.length-1;i++) {
              const s = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
              s.position.copyFrom(pts[i]); s.isPickable = true; s.renderingGroupId = 3;
              const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
              mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0);
              mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35);
              mat.specularColor = new BABYLON.Color3(0,0,0);
              mat.disableDepthWrite = true; mat.backFaceCulling = false; mat.zOffset = 8;
              s.material = mat;
              state._connect.nodes.push({ i, mesh: s });
            }
            btnFinalize.style.display = 'inline-block';
            try { Log.log('PATH', 'proposal:create', { points: path.length, segs: state._connect.segs.length, nodes: state._connect.nodes.length }); } catch {}
          } catch {}
        }
        function updateProposalMeshes() {
          try {
            const path = state._connect.path || [];
            const pts = path.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
            // Update main line by recreation (simple and safe)
            for (const p of state._connect.props) { try { p.mesh?.dispose?.(); } catch {} }
            state._connect.props = [];
            const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: false }, scene);
            line.color = new BABYLON.Color3(0.55, 0.9, 1.0);
            line.isPickable = false; line.renderingGroupId = 3;
            state._connect.props.push({ name: 'connect:proposal', mesh: line, path });
            // Update segments — simple mode: none (computed analytically)
            for (const s of state._connect.segs) { try { s.mesh?.dispose?.(); } catch {} }
            state._connect.segs = [];
            // Update nodes (rebuild for simplicity)
            for (const n of state._connect.nodes) { try { n.mesh?.dispose?.(); } catch {} }
            state._connect.nodes = [];
            for (let i=1;i<pts.length-1;i++) {
              const s = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
              s.position.copyFrom(pts[i]); s.isPickable = true; s.renderingGroupId = 3;
              const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
              mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0);
              mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35);
              mat.specularColor = new BABYLON.Color3(0,0,0);
              mat.disableDepthWrite = true; mat.backFaceCulling = false; mat.zOffset = 8;
              s.material = mat;
              state._connect.nodes.push({ i, mesh: s });
            }
            try { Log.log('PATH', 'proposal:update', { points: path.length, segs: state._connect.segs.length, nodes: state._connect.nodes.length }); } catch {}
          } catch {}
        }
        // ESC to cancel proposed path
        window.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') {
            if (state?._connect?.path) {
              clearProposals();
              Log.log('UI', 'Connect: canceled proposal (Esc)', {});
              ev.preventDefault(); ev.stopPropagation();
            }
          }
        });

        btnConnect.addEventListener('click', () => {
          try {
            try { Log.log('UI', 'Connect: click', {}); } catch {}
            const sel = Array.from(state.selection || []);
            const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
            const bySpace = new Map(); for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
            // Decide which two spaces to connect:
            // 1) Prefer exactly-two distinct spaces from voxel picks (no need to be selected)
            // 2) Else, if exactly two spaces are selected and both have picks, use those
            // 3) Otherwise, log a helpful message and return
            let aId = null, bId = null;
            const distinct = Array.from(bySpace.keys());
            if (distinct.length === 2) {
              aId = distinct[0]; bId = distinct[1];
              try { Log.log('UI', 'Connect: using voxel picks (no selection needed)', { aId, bId }); } catch {}
            } else if (sel.length === 2 && bySpace.has(sel[0]) && bySpace.has(sel[1])) {
              aId = sel[0]; bId = sel[1];
              try { Log.log('UI', 'Connect: using selected spaces with voxel picks', { aId, bId }); } catch {}
            } else {
              if (distinct.length < 2) {
                try { Log.log('UI', 'Connect: need voxels in two spaces', { uniqueSpaces: distinct.length }); } catch {}
                try { Log.log('ERROR', 'Connect: need voxels in two spaces', { uniqueSpaces: distinct.length }); } catch {}
              }
              else if (distinct.length > 2) {
                try { Log.log('UI', 'Connect: voxels span more than two spaces', { uniqueSpaces: distinct.length, ids: distinct.slice(0,6) }); } catch {}
                try { Log.log('ERROR', 'Connect: voxels span more than two spaces', { uniqueSpaces: distinct.length, ids: distinct.slice(0,6) }); } catch {}
              }
              else {
                try { Log.log('UI', 'Connect: unable to determine two spaces', { selCount: sel.length, uniqueSpaces: distinct.length }); } catch {}
                try { Log.log('ERROR', 'Connect: unable to determine two spaces', { selCount: sel.length, uniqueSpaces: distinct.length }); } catch {}
              }
              return;
            }
            const spacesById = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
            const sA = spacesById.get(aId); const sB = spacesById.get(bId); if (!sA || !sB) return;
            // Compute world centroids for both selections
            const ptsA = (bySpace.get(aId) || []).map(p => worldPointFromVoxelIndex(sA, p.x, p.y, p.z)).filter(Boolean);
            const ptsB = (bySpace.get(bId) || []).map(p => worldPointFromVoxelIndex(sB, p.x, p.y, p.z)).filter(Boolean);
            const centroid = (arr) => { let s = new BABYLON.Vector3(0,0,0); let n = 0; for (const v of arr) { s = s.add(v); n++; } return n? s.scale(1/n) : null; };
            const start = centroid(ptsA); const end = centroid(ptsB);
            if (!start || !end) {
              try { Log.log('UI', 'Connect: unable to compute centroids', { a: !!start, b: !!end }); } catch {}
              try { Log.log('ERROR', 'Connect: unable to compute centroids', { a: !!start, b: !!end }); } catch {}
              return;
            }
            // Obstacles = all other spaces' AABB
            const obstacles = [];
            try {
              for (const sp of (state?.barrow?.spaces||[])) {
                if (!sp || sp.id === sA.id || sp.id === sB.id) continue;
                obstacles.push(aabbForSpace(sp));
              }
            } catch {}
            const baseRes = Math.max(sA.res || (state?.barrow?.meta?.voxelSize||1), sB.res || (state?.barrow?.meta?.voxelSize||1));
            let cs = 6; try { cs = Math.max(6, Number(localStorage.getItem('dw:ops:minTunnelWidth')||'6')||6); } catch {}
            const maxDim = Math.max((sA.size?.x|0), (sA.size?.y|0), (sA.size?.z|0), (sB.size?.x|0), (sB.size?.y|0), (sB.size?.z|0));
            const Lvox = Math.max(12, Math.round(maxDim * 0.375));
            const radius = (cs * baseRes) / 2;
            const upY = Math.max( (Math.max(start.y, end.y) + radius*2 + 2), Math.max(...obstacles.map(o => o.max.y), 0) + radius*2 + 2 );
            clearProposals();
            // Compute one most-direct path with slope <= 30 deg
            const best = buildSinglePath(start, end, obstacles, radius, upY, 30);
            if (!best || best.length < 2) {
              try { Log.log('UI', 'Connect: no path found', {}); } catch {}
              try { Log.log('ERROR', 'Connect: no path found', {}); } catch {}
              return;
            }
            state._connect.path = best;
            createProposalMeshesFromPath(best);
            try { Log.log('PATH', 'route:chosen', { points: best.length, length: Number(pathLength(best).toFixed(2)) }); } catch {}
            // Deselect spaces now that proposal line exists
            try { state.selection.clear(); rebuildHalos(); window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
            Log.log('UI', 'Connect: proposal ready (edit elbows or segments, then Finalize)', {});
            // Enable editing: pick nodes or segments (shift to multi-select). Drag moves selection on XZ plane.
            if (state._connect.editObs) { try { scene.onPrePointerObservable.remove(state._connect.editObs); } catch {} }
            let drag = { active: false, ids: [], type: 'node', startPt: null, basePts: null, planeY: 0 };
            function idFromMesh(m) {
              const nm = String(m?.name||'');
              if (nm.startsWith('connect:node:')) return nm;
              if (nm.startsWith('connect:seg:')) return nm;
              return null;
            }
        state._connect.sel = new Set();
            // Compute nearest segment to the pointer by projecting pointer ray onto a horizontal Y plane
            function nearestSegmentAtPointer() {
              try {
                const path = (state && state._connect && Array.isArray(state._connect.path)) ? state._connect.path : [];
                if (!path || path.length < 2) return null;
                // Plane Y: use min Y across path to approximate ground for PP
                let minY = Infinity; for (const p of path) { if (p && isFinite(p.y)) minY = Math.min(minY, p.y); }
                if (!isFinite(minY)) minY = 0;
                const n = new BABYLON.Vector3(0,1,0);
                const base = new BABYLON.Vector3(0, minY, 0);
                // Use pointer-based picking ray (not camera forward ray)
                const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
                const denom = BABYLON.Vector3.Dot(ray.direction, n);
                if (Math.abs(denom) < 1e-6) return null;
                const tRay = BABYLON.Vector3.Dot(base.subtract(ray.origin), n) / denom;
                if (!isFinite(tRay) || tRay <= 0) return null;
                const P = ray.origin.add(ray.direction.scale(tRay));
                let bestI = -1; let bestD2 = Infinity; let bestN = null;
                for (let i=0;i<path.length-1;i++) {
                  const A = new BABYLON.Vector3(path[i].x, path[i].y, path[i].z);
                  const B = new BABYLON.Vector3(path[i+1].x, path[i+1].y, path[i+1].z);
                  const AB = B.subtract(A); const AB2 = Math.max(1e-8, AB.lengthSquared());
                  const AP = P.subtract(A);
                  let t = BABYLON.Vector3.Dot(AP, AB) / AB2; if (t < 0) t = 0; else if (t > 1) t = 1;
                  const N = A.add(AB.scale(t));
                  const d2 = N.subtract(P).lengthSquared();
                  if (d2 < bestD2) { bestD2 = d2; bestI = i; bestN = N; }
                }
                if (bestI < 0 || !bestN) return null;
                return { i: bestI, point: bestN };
              } catch { return null; }
            }

            function applySelectionVisual() {
              try {
                // Reset segs to cyan-ish, nodes to light-blue
                for (const s of state._connect.segs) {
                  const mat = s.mesh.material; if (!mat) continue;
                  if (mat.diffuseColor) mat.diffuseColor = new BABYLON.Color3(0.4,0.8,1.0);
                  if (mat.emissiveColor) mat.emissiveColor = new BABYLON.Color3(0,0,0);
                }
                for (const n of state._connect.nodes) {
                  const mat = n.mesh.material; if (!mat) continue;
                  if (mat.emissiveColor) mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0);
                  if (mat.diffuseColor) mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35);
                }
                // Apply selection colors
                for (const sid of state._connect.sel) {
                  if (sid.startsWith('connect:seg:')) {
                    const idx = Number(sid.split(':').pop());
                    const s = state._connect.segs.find(x => x.i === idx);
                    if (s && s.mesh.material) { s.mesh.material.diffuseColor = new BABYLON.Color3(1.0,0.95,0.3); }
                  } else if (sid.startsWith('connect:node:')) {
                    const idx = Number(sid.split(':').pop());
                    const n = state._connect.nodes.find(x => x.i === idx);
                    if (n && n.mesh.material) {
                      // Make selected node vivid (orange-red)
                      n.mesh.material.emissiveColor = new BABYLON.Color3(0.98, 0.38, 0.25);
                      n.mesh.material.diffuseColor = new BABYLON.Color3(0.55, 0.18, 0.10);
                    }
                  }
                }
              } catch {}
              try { ensureConnectGizmo(); } catch {}
              try { requestAnimationFrame(() => { try { ensureConnectGizmo(); } catch {} }); } catch {}
              try { Log.log('PATH', 'sel:update', { selected: Array.from(state._connect.sel||[]) }); } catch {}
            }
            function pickPlaneY() {
              try {
                // Use the lowest y among selected items as drag plane
                let y = null;
                for (const sid of state._connect.sel) {
                  if (sid.startsWith('connect:node:')) { const n = state._connect.nodes.find(x => x.i === Number(sid.split(':').pop())); if (n) y = (y==null)? n.mesh.position.y : Math.min(y, n.mesh.position.y); }
                  if (sid.startsWith('connect:seg:')) { const idx = Number(sid.split(':').pop()); const p0 = state._connect.path[idx]; const p1 = state._connect.path[idx+1]; const my = Math.min(p0.y, p1.y); y = (y==null) ? my : Math.min(y, my); }
                }
                return (y==null) ? 0 : y;
              } catch { return 0; }
            }
            function pickPointOnPlaneY(y) {
              try {
                const ray = camera.getForwardRay();
                const n = new BABYLON.Vector3(0,1,0);
                const base = new BABYLON.Vector3(0,y,0);
                const denom = BABYLON.Vector3.Dot(ray.direction, n);
                if (Math.abs(denom) < 1e-6) return null;
                const t = BABYLON.Vector3.Dot(base.subtract(ray.origin), n) / denom;
                return ray.origin.add(ray.direction.scale(t));
              } catch { return null; }
            }

            // ——— Connect gizmo (X/Y/Z arrows + XZ plane) ———
function disposeConnectGizmo() {
  try {
                try { Log.log('PATH', 'gizmo:dispose', {}); } catch {}
                const g = state._connect.gizmo || {};
                try { g.root?.dispose?.(); } catch {}
                try { (g.parts||[]).forEach(m => { try { m.dispose(); } catch {} }); } catch {}
              } catch {}
              state._connect.gizmo = null;
            }
function ensureConnectGizmo() {
  try {
    // Only show gizmo when at least one PP node is selected
    const hasSel = !!(state._connect && state._connect.sel && state._connect.sel.size > 0);
    const selIds = hasSel ? Array.from(state._connect.sel || []) : [];
    const selNodeIdx = selIds.filter(id => String(id||'').startsWith('connect:node:')).map(id => Number(String(id).split(':').pop())).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
    const hasNodeSel = hasSel && selNodeIdx.length > 0;
    if (!hasNodeSel) {
      try { Log.log('PATH', 'gizmo:suppressed', { reason: hasSel ? 'no-node-selected' : 'empty-selection' }); } catch {}
      disposeConnectGizmo();
      try { if (state._connect && state._connect.debug && state._connect.debug.marker) { state._connect.debug.marker.dispose(); } } catch {}
      try { state._connect.debug = null; } catch {}
      return;
    }
                try { Log.log('PATH', 'gizmo:ensure', { sel: Array.from(state._connect.sel||[]) }); } catch {}
    // Only show gizmo when some path element is selected
    if (!state._connect || !state._connect.sel || state._connect.sel.size === 0) {
      disposeConnectGizmo();
      return;
    }
                try { Log.log('PATH', 'gizmo:ensure', { sel: Array.from(state._connect.sel||[]) }); } catch {}
                const center = getConnectSelectionCenter() || (state._connect.path && state._connect.path[0] ? new BABYLON.Vector3(state._connect.path[0].x, state._connect.path[0].y, state._connect.path[0].z) : null);
                if (!center) { disposeConnectGizmo(); return; }
                const g = state._connect.gizmo;
                const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100;
                // For PP node gizmo, only show Move arrows and Blue XZ disc
                const showMove = true;
                const showRotate = false;
                const showDisc = true;
                const showCast = false;
                // Estimate radius from path extents for sizing
                let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
                for (const p of (state._connect.path||[])) { if (!p) continue; if (p.x<minX)minX=p.x; if (p.y<minY)minY=p.y; if (p.z<minZ)minZ=p.z; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; if(p.z>maxZ)maxZ=p.z; }
                const rad = Math.max(1, Math.max(maxX-minX, maxY-minY, maxZ-minZ) * 0.4);
                const gScale = Math.max(0.1, scalePct / 100);
                // Shrink gizmo when operating directly on node(s)
                const nodeMul = selNodeIdx.length > 0 ? 0.65 : 1.0;
                const len = Math.max(0.8, rad * 1.2 * gScale * nodeMul);
                const shaft = Math.max(0.04, len * 0.08);
                const tipLen = Math.max(0.12, len * 0.22);
                const tipDia = shaft * 2.2;
                const cfgKey = `${showMove?'1':'0'}-${showRotate?'1':'0'}-${showDisc?'1':'0'}-${showCast?'1':'0'}-N:${selNodeIdx.join(',')}`;
                const noParts = !g || !g.parts || (Array.isArray(g.parts) && g.parts.length === 0);
                if (!g || !g.root || (g.root.isDisposed && g.root.isDisposed()) || g.key !== cfgKey || noParts) {
                  disposeConnectGizmo();
                  const root = new BABYLON.TransformNode('connectGizmo:root', scene);
                  const parts = [];
                  const mkArrow = (axis, color) => {
                    const name = `connectGizmo:${axis}`;
                    const shaftMesh = BABYLON.MeshBuilder.CreateCylinder(`${name}:shaft`, { height: Math.max(0.1, len - Math.max(0.16, tipLen * 1.35)), diameter: Math.max(0.06, shaft * 1.5) }, scene);
                    const tipMesh = BABYLON.MeshBuilder.CreateCylinder(`${name}:tip`, { height: Math.max(0.16, tipLen * 1.35), diameterTop: 0, diameterBottom: Math.max(Math.max(0.06, shaft * 1.5) * 2.6, tipDia * 1.2), tessellation: 24 }, scene);
                    const mat = new BABYLON.StandardMaterial(`${name}:mat`, scene);
                    mat.diffuseColor = color.scale(0.25); mat.emissiveColor = color.clone(); mat.specularColor = new BABYLON.Color3(0,0,0);
                    shaftMesh.material = mat; tipMesh.material = mat;
                    shaftMesh.isPickable = true; tipMesh.isPickable = true; shaftMesh.alwaysSelectAsActiveMesh = true; tipMesh.alwaysSelectAsActiveMesh = true;
                    shaftMesh.renderingGroupId = 3; tipMesh.renderingGroupId = 3;
                    shaftMesh.parent = root; tipMesh.parent = root;
                    if (axis === 'x') { shaftMesh.rotation.z = -Math.PI/2; tipMesh.rotation.z = -Math.PI/2; shaftMesh.position.x = (len - tipLen)/2; tipMesh.position.x = len - tipLen/2; }
                    else if (axis === 'y') { shaftMesh.position.y = (len - tipLen)/2; tipMesh.position.y = len - tipLen/2; }
                    else { shaftMesh.rotation.x = Math.PI/2; tipMesh.rotation.x = Math.PI/2; shaftMesh.position.z = (len - tipLen)/2; tipMesh.position.z = len - tipLen/2; }
                    shaftMesh.name = name; tipMesh.name = name; parts.push(shaftMesh, tipMesh);
                  };
                  if (showMove) { mkArrow('x', new BABYLON.Color3(0.95, 0.2, 0.2)); mkArrow('y', new BABYLON.Color3(0.2, 0.95, 0.2)); mkArrow('z', new BABYLON.Color3(0.2, 0.45, 0.95)); }
                  // Rotate rings
                  if (showRotate) {
                    const mkRing = (axis, color, diamMul = 2.2, thickMul = 0.06) => {
                      const name = `connectGizmo:rot:${axis}`;
                      const ring = BABYLON.MeshBuilder.CreateTorus(name, { diameter: Math.max(0.4, len * diamMul), thickness: Math.max(0.02, len * thickMul), tessellation: 96 }, scene);
                      const mat = new BABYLON.StandardMaterial(`${name}:mat`, scene); mat.diffuseColor = new BABYLON.Color3(0,0,0); mat.emissiveColor = color.clone(); mat.specularColor = new BABYLON.Color3(0,0,0); ring.material = mat;
                      ring.isPickable = true; ring.alwaysSelectAsActiveMesh = true; ring.renderingGroupId = 3; ring.parent = root;
                      if (axis === 'x') ring.rotation.z = Math.PI/2; else if (axis === 'z') ring.rotation.x = Math.PI/2;
                      parts.push(ring);
                    };
                    mkRing('y', new BABYLON.Color3(0.2, 0.95, 0.2));
                    mkRing('x', new BABYLON.Color3(0.95, 0.2, 0.2));
                    mkRing('z', new BABYLON.Color3(0.2, 0.45, 0.95));
                  }
                  let disc = null; let cast = null;
                  if (showDisc) {
                    try {
                      const discR = Math.max(0.8, rad * 1.1 * gScale * nodeMul);
                      disc = BABYLON.MeshBuilder.CreateDisc('connectGizmo:disc', { radius: discR, tessellation: 64 }, scene);
                      const dmat = new BABYLON.StandardMaterial('connectGizmo:disc:mat', scene);
                      dmat.diffuseColor = new BABYLON.Color3(0.15, 0.5, 0.95); dmat.emissiveColor = new BABYLON.Color3(0.12, 0.42, 0.85); dmat.alpha = 0.30; dmat.specularColor = new BABYLON.Color3(0,0,0); dmat.zOffset = 3;
                      disc.material = dmat; disc.isPickable = true; disc.alwaysSelectAsActiveMesh = true; disc.renderingGroupId = 3; disc.rotation.x = Math.PI/2; disc.parent = root; parts.push(disc);
                    } catch {}
                  }
                  // Add a small blue XZ disc at each selected node for clarity (non-pickable)
                  try {
                    const path = state._connect.path || [];
                    const nodeDiscR = Math.max(0.25, len * 0.22);
                    for (const i of selNodeIdx) {
                      const p = path[i]; if (!p) continue;
                      const nd = BABYLON.MeshBuilder.CreateDisc(`connectGizmo:nodeDisc:${i}`, { radius: nodeDiscR, tessellation: 48 }, scene);
                      const nmat = new BABYLON.StandardMaterial(`connectGizmo:nodeDisc:${i}:mat`, scene);
                      nmat.diffuseColor = new BABYLON.Color3(0.10, 0.45, 0.95);
                      nmat.emissiveColor = new BABYLON.Color3(0.18, 0.55, 1.0);
                      nmat.alpha = 0.35; nmat.specularColor = new BABYLON.Color3(0,0,0);
                      nmat.disableDepthWrite = true; nmat.backFaceCulling = false; nmat.zOffset = 8;
                      nd.material = nmat; nd.isPickable = false; nd.renderingGroupId = 3; nd.rotation.x = Math.PI/2; nd.parent = root; nd.position.set(p.x, p.y, p.z);
                      parts.push(nd);
                    }
                  } catch {}
                  if (showCast) {
                    try {
                      cast = BABYLON.MeshBuilder.CreateDisc('connectGizmo:cast', { radius: Math.max(0.6, rad), tessellation: 64 }, scene);
                      const cmat = new BABYLON.StandardMaterial('connectGizmo:cast:mat', scene);
                      cmat.diffuseColor = new BABYLON.Color3(0.85, 0.80, 0.20); cmat.emissiveColor = new BABYLON.Color3(0.35, 0.33, 0.10); cmat.alpha = 0.28; cmat.specularColor = new BABYLON.Color3(0,0,0);
                      cast.material = cmat; cast.isPickable = false; cast.renderingGroupId = 1; cast.rotation.x = Math.PI/2; cast.parent = root; parts.push(cast);
                    } catch {}
                  }
                  state._connect.gizmo = { root, parts, disc, cast, key: cfgKey };
                  try {
                    for (const m of parts) {
                      try { m.renderingGroupId = 3; } catch {}
                      try {
                        const matAny = m.material; if (matAny && matAny instanceof BABYLON.StandardMaterial) {
                          matAny.disableDepthWrite = true; matAny.backFaceCulling = false; matAny.zOffset = Math.max(4, Number(matAny.zOffset||0));
                        }
                      } catch {}
                    }
                    if (disc && disc.material && disc.material instanceof BABYLON.StandardMaterial) {
                      try { disc.renderingGroupId = 3; disc.material.disableDepthWrite = true; disc.material.backFaceCulling = false; disc.material.zOffset = Math.max(6, Number(disc.material.zOffset||0)); } catch {}
                    }
                  } catch {}
                  try { Log.log('PATH', 'gizmo:created', { key: cfgKey, parts: parts.length, move: !!showMove, rot: !!showRotate, disc: !!showDisc, cast: !!showCast }); } catch {}
                }
                // Always enforce overlay settings on existing gizmo (handles pre-patch creations)
                try {
                  const gNow = state._connect.gizmo;
                  const list = (gNow && Array.isArray(gNow.parts) && gNow.parts.length) ? gNow.parts : (gNow && gNow.root && gNow.root.getChildMeshes ? gNow.root.getChildMeshes() : []);
                  for (const m of list) {
                    try { m.renderingGroupId = 3; } catch {}
                    try {
                      const matAny = m.material; if (matAny && matAny instanceof BABYLON.StandardMaterial) {
                        matAny.disableDepthWrite = true; matAny.backFaceCulling = false; matAny.zOffset = Math.max(4, Number(matAny.zOffset||0));
                      }
                    } catch {}
                  }
                  if (gNow && gNow.disc && gNow.disc.material && gNow.disc.material instanceof BABYLON.StandardMaterial) {
                    try { gNow.disc.renderingGroupId = 3; gNow.disc.material.disableDepthWrite = true; gNow.disc.material.backFaceCulling = false; gNow.disc.material.zOffset = Math.max(6, Number(gNow.disc.material.zOffset||0)); } catch {}
                  }
                  // Update per-node disc positions to follow selected node coordinates
                  try {
                    const path = state._connect.path || [];
                    for (const i of selNodeIdx) {
                      const p = path[i]; if (!p) continue;
                      const nm = `connectGizmo:nodeDisc:${i}`;
                      const d = list.find(m => String(m.name||'') === nm);
                      if (d && d.position) d.position.set(p.x, p.y, p.z);
                    }
                  } catch {}
                } catch {}
                try { state._connect.gizmo.root.position.copyFrom(center); } catch (e) { try { Log.log('ERROR', 'PP gizmo position', { error: String(e) }); } catch {} }
                // Place disc on selection’s lowest Y for convenience
                try {
                  let minY = center.y;
                  for (const sid of (state._connect.sel || [])) {
                    if (sid.startsWith('connect:node:')) { const idx = Number(sid.split(':').pop()); const p = state._connect.path[idx]; if (p) minY = Math.min(minY, p.y); }
                    else if (sid.startsWith('connect:seg:')) { const i = Number(sid.split(':').pop()); const p0 = state._connect.path[i], p1 = state._connect.path[i+1]; if (p0&&p1) minY = Math.min(minY, p0.y, p1.y); }
                  }
                  if (state._connect.gizmo.disc) { state._connect.gizmo.disc.position.set(center.x, minY, center.z); }
                  if (state._connect.gizmo.cast) { state._connect.gizmo.cast.position.set(center.x, minY, center.z); }
                  try { Log.log('PATH', 'gizmo:update', { center: { x:center.x, y:center.y, z:center.z }, minY }); } catch {}
                  // ——— Debug marker at gizmo center (disabled) ———
                  try {
                    const wantDbg = false; // disabled unless explicitly re-enabled
                    if (wantDbg) {
                      if (!state._connect.debug || !state._connect.debug.marker || (state._connect.debug.marker.isDisposed && state._connect.debug.marker.isDisposed())) {
                        const dbg = BABYLON.MeshBuilder.CreateSphere('connectGizmo:debug:mark', { diameter: Math.max(0.6, rad * 0.6) }, scene);
                        const dbgMat = new BABYLON.StandardMaterial('connectGizmo:debug:mat', scene);
                        dbgMat.emissiveColor = new BABYLON.Color3(1.0, 0.1, 0.8);
                        dbgMat.diffuseColor = new BABYLON.Color3(0,0,0);
                        dbgMat.disableDepthWrite = true; dbgMat.backFaceCulling = false; dbgMat.zOffset = 10;
                        dbg.material = dbgMat; dbg.isPickable = false; dbg.renderingGroupId = 3;
                        state._connect.debug = { marker: dbg };
                        try { Log.log('PATH', 'debug:marker:create', {}); } catch {}
                      }
                      try {
                        const dbg = state._connect.debug.marker;
                        dbg.position.set(center.x, minY + Math.max(0.3, (state?.barrow?.meta?.voxelSize||1) * 0.2), center.z);
                      } catch {}
                    } else {
                      try { if (state?._connect?.debug?.marker) { state._connect.debug.marker.dispose(); } } catch {}
                      try { state._connect.debug = null; } catch {}
                    }
                  } catch {}
                } catch (e) { try { Log.log('ERROR', 'PP gizmo update', { error: String(e) }); } catch {} }
              } catch (e) { try { Log.log('ERROR', 'PP gizmo ensure', { error: String(e) }); } catch {} }
}
            // React to settings changes for gizmo parts
            try { window.addEventListener('dw:pathGizmo:config', () => { try { ensureConnectGizmo(); } catch {} }); } catch {}
            // Ensure we always clean up capture even if the pointer gets canceled (e.g., clicking outside UI)
            try {
              const canvas = engine.getRenderingCanvas();
              const cancelFn = () => {
                try { drag.active = false; drag.gizmoActive = false; drag.ids = []; drag.basePts = null; } catch {}
                try { const c = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(c); } catch {}
                try { if (drag.ptrId != null && canvas && canvas.releasePointerCapture) canvas.releasePointerCapture(drag.ptrId); drag.ptrId = null; } catch {}
              };
              canvas.addEventListener('pointercancel', cancelFn, { once: true });
              canvas.addEventListener('lostpointercapture', cancelFn, { once: true });
            } catch {}

            state._connect.editObs = scene.onPrePointerObservable.add((pi) => {
              try {
                if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                  try {
                    const nmDbg = (() => { const p = scene.pick(scene.pointerX, scene.pointerY); return p?.pickedMesh?.name || ''; })();
                    const m = pi.event; Log.log('PATH', 'pointer:down', { name: nmDbg, shift: !!m?.shiftKey, cmd: !!m?.metaKey, alt: !!m?.altKey, ctrl: !!m?.ctrlKey });
                  } catch {}
                  // Strict priority: nodes first
                  const pickNode = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && m.name.startsWith('connect:node:'));
                  if (pickNode?.hit && pickNode.pickedMesh) {
                    const nodeId = idFromMesh(pickNode.pickedMesh);
                    const shift = !!(pi.event && pi.event.shiftKey);
                    try { Log.log('PATH', 'select:node', { id: nodeId }); } catch {}
                    if (!shift) state._connect.sel.clear();
                    if (state._connect.sel.has(nodeId) && shift) state._connect.sel.delete(nodeId); else state._connect.sel.add(nodeId);
                    applySelectionVisual();
                    try { requestAnimationFrame(() => { try { ensureConnectGizmo(); } catch {} }); } catch {}
                    // Prepare ground-plane drag for nodes only
                    drag.active = true; drag.ids = Array.from(state._connect.sel);
                    drag.type = 'node';
                    drag.planeY = pickPlaneY();
                    drag.startPt = pickPointOnPlaneY(drag.planeY);
                    drag.basePts = JSON.parse(JSON.stringify(state._connect.path));
                    try { Log.log('PATH', 'drag:start', { type: drag.type, ids: drag.ids, planeY: drag.planeY }); } catch {}
                    try { const ev = pi.event; ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
                    pi.skipOnPointerObservable = true; return;
                  }
                  const pickNS = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && m.name.startsWith('connect:seg:'));
                  const selId = idFromMesh(pickNS?.pickedMesh);
                  const shift = !!(pi.event && pi.event.shiftKey);
                  const cmd = !!(pi.event && pi.event.metaKey);
                  // Cmd-click: split nearest segment into two by inserting a node at nearest point
                  if (cmd) {
                    try {
                      const hit = nearestSegmentAtPointer();
                      const path = Array.isArray(state._connect.path) ? state._connect.path.map(p => ({ x: p.x, y: p.y, z: p.z })) : [];
                      if (hit && path[hit.i] && path[hit.i+1]) {
                        const A = new BABYLON.Vector3(path[hit.i].x, path[hit.i].y, path[hit.i].z);
                        const B = new BABYLON.Vector3(path[hit.i+1].x, path[hit.i+1].y, path[hit.i+1].z);
                        const AB = B.subtract(A);
                        const AP = hit.point.subtract(A);
                        const ab2 = Math.max(1e-8, AB.lengthSquared());
                        let t = BABYLON.Vector3.Dot(AP, AB) / ab2;
                        t = Math.max(0.08, Math.min(0.92, t));
                        const N = A.add(AB.scale(t));
                        path.splice(hit.i+1, 0, { x: N.x, y: N.y, z: N.z });
                        state._connect.path = path;
                        updateProposalMeshes();
                        try { state._connect.sel.clear(); state._connect.sel.add(`connect:node:${hit.i+1}`); applySelectionVisual(); } catch {}
                        try { Log.log('PATH', 'split:insertNode', { seg: hit.i, t, at: { x: N.x, y: N.y, z: N.z } }); } catch {}
                        try { const ev = pi.event; ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
                        pi.skipOnPointerObservable = true; return;
                      }
                    } catch (e) { logErr('EH:connect:cmdSplit', e); }
                  }
                  // If not selecting a node (and not cmd-splitting), allow gizmo picks
                  let pickG = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('connectGizmo:'));
                  if (pickG?.hit && pickG.pickedMesh) {
                    try { Log.log('PATH', 'gizmo:pick', { name: String(pickG.pickedMesh.name||'') }); } catch {}
                    const nm = String(pickG.pickedMesh.name || '');
                    drag.gizmoActive = true; drag.basePts = JSON.parse(JSON.stringify(state._connect.path));
                    const center = getConnectSelectionCenter() || new BABYLON.Vector3(0,0,0);
                    if (nm.startsWith('connectGizmo:disc')) {
                      drag.mode = 'plane'; drag.axisVec = null; drag.planeNormal = new BABYLON.Vector3(0,1,0);
                      drag.startPt = pickPointOnPlane(drag.planeNormal, new BABYLON.Vector3(center.x, (state._connect.gizmo?.disc?.position?.y || center.y), center.z));
                    } else if (nm.startsWith('connectGizmo:rot:')) {
                      drag.mode = 'rot';
                      const ax = nm.endsWith(':x') ? 'x' : nm.endsWith(':y') ? 'y' : 'z';
                      drag.rotAxis = ax;
                      drag.rotAxisVec = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
                      drag.rotCenter = center.clone();
                      drag.startAngle = angleToPointerFrom(center);
                    } else {
                      drag.mode = 'axis';
                      const axis = nm.includes(':x') ? new BABYLON.Vector3(1,0,0) : nm.includes(':y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
                      drag.axisVec = axis.clone(); try { drag.axisVec.normalize(); } catch {}
                      const view = camera.getForwardRay().direction.clone();
                      let n = BABYLON.Vector3.Cross(axis, BABYLON.Vector3.Cross(view, axis));
                      if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(0,1,0));
                      if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(1,0,0));
                      try { n.normalize(); } catch {}
                      drag.planeNormal = n;
                      drag.startPt = pickPointOnPlane(n, center) || center.clone();
                    }
                    // Detach camera pointer input during gizmo drag and capture pointer
                    try {
                      const canvas = engine.getRenderingCanvas();
                      camera.inputs?.attached?.pointers?.detachControl(canvas);
                      const pe = pi.event; drag.ptrId = pe && pe.pointerId != null ? pe.pointerId : null;
                      if (drag.ptrId != null && canvas && canvas.setPointerCapture) canvas.setPointerCapture(drag.ptrId);
                    } catch {}
                    try { const ev = pi.event; ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
                    pi.skipOnPointerObservable = true; return;
                  }
                  // Ignore plain clicks on segments for selection — nodes only
                  // Fall through with no action
                } else if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
                  // Drag via gizmo
                  if (drag.gizmoActive) {
                    const center = getConnectSelectionCenter() || new BABYLON.Vector3(0,0,0);
                    if (drag.mode === 'rot') {
                      const angNow = angleToPointerFrom(center);
                      if (!isFinite(angNow) || !isFinite(drag.startAngle)) return;
                      let delta = angNow - drag.startAngle;
                      if (delta > Math.PI) delta -= 2*Math.PI; else if (delta < -Math.PI) delta += 2*Math.PI;
                      const axis = drag.rotAxisVec || new BABYLON.Vector3(0,1,0);
                      const R = BABYLON.Matrix.RotationAxis(axis, delta);
                      const path = drag.basePts.map(p => ({ x: p.x, y: p.y, z: p.z }));
                      const applyRot = (idx) => {
                        const p = drag.basePts[idx]; if (!p) return;
                        const rel = new BABYLON.Vector3(p.x - center.x, p.y - center.y, p.z - center.z);
                        const out = BABYLON.Vector3.TransformCoordinates(rel, R);
                        path[idx].x = center.x + out.x; path[idx].y = center.y + out.y; path[idx].z = center.z + out.z;
                      };
                      for (const sid of state._connect.sel || []) {
                        if (sid.startsWith('connect:node:')) { const idx = Number(sid.split(':').pop()); applyRot(idx); }
                        else if (sid.startsWith('connect:seg:')) { const i = Number(sid.split(':').pop()); applyRot(i); applyRot(i+1); }
                      }
                      state._connect.path = path; updateProposalMeshes(); ensureConnectGizmo(); pi.skipOnPointerObservable = true; return;
                    } else {
                      const cur = drag.mode === 'plane' ? pickPointOnPlane(drag.planeNormal || new BABYLON.Vector3(0,1,0), new BABYLON.Vector3(center.x, (state._connect.gizmo?.disc?.position?.y || center.y), center.z)) : pickPointOnPlane(drag.planeNormal || new BABYLON.Vector3(0,1,0), center);
                      if (!cur || !drag.startPt) return;
                      let move = new BABYLON.Vector3(0,0,0);
                      if (drag.mode === 'plane') { move = new BABYLON.Vector3(cur.x - drag.startPt.x, 0, cur.z - drag.startPt.z); }
                      else { const d = cur.subtract(drag.startPt); const axis = drag.axisVec || new BABYLON.Vector3(1,0,0); const dist = BABYLON.Vector3.Dot(d, axis); move = axis.scale(dist); }
                      const path = drag.basePts.map(p => ({ x: p.x, y: p.y, z: p.z }));
                      const applyMove = (idx) => { path[idx].x += move.x; path[idx].y += move.y; path[idx].z += move.z; };
                      if (state._connect.sel && state._connect.sel.size > 0) {
                        for (const sid of state._connect.sel) {
                          if (sid.startsWith('connect:node:')) { const idx = Number(sid.split(':').pop()); applyMove(idx); }
                          else if (sid.startsWith('connect:seg:')) { const i = Number(sid.split(':').pop()); applyMove(i); applyMove(i+1); }
                        }
                      } else { for (let i=0;i<path.length;i++) applyMove(i); }
                      state._connect.path = path; updateProposalMeshes(); ensureConnectGizmo(); pi.skipOnPointerObservable = true; return;
                    }
                  }
                  // Drag by direct selection on ground plane (legacy XZ drag)
                  if (!drag.active) return;
                  const cur = pickPointOnPlaneY(drag.planeY); if (!cur || !drag.startPt) return;
                  const dx = cur.x - drag.startPt.x; const dz = cur.z - drag.startPt.z;
                  const dvec = { x: dx, y: 0, z: dz };
                  const path = drag.basePts.map(p => ({ x: p.x, y: p.y, z: p.z }));
                  if (drag.type === 'node') {
                    for (const sid of drag.ids) { if (!sid.startsWith('connect:node:')) continue; const idx = Number(sid.split(':').pop()); path[idx].x += dvec.x; path[idx].z += dvec.z; }
                  } else {
                    for (const sid of drag.ids) { if (!sid.startsWith('connect:seg:')) continue; const i = Number(sid.split(':').pop()); path[i].x += dvec.x; path[i].z += dvec.z; path[i+1].x += dvec.x; path[i+1].z += dvec.z; }
                  }
                  state._connect.path = path;
                  updateProposalMeshes();
                  try { const now = performance.now(); drag._lastLog = drag._lastLog||0; if (now - drag._lastLog > 150) { drag._lastLog = now; Log.log('PATH', 'drag:update', { type: drag.type, ids: drag.ids, dx, dz }); } } catch {}
                  pi.skipOnPointerObservable = true;
                } else if (pi.type === BABYLON.PointerEventTypes.POINTERUP) {
                  if (drag.active || drag.gizmoActive) {
                    drag.active = false; drag.gizmoActive = false; drag.ids = []; drag.basePts = null;
                    try { Log.log('PATH', 'drag:end', {}); } catch {}
                    // Reattach camera pointer input and release capture
                    try {
                      const canvas = engine.getRenderingCanvas();
                      camera.inputs?.attached?.pointers?.attachControl(canvas);
                      if (drag.ptrId != null && canvas && canvas.releasePointerCapture) canvas.releasePointerCapture(drag.ptrId);
                      drag.ptrId = null;
                    } catch {}
                  }
                }
              } catch (e2) { logErr('EH:connect:edit', e2); }
            });

            // Finalize handler
            btnFinalize.onclick = () => {
              try {
                const path = state._connect.path || [];
                const depthInside = Math.max(cs * baseRes * 1.5, (maxDim * baseRes) * 0.20, 2 * baseRes);
                const addedIds = [];
                for (let i = 0; i < path.length - 1; i++) {
                  const p0 = path[i]; const p1 = path[i+1];
                  const ids = addTunnelsAlongSegment(new BABYLON.Vector3(p0.x,p0.y,p0.z), new BABYLON.Vector3(p1.x,p1.y,p1.z), { baseRes, cs, Lvox, depthInside, isFirst: i===0, isLast: i===path.length-2 });
                  addedIds.push(...ids);
                }
                if (addedIds.length) {
                  saveBarrow(state.barrow); snapshot(state.barrow);
                  renderDbView(state.barrow); rebuildScene(); scheduleGridUpdate();
                  try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-connect', added: addedIds, path: path.map(p=>({x:p.x,y:p.y,z:p.z})) } })); } catch {}
                  Log.log('UI', 'Connect: finalized', { added: addedIds.length });
                } else {
                  Log.log('UI', 'Connect: no segments added', {});
                }
              } catch (e) { logErr('EH:voxelConnect:finalize', e); }
              finally { clearProposals(); }
            };
          } catch (e) { logErr('EH:voxelConnect', e); try { Log.log('ERROR', 'Connect: exception', { error: String(e && e.message ? e.message : e) }); } catch {} }
        });

        btnTunnel.addEventListener('click', () => {
          try {
            const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
            if (!picks.length) { Log.log('UI', 'Voxel tunnel: no picks', {}); return; }
            const bySpace = new Map();
            for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
            const spacesById = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
            const added = [];
            function clusterVoxels(points) {
              // points: array of {x,y,z}
              const key = (x,y,z) => `${x},${y},${z}`;
              const map = new Map();
              for (const p of points) { if (!p) continue; map.set(key(p.x|0,p.y|0,p.z|0), { x:p.x|0, y:p.y|0, z:p.z|0 }); }
              const visited = new Set();
              const comps = [];
              const neigh = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
              for (const [k, start] of map.entries()) {
                if (visited.has(k)) continue;
                const comp = [];
                const q = [start]; visited.add(k);
                while (q.length) {
                  const cur = q.shift();
                  comp.push(cur);
                  for (const d of neigh) {
                    const nx = cur.x + d[0], ny = cur.y + d[1], nz = cur.z + d[2];
                    const nk = key(nx,ny,nz);
                    if (map.has(nk) && !visited.has(nk)) { visited.add(nk); q.push(map.get(nk)); }
                  }
                }
                comps.push(comp);
              }
              return comps;
            }
            for (const [sid, arr] of bySpace.entries()) {
              const s = spacesById.get(sid); if (!s) continue;
              const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
              const comps = clusterVoxels(arr);
              for (const comp of comps) {
                // Compute voxel centroid in world for this component
                let sum = new BABYLON.Vector3(0,0,0); let n = 0;
                for (const p of comp) { const w = worldPointFromVoxelIndex(s, p.x, p.y, p.z); if (w) { sum = sum.add(w); n++; } }
                if (n === 0) continue;
                const centroid = sum.scale(1 / n);
                const center = new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
                let dir = centroid.subtract(center); const len = dir.length();
                if (!(len > 1e-6)) dir = new BABYLON.Vector3(0,0,1); else dir = dir.scale(1/len);
                // Tunnel dimensions (box): increase size by ~50%
                // Cross‑section: thicker for visibility; Length: ~3/8 of cavern size
                let minWidth = 6; try { minWidth = Math.max(1, Number(localStorage.getItem('dw:ops:minTunnelWidth')||'6')||6); } catch {}
                const cs = Math.max(6, minWidth);
                const maxDim = Math.max(1, (s.size?.x|0) || 1, (s.size?.y|0) || 1, (s.size?.z|0) || 1);
                const L = Math.max(12, Math.round(maxDim * 0.375));
                const tunnelRes = res; // match base space resolution
                const sizeVox = { x: cs, y: cs, z: L };
                // Position: ensure the inner end penetrates well inside the cavern so merges create an opening
                const halfLen = (L * tunnelRes) / 2;
                const depthInside = Math.max(cs * tunnelRes * 1.5, (maxDim * tunnelRes) * 0.20, 2 * tunnelRes); // ensure >= 2 vox inside
                const origin = centroid.add(dir.scale(halfLen - depthInside));
                // Orientation: align local Z with dir (yaw/pitch)
                const yaw = Math.atan2(dir.x, dir.z);
                const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)));
                const rot = { x: pitch, y: yaw, z: 0 };
                const baseId = (s.id || 'space') + '-tunnel';
                const id = uniqueId(baseId);
                const tunnel = { id, type: 'Tunnel', size: sizeVox, origin: { x: origin.x, y: origin.y, z: origin.z }, res: tunnelRes, rotation: rot };
                try { state.barrow.spaces.push(tunnel); added.push(id); } catch {}
              }
            }
            if (added.length) {
              try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
              try { rebuildScene(); } catch {}
              try { renderDbView(state.barrow); } catch {}
              try { scheduleGridUpdate(); } catch {}
              try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-add-tunnel', added } })); } catch {}
              Log.log('UI', 'Voxel tunnel: added', { added });
            } else {
              Log.log('UI', 'Voxel tunnel: none added', {});
            }
          } catch (e) { logErr('EH:voxelAddTunnel', e); }
        });
      } catch (e) { logErr('EH:addVoxelOpsSection', e); }
    })();

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
    // Tabs activation handled by initTabsUI
  })();

  // ——————————— External transforms (buttons/commands) ———————————
  window.addEventListener('dw:transform', (e) => {
    try { ensureRotWidget(); ensureMoveWidget(); rebuildHalos(); } catch {}
  });

  // ——————————— DB UI handlers moved to handlers/ui/db.mjs ———————————
  try {
    initDbUiHandlers({
      scene, engine, camApi, camera, state,
      helpers: { ...helpers, exitCavernMode, exitScryMode },
      gizmo: { ensureRotWidget, ensureMoveWidget, disposeRotWidget, disposeMoveWidget }
    });
  } catch (e) { logErr('EH:dbUi:init', e); }
}
