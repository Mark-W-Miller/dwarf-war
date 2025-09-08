import { makeDefaultBarrow, mergeInstructions, directions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { Log } from './modules/util/log.mjs';

// Babylon setup
const canvas = document.getElementById('renderCanvas');
const hud = document.getElementById('hud');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 24, new BABYLON.Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 2; camera.upperRadiusLimit = 5000;
camera.minZ = 0.1; camera.maxZ = 10000;
camera.wheelPrecision = 1; // use percentage-based zoom below
// Middle mouse (button=1) pans the view; adjust panning speed/inertia
camera.panningMouseButton = 2; // right button pans
camera.panningSensibility = 40; // lower = faster
camera.panningInertia = 0.2;

// Lighting
const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
dir.position = new BABYLON.Vector3(10, 20, 10); dir.intensity = 1.1;
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.2;

// Ground (subtle green grid), open environment (no enclosing sphere)
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 800, height: 800 }, scene);
ground.position.y = 0;
const grid = new BABYLON.GridMaterial('grid', scene);
grid.mainColor = new BABYLON.Color3(0.10, 0.06, 0.06); // dark base
grid.lineColor = new BABYLON.Color3(0.75, 0.25, 0.25); // XZ (red-ish)
grid.gridRatio = 2; // meters per cell
grid.opacity = 0.95;
ground.material = grid;

// Vertical YX grid at Z=0 with numbers
const vGrid = BABYLON.MeshBuilder.CreatePlane('gridYX', { width: 800, height: 800 }, scene);
vGrid.position = new BABYLON.Vector3(0, 0, 0);
// Plane default is XY at Z=0 facing +Z
const gridVMat = new BABYLON.GridMaterial('gridV', scene);
gridVMat.mainColor = new BABYLON.Color3(0.06, 0.10, 0.06);
gridVMat.lineColor = new BABYLON.Color3(0.25, 0.85, 0.25); // XY includes Y axis (green)
gridVMat.gridRatio = 2;
gridVMat.opacity = 0.6;
gridVMat.backFaceCulling = false;
vGrid.material = gridVMat;

// Third grid: YZ plane at X=0 (vertical), with numbers
const wGrid = BABYLON.MeshBuilder.CreatePlane('gridYZ', { width: 800, height: 800 }, scene);
wGrid.position = new BABYLON.Vector3(0, 0, 0);
wGrid.rotation.y = Math.PI / 2; // rotate to YZ
const gridWMat = new BABYLON.GridMaterial('gridW', scene);
gridWMat.mainColor = new BABYLON.Color3(0.06, 0.08, 0.12);
gridWMat.lineColor = new BABYLON.Color3(0.25, 0.35, 0.85); // YZ plane (blue-ish)
gridWMat.gridRatio = 2;
gridWMat.opacity = 0.6; gridWMat.backFaceCulling = false;
wGrid.material = gridWMat;

// Axis numbers along X/Z=0 and X/Y and Z/Y at coarse intervals
(function addAxisLabels() {
  const tick = 20; // spacing in world units
  const range = 200; // +/- range
  const font = 'bold 22px system-ui, sans-serif';
  const color = '#7fbf7f';

  function makeTextPlane(name, text) {
    const size = 128;
    const dt = new BABYLON.DynamicTexture(name+':dt', { width: size, height: size }, scene, false);
    dt.hasAlpha = true; const ctx = dt.getContext(); ctx.clearRect(0,0,size,size);
    dt.drawText(text, null, 90, font, color, 'transparent', true);
    const mat = new BABYLON.StandardMaterial(name+':mat', scene);
    mat.diffuseTexture = dt; mat.emissiveTexture = dt; mat.backFaceCulling = false; mat.specularColor = new BABYLON.Color3(0,0,0);
    const p = BABYLON.MeshBuilder.CreatePlane(name, { size: 1.2 }, scene);
    p.material = mat; p.isPickable = false;
    return p;
  }

  // Ground X axis labels (Z=0, Y slightly above 0)
  for (let x = -range; x <= range; x += tick) {
    const plane = makeTextPlane('lblX_'+x, String(x));
    plane.position = new BABYLON.Vector3(x, 0.05, 0.01);
    plane.rotation.x = -Math.PI/2; // face up
  }
  // Vertical grid X axis labels along Y=0 (Z slightly towards camera)
  for (let x = -range; x <= range; x += tick) {
    const plane = makeTextPlane('lblVX_'+x, String(x));
    plane.position = new BABYLON.Vector3(x, -0.05, 0.05);
    // faces camera by default on XY plane
  }
  // Vertical grid Y axis labels at X=0
  for (let y = -range; y <= range; y += tick) {
    const plane = makeTextPlane('lblVY_'+y, String(y));
    plane.position = new BABYLON.Vector3(0.05, y, 0.05);
  }

  // Ground Z axis labels (X ~ 0)
  for (let z = -range; z <= range; z += tick) {
    const plane = makeTextPlane('lblZ_'+z, String(z));
    plane.position = new BABYLON.Vector3(0.01, 0.05, z);
    plane.rotation.x = -Math.PI/2; // face up
  }

  // Vertical YZ plane Z axis labels at X=0
  for (let z = -range; z <= range; z += tick) {
    const plane = makeTextPlane('lblVZ_'+z, String(z));
    plane.position = new BABYLON.Vector3(0.05, -0.05, z);
  }
})();

