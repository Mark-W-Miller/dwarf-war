import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot, inflateAfterLoad } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { Log } from './modules/util/log.mjs';
import { initCamera } from './modules/view/camera.mjs';
import { initGrids } from './modules/view/grids.mjs';
import { renderDbView } from './modules/view/dbTab.mjs';
// Floating log window (replaces tab)
import { initLogWindow } from './modules/view/logWindow.mjs';
import { initSettingsTab } from './modules/view/settingsTab.mjs';
import { initVoxelTab } from './modules/view/voxelTab.mjs';
import { initSceneHandlers } from './modules/view/sceneHandlers.mjs';
import { initUIHandlers } from './modules/view/uiHandlers.mjs';
import { createRebuildHalos } from './modules/view/handlers/halos.mjs';
import { initVoxelDebug } from './modules/view/handlers/voxelDebug.mjs';

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
dir.position = new BABYLON.Vector3(10, 20, 10); dir.intensity = 1.4;
// Shadows: generator and helpers
let shadowGen = null;
try {
  shadowGen = new BABYLON.ShadowGenerator(2048, dir);
  // Make shadows clearer and crisper
  shadowGen.usePercentageCloserFiltering = true;
  try { shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH; } catch {}
  shadowGen.bias = 0.0005;
  try { shadowGen.normalBias = 0.01; } catch {}
  shadowGen.darkness = 0.75;
  try { shadowGen.autoCalcShadowZBounds = true; } catch {}
} catch {}
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
  // View mode: 'war' | 'cavern' | 'scry'
  mode: 'war',
  running: true,
  barrow: null,
  built: null, // handles to built meshes
  selection: new Set(), // selected cavern ids
  halos: new Map(), // id -> halo mesh
  hl: null, // highlight layer
  selObb: new Map(), // id -> OBB line mesh for selection box
  voxHl: new Map(), // id -> selected voxel highlight mesh
  voxSel: [],       // array of { id, x, y, z, v }
  voxSelMeshes: [], // meshes used to render multi-voxel selections (dispose each rebuild)
  lastVoxPick: null, // { id, x,y,z,v }
  lockedVoxPick: null, // { id, x,y,z,v } locked in Cavern Mode
};

// Provide a reusable selection/voxel highlight rebuilder
const rebuildHalos = createRebuildHalos({ scene, state });

// Ensure view mode and material opacities are sane on startup (avoid stale cavern settings)
try {
  // Force War Room view on boot unless explicitly in cavern
  const vm = localStorage.getItem('dw:viewMode');
  if (vm !== 'cavern') localStorage.setItem('dw:viewMode', 'war');
  // Initialize wall/rock opacity if missing or invalid
  const clamp01 = (n, dflt) => {
    const v = Number(n);
    return isFinite(v) && v >= 0 && v <= 100 ? String(v) : String(dflt);
  };
  localStorage.setItem('dw:ui:wallOpacity', clamp01(localStorage.getItem('dw:ui:wallOpacity'), 60));
  localStorage.setItem('dw:ui:rockOpacity', clamp01(localStorage.getItem('dw:ui:rockOpacity'), 85));
} catch {}

// Global flag to block transforms during voxel operations (bake/merge/fill)
let _voxOpActive = false;
try {
  window.addEventListener('dw:gizmos:disable', () => { _voxOpActive = true; try { Log.log('VOXEL', 'Op start: suppress transforms', {}); } catch {} });
  window.addEventListener('dw:gizmos:enable', () => { _voxOpActive = false; try { Log.log('VOXEL', 'Op end: allow transforms', {}); } catch {} });
} catch {}

