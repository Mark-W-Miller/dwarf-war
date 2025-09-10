import { makeDefaultBarrow, mergeInstructions, directions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { Log } from './modules/util/log.mjs';
import { initCamera } from './modules/view/camera.mjs';
import { initGrids } from './modules/view/grids.mjs';
import { renderDbView } from './modules/view/dbView.mjs';
import { initLogTab } from './modules/view/logTab.mjs';
import { initSettingsTab } from './modules/view/settings.mjs';
import { initEventHandlers } from './modules/view/eventHandler.mjs';

// Babylon setup
const canvas = document.getElementById('renderCanvas');
const hud = document.getElementById('hud');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

// Camera
const camApi = initCamera(scene, canvas, Log);
const camera = camApi.camera;

// Lighting
const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
dir.position = new BABYLON.Vector3(10, 20, 10); dir.intensity = 1.1;
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.2;

// Grids
const grids = initGrids(scene);
const ground = grids.ground;
const vGrid = grids.vGrid;
const wGrid = grids.wGrid;

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
grids.updateUnitGrids(state.barrow?.meta?.voxelSize || 1);
try { grids.updateGridExtent(state.built); } catch {}
camApi.applyZoomBase();
camApi.applyPanBase();
rebuildHalos();
grids.scheduleGridUpdate(state.built);
applyViewToggles();
applyTextScale?.();
updateHud();
// Highlight layer for selection glow
state.hl = new BABYLON.HighlightLayer('hl', scene, { blurHorizontalSize: 0.45, blurVerticalSize: 0.45 });
state.hl.innerGlow = true; state.hl.outerGlow = false;

function applyGlowStrength() {
  let strength = 70;
  try { strength = Math.max(0, Math.min(100, Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70)); } catch {}
  const k = strength / 100; // 0..1
  // Blur size: from subtle (0.2) to strong (~2.2)
  const blur = 0.2 + 2.0 * k;
  try { state.hl.blurHorizontalSize = blur; state.hl.blurVerticalSize = blur; } catch {}
}
applyGlowStrength();

function updateHud() {
  const barrowName = state.barrow?.id || 'Barrow';
  hud.textContent = `Dwarf War • ${barrowName} • ${state.mode === 'edit' ? 'Edit' : 'Game'} ${state.running ? '• Running' : '• Paused'}`;
}
function setMode(mode) { state.mode = mode; updateHud(); }
function setRunning(run) { state.running = run; updateHud(); }

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

// Centralize event wiring in a dedicated module
initEventHandlers({
  scene,
  engine,
  camApi,
  camera,
  state,
  helpers: { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateHud, updateGridExtent }
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

// Fit view handled in eventHandler.mjs

// Defaults per type and update size fields when type changes
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
    // Adapt pan speed with distance
    camApi.updatePanDynamics();
  } catch {}
  // Grid extent updates are debounced (2s) via scheduleGridUpdate()
  // Percentage-based zoom handles near/far scaling; settings slider updates base percentage.
  // Render
  scene.render();
});

// Window resize handled in eventHandler.mjs

// Collapse/expand panel with persistence
// Panel collapse handled in eventHandler.mjs

// (AI/Ollama disabled)

