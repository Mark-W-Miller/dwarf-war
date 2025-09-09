import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from '../barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from '../barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from '../barrow/builder.mjs';
import { Log } from '../util/log.mjs';
import { renderDbView } from './dbView.mjs';

// Initialize all UI and scene event handlers that were previously in main.mjs
export function initEventHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateHud } = helpers;

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

  const panel = document.getElementById('rightPanel');
  const collapsePanelBtn = document.getElementById('collapsePanel');

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
  function readBool(key, dflt = true) { try { const v = localStorage.getItem(key); return v == null ? dflt : v !== '0'; } catch { return dflt; } }
  function writeBool(key, val) { try { localStorage.setItem(key, val ? '1' : '0'); } catch {} }

  if (showNamesCb) { showNamesCb.checked = readBool('dw:ui:showNames', true); }
  if (gridGroundCb) { gridGroundCb.checked = readBool('dw:ui:gridGround', true); }
  if (gridXYCb) { gridXYCb.checked = readBool('dw:ui:gridXY', true); }
  if (gridYZCb) { gridYZCb.checked = readBool('dw:ui:gridYZ', true); }

  function applyTogglesFromUI() {
    if (showNamesCb) writeBool('dw:ui:showNames', !!showNamesCb.checked);
    if (gridGroundCb) writeBool('dw:ui:gridGround', !!gridGroundCb.checked);
    if (gridXYCb) writeBool('dw:ui:gridXY', !!gridXYCb.checked);
    if (gridYZCb) writeBool('dw:ui:gridYZ', !!gridYZCb.checked);
    try { applyViewToggles?.(); } catch {}
  }
  showNamesCb?.addEventListener('change', applyTogglesFromUI);
  gridGroundCb?.addEventListener('change', applyTogglesFromUI);
  gridXYCb?.addEventListener('change', applyTogglesFromUI);
  gridYZCb?.addEventListener('change', applyTogglesFromUI);
  // Apply once on init
  applyTogglesFromUI();

  // ——————————— Reset/Export/Import ———————————
  resetBtn?.addEventListener('click', () => {
    disposeBuilt(state.built);
    state.barrow = makeDefaultBarrow();
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene();
    try { updateHud?.(); } catch {}
  });

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.barrow, null, 2)], { type: 'application/json' });
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
      const data = JSON.parse(text);
      disposeBuilt(state.built);
      state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
      layoutBarrow(state.barrow);
      state.built = buildSceneFromBarrow(scene, state.barrow);
      saveBarrow(state.barrow); snapshot(state.barrow);
      renderDbView(state.barrow);
      rebuildScene();
      try { updateHud?.(); } catch {}
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
    const origin = camera.target.clone();
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
    scheduleGridUpdate();
    // Suggest next name
    ensureNameInput();
  });

  // ——————————— Fit view ———————————
  fitViewBtn?.addEventListener('click', () => camApi.fitViewAll(state.barrow?.spaces || [], state.barrow?.meta?.voxelSize || 1));

  // ——————————— Type defaults & size fields ———————————
  function defaultSizeForType(t) {
    switch (t) {
      case 'Cavern': return { x: 200, y: 150, z: 200 };
      case 'Carddon': return { x: 60, y: 30, z: 60 };
      case 'Tunnel': return { x: 100, y: 40, z: 20 };
      case 'Room': return { x: 120, y: 60, z: 120 };
      default: return { x: 200, y: 100, z: 200 };
    }
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
    function step() { const v = Number(stepEl?.value)||1; return v; }
    function addRepeat(btn, fn){
      if (!btn) return;
      let timer = null;
      const fire = () => fn();
      btn.addEventListener('click', fire);
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

  // ——————————— Pointer selection & double-click ———————————
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  let lastPickName = null;
  let lastPickTime = 0;
  scene.onPointerObservable.add((pi) => {
    if (state.mode !== 'edit') return;
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    const ev = pi.event || window.event;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && (m.name.startsWith('space:') || m.name.startsWith('cavern:')));
    if (!pick?.hit || !pick.pickedMesh) return;
    const name = pick.pickedMesh.name; // space:<id> or cavern:<id>
    let id = '';
    if (name.startsWith('space:')) id = name.slice('space:'.length);
    else id = name.slice('cavern:'.length);
    if (ev && ev.shiftKey) {
      if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    } else {
      state.selection.clear();
      state.selection.add(id);
    }
    Log.log('UI', 'Select space(s)', { selection: Array.from(state.selection) });
    rebuildHalos();

    // Handle double-click/tap with adjustable threshold
    const now = performance.now();
    if (name === lastPickName && (now - lastPickTime) <= DOUBLE_CLICK_MS) {
      try { camApi.centerOnMesh(pick.pickedMesh); } catch (err) { Log.log('ERROR', 'Center on item failed', { error: String(err) }); }
      // If double-clicking a space, open the Database tab and focus that space
      if (name.startsWith('space:')) {
        try { window.dispatchEvent(new CustomEvent('dw:showDbForSpace', { detail: { id } })); } catch {}
      }
    }
    lastPickName = name;
    lastPickTime = now;
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
      editPane.classList.toggle('active', tabId === 'tab-edit');
      dbPane.classList.toggle('active', tabId === 'tab-db');
      settingsPane.classList.toggle('active', tabId === 'tab-settings');
      tabEditBtn.classList.toggle('active', tabId === 'tab-edit');
      tabDbBtn.classList.toggle('active', tabId === 'tab-db');
      tabSettingsBtn.classList.toggle('active', tabId === 'tab-settings');
    }
    tabEditBtn.addEventListener('click', () => activate('tab-edit'));
    tabDbBtn.addEventListener('click', () => activate('tab-db'));
    tabSettingsBtn.addEventListener('click', () => activate('tab-settings'));
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
            if (prev && state.selection.has(prev)) { state.selection.delete(prev); state.selection.add(candidate); try { rebuildHalos(); } catch {} }
          }
        }
      }
    } catch {}
    try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
    try { rebuildScene(); } catch {}
    try { renderDbView(state.barrow); } catch {}
    try { scheduleGridUpdate(); } catch {}
    try { applyViewToggles?.(); } catch {}
    try { updateHud?.(); } catch {}
  });

  // ——————————— DB navigation and centering ———————————
  // Center camera when a DB row (space summary) is clicked
  window.addEventListener('dw:dbRowClick', (e) => {
    const { type, id } = e.detail || {};
    if (type !== 'space' || !id) return;
    try {
      const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || scene.getMeshByName(`space:${id}`);
      if (mesh) camApi.centerOnMesh(mesh);
      // Update selection to the clicked space and refresh halos
      try { state.selection.clear(); state.selection.add(id); rebuildHalos(); } catch {}
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
