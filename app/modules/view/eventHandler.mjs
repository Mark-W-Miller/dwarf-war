import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from '../barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from '../barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from '../barrow/builder.mjs';
import { Log } from '../util/log.mjs';
import { renderDbView } from './dbView.mjs';

// Initialize all UI and scene event handlers that were previously in main.mjs
export function initEventHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate } = helpers;

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
  const newSpaceBtn = document.getElementById('newSpace');
  const fitViewBtn = document.getElementById('fitView');
  const sizeXEl = document.getElementById('sizeX');
  const sizeYEl = document.getElementById('sizeY');
  const sizeZEl = document.getElementById('sizeZ');

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

  // ——————————— Reset/Export/Import ———————————
  resetBtn?.addEventListener('click', () => {
    disposeBuilt(state.built);
    state.barrow = makeDefaultBarrow();
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    renderDbView(state.barrow);
    rebuildScene();
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
    } catch (err) { console.error('Import failed', err); }
    if (importFile) importFile.value = '';
  });

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
    const idBase = type.toLowerCase();
    let n = 1, id = idBase;
    const used = new Set((state.barrow.spaces||[]).map(s => s.id));
    while (used.has(id)) { id = idBase + '-' + (++n); }
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
  });
  applyDefaultSizeFields();

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
}