// Build tabs: Edit and Database, and move existing controls accordingly
// Tabs setup handled in eventHandler.mjs
// removed legacy Parse button wiring; Enter now handles parsing
// ——————————— Log Tab ———————————
initLogTab(document.querySelector('.panel-content'));
// Global error logging into Log tab
try {
  window.addEventListener('error', (e) => {
    const payload = { type: 'error', message: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: (e.error && e.error.stack) ? String(e.error.stack) : undefined };
    try { Log.log('ERROR', 'Unhandled error', payload); } catch {}
    try { sendToAssistant(payload); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    const payload = { type: 'unhandledrejection', reason: String(e.reason), stack: (e.reason && e.reason.stack) ? String(e.reason.stack) : undefined };
    try { Log.log('ERROR', 'Unhandled rejection', payload); } catch {}
    try { sendToAssistant(payload); } catch {}
  });
} catch {}

function sendToAssistant(obj) {
  try {
    if (localStorage.getItem('dw:dev:sendErrors') !== '1') return;
  } catch { return; }
  try {
    const url = 'http://localhost:6060/log';
    const data = { app: 'dwarf-war', at: Date.now(), ...obj };
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
    fetch(url, { method: 'POST', body: JSON.stringify(data), keepalive: true, mode: 'no-cors' }).catch(() => {});
  } catch {}
}

// ——————————— Settings UI ———————————
function applyGridArrowVisuals() {
  const gs = Number(localStorage.getItem('dw:ui:gridStrength') || '80') || 80;
  const as = Number(localStorage.getItem('dw:ui:arrowStrength') || '40') || 40;
  try { grids.applyVisualStrengths(gs, as); } catch {}
}
// Initialize Settings UI and bind sliders
initSettingsTab(camApi, { applyTextScale, applyGridArrowVisuals, rebuildScene, applyGlowStrength, rebuildHalos });
// Apply grid/arrow visuals on startup
applyGridArrowVisuals();

// Zoom/pan helpers now live in camApi (camera module)

// DB view renderer provided by modules/view/dbView.mjs

// ——————————— Units and selection/transform ———————————
function getVoxelSize() {
  return Number(state.barrow?.meta?.voxelSize) || 1;
}

function updateUnitGrids() {
  const s = getVoxelSize();
  try { grids.updateUnitGrids(s); } catch {}
}

function applyViewToggles() {
  // Grid visibility
  try {
    const gOn = localStorage.getItem('dw:ui:gridGround') !== '0';
    const xyOn = localStorage.getItem('dw:ui:gridXY') !== '0';
    const yzOn = localStorage.getItem('dw:ui:gridYZ') !== '0';
    if (ground) ground.setEnabled(!!gOn);
    if (vGrid) vGrid.setEnabled(!!xyOn);
    if (wGrid) wGrid.setEnabled(!!yzOn);
  } catch {}
  // Labels visibility (spaces + caverns)
  try {
    const namesOn = localStorage.getItem('dw:ui:showNames') !== '0';
    for (const x of state?.built?.spaceLabels || []) x.mesh?.setEnabled(!!namesOn);
    for (const x of state?.built?.cavernLabels || []) x.mesh?.setEnabled(!!namesOn);
  } catch {}
}

function applyTextScale() {
  let scale = 1;
  try {
    const val = Number(localStorage.getItem('dw:ui:textScale') || '100') || 100;
    scale = Math.max(0.1, Math.min(100, val / 100));
  } catch {}
  const apply = (mesh) => {
    if (!mesh) return;
    try {
      mesh.scaling.x = scale;
      mesh.scaling.y = scale;
      if (mesh.scaling.z !== undefined) mesh.scaling.z = 1;
    } catch {}
  };
  try { for (const x of state?.built?.spaceLabels || []) apply(x.mesh); } catch {}
  try { for (const x of state?.built?.cavernLabels || []) apply(x.mesh); } catch {}
  try { for (const x of state?.built?.carddons || []) if (x?.mesh?.name?.includes(':label')) apply(x.mesh); } catch {}
}

function rebuildScene() {
  disposeBuilt(state.built);
  layoutBarrow(state.barrow);
  state.built = buildSceneFromBarrow(scene, state.barrow);
  updateUnitGrids();
  try { grids.updateGridExtent(state.built); } catch {}
  rebuildHalos();
  scheduleGridUpdate();
  applyViewToggles();
  applyTextScale?.();
}

function rebuildHalos() {
  // clear old torus meshes if any
  for (const [id, mesh] of state.halos) { try { mesh.dispose(); } catch {} }
  state.halos.clear();
  // update highlight layer
  try { state.hl.removeAllMeshes(); } catch {}
  const bySpace = new Map((state.built.spaces||[]).map(x => [x.id, x.mesh]));
  // Glow color intensity from setting
  let glowK = 0.7;
  try { const s = Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70; glowK = Math.max(0.2, Math.min(1.25, s / 70)); } catch {}
  const byCav = new Map((state.built.caverns||[]).map(x => [x.id, x.mesh]));
  const blue = new BABYLON.Color3(0.12 * glowK, 0.35 * glowK, 0.7 * glowK);
  const yellow = new BABYLON.Color3(0.7 * glowK, 0.65 * glowK, 0.15 * glowK);
  for (const id of state.selection) {
    const m = bySpace.get(id) || byCav.get(id);
    if (!m) continue;
    state.hl.addMesh(m, blue);
  }
  // Always glow intersections in yellow
  try {
    for (const x of state?.built?.intersections || []) if (x?.mesh) state.hl.addMesh(x.mesh, yellow);
  } catch {}
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
  try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'move', dx, dy, dz, selection: Array.from(state.selection) } })); } catch {}
}

// Transform buttons handled in eventHandler.mjs

// Pointer selection and double-click handled in eventHandler.mjs


// Compute grid extents to contain all spaces (min 1000 yards)
function updateGridExtent(){
  // Delegate to grids module for a single source of truth
  try { grids.updateGridExtent(state.built); } catch {}
}

// Debounced grid update: schedule an update 2s after the last edit
function scheduleGridUpdate(){
  try { grids.scheduleGridUpdate(state.built); } catch { updateGridExtent(); }
}
