import { Log, logErr, sLog, inputLog, modsOf, comboName, dPick } from '../util/log.mjs';
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
  try { initPanelUI({ panel, collapsePanelBtn, engine, Log }); } catch {}

  try { initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget: sceneApi.ensureRotWidget, ensureMoveWidget: sceneApi.ensureMoveWidget }); } catch {}
  try {
    try { Log.log('TRACE', 'selection:init:call', {}); } catch {}
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
    try { Log.log('TRACE', 'selection:init:ok', {}); } catch {}
  } catch (e) { try { Log.log('ERROR', 'selection:init:fail', { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {} }

  function clearAllSelection() {
    let clearedSpaces = false;
    let clearedPP = false;
    try {
      if (state.selection?.size) { state.selection.clear(); clearedSpaces = true; }
    } catch {}
    try {
      if (state?._connect?.sel instanceof Set && state._connect.sel.size) {
        state._connect.sel.clear();
        clearedPP = true;
      }
    } catch {}
    if (clearedPP) {
      try { sceneApi.disposeConnectGizmo?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:connect:update')); } catch {}
    }
    if (clearedSpaces || clearedPP) {
      try { rebuildHalos?.(); } catch {}
      try { sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
      try { Log.log('UI', 'Clear selection (Esc)', { spaces: clearedSpaces, pp: clearedPP, mode: state.mode }); } catch {}
    }
  }

  window.addEventListener('keydown', (e) => {
    try {
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
      try { helpers.saveBarrow ? helpers.saveBarrow(state.barrow) : null; helpers.snapshot ? helpers.snapshot(state.barrow) : null; } catch {}
      try { sceneApi.disposeMoveWidget?.(); } catch {}
      try { sceneApi.disposeRotWidget?.(); } catch {}
      try { rebuildScene?.(); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { scheduleGridUpdate?.(); } catch {}
      try { rebuildHalos?.(); } catch {}
      try { sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      try { Log.log('UI', 'Delete spaces', { removed: toDelete, keptVoxelized: skipped, before, after: state.barrow.spaces.length }); } catch {}
    } catch {}
  });

  window.addEventListener('resize', () => engine.resize());

  (function setupTabs() {
    try {
      const created = buildTabPanel({ renderDbView, state, Log }) || {};
      const editDom = created.editDom || null;
      try { initTestTab({ pane: created.testPane, scene, camera, state }); } catch (e) { logErr('EH:testTab:init', e); }
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
    } catch (e) { logErr('EH:tabs:init', e); }
  })();

  window.addEventListener('dw:transform', () => {
    try { sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.(); rebuildHalos?.(); } catch {}
  });

  try {
    initDbUiHandlers({
      scene, engine, camApi, camera, state,
      helpers: { ...helpers, exitCavernMode: sceneApi.exitCavernMode, exitScryMode: sceneApi.exitScryMode },
      gizmo: { ensureRotWidget: sceneApi.ensureRotWidget, ensureMoveWidget: sceneApi.ensureMoveWidget, disposeRotWidget: sceneApi.disposeRotWidget, disposeMoveWidget: sceneApi.disposeMoveWidget }
    });
  } catch (e) { logErr('EH:dbUi:init', e); }
}