// App state
const state = {
  mode: 'edit', // 'edit' | 'game'
  running: true,
  barrow: null,
  built: null, // handles to built meshes
  selection: new Set(), // selected cavern ids
  halos: new Map(), // id -> halo mesh
  hl: null, // highlight layer
};

// Load or create barrow
state.barrow = loadBarrow() || makeDefaultBarrow();
layoutBarrow(state.barrow); // ensure positions from directions
state.built = buildSceneFromBarrow(scene, state.barrow);
renderDbView(state.barrow);
updateUnitGrids();
applyZoomBase();
applyPanBase();
rebuildHalos();
scheduleGridUpdate();
// Highlight layer for selection glow
state.hl = new BABYLON.HighlightLayer('hl', scene, { blurHorizontalSize: 1.0, blurVerticalSize: 1.0 });
state.hl.innerGlow = false; state.hl.outerGlow = true;

function setMode(mode) {
  state.mode = mode;
  hud.textContent = `Dwarf War • ${mode === 'edit' ? 'Edit' : 'Game'} mode ${state.running ? '• Running' : '• Paused'}`;
}
function setRunning(run) {
  state.running = run;
  hud.textContent = `Dwarf War • ${state.mode === 'edit' ? 'Edit' : 'Game'} mode ${run ? '• Running' : '• Paused'}`;
}

// UI wiring
const toggleRunBtn = document.getElementById('toggleRun');
const resetBtn = document.getElementById('reset');
const exportBtn = document.getElementById('export');
const importBtn = document.getElementById('import');
const importFile = document.getElementById('importFile');
// (no text assistant UI)
// Transform controls
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
//
const panel = document.getElementById('rightPanel');
const collapsePanelBtn = document.getElementById('collapsePanel');
const settingsOpenBtn = document.getElementById('settingsOpen');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsClose');
//

document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener('change', () => setMode(r.value));
});
toggleRunBtn.addEventListener('click', () => {
  setRunning(!state.running);
  toggleRunBtn.textContent = state.running ? 'Pause' : 'Run';
  Log.log('UI', 'Toggle run', { running: state.running });
});
resetBtn.addEventListener('click', () => {
  disposeBuilt(state.built);
  state.barrow = makeDefaultBarrow();
  layoutBarrow(state.barrow);
  state.built = buildSceneFromBarrow(scene, state.barrow);
  saveBarrow(state.barrow); snapshot(state.barrow);
  renderDbView(state.barrow);
  rebuildScene();
});
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.barrow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${state.barrow.id || 'barrow'}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  Log.log('UI', 'Export barrow', { id: state.barrow.id });
});
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async (e) => {
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
  importFile.value = '';
});
// Create new space at view center, non-overlapping, then focus camera
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
    sizeYEl && (sizeYEl.value = String(sy));
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

