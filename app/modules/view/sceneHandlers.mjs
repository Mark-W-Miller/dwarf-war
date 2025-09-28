import { Log, logErr, sLog, inputLog, modsOf, comboName, dPick } from '../util/log.mjs';
import { initScryApi } from './handlers/scry.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initRouter } from './router.mjs';
import { initGizmoSystem, getVoxelPickWorldCenter as computeVoxelPickWorldCenter } from './handlers/gizmo.mjs';
import { initCavernApi } from './handlers/cavern.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { getSelectionCenter as computeSelectionCenter } from './handlers/ui/selection.mjs';
import { decompressVox, VoxelType } from '../voxels/voxelize.mjs';
import { saveBarrow, snapshot } from '../barrow/store.mjs';
import { renderDbView } from './dbTab.mjs';

export function initSceneHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, rebuildScene, rebuildHalos, scheduleGridUpdate } = helpers || {};

  let _gizmosSuppressed = false;
  let _gizmo = null;
  let _scryApi = null;
  let _cavernApi = null;

  const getSelectionCenter = () => { try { return computeSelectionCenter(state); } catch { return null; } };
  const getVoxelPickWorldCenter = () => { try { return computeVoxelPickWorldCenter(state); } catch { return null; } };

  try { _scryApi = initScryApi({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:scry:init', e); }
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function enterScryMode() { try { _scryApi?.enterScryMode?.(); } catch { } }
  function exitScryMode() { try { _scryApi?.exitScryMode?.(); } catch { } }

  // LEGACY INPUT HANDLER (disabled): kept for reference only — NOT attached.
  // To re-enable temporarily for debugging, attach with:
  //   scene.onPointerObservable.add(legacyScenePointerHandler);
  function legacyScenePointerHandler(pi) {
    const ev = pi.event || window.event;
    // Cavern mode click handling (voxel lock + scry double‑tap)
    if (state.mode === 'cavern' && pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      sLog('cm:pointerdown', { x: scene.pointerX, y: scene.pointerY, button: ev?.button, meta: !!ev?.metaKey, shift: !!ev?.shiftKey });
      try {
        const pickBall = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'scryBall');
        if (pickBall?.hit && pickBall.pickedMesh) {
          const now = performance.now();
          const last = state._scry?.lastClickTime || 0;
          const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
          if ((now - last) <= DOUBLE_CLICK_MS) { enterScryMode(); state._scry.lastClickTime = 0; return; }
          state._scry.lastClickTime = now; return;
        }
      } catch (e) { logErr('EH:cm:pickBall', e); }
      // lock voxel on plain left click
      try {
        const isLeft = (typeof ev?.button === 'number') ? (ev.button === 0) : true;
        if (!isLeft) return;
        let pointerSpaceId = null;
        try {
          const spacePick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && m.name.startsWith('space:'));
          if (spacePick?.hit && spacePick.pickedMesh) pointerSpaceId = String(spacePick.pickedMesh.name).slice('space:'.length).split(':')[0];
        } catch {}
        const sid = pointerSpaceId || state._scry?.spaceId || (Array.from(state.selection || [])[0] || null);
        const s = (state?.barrow?.spaces || []).find(x => x && x.id === sid);
        if (!s || !s.vox || !s.vox.size) return;
        let pick = s.voxPick;
        if (!pick) {
          const vox = decompressVox(s.vox);
          const nx = Math.max(1, vox.size?.x || 1), ny = Math.max(1, vox.size?.y || 1), nz = Math.max(1, vox.size?.z || 1);
          const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
          const roW = ray.origin.clone(), rdW = ray.direction.clone();
          const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
          let q = BABYLON.Quaternion.Identity(); const worldAligned = !!(s.vox && s.vox.worldAligned);
          try { if (!worldAligned) { const rx=Number(s.rotation?.x||0)||0, ry=(typeof s.rotation?.y==='number')?Number(s.rotation.y):Number(s.rotY||0)||0, rz=Number(s.rotation?.z||0)||0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
          const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), BABYLON.Quaternion.Inverse(q), BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
          const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
          const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
          const minX = -(nx * res) / 2, maxX = +(nx * res) / 2, minY = -(ny * res) / 2, maxY = +(ny * res) / 2, minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
          const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
          const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
          const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
          const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
          const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
          const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
          if (tmax >= Math.max(0, tmin)) {
            const EPS = 1e-6; let t = Math.max(tmin, 0) + EPS;
            const toIdx = (x, y, z) => ({ ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))), iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))), iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))) });
            let pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
            let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
            const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0), stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0), stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
            const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
            let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
            let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
            let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
            const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity, tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity, tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
            let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
            const yCut = ny - hideTop; const data = Array.isArray(vox.data) ? vox.data : [];
            let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
            while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
              if (iy < yCut) { const flat = ix + nx * (iy + ny * iz), v = data[flat] ?? VoxelType.Uninstantiated; if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) { pick = { x: ix, y: iy, z: iz, v }; break; } }
              if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
              else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
              else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
            }
          }
        }
        if (!pick) return;
        s.voxPick = pick;
        state.lockedVoxPick = { id: s.id, x: pick.x, y: pick.y, z: pick.z, v: pick.v };
        state.lastVoxPick = { ...state.lockedVoxPick };
        try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: pick.x, j: pick.y, k: pick.z, v: pick.v } })); } catch {}
        try { rebuildHalos?.(); } catch {}
        dPick('voxelPick:lock', { id: s.id, x: pick.x, y: pick.y, z: pick.z });
        sLog('cm:lockVoxel', { id: s.id, x: pick.x, y: pick.y, z: pick.z });
        ev.preventDefault(); ev.stopPropagation();
      } catch (e) { logErr('EH:cavern:voxelLock', e); }
      return;
    }
    // Edit mode: legacy selection is disabled (router handles inputs). No-op.
    if (state.mode === 'edit' && pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      return;
    }
  }

  // Failsafe (legacy): not attached; router manages camera pointers centrally.

  // Attach debug router logs before view handlers so logs still appear
  try { initRouter({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:router:init', e); }
  try { initViewManipulations({ scene, engine, camera, state, helpers: { getSelectionCenter, getVoxelPickWorldCenter } }); } catch (e) { logErr('EH:view:init', e); }

  try {
    const giz = initGizmoSystem({
      scene, engine, camera, state,
      renderDbView,
      saveBarrow, snapshot, scheduleGridUpdate, rebuildScene,
      helpers: {}
    });
    _gizmo = giz;
  } catch (e) { logErr('EH:gizmo:init', e); }

  // Keep PP gizmo synced with node selection/position updates
  try { window.addEventListener('dw:connect:update', () => { try { _gizmo?.ensureConnectGizmoFromSel?.(); } catch {} }); } catch {}

  // Gizmo pre-capture is handled centrally in routeDebug; no Babylon pre-observer here.

  try {
    _cavernApi = initCavernApi({
      scene, engine, camera, state,
      helpers: { rebuildScene, rebuildHalos, setMode, setGizmoHudVisible: _gizmo?.setGizmoHudVisible, disposeMoveWidget: _gizmo?.disposeMoveWidget, disposeRotWidget: _gizmo?.disposeRotWidget },
      scryApi: _scryApi,
      Log,
    });
  } catch (e) { logErr('EH:cavern:init', e); }

  let _vox = null;
  try {
    _vox = initVoxelHandlers({ scene, engine, camera, state });
    _vox.initVoxelHover({ isGizmoBusy: () => { try { return !!(_gizmo?.rotWidget?.dragging || _gizmo?.moveWidget?.dragging); } catch { return false; } } });
  } catch (e) { logErr('EH:voxel:init', e); }

  return {
    // exposure for UI module
    isGizmosSuppressed: () => _gizmosSuppressed,
    getRotWidget: () => _gizmo?.rotWidget,
    getMoveWidget: () => _gizmo?.moveWidget,
    ensureRotWidget: _gizmo?.ensureRotWidget,
    ensureMoveWidget: _gizmo?.ensureMoveWidget,
    disposeRotWidget: _gizmo?.disposeRotWidget,
    disposeMoveWidget: _gizmo?.disposeMoveWidget,
    pickPointOnPlane: _gizmo?.pickPointOnPlane,
    disposeLiveIntersections: _gizmo?.disposeLiveIntersections,
    updateLiveIntersectionsFor: _gizmo?.updateLiveIntersectionsFor,
    updateSelectionObbLive: _gizmo?.updateSelectionObbLive,
    updateContactShadowPlacement: _gizmo?.updateContactShadowPlacement,
    ensureConnectGizmoFromSel: _gizmo?.ensureConnectGizmoFromSel,
    disposeConnectGizmo: _gizmo?.disposeConnectGizmo,
    setGizmoHudVisible: _gizmo?.setGizmoHudVisible,
    enterCavernModeForSpace: (id) => { try { _cavernApi?.enterCavernModeForSpace?.(id); } catch { } },
    exitCavernMode: () => { try { _cavernApi?.exitCavernMode?.(); } catch { } },
    exitScryMode,
    voxelHitAtPointerForSpace: (s) => { try { return _vox?.voxelHitAtPointerForSpace?.(s) || null; } catch { return null; } },
  };
}
