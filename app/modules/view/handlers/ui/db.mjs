// Database-related UI/event handlers split from eventHandler.mjs
// Initializes listeners for DB edits, selection via DB tree, delete/undo, and open-to-space.
import { saveBarrow, snapshot, undoLast, loadBarrow, cloneForSave, inflateAfterLoad } from '../../../barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from '../../../barrow/builder.mjs';
import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from '../../../barrow/schema.mjs';
import { renderDbView } from '../../dbTab.mjs';
import { Log } from '../../../util/log.mjs';

export function initDbUiHandlers(ctx) {
  const { scene, engine, camApi, camera, state, helpers, gizmo } = ctx;
  const { rebuildScene, rebuildHalos, scheduleGridUpdate, updateHud, exitCavernMode, exitScryMode } = helpers || {};
  const ensureRotWidget = gizmo && gizmo.ensureRotWidget ? gizmo.ensureRotWidget : (() => {});
  const ensureMoveWidget = gizmo && gizmo.ensureMoveWidget ? gizmo.ensureMoveWidget : (() => {});
  const disposeRotWidget = gizmo && gizmo.disposeRotWidget ? gizmo.disposeRotWidget : (() => {});
  const disposeMoveWidget = gizmo && gizmo.disposeMoveWidget ? gizmo.disposeMoveWidget : (() => {});

  // Apply live DB edits back into scene and gizmos
  window.addEventListener('dw:dbEdit', (e) => {
    try {
      const d = e.detail || {}; const path = d.path; const value = d.value; const prev = d.prev;
      // Ensure unique space id on rename
      try {
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
              if (prev && state.selection.has(prev)) { state.selection.delete(prev); state.selection.add(candidate); try { rebuildHalos(); } catch (e2) {} }
            }
          }
        }
      } catch {}
      // Persist + rebuild derived scene state
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
      try { disposeBuilt(state.built); } catch {}
      try { state.built = buildSceneFromBarrow(scene, state.barrow); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { rebuildHalos(); } catch {}
      try { scheduleGridUpdate(); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch (e2) { Log.log('ERROR', 'EH:dbEdit:ensureWidgets', { error: String(e2) }); }
      try { updateHud?.(); } catch {}
      Log.log('UI', 'DB edit applied', { path, value, prev });
    } catch (err) { Log.log('ERROR', 'DB edit apply failed', { error: String(err) }); }
  });

  // Delete selected spaces (from DB tab button)
  window.addEventListener('dw:dbDeleteSelected', (e) => {
    try {
      const ids = (e && e.detail && Array.isArray(e.detail.ids)) ? e.detail.ids : [];
      const before = (state?.barrow?.spaces || []).length;
      const delSet = new Set(ids.map(String));
      // Snapshot before deletion to support undo
      try { snapshot(state.barrow); } catch {}
      // Remove spaces from model
      state.barrow.spaces = (state.barrow.spaces || []).filter(s => !delSet.has(String(s?.id)));
      // Clear selection of deleted ids
      try { for (const id of ids) state.selection.delete(id); } catch {}
      // Persist + rebuild
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
      try { disposeBuilt(state.built); } catch {}
      try { state.built = buildSceneFromBarrow(scene, state.barrow); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { rebuildHalos(); } catch {}
      try { scheduleGridUpdate(); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      try { updateHud?.(); } catch {}
      Log.log('UI', 'DB delete selected', { removed: ids, before, after: (state?.barrow?.spaces || []).length });
    } catch (err) { Log.log('ERROR', 'DB delete selected failed', { error: String(err) }); }
  });

  // Undo last DB change (primarily deletes)
  window.addEventListener('dw:dbUndo', () => {
    try {
      const restored = undoLast();
      if (!restored) { Log.log('UI', 'Undo: nothing to undo', {}); return; }
      state.barrow = restored;
      // Rebuild scene and DB
      try { disposeBuilt(state.built); } catch {}
      try { state.built = buildSceneFromBarrow(scene, state.barrow); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { rebuildHalos(); } catch {}
      try { scheduleGridUpdate(); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
      try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
      try { updateHud?.(); } catch {}
      Log.log('UI', 'Undo: restored previous snapshot', {});
    } catch (e) { Log.log('ERROR', 'Undo failed', { error: String(e) }); }
  });

  // DB navigation and selection (no camera center; selection only)
  window.addEventListener('dw:dbRowClick', (e) => {
    const { type, id, shiftKey } = e.detail || {};
    if (type !== 'space' || !id) return;
    try {
      if (shiftKey) {
        if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
      } else {
        state.selection.clear(); state.selection.add(id);
      }
      rebuildHalos(); ensureRotWidget(); ensureMoveWidget();
      window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
      Log.log('UI', 'DB row center', { id });
    } catch (err) { Log.log('ERROR', 'Center from DB failed', { id, error: String(err) }); }
  });

  // Open DB tab to a specific space id
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
        try { target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
      }
    } catch (err) { Log.log('ERROR', 'Open DB to space failed', { id, error: String(err) }); }
  });

  // Local helpers copied from eventHandler scope for DB open
  const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
  function applyPanelCollapsed(collapsed) {
    const panel = document.getElementById('rightPanel');
    const collapsePanelBtn = document.getElementById('collapsePanel');
    if (!panel || !collapsePanelBtn) return;
    panel.classList.toggle('collapsed', !!collapsed);
    if (panel.classList.contains('collapsed')) {
      try {
        const rect = panel.getBoundingClientRect();
        const w = rect.width;
        const tab = 36; // visible tab width for the collapse control
        panel.style.right = `${-(Math.max(40, w) - tab)}px`;
        panel.style.pointerEvents = 'none';
      } catch {}
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

  resetBtn?.addEventListener('click', () => {
    try { disposeMoveWidget(); } catch {}
    try { disposeRotWidget(); } catch {}
    try { state.selection.clear(); } catch {}
    try { state.lockedVoxPick = null; state.lastVoxPick = null; } catch {}
    try { rebuildHalos(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:debug:clearAll')); } catch {}
    try { if (state.mode === 'cavern') { try { exitScryMode?.(); } catch {} try { exitCavernMode?.(); } catch {} } } catch {}

    try { disposeBuilt(state.built); } catch {}
    state.barrow = makeDefaultBarrow();
    try { layoutBarrow(state.barrow); } catch {}
    try { state.built = buildSceneFromBarrow(scene, state.barrow); } catch {}
    try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
    try { renderDbView(state.barrow); } catch {}
    try { rebuildScene?.(); } catch {}
    try { updateHud?.(); } catch {}
    try { camera.target.set(0,0,0); } catch {}
    try { Log.log('UI', 'Reset barrow', {}); } catch {}
  });

  exportBtn?.addEventListener('click', async () => {
    try {
      const toExport = cloneForSave(state.barrow);
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
      try {
        const resp = await fetch('http://localhost:6060/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (resp && resp.ok) {
          exportedVia = 'local-export';
          try {
            const info = await resp.json().catch(() => null);
            Log.log('UI', 'Export barrow (server)', { id: state.barrow.id, path: info?.path || `export/${filename}` });
            return; // done via local server
          } catch {}
        }
      } catch {}
      // Attempt File System Access API (Chromium): allow user to choose location
      try {
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
      } catch (e) {
        // If user cancels or API errors, fall through to download
      }
      // Fallback: browser download
      const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${filename}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      Log.log('UI', 'Export barrow (fallback)', { id: state.barrow.id });
    } catch (e) { Log.log('ERROR', 'Export failed', { error: String(e) }); }
  });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try {
      let data = JSON.parse(text);
      try { data = inflateAfterLoad(data); } catch {}
      try { disposeBuilt(state.built); } catch {}
      state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
      try { layoutBarrow(state.barrow); } catch {}
      try { state.built = buildSceneFromBarrow(scene, state.barrow); } catch {}
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
      try { renderDbView(state.barrow); } catch {}
      try { rebuildScene?.(); } catch {}
      try { updateHud?.(); } catch {}
      try { Log.log('UI', 'Import barrow', { size: text.length }); } catch {}
    } catch (err) { console.error('Import failed', err); }
    if (importFile) importFile.value = '';
  });
}