// Fit camera to all spaces
function fitViewAll() {
  const spaces = state.barrow?.spaces || [];
  if (spaces.length === 0) return;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of spaces) {
    const res = s.res || (state.barrow?.meta?.voxelSize || 1);
    const w = (s.size?.x||0) * res, h = (s.size?.y||0) * res, d = (s.size?.z||0) * res;
    const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
    const min = { x: cx - w/2, y: cy - h/2, z: cz - d/2 };
    const max = { x: cx + w/2, y: cy + h/2, z: cz + d/2 };
    if (min.x < minX) minX = min.x; if (min.y < minY) minY = min.y; if (min.z < minZ) minZ = min.z;
    if (max.x > maxX) maxX = max.x; if (max.y > maxY) maxY = max.y; if (max.z > maxZ) maxZ = max.z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
  const span = Math.max(spanX, spanY, spanZ);
  const radius = Math.max(10, span * 0.8 + 10);
  camera.target.set(cx, cy, cz);
  camera.radius = radius;
  if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
  Log.log('UI', 'Fit view', { center: { x: cx, y: cy, z: cz }, span: { x: spanX, y: spanY, z: spanZ }, radius });
}

fitViewBtn?.addEventListener('click', fitViewAll);

// Defaults per type and update size fields when type changes
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

// Initialize size fields for initial type
applyDefaultSizeFields();
// (text-based assistant disabled)

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  // Keep grids near the camera target so they don't "disappear" when moving far
  try {
    // Grids are centered at the world origin (0,0,0); do not follow camera.
    if (ground) { ground.position.x = 0; ground.position.z = 0; ground.position.y = 0; }
    if (typeof vGrid !== 'undefined' && vGrid) { vGrid.position.x = 0; vGrid.position.z = 0; }
    if (typeof wGrid !== 'undefined' && wGrid) { wGrid.position.x = 0; wGrid.position.z = 0; }
    // Keep the barrow label near the target for visibility
    if (state?.built?.label && camera?.target) {
      state.built.label.position.x = camera.target.x;
      state.built.label.position.z = camera.target.z;
    }
    // Adapt pan speed with distance: farther = faster (lower sensibility)
    const panBase = getPanBase();
    const r = Math.max(1, camera.radius);
    const f = Math.max(0.2, r / 100); // grows with distance
    const baseSens = Math.max(1, 300 / panBase); // invert mapping (higher base = faster = lower sens)
    camera.panningSensibility = Math.max(1, baseSens / f);
  } catch {}
  // Grid extent updates are debounced (2s) via scheduleGridUpdate()
  // Percentage-based zoom handles near/far scaling; settings slider updates base percentage.
  // Render
  scene.render();
});

window.addEventListener('resize', () => engine.resize());

// Collapse/expand panel with persistence
const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
function applyPanelCollapsed(collapsed) {
  panel.classList.toggle('collapsed', !!collapsed);
  collapsePanelBtn.textContent = collapsed ? '⟩' : '⟨⟩';
}
applyPanelCollapsed(localStorage.getItem(PANEL_STATE_KEY) === '1');
collapsePanelBtn.addEventListener('click', () => {
  const next = !panel.classList.contains('collapsed');
  applyPanelCollapsed(next);
  try { localStorage.setItem(PANEL_STATE_KEY, next ? '1' : '0'); } catch {}
});

// (AI/Ollama disabled)

