// Database-related UI/event handlers split from eventHandler.mjs
// Initializes listeners for DB edits, selection via DB tree, delete/undo, and open-to-space.
import { saveBarrow, snapshot, undoLast, loadBarrow, cloneForSave, inflateAfterLoad, saveNamedBarrow, listSavedBarrows, loadNamedBarrow, removeNamedBarrow } from '../../../barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from '../../../barrow/builder.mjs';
import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from '../../../barrow/schema.mjs';
import { renderDbView } from '../../dbTab.mjs';
import { Log } from '../../../util/log.mjs';
import { rebuildConnectMeshes, disposeConnectMeshes, ensureConnectState, syncConnectPathToDb } from '../../connectMeshes.mjs';

export function initDbUiHandlers(ctx) {
  const { scene, engine, camApi, camera, state, helpers, gizmo } = ctx;
  const { rebuildScene, rebuildHalos, scheduleGridUpdate, updateHud, exitCavernMode, exitScryMode } = helpers || {};
  const ensureRotWidget = gizmo && gizmo.ensureRotWidget ? gizmo.ensureRotWidget : (() => {});
  const ensureMoveWidget = gizmo && gizmo.ensureMoveWidget ? gizmo.ensureMoveWidget : (() => {});
  const disposeRotWidget = gizmo && gizmo.disposeRotWidget ? gizmo.disposeRotWidget : (() => {});
  const disposeMoveWidget = gizmo && gizmo.disposeMoveWidget ? gizmo.disposeMoveWidget : (() => {});

  // Apply live DB edits back into scene and gizmos
  window.addEventListener('dw:dbEdit', (e) => {
    const d = e.detail || {}; const path = d.path; const value = d.value; const prev = d.prev;
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
          if (prev && state.selection.has(prev)) { state.selection.delete(prev); state.selection.add(candidate);  rebuildHalos();  }
        }
      }
    }

    // Persist + rebuild derived scene state
    saveBarrow(state.barrow); snapshot(state.barrow);
    disposeBuilt(state.built);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    renderDbView(state.barrow);
    rebuildHalos();
    scheduleGridUpdate();
    ensureRotWidget(); ensureMoveWidget();
    updateHud?.();
    Log.log('UI', 'DB edit applied', { path, value, prev });

 });

  // Delete selected spaces (from DB tab button)
  window.addEventListener('dw:dbDeleteSelected', (e) => {
    const ids = (e && e.detail && Array.isArray(e.detail.ids)) ? e.detail.ids : [];
    const before = (state?.barrow?.spaces || []).length;
    const delSet = new Set(ids.map(String));
    // Snapshot before deletion to support undo
    snapshot(state.barrow);
    // Remove spaces from model
    state.barrow.spaces = (state.barrow.spaces || []).filter(s => !delSet.has(String(s?.id)));
    // Clear selection of deleted ids
    for (const id of ids) state.selection.delete(id);
    // Persist + rebuild
    saveBarrow(state.barrow); snapshot(state.barrow);
    disposeBuilt(state.built);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    renderDbView(state.barrow);
    rebuildHalos();
    scheduleGridUpdate();
    ensureRotWidget(); ensureMoveWidget();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    updateHud?.();
    Log.log('UI', 'DB delete selected', { removed: ids, before, after: (state?.barrow?.spaces || []).length });

 });

  // Select all non-voxel spaces from DB tab
  window.addEventListener('dw:dbSelectNonVox', (e) => {
    const ids = (e && e.detail && Array.isArray(e.detail.ids)) ? e.detail.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return;
    if (!(state.selection instanceof Set)) state.selection = new Set(Array.isArray(state.selection) ? state.selection : []);
    state.selection.clear();
    for (const id of ids) state.selection.add(id);
    state._connect?.sel?.clear?.(); gizmo?.disposeConnectGizmo?.();
    rebuildHalos();
    ensureRotWidget(); ensureMoveWidget();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    Log.log('UI', 'Select non-voxel spaces', { count: ids.length });

 });

  // Undo last DB change (primarily deletes)
  window.addEventListener('dw:dbUndo', () => {
    const restored = undoLast();
    if (!restored) { Log.log('UI', 'Undo: nothing to undo', {}); return; }
    state.barrow = restored;
    // Rebuild scene and DB
    disposeBuilt(state.built);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    renderDbView(state.barrow);
    rebuildHalos();
    scheduleGridUpdate();
    ensureRotWidget(); ensureMoveWidget();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    updateHud?.();
    Log.log('UI', 'Undo: restored previous snapshot', {});

 });

  // DB navigation and selection (no camera center; selection only)
  window.addEventListener('dw:dbRowClick', (e) => {
    const { type, id, shiftKey } = e.detail || {};
    if (type !== 'space' || !id) return;
    if (shiftKey) {
      if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
 } else {
      state.selection.clear(); state.selection.add(id);
    }
    rebuildHalos(); ensureRotWidget(); ensureMoveWidget();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    Log.log('UI', 'DB row center', { id });

 });

  // Open DB tab to a specific space id
  window.addEventListener('dw:showDbForSpace', (e) => {
    const { id } = e.detail || {};
    if (!id) return;
    // Ensure panel is expanded/visible
    applyPanelCollapsed(false); localStorage.setItem(PANEL_STATE_KEY, '0');
    // Activate DB tab
    const dbBtn = document.querySelector('.tabs .tab[data-tab="tab-db"]');
    dbBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Ensure dbView exists
    const dbView = document.getElementById('dbView'); if (!dbView) return;
    // Open Spaces section
    const spaces = dbView.querySelector('#dbSpaces'); if (spaces) spaces.open = true;
    // Open specific space details and scroll into view
    let target = null;
    target = dbView.querySelector(`details[data-space-id="${id}"]`);
    if (!target) {
      target = Array.from(dbView.querySelectorAll('details[data-space-id]')).find(d => (d.dataset.spaceId || '') === String(id));
    }
    if (target) {
      target.open = true;
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

 });

  // Local helpers copied from eventHandler scope for DB open
  const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
  function applyPanelCollapsed(collapsed) {
    const panel = document.getElementById('rightPanel');
    const collapsePanelBtn = document.getElementById('collapsePanel');
    if (!panel || !collapsePanelBtn) return;
    panel.classList.toggle('collapsed', !!collapsed);
    if (panel.classList.contains('collapsed')) {
      const rect = panel.getBoundingClientRect();
      const w = rect.width;
      const tab = 36; // visible tab width for the collapse control
      panel.style.right = `${-(Math.max(40, w) - tab)}px`;
      panel.style.pointerEvents = 'none';

 } else {
      panel.style.right = '';
      panel.style.pointerEvents = '';
    }
  }

  // ——————————— Reset/Export/Import ———————————
  const resetBtn = document.getElementById('reset');
  const exportBtn = document.getElementById('export');
  const importBtn = document.getElementById('import');
  const importFile = document.getElementById('importFile');
  const testSelect = document.getElementById('dbTestSelect');
  const testBtn = document.getElementById('dbLoadTest');
  const saveDbBtn = document.getElementById('saveDb');
  const savedDbSelect = document.getElementById('savedDbSelect');
  const loadDbBtn = document.getElementById('loadDb');
  const deleteSavedDbBtn = document.getElementById('deleteSavedDb');

  function refreshSavedDbList(selectedName = null) {
    if (!savedDbSelect) return;
    const options = listSavedBarrows();
    savedDbSelect.innerHTML = '';
    if (!options.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No saved databases';
      opt.disabled = true;
      opt.selected = true;
      savedDbSelect.appendChild(opt);
      savedDbSelect.disabled = true;
      if (loadDbBtn) loadDbBtn.disabled = true;
      if (deleteSavedDbBtn) deleteSavedDbBtn.disabled = true;
      return;
    }
    savedDbSelect.disabled = false;
    const sorted = options.sort((a, b) => b.savedAt - a.savedAt);
    for (const entry of sorted) {
      const opt = document.createElement('option');
      opt.value = entry.name;
      const when = entry.savedAt ? new Date(entry.savedAt).toLocaleString() : '';
      opt.textContent = when ? `${entry.name} (${when})` : entry.name;
      if (selectedName && entry.name === selectedName) opt.selected = true;
      savedDbSelect.appendChild(opt);
    }
    if (!selectedName && savedDbSelect.options.length) {
      savedDbSelect.selectedIndex = 0;
    }
    const hasSelection = !!savedDbSelect.value;
    if (loadDbBtn) loadDbBtn.disabled = !hasSelection;
    if (deleteSavedDbBtn) deleteSavedDbBtn.disabled = !hasSelection;
  }

  function handleSavedSelectionChange() {
    if (!savedDbSelect) return;
    const hasSelection = !!savedDbSelect.value;
    if (loadDbBtn) loadDbBtn.disabled = !hasSelection;
    if (deleteSavedDbBtn) deleteSavedDbBtn.disabled = !hasSelection;
  }

  savedDbSelect?.addEventListener('change', handleSavedSelectionChange);

  function deriveSaveNameFromBarrow() {
    const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
    const first = spaces.find((s) => !!s);
    const fallback = state?.barrow?.id || 'barrow';
    const candidate = first?.name || first?.id || fallback;
    const trimmed = String(candidate ?? '').trim();
    return trimmed || 'barrow';
  }

  saveDbBtn?.addEventListener('click', () => {
    if (!state?.barrow) {
      Log.log('ERROR', 'DB save snapshot: no barrow', {});
      return;
    }
    const baseName = deriveSaveNameFromBarrow();
    const entry = saveNamedBarrow(baseName, state.barrow, { selection: Array.from(state.selection || []) });
    Log.log('UI', 'DB save snapshot', { name: entry.name, spaces: Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces.length : 0 });
    refreshSavedDbList(entry.name);
  });

  loadDbBtn?.addEventListener('click', () => {
    const name = savedDbSelect?.value;
    if (!name) {
      Log.log('ERROR', 'DB load snapshot: no selection', {});
      return;
    }
    const loaded = loadNamedBarrow(name);
    if (!loaded) {
      Log.log('ERROR', 'DB load snapshot: missing entry', { name });
      refreshSavedDbList();
      return;
    }

    disposeMoveWidget();
    disposeRotWidget();
    state.selection.clear();
    state.lockedVoxPick = null;
    rebuildHalos();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));

    disposeBuilt(state.built);
    state.barrow = loaded;
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene?.();
    updateHud?.();

    const connectInfo = state?.barrow?.connect || {};
    const connectPath = Array.isArray(connectInfo?.path) ? connectInfo.path : null;
    const savedNodeDiameter = Number(connectInfo?.nodeDiameter);
    const connectState = ensureConnectState(state);
    connectState.nodeDiameter = Number.isFinite(savedNodeDiameter) && savedNodeDiameter > 0 ? savedNodeDiameter : null;
    disposeConnectMeshes(state);
    if (connectPath && connectPath.length >= 2) {
      rebuildConnectMeshes({ scene, state, path: connectPath, nodeDiameter: connectState.nodeDiameter });
      syncConnectPathToDb(state);
      saveBarrow(state.barrow);
      if (gizmo?.ensureConnectGizmoFromSel) gizmo.ensureConnectGizmoFromSel();
    } else {
      connectState.nodeDiameter = null;
      syncConnectPathToDb(state);
      saveBarrow(state.barrow);
    }

    const selFromMeta = Array.isArray(state?.barrow?.meta?.selected) ? state.barrow.meta.selected.map(String) : [];
    state.selection.clear();
    if (selFromMeta.length) {
      for (const id of selFromMeta) state.selection.add(id);
      rebuildHalos();
      window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
      ensureRotWidget(); ensureMoveWidget();
    } else {
      rebuildHalos();
      window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
    }

    camApi?.fitViewSmart?.(state.barrow);
    Log.log('UI', 'DB load snapshot', { name });
  });

  deleteSavedDbBtn?.addEventListener('click', () => {
    const name = savedDbSelect?.value;
    if (!name) return;
    const removed = removeNamedBarrow(name);
    Log.log('UI', removed ? 'DB delete snapshot' : 'DB delete snapshot: missing', { name });
    refreshSavedDbList();
  });

  resetBtn?.addEventListener('click', () => {
    disposeMoveWidget();
    disposeRotWidget();
    state.selection.clear();
    state.lockedVoxPick = null; state.lastVoxPick = null;
    rebuildHalos();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
    window.dispatchEvent(new CustomEvent('dw:debug:clearAll'));
    if (state.mode === 'cavern') { exitScryMode?.();   exitCavernMode?.();  }

    disposeBuilt(state.built);
    state.barrow = makeDefaultBarrow();
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene?.();
    updateHud?.();
    camera.target.set(0,0,0);
    Log.log('UI', 'Reset barrow', {});
 });

  exportBtn?.addEventListener('click', async () => {
    const toExport = cloneForSave(state.barrow);
    // Include current selection for test scenarios to reselect after import
    toExport.meta = toExport.meta || {}; toExport.meta.selected = Array.from(state.selection || []);
    // Prefer local dev receiver to write file into repo under exports/
    const id = String(state.barrow.id || 'barrow');
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '-');
    const ts = new Date();
    const stamp = [
      ts.getFullYear(),
      String(ts.getMonth()+1).padStart(2,'0'),
      String(ts.getDate()).padStart(2,'0'),
      '-',
      String(ts.getHours()).padStart(2,'0'),
      String(ts.getMinutes()).padStart(2,'0'),
      String(ts.getSeconds()).padStart(2,'0')
    ].join('');
    const filename = `${safeId}-${stamp}.json`;
    const body = JSON.stringify({ filename, content: JSON.stringify(toExport, null, 2) });
    let exportedVia = 'download';
    const resp = await fetch('http://localhost:6060/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (resp && resp.ok) {
      exportedVia = 'local-export';
      const info = await resp.json().catch(() => null);
      Log.log('UI', 'Export barrow (server)', { id: state.barrow.id, path: info?.path || `export/${filename}` });
      return; // done via local server

    }

    // Attempt File System Access API (Chromium): allow user to choose location
    if (window?.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          { description: 'JSON', accept: { 'application/json': ['.json'] } }
        ]
 });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(toExport, null, 2));
      await writable.close();
      Log.log('UI', 'Export barrow (picker)', { id: state.barrow.id });
      return;
    }

    // Fallback: browser download
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${filename}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    Log.log('UI', 'Export barrow (fallback)', { id: state.barrow.id });

 });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    // Reset transient UI state to avoid stale references during rebuild
    disposeMoveWidget();
    disposeRotWidget();
    state.selection.clear();
    rebuildHalos();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));

    let data = JSON.parse(text);
    data = inflateAfterLoad(data);
    disposeBuilt(state.built);
    state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene?.();
    updateHud?.();
    // Apply PP proposal path if provided
    const rawConnect = data?.connect || data?.meta?.connect || {};
    const p = (rawConnect && Array.isArray(rawConnect.path)) ? rawConnect.path : null;
    const savedNodeDiameter = Number(rawConnect?.nodeDiameter);
    const connectState = ensureConnectState(state);
    connectState.nodeDiameter = Number.isFinite(savedNodeDiameter) && savedNodeDiameter > 0 ? savedNodeDiameter : null;
    if (p && p.length >= 2) {
      rebuildConnectMeshes({ scene, state, path: p, nodeDiameter: connectState.nodeDiameter });
      syncConnectPathToDb(state);
      saveBarrow(state.barrow);
      if (gizmo?.ensureConnectGizmoFromSel) gizmo.ensureConnectGizmoFromSel();
    }

    // Reapply selection if provided
    const selFromMeta = Array.isArray(data?.meta?.selected) ? data.meta.selected.map(String) : [];
    if (selFromMeta.length) {
      state.selection.clear(); for (const id of selFromMeta) state.selection.add(id);
      rebuildHalos();
      window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
      ensureRotWidget(); ensureMoveWidget();
    }

    camApi?.fitViewSmart?.(state.barrow);
    Log.log('UI', 'Import barrow', { size: text.length });

    if (importFile) importFile.value = '';
 });

  // Load a bundled test DB by path (from dbTab select)
  window.addEventListener('dw:dbLoadTest', async (e) => {
    const path = String(e?.detail?.path || ''); if (!path) return;
    // Reset transient state
    disposeMoveWidget();
    disposeRotWidget();
    state.selection.clear();
    rebuildHalos();
    window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } }));
    // Fetch and apply
    const resp = await fetch(path, { cache: 'no-store' }); if (!resp.ok) throw new Error('fetch failed');
    let data = await resp.json();
    data = inflateAfterLoad(data);
    disposeBuilt(state.built);
    state.barrow = mergeInstructions(makeDefaultBarrow(), data);
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene?.();
    updateHud?.();
    // Apply PP proposal path if provided
    const rawConnect = data?.connect || data?.meta?.connect || {};
    const p = (rawConnect && Array.isArray(rawConnect.path)) ? rawConnect.path : null;
    const savedNodeDiameter = Number(rawConnect?.nodeDiameter);
    const connectState = ensureConnectState(state);
    connectState.nodeDiameter = Number.isFinite(savedNodeDiameter) && savedNodeDiameter > 0 ? savedNodeDiameter : null;
    if (p && p.length >= 2) {
      rebuildConnectMeshes({ scene, state, path: p, nodeDiameter: connectState.nodeDiameter });
      syncConnectPathToDb(state);
      saveBarrow(state.barrow);
      if (gizmo?.ensureConnectGizmoFromSel) gizmo.ensureConnectGizmoFromSel();
    }

    // Apply 'meta.selected' selection if present
    const selFromMeta = Array.isArray(data?.meta?.selected) ? data.meta.selected.map(String) : [];
    if (selFromMeta.length) {
      state.selection.clear(); for (const id of selFromMeta) state.selection.add(id);
      rebuildHalos();
      window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
      ensureRotWidget(); ensureMoveWidget();
    }

    camApi?.fitViewSmart?.(state.barrow);
    Log.log('UI', 'Load test DB', { path });

  });

  refreshSavedDbList();
}
