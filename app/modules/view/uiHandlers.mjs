import { Log, logErr, sLog, inputLog, modsOf, comboName, dPick } from '../util/log.mjs';
import { ensureConnectState, rebuildConnectMeshes, disposeConnectMeshes, syncConnectPathToDb } from './connectMeshes.mjs';
import { initPanelUI } from './handlers/ui/panel.mjs';
import { initSelectionUI, initPointerSelection } from './handlers/ui/selection.mjs';
import { buildTabPanel } from './tabPanel.mjs';
import { initEditUiHandlers } from './handlers/ui/edit.mjs';
import { initDbUiHandlers } from './handlers/ui/db.mjs';
import { initTestTab } from './testTab.mjs';
import { renderDbView } from './dbTab.mjs';

export function initUIHandlers({ scene, engine, camApi, camera, state, helpers, sceneApi }) {
  const { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateGridExtent } = helpers || {};

  const panel = document.getElementById('rightPanel');
  const collapsePanelBtn = document.getElementById('collapsePanel');
  initPanelUI({ panel, collapsePanelBtn, engine, Log });

  initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget: sceneApi.ensureRotWidget, ensureMoveWidget: sceneApi.ensureMoveWidget });
    Log.log('TRACE', 'selection:init:call', {});
  initPointerSelection({
    scene, engine, camera, state, camApi,
    rebuildHalos,
    ensureRotWidget: sceneApi.ensureRotWidget,
    ensureMoveWidget: sceneApi.ensureMoveWidget,
    disposeLiveIntersections: sceneApi.disposeLiveIntersections,
    voxelHitAtPointerForSpace: sceneApi.voxelHitAtPointerForSpace,
    pickPointOnPlane: sceneApi.pickPointOnPlane,
    isGizmosSuppressed: () => sceneApi.isGizmosSuppressed?.() || false,
    getRotWidget: () => sceneApi.getRotWidget?.() || null,
    getMoveWidget: () => sceneApi.getMoveWidget?.() || null,
    enterCavernModeForSpace: sceneApi.enterCavernModeForSpace,
    ensureConnectGizmoFromSel: sceneApi.ensureConnectGizmoFromSel,
    disposeConnectGizmo: sceneApi.disposeConnectGizmo,
    Log, dPick, sLog, inputLog, modsOf, comboName,
 });
  Log.log('TRACE', 'selection:init:ok', {});

  function clearAllSelection() {
    const hadSpaces = !!(state.selection && state.selection.size);
    state.selection?.clear?.();
    rebuildHalos?.();
    sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
    Log.log('UI', 'Clear space selection (Esc)', { spaces: hadSpaces, mode: state.mode });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state._scry?.scryMode) { e.preventDefault(); e.stopPropagation(); sceneApi.exitScryMode?.(); return; }
      if (state.mode === 'cavern') { e.preventDefault(); e.stopPropagation(); sceneApi.exitCavernMode?.(); return; }
      if (state.mode === 'war') {
        const t = e.target; const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : '';
        const isEditable = (tag === 'input') || (tag === 'textarea') || (t && t.isContentEditable) || (tag === 'select');
        if (!isEditable) {
          e.preventDefault();
          e.stopPropagation();
          clearAllSelection();
          return;
        }
      }
      if (state.mode === 'edit') {
        const t = e.target; const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : '';
        const isEditable = (tag === 'input') || (tag === 'textarea') || (t && t.isContentEditable) || (tag === 'select');
        if (!isEditable) {
          e.preventDefault();
          e.stopPropagation();
          clearAllSelection();
          return;
        }
      }
    }

    if (state.mode !== 'edit') return;
    const k = e.key;
    if (k !== 'Delete' && k !== 'Backspace') return;
    const t = e.target; const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : '';
    const isEditable = (tag === 'input') || (tag === 'textarea') || (t && t.isContentEditable) || (tag === 'select');
    if (isEditable) return;
    const rw = sceneApi.getRotWidget?.(); const mw = sceneApi.getMoveWidget?.();
    if (rw?.dragging || mw?.dragging || rw?.preDrag || mw?.preDrag) return;

    const connectState = ensureConnectState(state);
    if (connectState?.sel instanceof Set && connectState.sel.size) {
      e.preventDefault();
      e.stopPropagation();
      const path = Array.isArray(connectState.path) ? connectState.path.slice() : null;
      if (!path || !path.length) {
        connectState.sel.clear();
        disposeConnectMeshes(state);
        connectState.path = null;
        connectState.nodeSize = null;
        syncConnectPathToDb(state);
        window.dispatchEvent(new CustomEvent('dw:connect:update'));
        Log.log('PATH', 'pp:delete:no-path', {});
        return;
      }
      const indices = Array.from(new Set(Array.from(connectState.sel).map((name) => {
        const match = /connect:node:(\d+)/.exec(String(name));
        return match ? Number(match[1]) : null;
      }).filter((n) => Number.isFinite(n)))).sort((a, b) => b - a);
      connectState.sel.clear();
      let removed = 0;
      for (const idx of indices) {
        if (idx >= 0 && idx < path.length) {
          path.splice(idx, 1);
          removed++;
        }
      }
      Log.log('PATH', 'pp:delete:nodes', { indices, removed, remaining: path.length });
      if (path.length >= 2) {
        connectState.path = path;
        rebuildConnectMeshes({ scene, state, path, nodeSize: connectState.nodeSize });
        syncConnectPathToDb(state);
        window.dispatchEvent(new CustomEvent('dw:connect:update'));
      } else {
        connectState.path = null;
        connectState.nodeSize = null;
        disposeConnectMeshes(state);
        syncConnectPathToDb(state);
        window.dispatchEvent(new CustomEvent('dw:connect:update'));
        Log.log('PATH', 'pp:delete:cleared', {});
      }
      return;
    }
    const ids = Array.from(state.selection || []);
    if (!ids.length) return;
    const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
    const toDelete = ids.filter(id => { const s = byId.get(id); return s && !s.vox; });
    const skipped = ids.filter(id => { const s = byId.get(id); return s && !!s.vox; });
    if (!toDelete.length) return;
    e.preventDefault(); e.stopPropagation();
    const before = state.barrow.spaces.length;
    state.barrow.spaces = (state.barrow.spaces||[]).filter(s => !toDelete.includes(s.id));
    state.selection.clear();
    for (const id of skipped) state.selection.add(id);
    helpers.saveBarrow ? helpers.saveBarrow(state.barrow) : null; helpers.snapshot ? helpers.snapshot(state.barrow) : null;
    sceneApi.disposeMoveWidget?.();
    sceneApi.disposeRotWidget?.();
    rebuildScene?.();
    renderDbView(state.barrow);
    scheduleGridUpdate?.();
    rebuildHalos?.();
    sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    Log.log('UI', 'Delete spaces', { removed: toDelete, keptVoxelized: skipped, before, after: state.barrow.spaces.length });

 });

  window.addEventListener('resize', () => engine.resize());

  (function setupTabs() {
    const created = buildTabPanel({ renderDbView, state, Log }) || {};
    const editDom = created.editDom || null;
    initTestTab({ pane: created.testPane, scene, camera, state });
    initEditUiHandlers({
      scene, engine, camera, state, Log,
      dom: editDom,
      helpers: {
        saveBarrow: helpers.saveBarrow, snapshot: helpers.snapshot, rebuildScene, rebuildHalos, scheduleGridUpdate, renderDbView,
        pickPointOnPlane: sceneApi.pickPointOnPlane, moveSelection, setMode, setRunning,
        ensureRotWidget: sceneApi.ensureRotWidget, ensureMoveWidget: sceneApi.ensureMoveWidget,
        disposeRotWidget: sceneApi.disposeRotWidget, disposeMoveWidget: sceneApi.disposeMoveWidget,
        applyViewToggles, updateGridExtent, camApi,
        setTargetDotVisible: sceneApi.setTargetDotVisible,
        isTargetDotVisible: sceneApi.isTargetDotVisible
      }
 });

 })();

  window.addEventListener('dw:transform', () => {
    sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.(); rebuildHalos?.();
 });

  initDbUiHandlers({
    scene, engine, camApi, camera, state,
    helpers: { ...helpers, exitCavernMode: sceneApi.exitCavernMode, exitScryMode: sceneApi.exitScryMode },
    gizmo: { ensureRotWidget: sceneApi.ensureRotWidget, ensureMoveWidget: sceneApi.ensureMoveWidget, disposeRotWidget: sceneApi.disposeRotWidget, disposeMoveWidget: sceneApi.disposeMoveWidget }
 });

}