// Build tabs: Edit and Database, and move existing controls accordingly
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
// removed legacy Parse button wiring; Enter now handles parsing
// ——————————— Log Tab ———————————
(function setupLogTab(){
  const panelContent = document.querySelector('.panel-content');
  if (!panelContent) return;
  const tabsBar = panelContent.querySelector('.tabs');
  const dbPane = panelContent.querySelector('#tab-db');
  const editPane = panelContent.querySelector('#tab-edit');
  if (!tabsBar || !dbPane || !editPane) return;
  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab'; tabBtn.dataset.tab = 'tab-log'; tabBtn.textContent = 'Log';
  tabsBar.appendChild(tabBtn);
  const logPane = document.createElement('div'); logPane.id = 'tab-log'; logPane.className = 'tab-pane';
  const filterRow = document.createElement('div'); filterRow.className = 'row';
  const filtersBox = document.createElement('div'); filtersBox.id = 'logClassFilters'; filtersBox.style.display = 'flex'; filtersBox.style.flexWrap = 'wrap'; filtersBox.style.gap = '8px';
  filterRow.appendChild(filtersBox);
  logPane.appendChild(filterRow);
  const entries = document.createElement('div'); entries.id = 'logEntries'; entries.style.whiteSpace = 'pre-wrap'; entries.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; entries.style.fontSize = '12px'; entries.style.maxHeight = '240px'; entries.style.overflow = 'auto'; entries.style.border = '1px solid #1e2a30'; entries.style.borderRadius = '6px'; entries.style.padding = '8px'; entries.style.background = '#0f151a';
  logPane.appendChild(entries);
  panelContent.appendChild(logPane);
  function activateLog() {
    editPane.classList.remove('active'); dbPane.classList.remove('active'); logPane.classList.add('active');
    const allTabs = tabsBar.querySelectorAll('.tab');
    allTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'tab-log'));
    renderFilters(); renderEntries();
  }
  tabBtn.addEventListener('click', activateLog);
  const selected = new Set();
  function renderFilters() {
    const classes = Array.from(Log.getClasses()).sort();
    if (selected.size === 0) classes.forEach(c => selected.add(c));
    filtersBox.innerHTML = '';
    classes.forEach(c => {
      const label = document.createElement('label'); label.style.display = 'inline-flex'; label.style.alignItems = 'center'; label.style.gap = '6px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(c);
      cb.addEventListener('change', () => { if (cb.checked) selected.add(c); else selected.delete(c); renderEntries(); });
      label.appendChild(cb); label.appendChild(document.createTextNode(c));
      filtersBox.appendChild(label);
    });
  }
  function renderEntries() {
    const list = Log.getEntries();
    const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
    const lines = filtered.slice(-500).map(e => {
      const t = new Date(e.time).toLocaleTimeString();
      const d = e.data != null ? ` ${JSON.stringify(e.data, (k,v) => (typeof v === 'number' ? parseFloat(Number(v).toPrecision(2)) : v))}` : '';
      return `[${t}] [${e.cls}] ${e.msg}${d}`;
    });
    entries.textContent = lines.join('\n');
    entries.scrollTop = entries.scrollHeight;
  }
  Log.on(() => { renderFilters(); renderEntries(); });
})();

// ——————————— Settings UI (Zoom speed) ———————————
(function setupSettings(){
  const pane = document.getElementById('tab-settings'); if (!pane) return;
  // Zoom speed slider
  const row = document.createElement('div'); row.className = 'row';
  const label = document.createElement('label'); label.textContent = 'Zoom Speed'; label.style.display = 'flex'; label.style.alignItems = 'center'; label.style.gap = '8px';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '5'; slider.max = '100'; slider.step = '1'; slider.id = 'zoomSpeed';
  const valueSpan = document.createElement('span'); valueSpan.id = 'zoomSpeedVal';
  label.appendChild(slider); label.appendChild(valueSpan);
  row.appendChild(label); pane.appendChild(row);

  // Pan speed slider (controls panningSensibility; lower = faster)
  const row2 = document.createElement('div'); row2.className = 'row';
  const label2 = document.createElement('label'); label2.textContent = 'Pan Speed'; label2.style.display = 'flex'; label2.style.alignItems = 'center'; label2.style.gap = '8px';
  const slider2 = document.createElement('input'); slider2.type = 'range'; slider2.min = '5'; slider2.max = '200'; slider2.step = '1'; slider2.id = 'panSpeed';
  const valueSpan2 = document.createElement('span'); valueSpan2.id = 'panSpeedVal';
  label2.appendChild(slider2); label2.appendChild(valueSpan2);
  row2.appendChild(label2); pane.appendChild(row2);
  const KEY = 'dw:ui:zoomBase';
  const stored = Number(localStorage.getItem(KEY) || '30') || 30;
  slider.value = String(stored); valueSpan.textContent = String(stored);
  slider.addEventListener('input', () => { valueSpan.textContent = slider.value; localStorage.setItem(KEY, slider.value); applyZoomBase(); });
  const PKEY = 'dw:ui:panBase';
  const pstored = Number(localStorage.getItem(PKEY) || '200') || 200;
  slider2.value = String(pstored); valueSpan2.textContent = String(pstored);
  slider2.addEventListener('input', () => { valueSpan2.textContent = slider2.value; localStorage.setItem(PKEY, slider2.value); applyPanBase(); });
})();

function getZoomBase(){ return Number(localStorage.getItem('dw:ui:zoomBase') || '30') || 30; }
function getPanBase(){ return Number(localStorage.getItem('dw:ui:panBase') || '200') || 200; }

