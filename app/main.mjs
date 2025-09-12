import { makeDefaultBarrow, mergeInstructions, directions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { Log } from './modules/util/log.mjs';
import { initCamera } from './modules/view/camera.mjs';
import { initGrids } from './modules/view/grids.mjs';
import { renderDbView } from './modules/view/dbView.mjs';
import { initLogTab } from './modules/view/logTab.mjs';
import { initSettingsTab } from './modules/view/settings.mjs';
import { initVoxelTab } from './modules/view/voxelTab.mjs';
import { worldAabbFromSpace } from './modules/barrow/schema.mjs';
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
// Create highlight layer before first halo rebuild so it applies immediately
state.hl = new BABYLON.HighlightLayer('hl', scene, { blurHorizontalSize: 0.45, blurVerticalSize: 0.45 });
state.hl.innerGlow = true; state.hl.outerGlow = true;
try { state.hl.renderingGroupId = 3; } catch {}
state.built = buildSceneFromBarrow(scene, state.barrow);
renderDbView(state.barrow);
grids.updateUnitGrids(state.barrow?.meta?.voxelSize || 1);
try { grids.updateGridExtent(state.built); } catch {}
camApi.applyZoomBase();
camApi.applyPanBase();
// Fit view initially to frame all spaces
try { camApi.fitViewAll(state.barrow?.spaces || [], state.barrow?.meta?.voxelSize || 1); } catch {}
rebuildHalos();
grids.scheduleGridUpdate(state.built);
applyViewToggles();
applyTextScale?.();
applyVoxelOpacity?.();
updateHud();

function applyGlowStrength() {
  let strength = 70;
  try { strength = Math.max(0, Math.min(300, Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70)); } catch {}
  const k = strength / 100; // 0..3
  // Blur size: triple the previous range (max ~6.2)
  const blur = 0.2 + 2.0 * k * 3.0;
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

// Initialize optional tabs now that tabs exist
function ensureVoxelTab() {
  try {
    const panelContent = document.querySelector('.panel-content');
    if (!panelContent) return;
    if (!panelContent.querySelector('#tab-vox')) {
      initVoxelTab(panelContent, { state, saveBarrow, snapshot, renderDbView, rebuildScene, scheduleGridUpdate: () => grids.scheduleGridUpdate(state.built), scene, debug: { startVoxelScanDebug, addVoxelScanPointInside, addVoxelScanPointOutside, flushVoxelScanPoints, endVoxelScanDebug, showObbDebug, clearObbDebug } });
      try { Log.log('UI', 'Voxel tab initialized', {}); } catch {}
    }
  } catch (e) { try { Log.log('ERROR', 'Init voxel tab failed', { error: String(e) }); } catch {} }
}
// Try now, and also whenever tabs report readiness
ensureVoxelTab();
try { window.addEventListener('dw:tabsReady', ensureVoxelTab); } catch {}

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
// Apply axis thickness based on settings
function applyAxisRadius() {
  try {
    const pct = Number(localStorage.getItem('dw:ui:axisRadius') || '100') || 100;
    const k = Math.max(0.05, pct / 100);
    grids?.arrows?.setRadiusScale?.(k);
    grids.updateGridExtent(state.built);
  } catch {}
}
// Initialize Settings UI and bind sliders
initSettingsTab(camApi, { applyTextScale, applyGridArrowVisuals, rebuildScene, applyGlowStrength, rebuildHalos, applyVoxelOpacity, applyAxisRadius });
// Apply grid/arrow visuals on startup
applyGridArrowVisuals();
applyAxisRadius();

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
    const axOn = localStorage.getItem('dw:ui:axisArrows') !== '0';
    if (ground) ground.setEnabled(!!gOn);
    if (vGrid) vGrid.setEnabled(!!xyOn);
    if (wGrid) wGrid.setEnabled(!!yzOn);
    try { grids?.arrows?.group?.setEnabled?.(!!axOn); } catch {}
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

// Apply voxel wall opacity to current scene based on settings
function applyVoxelOpacity() {
  let alphaWall = 0.6;
  let alphaRock = 0.85;
  try { alphaWall = Math.max(0.0, Math.min(1.0, (Number(localStorage.getItem('dw:ui:wallOpacity') || '60') || 60) / 100)); } catch {}
  try { alphaRock = Math.max(0.0, Math.min(1.0, (Number(localStorage.getItem('dw:ui:rockOpacity') || '85') || 85) / 100)); } catch {}
  try {
    for (const part of state?.built?.voxParts || []) {
      try {
        const nm = String(part?.name || '');
        if (part.material) {
          if (nm.includes(':vox:wall')) part.material.alpha = alphaWall;
          else if (nm.includes(':vox:rock')) part.material.alpha = alphaRock;
        }
      } catch {}
    }
  } catch {}
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
  applyVoxelOpacity?.();
}

// ——————————— Voxel scan debug visualization ———————————
state._scanDebug = { redBase: null, greenBase: null, redArr: [], greenArr: [], count: 0 };
state._obbDebug = { mesh: null };
function startVoxelScanDebug(res=1) {
  try { endVoxelScanDebug(); } catch {}
  // Reduce dot size to 1/4 of previous
  const dia = Math.max(0.0625, (res * 0.7) / 4);
  const red = BABYLON.MeshBuilder.CreateSphere('dbg:scanDot:red', { diameter: dia, segments: 8 }, scene);
  const rmat = new BABYLON.StandardMaterial('dbg:scanDot:red:mat', scene);
  rmat.diffuseColor = new BABYLON.Color3(0.95, 0.15, 0.15); rmat.emissiveColor = new BABYLON.Color3(0.85, 0.12, 0.12); rmat.specularColor = new BABYLON.Color3(0,0,0);
  red.material = rmat; red.isPickable = false; red.renderingGroupId = 3;
  const green = BABYLON.MeshBuilder.CreateSphere('dbg:scanDot:green', { diameter: dia, segments: 8 }, scene);
  const gmat = new BABYLON.StandardMaterial('dbg:scanDot:green:mat', scene);
  gmat.diffuseColor = new BABYLON.Color3(0.1, 0.85, 0.2); gmat.emissiveColor = new BABYLON.Color3(0.1, 0.75, 0.2); gmat.specularColor = new BABYLON.Color3(0,0,0);
  green.material = gmat; green.isPickable = false; green.renderingGroupId = 3;
  state._scanDebug.redBase = red; state._scanDebug.greenBase = green; state._scanDebug.redArr = []; state._scanDebug.greenArr = []; state._scanDebug.count = 0;
  try { Log.log('VOXEL', 'scan:start', { res, dia }); } catch {}
}
function _pushDot(arr, wx, wy, wz) {
  const t = BABYLON.Vector3.Zero(); t.x = wx; t.y = wy; t.z = wz;
  const sc = new BABYLON.Vector3(1,1,1);
  const m = BABYLON.Matrix.Compose(sc, BABYLON.Quaternion.Identity(), t);
  for (let k = 0; k < 16; k++) arr.push(m.m[k]);
}
function addVoxelScanPointOutside(wx, wy, wz) { _pushDot(state._scanDebug.redArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
function addVoxelScanPointInside(wx, wy, wz) { _pushDot(state._scanDebug.greenArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
function flushVoxelScanPoints() {
  try { const b = state._scanDebug.redBase; if (b && state._scanDebug.redArr.length) b.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.redArr), 16, true); } catch {}
  try { const b2 = state._scanDebug.greenBase; if (b2 && state._scanDebug.greenArr.length) b2.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.greenArr), 16, true); } catch {}
  try { Log.log('VOXEL', 'scan:flush', { red: (state._scanDebug.redArr.length/16)|0, green: (state._scanDebug.greenArr.length/16)|0 }); } catch {}
}
function endVoxelScanDebug() {
  try { state._scanDebug.redBase?.dispose?.(); } catch {}
  try { state._scanDebug.greenBase?.dispose?.(); } catch {}
  state._scanDebug.redBase = null; state._scanDebug.greenBase = null; state._scanDebug.redArr = []; state._scanDebug.greenArr = []; state._scanDebug.count = 0;
  try { Log.log('VOXEL', 'scan:end', {}); } catch {}
}

function clearObbDebug() {
  try { state._obbDebug.mesh?.dispose?.(); } catch {}
  state._obbDebug.mesh = null;
}
function showObbDebug(corners) {
  try {
    clearObbDebug();
    if (!Array.isArray(corners) || corners.length !== 8) return;
    const V = (p) => new BABYLON.Vector3(p.x||0, p.y||0, p.z||0);
    const cs = corners.map(V);
    const edges = [
      [cs[0], cs[1]], [cs[1], cs[5]], [cs[5], cs[4]], [cs[4], cs[0]], // bottom rectangle
      [cs[2], cs[3]], [cs[3], cs[7]], [cs[7], cs[6]], [cs[6], cs[2]], // top rectangle
      [cs[0], cs[2]], [cs[1], cs[3]], [cs[4], cs[6]], [cs[5], cs[7]]  // verticals
    ];
    const lines = BABYLON.MeshBuilder.CreateLineSystem('dbg:obb', { lines: edges }, scene);
    lines.color = new BABYLON.Color3(0.1, 0.9, 0.9);
    lines.isPickable = false; lines.renderingGroupId = 3;
    state._obbDebug.mesh = lines;
  } catch {}
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
  try { const s = Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70; glowK = Math.max(0.2, Math.min(3.0, s / 100)); } catch {}
  const byCav = new Map((state.built.caverns||[]).map(x => [x.id, x.mesh]));
  const blue = new BABYLON.Color3(0.12 * glowK, 0.35 * glowK, 0.7 * glowK);
  const yellow = new BABYLON.Color3(0.7 * glowK, 0.65 * glowK, 0.15 * glowK);
  const subtleBlue = new BABYLON.Color3(0.10 * glowK, 0.28 * glowK, 0.55 * glowK);
  // Clear any outlines from previous selection
  try {
    for (const part of (state?.built?.voxParts || [])) {
      try { part.renderOutline = false; } catch {}
    }
  } catch {}
  for (const id of state.selection) {
    const m = bySpace.get(id) || byCav.get(id);
    if (!m) continue;
    state.hl.addMesh(m, blue);
    // Also glow voxel parts for selected spaces (subtle)
    try {
      for (const part of (state?.built?.voxParts || [])) {
        const nm = String(part?.name || '');
        if (nm.startsWith(`space:${id}:`)) {
          state.hl.addMesh(part, subtleBlue);
          // Add outline for better visibility at grazing angles
          try { part.outlineColor = subtleBlue; part.renderOutline = true; part.outlineWidth = 0.02; } catch {}
        }
      }
    } catch {}
  }
  // Draw selected space world-AABB in translucent red (single selection only)
  try {
    if (state.selection.size === 1) {
      const id = Array.from(state.selection)[0];
      const s = (state.barrow.spaces||[]).find(x => x.id === id);
      if (s) {
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
        const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
        function worldAabb(space){
          const w = (space.size?.x||0) * sr, h = (space.size?.y||0) * sr, d = (space.size?.z||0) * sr;
          const hx=w/2, hy=h/2, hz=d/2; const cx=space.origin?.x||0, cy=space.origin?.y||0, cz=space.origin?.z||0;
          const cX=Math.cos(rx), sX=Math.sin(rx), cY=Math.cos(ry), sY=Math.sin(ry), cZ=Math.cos(rz), sZ=Math.sin(rz);
          function rot(p){ let x=p.x, y=p.y*cX - p.z*sX, z=p.y*sX + p.z*cX; let x2=x*cY + z*sY, y2=y, z2=-x*sY + z*cY; let x3=x2*cZ - y2*sZ, y3=x2*sZ + y2*cZ, z3=z2; return {x:x3+cx,y:y3+cy,z:z3+cz}; }
          const cs=[{x:-hx,y:-hy,z:-hz},{x:+hx,y:-hy,z:-hz},{x:-hx,y:+hy,z:-hz},{x:+hx,y:+hy,z:-hz},{x:-hx,y:-hy,z:+hz},{x:+hx,y:-hy,z:+hz},{x:-hx,y:+hy,z:+hz},{x:+hx,y:+hy,z:+hz}].map(rot);
          let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity; for(const p of cs){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z);} return {min:{x:minX,y:minY,z:minZ},max:{x:maxX,y:maxY,z:maxZ}};
        }
        const bb = worldAabb(s);
        const w = Math.max(0.001, bb.max.x - bb.min.x), h = Math.max(0.001, bb.max.y - bb.min.y), d = Math.max(0.001, bb.max.z - bb.min.z);
        const cx = (bb.min.x + bb.max.x)/2, cy = (bb.min.y + bb.max.y)/2, cz = (bb.min.z + bb.max.z)/2;
        // Dispose previous debug box
        try { state.debugAabb?.dispose?.(); } catch {}
        const dbg = BABYLON.MeshBuilder.CreateBox('dbg:aabb', { width: w, height: h, depth: d }, scene);
        const mat = new BABYLON.StandardMaterial('dbg:aabb:mat', scene); mat.diffuseColor = new BABYLON.Color3(0.9, 0.15, 0.15); mat.emissiveColor = new BABYLON.Color3(0.6, 0.08, 0.08); mat.alpha = 0.18; mat.specularColor = new BABYLON.Color3(0,0,0);
        dbg.material = mat; dbg.isPickable = false; dbg.position.set(cx, cy, cz); dbg.renderingGroupId = 1;
        state.debugAabb = dbg;
        try { Log.log('DEBUG', 'Show world AABB', { id, center: {x:cx,y:cy,z:cz}, size: {x:w/sr, y:h/sr, z:d/sr} }); } catch {}
      }
    } else {
      try { state.debugAabb?.dispose?.(); state.debugAabb = null; } catch {}
    }
  } catch {}
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