// Load or create barrow; remember if it came from saved localStorage
const __savedBarrow = loadBarrow();
const __hadSavedBarrow = !!__savedBarrow;
state.barrow = __savedBarrow || makeDefaultBarrow();
layoutBarrow(state.barrow); // ensure positions from directions
// Create highlight layer before first halo rebuild so it applies immediately
state.hl = new BABYLON.HighlightLayer('hl', scene, { blurHorizontalSize: 0.45, blurVerticalSize: 0.45 });
// Make highlight layer composite transparent when no meshes are highlighted to avoid black-pass artifacts.
try { state.hl.neutralColor = new BABYLON.Color4(0, 0, 0, 0); } catch {}
state.hl.innerGlow = true; state.hl.outerGlow = true;
// Keep highlight layer in group 2 to avoid overlay artifacts (black triangle)
try { state.hl.renderingGroupId = 2; } catch {}
state.built = buildSceneFromBarrow(scene, state.barrow);
renderDbView(state.barrow);
grids.updateUnitGrids(state.barrow?.meta?.voxelSize || 1);
try { grids.updateGridExtent(state.built); } catch {}

function ensureDefaultViewTogglesForEmptyScene() {
  const hasContent = !!(
    (state?.built?.spaces && state.built.spaces.length) ||
    (state?.built?.caverns && state.built.caverns.length) ||
    (state?.built?.carddons && state.built.carddons.length)
  );
  if (hasContent) return;
  const keys = ['dw:ui:gridGround', 'dw:ui:gridXY', 'dw:ui:gridYZ', 'dw:ui:axisArrows'];
  for (const key of keys) {
    try { localStorage.setItem(key, '1'); } catch {}
  }
}

ensureDefaultViewTogglesForEmptyScene();
try { if (ground) ground.receiveShadows = true; } catch {}
camApi.applyZoomBase();
camApi.applyPanBase();
// Fit view initially — target caverns center-of-mass, size to spaces extents
try { camApi.fitViewSmart(state.barrow); } catch {}
rebuildHalos();
grids.scheduleGridUpdate(state.built);
applyViewToggles();
applyTextScale?.();
applyVoxelOpacity?.();
updateHud();

// If a connect path is present in DB, render the proposal nodes/line at startup
try {
  const p = (state?.barrow?.connect && Array.isArray(state.barrow.connect.path)) ? state.barrow.connect.path : null;
  if (p && p.length >= 2) {
    try {
      state._connect = state._connect || {};
      for (const it of state._connect.props || []) { try { it.mesh?.dispose?.(); } catch {} }
      for (const it of state._connect.nodes || []) { try { it.mesh?.dispose?.(); } catch {} }
      state._connect.props = []; state._connect.nodes = []; state._connect.segs = []; state._connect.path = null;
    } catch {}
    const pts = p.map(q => new BABYLON.Vector3(q.x||0, q.y||0, q.z||0));
    const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: true }, scene);
    line.color = new BABYLON.Color3(0.55, 0.9, 1.0); line.isPickable = false; line.renderingGroupId = 3;
    state._connect.props = [{ name: 'connect:proposal', mesh: line, path: p }];
    state._connect.nodes = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const sNode = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
      sNode.position.copyFrom(pts[i]); sNode.isPickable = true; sNode.renderingGroupId = 3;
      const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
      mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0); mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35); mat.specularColor = new BABYLON.Color3(0,0,0); mat.disableDepthWrite = true; mat.backFaceCulling = false; mat.zOffset = 8;
      sNode.material = mat; state._connect.nodes.push({ i, mesh: sNode });
    }
    state._connect.path = p.map(q => ({ x:q.x||0, y:q.y||0, z:q.z||0 }));
    try { window.dispatchEvent(new CustomEvent('dw:connect:update')); } catch {}
  }
} catch {}