// Apply percentage-based zoom based on settings. Percentage auto-scales with distance.
function applyZoomBase(){
  const base = getZoomBase(); // 5..100
  // Map 5..100 to 0.0025..0.05 (0.25%..5% per wheel step)
  const pct = Math.max(0.001, Math.min(0.08, base / 2000));
  camera.wheelDeltaPercentage = pct;
  camera.pinchDeltaPercentage = pct;
  Log.log('UI', 'Apply zoom base', { base, wheelDeltaPercentage: pct });
}

function applyPanBase(){
  const base = getPanBase(); // higher = faster
  const baseSens = Math.max(1, 300 / base); // invert: 200 -> 1.5, 100 -> 3, 50 -> 6
  camera.panningSensibility = baseSens;
  Log.log('UI', 'Apply pan base', { panBase: base, panningSensibility: camera.panningSensibility });
}

// ——————————— DB View Renderer ———————————
function renderDbView(barrow) {
  const root = document.getElementById('dbView');
  if (!root) return;
  const meta = barrow.meta || {};

  function kv(label, value) {
    return `<div class="kv"><b>${label}:</b> ${value}</div>`;
  }

  function s2(n){ if (typeof n !== 'number') return n; return parseFloat(Number(n).toPrecision(2)); }
  root.innerHTML = `
    <details open>
      <summary>Summary</summary>
      ${kv('barrowId', barrow.id || '-')}
      ${kv('units', meta.units || '-')}
      ${kv('voxelSize', s2(meta.voxelSize ?? '-'))}
      ${kv('spaces', (barrow.spaces||[]).length)}
      ${kv('version', meta.version ?? '-')}
    </details>
    <details>
      <summary>Spaces ${(barrow.spaces||[]).length}</summary>
      ${(barrow.spaces||[]).map(s => `<div class=\"kv\">${s.id} — ${s.type} size ${s2(s.size?.x||0)}×${s2(s.size?.y||0)}×${s2(s.size?.z||0)} @${s2(s.res)} origin (${s2(s.origin?.x||0)},${s2(s.origin?.y||0)},${s2(s.origin?.z||0)})</div>`).join('') || '<div class=\"kv\">(none)</div>'}
    </details>
  `;
}

// ——————————— Units and selection/transform ———————————
function getVoxelSize() {
  return Number(state.barrow?.meta?.voxelSize) || 1;
}

function updateUnitGrids() {
  const s = getVoxelSize();
  if (grid) grid.gridRatio = s;
  if (gridVMat) gridVMat.gridRatio = s;
}

function rebuildScene() {
  disposeBuilt(state.built);
  layoutBarrow(state.barrow);
  state.built = buildSceneFromBarrow(scene, state.barrow);
  updateUnitGrids();
  rebuildHalos();
  scheduleGridUpdate();
}

function rebuildHalos() {
  // clear old torus meshes if any
  for (const [id, mesh] of state.halos) { try { mesh.dispose(); } catch {} }
  state.halos.clear();
  // update highlight layer
  try { state.hl.removeAllMeshes(); } catch {}
  const bySpace = new Map((state.built.spaces||[]).map(x => [x.id, x.mesh]));
  const byCav = new Map((state.built.caverns||[]).map(x => [x.id, x.mesh]));
  const blue = new BABYLON.Color3(0.2, 0.6, 1.0);
  for (const id of state.selection) {
    const m = bySpace.get(id) || byCav.get(id);
    if (!m) continue;
    state.hl.addMesh(m, blue);
  }
}

function moveSelection(dx=0, dy=0, dz=0) {
  if (!state.selection.size) return;
  const bySpace = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
  const byCav = new Map((state.barrow.caverns||[]).map(c => [c.id, c]));
  for (const id of state.selection) {
    const s = bySpace.get(id);
    if (s) {
      const p = s.origin || { x:0,y:0,z:0 };
      s.origin = { x: (p.x||0)+dx, y: (p.y||0)+dy, z: (p.z||0)+dz };
      continue;
    }
    const c = byCav.get(id);
    if (c) {
      const p = c.pos || { x:0,y:0,z:0 };
      c.pos = { x: (p.x||0)+dx, y: (p.y||0)+dy, z: (p.z||0)+dz };
    }
  }
  Log.log('XFORM', 'Move selection', { dx, dy, dz, selection: Array.from(state.selection) });
  saveBarrow(state.barrow); snapshot(state.barrow);
  rebuildScene();
  renderDbView(state.barrow);
  scheduleGridUpdate();
}

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

// Selection (click spaces and caverns; shift for multi-select)
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
});

// Double-click/tap a space or cavern to center the view on it
scene.onPointerObservable.add((pi) => {
  if (state.mode !== 'edit') return;
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOUBLETAP) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && (m.name.startsWith('space:') || m.name.startsWith('cavern:')));
  if (!pick?.hit || !pick.pickedMesh) return;
  const m = pick.pickedMesh;
  try {
    const bb = m.getBoundingInfo()?.boundingBox;
    const min = bb?.minimumWorld, max = bb?.maximumWorld;
    if (min && max) {
      const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
      const spanX = max.x - min.x, spanY = max.y - min.y, spanZ = max.z - min.z;
      const span = Math.max(spanX, spanY, spanZ);
      const radius = Math.max(10, span * 0.9 + 10);
      camera.target.set(cx, cy, cz);
      camera.radius = radius;
      if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
      Log.log('UI', 'Center on item (double-click)', { name: m.name, center: { x: cx, y: cy, z: cz }, span: { x: spanX, y: spanY, z: spanZ }, radius });
    } else {
      camera.target.copyFrom(m.position);
      Log.log('UI', 'Center on item (double-click)', { name: m.name, center: m.position });
    }
  } catch (err) {
    Log.log('ERROR', 'Center on item failed', { error: String(err) });
  }
});

// Compute grid extents to contain all spaces (min 1000 yards)
function updateGridExtent(){
  // Compute extents from built meshes (spaces + caverns), in world space
  const meshes = [];
  if (state?.built?.spaces) for (const s of state.built.spaces) if (s.mesh) meshes.push(s.mesh);
  if (state?.built?.caverns) for (const c of state.built.caverns) if (c.mesh) meshes.push(c.mesh);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    const bb = m.getBoundingInfo()?.boundingBox;
    if (!bb) continue;
    const vmin = bb.minimumWorld, vmax = bb.maximumWorld;
    if (!vmin || !vmax) continue;
    minX = Math.min(minX, vmin.x); maxX = Math.max(maxX, vmax.x);
    minY = Math.min(minY, vmin.y); maxY = Math.max(maxY, vmax.y);
    minZ = Math.min(minZ, vmin.z); maxZ = Math.max(maxZ, vmax.z);
  }

  // If nothing found, default large
  if (meshes.length === 0 || !isFinite(minX)) {
    const minSize = 1000;
    ground.scaling.x = ground.scaling.z = minSize / 800;
    vGrid.scaling.x = vGrid.scaling.y = minSize / 800;
    wGrid.scaling.x = wGrid.scaling.y = minSize / 800;
    return;
  }

  const pad = 100;
  // Center grids at origin; allow asymmetric extents by sizing to cover max absolute reach
  const maxAbsX = Math.max(Math.abs(minX), Math.abs(maxX));
  const maxAbsY = Math.max(Math.abs(minY), Math.abs(maxY));
  const maxAbsZ = Math.max(Math.abs(minZ), Math.abs(maxZ));
  const sizeXZ = Math.max(1000, 2 * Math.max(maxAbsX, maxAbsZ) + pad);
  const sizeXY = Math.max(1000, 2 * Math.max(maxAbsX, maxAbsY) + pad);
  const sizeYZ = Math.max(1000, 2 * Math.max(maxAbsY, maxAbsZ) + pad);
  // base plane sizes were 800; scale accordingly
  ground.scaling.x = sizeXZ / 800; ground.scaling.z = sizeXZ / 800;
  vGrid.scaling.x = vGrid.scaling.y = sizeXY / 800;
  wGrid.scaling.x = wGrid.scaling.y = sizeYZ / 800;
}

// Debounced grid update: schedule an update 2s after the last edit
function scheduleGridUpdate(){
  try { if (state._gridTimer) { clearTimeout(state._gridTimer); } } catch {}
  state._gridTimer = setTimeout(() => { try { updateGridExtent(); } catch {} }, 2000);
}
