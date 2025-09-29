import { Log, logErr } from '../util/log.mjs';
import { initScryApi } from './handlers/scry.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initRouter } from './router.mjs';
import { initGizmoSystem, getVoxelPickWorldCenter as computeVoxelPickWorldCenter } from './handlers/gizmo.mjs';
import { initCavernApi } from './handlers/cavern.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { getSelectionCenter as computeSelectionCenter } from './handlers/ui/selection.mjs';
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

  function exitScryMode() { try { _scryApi?.exitScryMode?.(); } catch { } }

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