// Restore selection from saved DB (meta.selected) after initial build
try {
  const selFromMeta = Array.isArray(state?.barrow?.meta?.selected) ? state.barrow.meta.selected.map(String) : [];
  if (selFromMeta.length) {
    state.selection.clear(); for (const id of selFromMeta) state.selection.add(id);
    try { rebuildHalos(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
  }
} catch {}

// Optional: auto-load a saved JSON from the repo's export folder
// - Honors ?load=<path> query param (relative to server root)
// - Else tries common defaults: /export/three-spaces.json, then /exports/three-spaces.json
// When loaded, merges into a fresh default barrow, persists, and rebuilds scene.
(async function tryLoadExport() {
  try {
    const params = new URLSearchParams(location.search || '');
    const q = params.get('load');
    const candidates = [];
    if (q) {
      candidates.push(q);
    } else {
      // If we already had a saved barrow, do NOT auto-load anything else
      if (__hadSavedBarrow) return;
      // Prefer last selected test DB if any
      try {
        const last = localStorage.getItem('dw:ui:lastTestDbPath');
        if (last) candidates.push(last);
      } catch {}
      // Fallbacks
      candidates.push('/export/three-spaces.json');
      candidates.push('/exports/three-spaces.json');
    }
    for (const rel of candidates) {
      const url = rel.startsWith('/') ? rel : `/${rel}`;
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) continue;
        const raw = await resp.json();
        const data = (() => { try { return inflateAfterLoad(raw); } catch { return raw; } })();
        // Merge onto a fresh default so required fields exist
        state.barrow = mergeInstructions(makeDefaultBarrow(), data);
        saveBarrow(state.barrow); snapshot(state.barrow);
        rebuildScene();
        renderDbView(state.barrow);
        // Apply saved selection from loaded file if present
        try {
          const selFromMeta = Array.isArray(state?.barrow?.meta?.selected) ? state.barrow.meta.selected.map(String) : [];
          if (selFromMeta.length) {
            state.selection.clear(); for (const id of selFromMeta) state.selection.add(id);
            try { rebuildHalos(); } catch {}
            try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
          }
        } catch {}
        try { Log.log('UI', 'Loaded barrow from export', { url }); } catch {}
        updateHud();
        break;
      } catch {}
    }
  } catch (e) { try { Log.log('ERROR', 'Auto-load export failed', { error: String(e && e.message ? e.message : e) }); } catch {} }
})();

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
  let modeLabel = 'War Room';
  if (state.mode === 'cavern') modeLabel = 'Cavern';
  else if (state.mode === 'scry') modeLabel = 'Scryball';
  else if (state.mode === 'war') modeLabel = 'War Room';
  hud.textContent = `Dwarf War • ${barrowName} • ${modeLabel} ${state.running ? '• Running' : '• Paused'}`;
}
function setMode(mode) { state.mode = mode; updateHud(); }
function setRunning(run) { state.running = run; updateHud(); }

// UI wiring handled by initUIHandlers

// Centralize event wiring in a dedicated module
const sceneApi = initSceneHandlers({
  scene,
  engine,
  camApi,
  camera,
  state,
  helpers: { setMode, rebuildScene, rebuildHalos, scheduleGridUpdate, moveSelection }
});

initUIHandlers({
  scene,
  engine,
  camApi,
  camera,
  state,
  helpers: { setMode, setRunning, rebuildScene, rebuildHalos, moveSelection, scheduleGridUpdate, applyViewToggles, updateHud, updateGridExtent, saveBarrow, snapshot },
  sceneApi
});

