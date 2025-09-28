import { saveBarrow, snapshot } from '../barrow/store.mjs';
import { VoxelType, decompressVox } from '../voxels/voxelize.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { initScryApi } from './handlers/scry.mjs';
import { Log, logErr, sLog, mLog, inputLog, modsOf, comboName, dPick } from '../util/log.mjs';
import { renderDbView } from './dbTab.mjs';
import { initErrorBar } from './errorBar.mjs';
import { initDbUiHandlers } from './handlers/ui/db.mjs';
import { initGizmoSystem } from './handlers/gizmo.mjs';
import { initCavernApi } from './handlers/cavern.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initPanelUI } from './handlers/ui/panel.mjs';
import { initSelectionUI, initPointerSelection } from './handlers/ui/selection.mjs';
import { initTabsUI } from './handlers/ui/tabs.mjs';
import { buildTabPanel } from './tabPanel.mjs';
import { buildEditTab } from './editTab.mjs';
import { initEditUiHandlers } from './handlers/ui/edit.mjs';

// Initialize all UI and scene event handlers that were previously in main.mjs
export function initEventHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateHud } = helpers;

  // Gizmo integration placeholders (populated by handlers/gizmo.mjs)
  let _gizmosSuppressed = false;
  let _gizmo = null;
  let _scryApi = null;
  let _cavernApi = null;
  let setGizmoHudVisible = (v) => {};
  let renderGizmoHud = () => {};
  let suppressGizmos = (on) => { _gizmosSuppressed = !!on; };
  // Move gizmo stubs until gizmo API is bound
  let moveWidget = { dragging: false, preDrag: false, axis: null };
  // Ring helpers bound by gizmo module
  let setRingsDim = () => {};
  let setRingActive = () => {};
  let ensureMoveWidget = () => {};
  let disposeMoveWidget = () => {};
  // Connect gizmo stubs
  let ensureConnectGizmoFromSel = () => {};
  let disposeConnectGizmo = () => {};
  let _GIZMO_DCLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  // ——————————— Error banner ———————————
  try { initErrorBar(Log); } catch {}
  // Unified input logging helpers are provided by util/log.mjs

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
  // Edit tab DOM is built in editTab.mjs; handlers use those elements via initEditUiHandlers
  // DB tab (reset/export/import) elements are handled in handlers/ui/db.mjs

  const panel = document.getElementById('rightPanel');
  const collapsePanelBtn = document.getElementById('collapsePanel');
  try { initPanelUI({ panel, collapsePanelBtn, engine, Log }); } catch {}

  // Mode and run/pause handlers are bound in handlers/ui/edit.mjs

  // Edit tab view toggles, proportional size, size fields, and controls are handled in handlers/ui/edit.mjs

  // ——————————— Debug helpers ———————————
  // dPick provided by util/log.mjs (respects Pick Debug setting)

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
  // Initialize Scry API
  try { _scryApi = initScryApi({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:scry:init', e); }

  // ——————————— Cavern Mode + Scry Ball ———————————
  // Keep a reference to the scry ball and view state so we can restore War Room View
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function disposeScryBall() { try { _scryApi?.disposeScryBall?.(); } catch {} }

  function findScryWorldPosForSpace(space) { try { return _scryApi?.findScryWorldPosForSpace?.(space) || null; } catch { return null; } }

  function ensureScryBallAt(pos, diameter) { try { return _scryApi?.ensureScryBallAt?.(pos, diameter) || null; } catch { return null; } }

  function enterCavernModeForSpace(spaceId) { try { _cavernApi?.enterCavernModeForSpace?.(spaceId); } catch {} }

  function exitCavernMode() { try { _cavernApi?.exitCavernMode?.(); } catch {} }

  // ——————————— Scryball Mode ———————————
  function voxelValueAtWorld(space, wx, wy, wz) {
    try { return _vox?.voxelValueAtWorld?.(space, wx, wy, wz); } catch { return VoxelType.Uninstantiated; }
  }

  // Helper: perform voxel pick at current pointer for a given space and dispatch dw:voxelPick
  function doVoxelPickAtPointer(s) { try { _vox?.doVoxelPickAtPointer?.(s); } catch {} }

  // Helper: compute first solid voxel hit under current pointer for space (without side effects)
  // Returns { hit:true, t, ix, iy, iz, v } or null
  function voxelHitAtPointerForSpace(s) { try { return _vox?.voxelHitAtPointerForSpace?.(s) || null; } catch { return null; } }
  function enterScryMode() { try { _scryApi?.enterScryMode?.(); } catch {} }
  function exitScryMode() { try { _scryApi?.exitScryMode?.(); } catch {} }

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
  // Resize grid handled in handlers/ui/edit.mjs

  // Reset/Export/Import handled in handlers/ui/db.mjs

  // ——————————— Name suggestion and validation ———————————
  // Edit tab: name suggestion and input enabling handled in handlers/ui/edit.mjs

  // Edit tab: New Space, Fit View, defaults, size fields, and transform nudges are handled in handlers/ui/edit.mjs

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

  // ——————————— Contact shadow helpers ———————————
  function updateContactShadowPlacement() { try { _gizmo?.updateContactShadowPlacement?.(); } catch {} }
  function disposeContactShadow() { try { _gizmo?.disposeContactShadow?.(); } catch {} }
  function disposeLiveIntersections(){ try { _gizmo?.disposeLiveIntersections?.(); } catch {} }
  function updateLiveIntersectionsFor(selectedId){ try { _gizmo?.updateLiveIntersectionsFor?.(selectedId); } catch {} }

  // Update selection OBB lines live (dispose and rebuild for selected ids)
  function updateSelectionObbLive() { try { _gizmo?.updateSelectionObbLive?.(); } catch {} }

  // Update move disc position to follow current selection bottom and center
  // updateMoveDiscPlacement is now internal to gizmo

  // ——————————— Move widget ———————————

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

  // Live voxel hover handled in voxel handlers

  // ——————————— View (camera) manipulations ———————————
  try { initViewManipulations({ scene, engine, camera, state, helpers: { getSelectionCenter, getVoxelPickWorldCenter } }); } catch (e) { logErr('EH:view:init', e); }

  // ——————————— Gizmo system (pre-capture + transform) ———————————
  try {
    const giz = initGizmoSystem({
      scene, engine, camera, state,
      renderDbView,
      saveBarrow, snapshot, scheduleGridUpdate, rebuildScene,
      helpers: { updateContactShadowPlacement, updateSelectionObbLive, updateLiveIntersectionsFor }
    });
    _gizmo = giz;
    rotWidget = giz.rotWidget; moveWidget = giz.moveWidget;
    disposeRotWidget = giz.disposeRotWidget; ensureRotWidget = giz.ensureRotWidget;
    disposeMoveWidget = giz.disposeMoveWidget; ensureMoveWidget = giz.ensureMoveWidget;
    pickPointOnPlane = giz.pickPointOnPlane; setRingsDim = giz.setRingsDim; setRingActive = giz.setRingActive;
    ensureConnectGizmoFromSel = giz.ensureConnectGizmoFromSel; disposeConnectGizmo = giz.disposeConnectGizmo;
    updateRotWidgetFromMesh = giz.updateRotWidgetFromMesh; _GIZMO_DCLICK_MS = giz._GIZMO_DCLICK_MS;
    setGizmoHudVisible = giz.setGizmoHudVisible; renderGizmoHud = giz.renderGizmoHud;
    suppressGizmos = (on) => { _gizmosSuppressed = !!on; try { giz.suppressGizmos(on); } catch {} };
  } catch (e) { logErr('EH:gizmo:init', e); }

  // Initialize Cavern API now that gizmo callbacks are bound
  try {
    _cavernApi = initCavernApi({
      scene, engine, camera, state,
      helpers: { rebuildScene, rebuildHalos, setMode, setGizmoHudVisible, disposeMoveWidget, disposeRotWidget },
      scryApi: _scryApi,
      Log,
    });
  } catch (e) { logErr('EH:cavern:init', e); }

  // ——————————— Voxel helpers init (hover + helpers) ———————————
  let _vox = null;
  try {
    _vox = initVoxelHandlers({ scene, engine, camera, state });
    _vox.initVoxelHover({ isGizmoBusy: () => { try { return !!(rotWidget?.dragging || moveWidget?.dragging); } catch { return false; } } });
  } catch (e) { logErr('EH:voxel:init', e); }

  // Selection UI side-effects
  try { initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget, ensureMoveWidget }); } catch {}
  // Pointer selection & double-click moved to handlers/ui/selection.mjs
  try {
    try { Log.log('TRACE', 'selection:init:call', {}); } catch {}
    initPointerSelection({
      scene, engine, camera, state, camApi,
      rebuildHalos, ensureRotWidget, ensureMoveWidget, disposeLiveIntersections,
      voxelHitAtPointerForSpace,
      pickPointOnPlane,
      isGizmosSuppressed: () => _gizmosSuppressed,
      getRotWidget: () => rotWidget,
      getMoveWidget: () => moveWidget,
      enterCavernModeForSpace,
      ensureConnectGizmoFromSel, disposeConnectGizmo,
      Log, dPick, sLog, inputLog, modsOf, comboName,
    });
    try { Log.log('TRACE', 'selection:init:ok', {}); } catch {}
  } catch (e) { try { Log.log('ERROR', 'selection:init:fail', { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {} }

  

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

  // Panel collapse/resize + header buttons handled in ui/panel.mjs

  // ——————————— Tabs setup ———————————
  (function setupTabs() {
    try {
      const created = buildTabPanel({ renderDbView, state, Log }) || {};
      const editDom = created.editDom || null;
      // Bind Edit tab handlers once DOM is in place
      initEditUiHandlers({
        scene, engine, camera, state, Log,
        dom: editDom,
        helpers: {
          saveBarrow, snapshot, rebuildScene, rebuildHalos, scheduleGridUpdate, renderDbView,
          pickPointOnPlane, moveSelection, setMode, setRunning,
          ensureRotWidget, ensureMoveWidget, disposeRotWidget, disposeMoveWidget,
          applyViewToggles, updateGridExtent: helpers.updateGridExtent, camApi
        }
      });
    } catch (e) { logErr('EH:tabs:init', e); }
  })();

  // ——————————— External transforms (buttons/commands) ———————————
  window.addEventListener('dw:transform', (e) => {
    try { ensureRotWidget(); ensureMoveWidget(); rebuildHalos(); } catch {}
  });

  // ——————————— DB UI handlers ———————————
  try {
    initDbUiHandlers({
      scene, engine, camApi, camera, state,
      helpers: { ...helpers, exitCavernMode, exitScryMode },
      gizmo: { ensureRotWidget, ensureMoveWidget, disposeRotWidget, disposeMoveWidget }
    });
  } catch (e) { logErr('EH:dbUi:init', e); }
}
