import { Log, logErr } from '../util/log.mjs';
import { initScryApi } from './handlers/scry.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initRouter } from './router.mjs';
import { getVoxelPickWorldCenter as computeVoxelPickWorldCenter } from './handlers/gizmo.mjs';
import { createGizmoBuilder } from './gizmoBuilder.mjs';
import { initCavernApi } from './handlers/cavern.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { getSelectionCenter as computeSelectionCenter } from './handlers/ui/selection.mjs';
import { saveBarrow, snapshot } from '../barrow/store.mjs';
import { renderDbView } from './dbTab.mjs';

export function initSceneHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, rebuildScene, rebuildHalos, scheduleGridUpdate, moveSelection } = helpers || {};

  let _gizmosSuppressed = false;
  const noop = () => {};
  const noopPromise = async () => {};
  const disabledGizmoApi = {
    ensureRotWidget: noop,
    ensureMoveWidget: noop,
    disposeRotWidget: noop,
    disposeMoveWidget: noop,
    pickPointOnPlane: () => null,
    disposeLiveIntersections: noop,
    updateLiveIntersectionsFor: noop,
    updateSelectionObbLive: noop,
    updateContactShadowPlacement: noop,
    ensureConnectGizmoFromSel: noop,
    disposeConnectGizmo: noop,
    setGizmoHudVisible: noop,
    rotWidget: null,
    moveWidget: null,
  };
  let _scryApi = null;
  let _cavernApi = null;
  let _selectionGizmo = null;
  let _translationHandler = null;

  const getSelectionCenter = () => { try { return computeSelectionCenter(state); } catch { return null; } };
  const getVoxelPickWorldCenter = () => { try { return computeVoxelPickWorldCenter(state); } catch { return null; } };

  try { _scryApi = initScryApi({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:scry:init', e); }
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function exitScryMode() { try { _scryApi?.exitScryMode?.(); } catch { } }

  // Attach debug router logs before view handlers so logs still appear
  try { initRouter({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:router:init', e); }
  try { initViewManipulations({ scene, engine, camera, state, helpers: { getSelectionCenter, getVoxelPickWorldCenter } }); } catch (e) { logErr('EH:view:init', e); }

  const _gizmo = disabledGizmoApi;

  function initSelectionGizmo() {
    try {
      _selectionGizmo = createGizmoBuilder({
        scene,
        camera,
        log: (evt, data) => {
          try { Log.log('GIZMO_2', evt, data); } catch {}
        },
        translationHandler: _translationHandler
      });
      _selectionGizmo.setActive(false);
      state._selectionGizmo = _selectionGizmo;
    } catch (e) { logErr('EH:gizmo2:init', e); }
  }

  // Legacy gizmo system disabled; ensure downstream consumers work with no-op API.
  try { window.addEventListener('dw:connect:update', () => { /* legacy gizmo disabled */ }); } catch {}

  try {
    _cavernApi = initCavernApi({
      scene, engine, camera, state,
      helpers: { rebuildScene, rebuildHalos, setMode, setGizmoHudVisible: _gizmo.setGizmoHudVisible, disposeMoveWidget: _gizmo.disposeMoveWidget, disposeRotWidget: _gizmo.disposeRotWidget },
      scryApi: _scryApi,
      Log,
    });
  } catch (e) { logErr('EH:cavern:init', e); }

  let _vox = null;
  try {
    _vox = initVoxelHandlers({ scene, engine, camera, state });
    _vox.initVoxelHover({ isGizmoBusy: () => { try { return !!(_gizmo?.rotWidget?.dragging || _gizmo?.moveWidget?.dragging); } catch { return false; } } });
  } catch (e) { logErr('EH:voxel:init', e); }

  function gatherSelectionTargets() {
    const accumulator = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity }, count: 0 };

    const expandBounds = (minVec, maxVec) => {
      if (!minVec || !maxVec) return;
      accumulator.min.x = Math.min(accumulator.min.x, minVec.x);
      accumulator.min.y = Math.min(accumulator.min.y, minVec.y);
      accumulator.min.z = Math.min(accumulator.min.z, minVec.z);
      accumulator.max.x = Math.max(accumulator.max.x, maxVec.x);
      accumulator.max.y = Math.max(accumulator.max.y, maxVec.y);
      accumulator.max.z = Math.max(accumulator.max.z, maxVec.z);
      accumulator.count++;
    };

    const expandPoint = (pos, radius = 0.8) => {
      if (!pos) return;
      accumulator.min.x = Math.min(accumulator.min.x, pos.x - radius);
      accumulator.min.y = Math.min(accumulator.min.y, pos.y - radius);
      accumulator.min.z = Math.min(accumulator.min.z, pos.z - radius);
      accumulator.max.x = Math.max(accumulator.max.x, pos.x + radius);
      accumulator.max.y = Math.max(accumulator.max.y, pos.y + radius);
      accumulator.max.z = Math.max(accumulator.max.z, pos.z + radius);
      accumulator.count++;
    };

    try {
      const selectedSpaces = Array.from(state?.selection || []);
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      for (const id of selectedSpaces) {
        const entry = builtSpaces.find((x) => x && x.id === id);
        const mesh = entry?.mesh;
        if (!mesh) continue;
        try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
        const bb = mesh.getBoundingInfo()?.boundingBox;
        if (!bb) continue;
        expandBounds(bb.minimumWorld, bb.maximumWorld);
      }
    } catch {}

    try {
      const connectSel = (state?._connect?.sel instanceof Set) ? Array.from(state._connect.sel) : [];
      for (const name of connectSel) {
        if (!name) continue;
        let mesh = null;
        try { mesh = scene.getMeshByName(name); } catch {}
        if (!mesh) {
          try { mesh = scene.getMeshByName(`${name}:mesh`); } catch {}
        }
        if (!mesh) continue;
        let pos = null;
        try { pos = mesh.getAbsolutePosition ? mesh.getAbsolutePosition() : mesh.position; } catch {}
        if (!pos) continue;
        expandPoint(pos, 0.9);
      }
    } catch {}

    if (accumulator.count === 0) return null;

    const minSpan = 1.2;
    const ensureSpan = (minVal, maxVal) => {
      if (!isFinite(minVal) || !isFinite(maxVal)) return [minVal, maxVal];
      const span = maxVal - minVal;
      if (span >= minSpan) return [minVal, maxVal];
      const mid = (minVal + maxVal) / 2;
      return [mid - minSpan / 2, mid + minSpan / 2];
    };

    const [minX, maxX] = ensureSpan(accumulator.min.x, accumulator.max.x);
    const [minY, maxY] = ensureSpan(accumulator.min.y, accumulator.max.y);
    const [minZ, maxZ] = ensureSpan(accumulator.min.z, accumulator.max.z);

    try {
      Log.log('GIZMO_2', 'selection:gizmo:bounds', {
        count: accumulator.count,
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ }
      });
    } catch {}

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ }
    };
  }

  function buildTranslationContext() {
    const context = { spaceIds: [], nodeTargets: [] };
    try {
      const selectedSpaces = Array.from(state?.selection || []);
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      for (const id of selectedSpaces) {
        const entry = builtSpaces.find((x) => x && x.id === id);
        const mesh = entry?.mesh;
        if (!mesh) continue;
        context.spaceIds.push(id);
      }
    } catch {}

    try {
      const nodes = Array.isArray(state?._connect?.nodes) ? state._connect.nodes : [];
      for (const node of nodes) {
        const mesh = node?.mesh;
        if (!mesh) continue;
        let start = null;
        try { start = mesh.getAbsolutePosition ? mesh.getAbsolutePosition().clone() : mesh.position.clone(); }
        catch { start = mesh.position ? mesh.position.clone() : null; }
        if (!start) continue;
        context.nodeTargets.push({ mesh, start });
      }
    } catch {}

    return context;
  }

  _translationHandler = {
    begin() {
      return buildTranslationContext();
    },
    apply(context, totalDelta, deltaStep) {
      if (!context || !totalDelta || !deltaStep) return;
      if (context.spaceIds?.length && typeof moveSelection === 'function' && deltaStep.lengthSquared() > 1e-6) {
        try { moveSelection(deltaStep.x, deltaStep.y, deltaStep.z); }
        catch (e) { logErr('EH:gizmo2:apply', e); }
      }
      for (const target of context.nodeTargets || []) {
        const mesh = target?.mesh;
        const start = target?.start;
        if (!mesh || !start) continue;
        start.addInPlace(deltaStep);
        try { mesh.setAbsolutePosition(start); }
        catch { try { mesh.position.copyFrom(start); } catch {} }
      }
    },
    cancel() {
      // no-op for spaces once moveSelection has been applied incrementally
    },
    commit(context, totalDelta) {
      if (!context || !totalDelta) return;
      if (context.spaceIds?.length) setTimeout(() => updateSelectionGizmo(), 0);
    }
  };

  initSelectionGizmo();
  updateSelectionGizmo();

  function updateSelectionGizmo() {
    if (!_selectionGizmo) return;
    const bounds = gatherSelectionTargets();
    if (!bounds) {
      try { Log.log('GIZMO_2', 'selection:gizmo:update', { active: false, reason: 'no-bounds', selection: Array.from(state?.selection || []), connect: state?._connect?.sel ? Array.from(state._connect.sel) : [] }); } catch {}
      _selectionGizmo.setActive(false);
      return;
    }
    try {
      _selectionGizmo.setBounds(bounds);
      _selectionGizmo.setActive(true);
      try { Log.log('GIZMO_2', 'selection:gizmo:update', { active: true, bounds }); } catch {}
    } catch (e) { logErr('EH:gizmo2:update', e); }
  }

  window.addEventListener('dw:selectionChange', () => updateSelectionGizmo());
  window.addEventListener('dw:connect:update', () => updateSelectionGizmo());
  window.addEventListener('dw:transform', () => updateSelectionGizmo());

  setTimeout(() => updateSelectionGizmo(), 0);

  const api = {
    // exposure for UI module
    isGizmosSuppressed: () => _gizmosSuppressed,
    getRotWidget: () => _gizmo.rotWidget,
    getMoveWidget: () => _gizmo.moveWidget,
    ensureRotWidget: _gizmo.ensureRotWidget,
    ensureMoveWidget: _gizmo.ensureMoveWidget,
    disposeRotWidget: _gizmo.disposeRotWidget,
    disposeMoveWidget: _gizmo.disposeMoveWidget,
    pickPointOnPlane: _gizmo.pickPointOnPlane,
    disposeLiveIntersections: _gizmo.disposeLiveIntersections,
    updateLiveIntersectionsFor: _gizmo.updateLiveIntersectionsFor,
    updateSelectionObbLive: _gizmo.updateSelectionObbLive,
    updateContactShadowPlacement: _gizmo.updateContactShadowPlacement,
    ensureConnectGizmoFromSel: _gizmo.ensureConnectGizmoFromSel,
    disposeConnectGizmo: _gizmo.disposeConnectGizmo,
    setGizmoHudVisible: _gizmo.setGizmoHudVisible,
    enterCavernModeForSpace: (id) => { try { _cavernApi?.enterCavernModeForSpace?.(id); } catch { } },
    exitCavernMode: () => { try { _cavernApi?.exitCavernMode?.(); } catch { } },
    exitScryMode,
    voxelHitAtPointerForSpace: (s) => { try { return _vox?.voxelHitAtPointerForSpace?.(s) || null; } catch { return null; } },
  };
  try { state._sceneApi = api; } catch {}
  state._selectionGizmo = _selectionGizmo;
  state._selectionGizmoUpdate = updateSelectionGizmo;
  return api;
}