// After UI handlers are wired, ensure selection side-effects (gizmos) are applied
try {
  if (state.selection && state.selection.size > 0) {
    try { sceneApi.ensureRotWidget?.(); sceneApi.ensureMoveWidget?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
  }
} catch {}

// Initialize optional tabs now that tabs exist
function ensureVoxelTab() {
  try {
    const panelContent = document.querySelector('.panel-content');
    if (!panelContent) return;
    if (!panelContent.querySelector('#tab-vox')) {
      const voxelDebug = initVoxelDebug({ scene, state });
      initVoxelTab(panelContent, { state, saveBarrow, snapshot, renderDbView, rebuildScene, scheduleGridUpdate: () => grids.scheduleGridUpdate(state.built), scene, debug: voxelDebug });
      try { Log.log('UI', 'Voxel tab initialized', {}); } catch {}
    }
  } catch (e) { try { Log.log('ERROR', 'Init voxel tab failed', { error: String(e) }); } catch {} }
}
// Try now, and also whenever tabs report readiness
ensureVoxelTab();
try { window.addEventListener('dw:tabsReady', ensureVoxelTab); } catch {}

// Fit camera to all spaces
// Fit view now handled via camera/click handlers

// Defaults per type and update size fields when type changes
// (text-based assistant disabled)

engine.runRenderLoop(() => {
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
  // Grid extent updates are debounced via scheduleGridUpdate(); render the scene
  scene.render();
});

// (AI/Ollama disabled)
// ——————————— Log Window ———————————
try { document.getElementById('logOpen')?.addEventListener('click', () => { try { initLogWindow(); } catch {} }); } catch {}
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
    const data = { ...obj };
    if (navigator.sendBeacon) {
      // Use text/plain for broad sendBeacon compatibility across browsers
      const blob = new Blob([JSON.stringify(data)], { type: 'text/plain;charset=UTF-8' });
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
applyViewToggles();

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
    const hasContent = !!(
      (state?.built?.spaces && state.built.spaces.length) ||
      (state?.built?.caverns && state.built.caverns.length) ||
      (state?.built?.carddons && state.built.carddons.length)
    );
    const readToggle = (key, dflt = true) => {
      const raw = localStorage.getItem(key);
      if (!hasContent && raw === '0') {
        try { localStorage.setItem(key, '1'); } catch {}
        return true;
      }
      return raw == null ? dflt : raw !== '0';
    };
    const gOn = readToggle('dw:ui:gridGround', true);
    const xyOn = readToggle('dw:ui:gridXY', true);
    const yzOn = readToggle('dw:ui:gridYZ', true);
    const axOn = readToggle('dw:ui:axisArrows', true);
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
  // Apply with a small floor to avoid fully invisible voxels in WR
  let alphaWall = 0.6;
  let alphaRock = 0.85;
  try { alphaWall = Math.max(0.05, Math.min(1.0, (Number(localStorage.getItem('dw:ui:wallOpacity') || '60') || 60) / 100)); } catch {}
  try { alphaRock = Math.max(0.05, Math.min(1.0, (Number(localStorage.getItem('dw:ui:rockOpacity') || '85') || 85) / 100)); } catch {}
  try {
    for (const part of state?.built?.voxParts || []) {
      try {
        const nm = String(part?.name || '');
        const m = part.material;
        if (!m) continue;
        const isWall = nm.includes(':vox:wall');
        const isRock = nm.includes(':vox:rock');
        if (!isWall && !isRock) continue;
        // Handle MultiMaterial (wall) and StandardMaterial
        const targetAlpha = isWall ? alphaWall : alphaRock;
        try {
          if (m.subMaterials && Array.isArray(m.subMaterials)) {
            for (const sm of m.subMaterials) { try { if (sm) sm.alpha = targetAlpha; } catch {} }
          } else {
            m.alpha = targetAlpha;
          }
        } catch {}
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
  try { if (ground) ground.receiveShadows = true; } catch {}
  rebuildHalos();
  try { updateShadowCastersFromSelection(); } catch {}
  scheduleGridUpdate();
  applyViewToggles();
  applyTextScale?.();
  applyVoxelOpacity?.();
}


// Rebuild halos (selection visuals + voxel highlight) when a voxel is picked, and remember last pick
try {
  window.addEventListener('dw:voxelPick', (e) => {
    try { const d = e.detail || {}; Log.log('SELECT', 'event:voxelPick', d); } catch {}
    try {
      const d = e.detail || {};
      state.lastVoxPick = { id: d.id, x: d.i, y: d.j, z: d.k, v: d.v };
    } catch {}
    try { rebuildHalos(); } catch {}
  });
} catch {}

// Log selection change events for debugging
try {
  window.addEventListener('dw:selectionChange', (e) => {
    try {
      const sel = (e?.detail?.selection || []);
      Log.log('SELECT', 'event:selectionChange', { selection: sel });
      // Persist selection into DB meta so refresh restores it
      try { state.barrow.meta = state.barrow.meta || {}; state.barrow.meta.selected = sel.map(String); } catch {}
      try { saveBarrow(state.barrow); } catch {}
      try { rebuildHalos(); } catch {}
    } catch {}
  });
  } catch {}
  
/*
    // Selected voxel highlight (if any)
    try {
      const s2 = (state.barrow.spaces||[]).find(x => x.id === id);
      const lock = state.lockedVoxPick && state.lockedVoxPick.id === id ? state.lockedVoxPick : null;
      const pickToUse = lock ? { x: lock.x, y: lock.y, z: lock.z } : (s2?.voxPick ? { x: s2.voxPick.x, y: s2.voxPick.y, z: s2.voxPick.z } : null);
      if (s2 && s2.vox && s2.vox.size && pickToUse) {
        const nx = Math.max(1, s2.vox.size?.x || 1);
        const ny = Math.max(1, s2.vox.size?.y || 1);
        const nz = Math.max(1, s2.vox.size?.z || 1);
        const res = s2.vox.res || s2.res || (state.barrow?.meta?.voxelSize || 1);
        const { x: ix, y: iy, z: iz } = pickToUse;
        if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) {
          // Respect expose-top slicing: hide highlight if layer is cut off
          let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s2.voxExposeTop || 0) || 0))); } catch {}
          const yCut = ny - hideTop;
          if (iy < yCut) {
            const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
            const lx = (ix + 0.5) * res - centerX;
            const ly = (iy + 0.5) * res - centerY;
            const lz = (iz + 0.5) * res - centerZ;
            // Apply rotation if vox not world-aligned
            let q = BABYLON.Quaternion.Identity();
            try {
              const worldAligned = !!(s2.vox && s2.vox.worldAligned);
              if (!worldAligned) {
                const rx = Number(s2.rotation?.x ?? 0) || 0;
                const ry = (s2.rotation && typeof s2.rotation.y === 'number') ? Number(s2.rotation.y) : Number(s2.rotY || 0) || 0;
                const rz = Number(s2.rotation?.z ?? 0) || 0;
                q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
              }
            } catch {}
            // Parent highlight to the space mesh and use local coordinates (matches instancing path)
            const parent = bySpace.get(id);
            try { if (!parent) Log.log('HILITE', 'parent:missing', { id }); } catch {}
            const cx = (s2.origin?.x||0) + 0; // unused with parenting
            const cy = (s2.origin?.y||0) + 0;
            const cz = (s2.origin?.z||0) + 0;
            const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:${id}`, { size: res * 1.06 }, scene);
            const mat = new BABYLON.StandardMaterial(`sel:voxel:${id}:mat`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05);
            mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
            mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
            try { mat.disableDepthWrite = true; } catch (e) { report('HILITE:mat:disableDepthWrite', e); }
            mat.backFaceCulling = false;
            try { mat.zOffset = -2; } catch (e) { report('HILITE:mat:zOffset', e); }
            box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
            // Rotate local voxel center by space rotation, then parent to space mesh
            const rotM = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
            const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx,ly,lz), rotM);
            try { box.parent = parent; } catch (e) { report('HILITE:box:parent', e); }
            box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
            try { box.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:box:rot', e); }
            // Red glow on selected voxel
            try { state.hl.addMesh(box, redGlow); } catch (e) { report('HILITE:hl:add:box', e); }
            try {
              const wm = parent?.getWorldMatrix?.() || BABYLON.Matrix.Identity();
              const wpos = BABYLON.Vector3.TransformCoordinates(afterLocal, wm);
              Log.log('HILITE', 'voxel:draw', { id, world: { x: wpos.x, y: wpos.y, z: wpos.z }, local: { x: afterLocal.x, y: afterLocal.y, z: afterLocal.z } });
            } catch (e) { report('HILITE:voxel:draw:log', e); }
            // Add crisp edge lines to ensure visibility over voxels
            try {
              const h = (res * 0.52);
              const c = [
                new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h),
                new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h),
                new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h),
                new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h)
              ];
              const edges = [
                [c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],
                [c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],
                [c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]
              ];
              const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:${id}:edges`, { lines: edges }, scene);
              lines.color = new BABYLON.Color3(0.95, 0.2, 0.2);
              lines.isPickable = false; lines.renderingGroupId = 3;
              try { lines.parent = box; } catch (e) { report('HILITE:lines:parent', e); }
              lines.position.set(0, 0, 0);
              try { lines.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:lines:rot', e); }
              // Ensure edges render on top: assign material with depth write disabled
              try {
                const lmat = new BABYLON.StandardMaterial(`sel:voxel:${id}:edges:mat`, scene);
                lmat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2);
                lmat.disableDepthWrite = true;
                try { lmat.zOffset = -2; } catch {}
                lines.material = lmat;
              } catch (e) { report('HILITE:lines:mat', e); }
              try { state.hl.addMesh(lines, redGlow); } catch (e) { report('HILITE:hl:add:lines', e); }
              
            } catch {}
            state.voxHl.set(id, box);
          }
        }
      }
    } catch {}
  }
  // Persisted voxel highlight (survives when nothing is selected)
  try {
      // Prefer locked pick if present
      const fall = state.lockedVoxPick || state.lastVoxPick;
      if (fall && (!state.selection || !state.selection.has(fall.id))) {
        const s2 = (state.barrow.spaces||[]).find(x => x.id === fall.id);
        if (s2 && s2.vox && s2.vox.size) {
          const nx = Math.max(1, s2.vox.size?.x || 1);
          const ny = Math.max(1, s2.vox.size?.y || 1);
          const nz = Math.max(1, s2.vox.size?.z || 1);
          const res = s2.vox.res || s2.res || (state.barrow?.meta?.voxelSize || 1);
          const ix = fall.x|0, iy = fall.y|0, iz = fall.z|0;
          if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) {
            let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s2.voxExposeTop || 0) || 0))); } catch {}
            const yCut = ny - hideTop;
            if (iy < yCut) {
              const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
              const lx2 = (ix + 0.5) * res - centerX;
              const ly2 = (iy + 0.5) * res - centerY;
              const lz2 = (iz + 0.5) * res - centerZ;
              let q2 = BABYLON.Quaternion.Identity();
              try {
                const worldAligned2 = !!(s2.vox && s2.vox.worldAligned);
                if (!worldAligned2) {
                  const rx2 = Number(s2.rotation?.x ?? 0) || 0;
                  const ry2 = (s2.rotation && typeof s2.rotation.y === 'number') ? Number(s2.rotation.y) : Number(s2.rotY || 0) || 0;
                  const rz2 = Number(s2.rotation?.z ?? 0) || 0;
                  q2 = BABYLON.Quaternion.FromEulerAngles(rx2, ry2, rz2);
                }
              } catch {}
              const parent2 = bySpace.get(fall.id);
              const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:last:${fall.id}`, { size: res * 1.06 }, scene);
              const mat = new BABYLON.StandardMaterial(`sel:voxel:last:${fall.id}:mat`, scene);
              mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05);
              mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
              mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
              try { mat.disableDepthWrite = true; } catch (e) { report('HILITE:last:mat:disableDepthWrite', e); }
              mat.backFaceCulling = false;
              try { mat.zOffset = -2; } catch (e) { report('HILITE:last:mat:zOffset', e); }
              box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
              try { box.parent = parent2; } catch (e) { report('HILITE:last:box:parent', e); }
              // Express voxel center in parent local space (match instancing path)
              const rotM2 = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q2, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
              const afterLocal2 = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx2, ly2, lz2), rotM2);
              box.position.set(afterLocal2.x, afterLocal2.y, afterLocal2.z);
              try { box.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:last:box:rot', e); }
              // Red glow on last picked voxel
              try { state.hl.addMesh(box, redGlow); } catch (e) { report('HILITE:last:hl:add:box', e); }
              // Log for troubleshooting
              try {
                const wm2 = parent2?.getWorldMatrix?.() || BABYLON.Matrix.Identity();
                const wpos2 = BABYLON.Vector3.TransformCoordinates(afterLocal2, wm2);
                Log.log('HILITE', 'voxel:draw:last', { id: fall.id, world: { x: wpos2.x, y: wpos2.y, z: wpos2.z }, local: { x: afterLocal2.x, y: afterLocal2.y, z: afterLocal2.z } });
              } catch (e) { report('HILITE:last:voxel:draw:log', e); }
              try {
                const h = (res * 0.52);
                const c = [
                  new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h),
                  new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h),
                  new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h),
                  new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h)
                ];
                const edges = [
                  [c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],
                  [c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],
                  [c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]
                ];
                const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:last:${fall.id}:edges`, { lines: edges }, scene);
                lines.color = new BABYLON.Color3(0.95, 0.2, 0.2);
                lines.isPickable = false; lines.renderingGroupId = 3;
                try { lines.parent = box; } catch (e) { report('HILITE:last:lines:parent', e); }
                lines.position.set(0, 0, 0);
                try { lines.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:last:lines:rot', e); }
                try { state.hl.addMesh(lines, redGlow); } catch (e) { report('HILITE:last:hl:add:lines', e); }
                
              } catch {}
              state.voxHl.set(fall.id, box);
            }
          }
        }
      }
    } catch {}
  // Draw selected space world-AABB in translucent red (single selection only)
  try {
    // Always dispose any previous debug AABB first
    try { state.debugAabb?.dispose?.(); state.debugAabb = null; } catch {}
    if (state.selection.size === 1) {
      const id = Array.from(state.selection)[0];
      const s = (state.barrow.spaces||[]).find(x => x.id === id);
      // Skip drawing AABB for voxelized spaces to reduce clutter after voxel ops
      if (s && !s.vox) {
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
    }
  } catch {}

  
  // Always glow intersections in yellow
  try {
    for (const x of state?.built?.intersections || []) if (x?.mesh) state.hl.addMesh(x.mesh, yellow);
  } catch {}

  // If in Scryball Mode, keep the scry ball glowing
  try {
    if (state?._scry?.scryMode && state?._scry?.ball) {
      const color = new BABYLON.Color3(0.4, 0.85, 1.0);
      state.hl.addMesh(state._scry.ball, color);
      try { state._scry.ball.outlineColor = color; state._scry.ball.outlineWidth = 0.02; state._scry.ball.renderOutline = true; } catch {}
    }
  } catch {}
}
*/

 function moveSelection(dx=0, dy=0, dz=0) {
  if (_voxOpActive) { try { Log.log('XFORM', 'Move blocked during voxel op', { dx, dy, dz }); } catch {} return; }
  if (!state.selection.size) return;
  const bySpace = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
  const byCav = new Map((state.barrow.caverns||[]).map(c => [c.id, c]));
  for (const id of state.selection) {
    const s = bySpace.get(id);
    if (s) {
      const p = s.origin || { x:0,y:0,z:0 };
      let nx = (p.x||0)+dx, ny = (p.y||0)+dy, nz = (p.z||0)+dz;
      try {
        if (s.vox && s.vox.size) {
          const res = s.vox?.res || s.res || (state.barrow?.meta?.voxelSize || 1);
          const snap = (v) => { const r = Math.max(1e-6, Number(res)||0); return Math.round(v / r) * r; };
          nx = snap(nx); ny = snap(ny); nz = snap(nz);
        }
      } catch {}
      s.origin = { x: nx, y: ny, z: nz };
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

 


// Compute grid extents to contain all spaces (min 1000 yards)
function updateGridExtent(){
  // Delegate to grids module for a single source of truth
  try { grids.updateGridExtent(state.built); } catch {}
}

// ——————————— Shadow casters on selection ———————————
function updateShadowCastersFromSelection() {
  try {
    if (!shadowGen) return;
    const sm = shadowGen.getShadowMap(); if (!sm) return;
    const list = [];
    const ids = Array.from(state.selection || []);
    const byId = new Map((state?.built?.spaces || []).map(x => [x.id, x.mesh]).filter(([k,v]) => !!v));
    for (const id of ids) { const m = byId.get(id); if (m) list.push(m); }
    // Also include voxel parts belonging to selected spaces
    try {
      for (const part of (state?.built?.voxParts || [])) {
        const nm = String(part?.name || '');
        if (ids.some(id => nm.startsWith(`space:${id}:`))) list.push(part);
      }
    } catch {}
    sm.renderList = list;
    // Ensure receivers are set
    try { if (grids?.ground) grids.ground.receiveShadows = true; } catch {}
  } catch {}
}

try { window.addEventListener('dw:selectionChange', updateShadowCastersFromSelection); } catch {}

// Debounced grid update: schedule an update 2s after the last edit
function scheduleGridUpdate(){
  try { grids.scheduleGridUpdate(state.built); } catch { updateGridExtent(); }
}
