import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot, inflateAfterLoad } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { Log } from './modules/util/log.mjs';
import { initCamera } from './modules/view/camera.mjs';
import { initGrids } from './modules/view/grids.mjs';
import { renderDbView } from './modules/view/dbTab.mjs';
import { initLogWindow } from './modules/view/logWindow.mjs';
import { initSettingsTab } from './modules/view/settingsTab.mjs';
import { initVoxelTab } from './modules/view/voxelTab.mjs';
import { initSceneHandlers } from './modules/view/sceneHandlers.mjs';
import { initUIHandlers } from './modules/view/uiHandlers.mjs';
import { createRebuildHalos } from './modules/view/handlers/halos.mjs';
import { initVoxelDebug } from './modules/view/handlers/voxelDebug.mjs';
import { rebuildConnectMeshes, ensureConnectState } from './modules/view/connectMeshes.mjs';


const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;

function readStorage(key, fallback = null) {
  if (!storage || typeof storage.getItem !== 'function') return fallback;
  const value = storage.getItem(key);
  return value === null ? fallback : value;
}

function writeStorage(key, value) {
  if (!storage || typeof storage.setItem !== 'function') return;
  storage.setItem(key, value);
}

function removeStorage(key) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  storage.removeItem(key);
}

function addWindowListener(name, handler) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener(name, handler);
}

function dispatchCustomEvent(name, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(name, detail));
}

function logEvent(cls, msg, data) {
  if (Log?.log) Log.log(cls, msg, data);
}

const canvas = document.getElementById('renderCanvas');
const hud = document.getElementById('hud');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

const camApi = initCamera(scene, canvas, Log);
const camera = camApi.camera;

const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
dir.position = new BABYLON.Vector3(10, 20, 10); dir.intensity = 1.4;
let shadowGen = null;
if (BABYLON?.ShadowGenerator) {
  const generator = new BABYLON.ShadowGenerator(2048, dir);
  generator.usePercentageCloserFiltering = true;
  if ('filteringQuality' in generator) generator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
  generator.bias = 0.0005;
  if ('normalBias' in generator) generator.normalBias = 0.01;
  generator.darkness = 0.75;
  if ('autoCalcShadowZBounds' in generator) generator.autoCalcShadowZBounds = true;
  shadowGen = generator;
}
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.2;

const grids = initGrids(scene);
const ground = grids.ground;
const vGrid = grids.vGrid;
const wGrid = grids.wGrid;

(function addAxisLabels() {
  const tick = 20; // spacing in world units
  const range = 200; // +/- range
  const font = 'bold 22px system-ui, sans-serif';
  const color = '#7fbf7f';

  function makeTextPlane(name, text) {
    const size = 128;
    const dt = new BABYLON.DynamicTexture(name + ':dt', { width: size, height: size }, scene, false);
    dt.hasAlpha = true; const ctx = dt.getContext(); ctx.clearRect(0, 0, size, size);
    dt.drawText(text, null, 90, font, color, 'transparent', true);
    const mat = new BABYLON.StandardMaterial(name + ':mat', scene);
    mat.diffuseTexture = dt; mat.emissiveTexture = dt; mat.backFaceCulling = false; mat.specularColor = new BABYLON.Color3(0, 0, 0);
    const p = BABYLON.MeshBuilder.CreatePlane(name, { size: 1.2 }, scene);
    p.material = mat; p.isPickable = false;
    return p;
  }

  for (let x = -range; x <= range; x += tick) {
    const plane = makeTextPlane('lblX_' + x, String(x));
    plane.position = new BABYLON.Vector3(x, 0.05, 0.01);
    plane.rotation.x = -Math.PI / 2; // face up
  }
  for (let x = -range; x <= range; x += tick) {
    const plane = makeTextPlane('lblVX_' + x, String(x));
    plane.position = new BABYLON.Vector3(x, -0.05, 0.05);
  }
  for (let y = -range; y <= range; y += tick) {
    const plane = makeTextPlane('lblVY_' + y, String(y));
    plane.position = new BABYLON.Vector3(0.05, y, 0.05);
  }

  for (let z = -range; z <= range; z += tick) {
    const plane = makeTextPlane('lblZ_' + z, String(z));
    plane.position = new BABYLON.Vector3(0.01, 0.05, z);
    plane.rotation.x = -Math.PI / 2; // face up
  }

  for (let z = -range; z <= range; z += tick) {
    const plane = makeTextPlane('lblVZ_' + z, String(z));
    plane.position = new BABYLON.Vector3(0.05, -0.05, z);
  }
})();

const state = {
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
  history: { lastCavernId: null },
  _hover: { spaceId: null },
};

const rebuildHalos = createRebuildHalos({ scene, state });

if (true) {
  const vm = localStorage.getItem('dw:viewMode');
  if (vm !== 'cavern') localStorage.setItem('dw:viewMode', 'war');
  const clamp01 = (n, dflt) => {
    const v = Number(n);
    return isFinite(v) && v >= 0 && v <= 100 ? String(v) : String(dflt);
  };
  localStorage.setItem('dw:ui:wallOpacity', clamp01(localStorage.getItem('dw:ui:wallOpacity'), 100));
  localStorage.setItem('dw:ui:rockOpacity', clamp01(localStorage.getItem('dw:ui:rockOpacity'), 100));
} // Global flag to block transforms during voxel operations (bake/merge/fill)
let _voxOpActive = false;
if (true) {
  window.addEventListener('dw:gizmos:disable', () => { _voxOpActive = true; if (true) { Log.log('VOXEL', 'Op start: suppress transforms', {}); } });
  window.addEventListener('dw:gizmos:enable', () => { _voxOpActive = false; if (true) { Log.log('VOXEL', 'Op end: allow transforms', {}); } });
} // Load or create barrow; remember if it came from saved localStorage
const __savedBarrow = loadBarrow();
const __hadSavedBarrow = !!__savedBarrow;
state.barrow = __savedBarrow || makeDefaultBarrow();
layoutBarrow(state.barrow); // ensure positions from directions
state.hl = new BABYLON.HighlightLayer('hl', scene, { blurHorizontalSize: 0.45, blurVerticalSize: 0.45 });
if (state.hl && 'neutralColor' in state.hl) state.hl.neutralColor = new BABYLON.Color4(0, 0, 0, 0);
state.hl.innerGlow = true; state.hl.outerGlow = true;
if (state.hl && 'renderingGroupId' in state.hl) state.hl.renderingGroupId = 2;
state.built = buildSceneFromBarrow(scene, state.barrow);
renderDbView(state.barrow);
grids.updateUnitGrids(state.barrow?.meta?.voxelSize || 1);
if (grids?.updateGridExtent) grids.updateGridExtent(state.built);

function ensureDefaultViewTogglesForEmptyScene() {
  const hasContent = !!(
    (state?.built?.spaces && state.built.spaces.length) ||
    (state?.built?.caverns && state.built.caverns.length) ||
    (state?.built?.carddons && state.built.carddons.length)
  );
  if (hasContent) return;
  const keys = ['dw:ui:gridGround', 'dw:ui:gridXY', 'dw:ui:gridYZ', 'dw:ui:axisArrows'];
  for (const key of keys) writeStorage(key, '1');
}

ensureDefaultViewTogglesForEmptyScene();
if (ground) ground.receiveShadows = true;
camApi.applyZoomBase();
camApi.applyPanBase();
if (camApi?.fitViewSmart) camApi.fitViewSmart(state.barrow);
rebuildHalos();
grids.scheduleGridUpdate(state.built);
applyViewToggles();
if (typeof applyTextScale === 'function') applyTextScale();
if (typeof applyVoxelOpacity === 'function') applyVoxelOpacity();
updateHud();

const connectInfo = state?.barrow?.connect || {};
const connectPath = Array.isArray(connectInfo?.path) ? connectInfo.path : null;
const savedNodeDiameter = Number(connectInfo?.nodeDiameter);
if (connectPath && connectPath.length >= 2) {
  const connectState = ensureConnectState(state);
  connectState.nodeDiameter = Number.isFinite(savedNodeDiameter) && savedNodeDiameter > 0 ? savedNodeDiameter : null;
  rebuildConnectMeshes({ scene, state, path: connectPath, nodeDiameter: connectState.nodeDiameter });
  dispatchCustomEvent('dw:connect:update');
}

const restoredSelection = Array.isArray(state?.barrow?.meta?.selected) ? state.barrow.meta.selected.map(String) : [];
if (restoredSelection.length) {
  state.selection.clear();
  for (const id of restoredSelection) state.selection.add(id);
  rebuildHalos();
  dispatchCustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } });
}

async function loadExportDataset() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search || '');
  const requestedPath = params.get('load');
  const candidates = [];
  if (requestedPath) {
    candidates.push(requestedPath);
  } else {
    if (__hadSavedBarrow) return;
    const lastPath = readStorage('dw:ui:lastTestDbPath');
    if (lastPath) candidates.push(lastPath);
    candidates.push('/export/three-spaces.json');
    candidates.push('/exports/three-spaces.json');
  }
  for (const rel of candidates) {
    const url = rel.startsWith('/') ? rel : `/${rel}`;
    const response = await fetch(url, { cache: 'no-store' }).then((res) => res, () => null);
    if (!response || !response.ok) continue;
    const raw = await response.json().then((data) => data, () => null);
    if (!raw) continue;
    const hydrated = typeof inflateAfterLoad === 'function' ? inflateAfterLoad(raw) : raw;
    state.barrow = mergeInstructions(makeDefaultBarrow(), hydrated);
    saveBarrow(state.barrow);
    snapshot(state.barrow);
    rebuildScene();
    renderDbView(state.barrow);
    const metaSelection = Array.isArray(state?.barrow?.meta?.selected) ? state.barrow.meta.selected.map(String) : [];
    if (metaSelection.length) {
      state.selection.clear();
      for (const id of metaSelection) state.selection.add(id);
      rebuildHalos();
      dispatchCustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } });
    }
    logEvent('UI', 'Loaded barrow from export', { url });
    updateHud();
    break;
  }
}

loadExportDataset();

function applyGlowStrength() {
  const raw = readStorage('dw:ui:glowStrength', '70');
  const numeric = Number(raw);
  const strength = Number.isFinite(numeric) ? Math.max(0, Math.min(300, numeric)) : 70;
  const blur = 0.2 + 2.0 * (strength / 100) * 3.0;
  if (state.hl) {
    state.hl.blurHorizontalSize = blur;
    state.hl.blurVerticalSize = blur;
  }
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

if (state.selection?.size) {
  sceneApi.ensureRotWidget?.();
  sceneApi.ensureMoveWidget?.();
  dispatchCustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } });
}

function isEditableTarget(element) {
  if (!element) return false;
  const tag = element.tagName ? String(element.tagName).toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!element.isContentEditable;
}

function getHoveredCavernId() {
  const hoveredId = state?._hover?.spaceId || null;
  if (!hoveredId) return null;
  const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
  const match = spaces.find((space) => space && String(space.id) === String(hoveredId));
  if (!match) return null;
  if ((match.vox && match.vox.size) || match.type === 'Cavern') return match.id;
  return null;
}

function handleViewModeHotkeys(event) {
  const key = event?.key;
  if (key !== '<' && key !== '>') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;
  if (event.repeat) return;

  if (key === '>') {
    if (state.mode === 'war') {
      let cavernId = getHoveredCavernId();
      if (!cavernId && state?.history?.lastCavernId) cavernId = state.history.lastCavernId;
      if (!cavernId) return;
      event.preventDefault();
      event.stopPropagation();
      sceneApi.enterCavernModeForSpace?.(cavernId);
      return;
    }
    if (state.mode === 'cavern') {
      event.preventDefault();
      event.stopPropagation();
      sceneApi.enterScryMode?.();
    }
    return;
  }

  if (state.mode === 'scry') {
    event.preventDefault();
    event.stopPropagation();
    sceneApi.exitScryMode?.();
    return;
  }
  if (state.mode === 'cavern') {
    event.preventDefault();
    event.stopPropagation();
    sceneApi.exitCavernMode?.();
  }
}

window.addEventListener('keydown', handleViewModeHotkeys, true);

function ensureVoxelTab() {
  if (true) {
    const panelContent = document.querySelector('.panel-content');
    if (!panelContent) return;
    if (!panelContent.querySelector('#tab-vox')) {
      const voxelDebug = initVoxelDebug({ scene, state });
      initVoxelTab(panelContent, { state, saveBarrow, snapshot, renderDbView, rebuildScene, scheduleGridUpdate: () => grids.scheduleGridUpdate(state.built), scene, debug: voxelDebug });
      if (true) { Log.log('UI', 'Voxel tab initialized', {}); } }
  } }
ensureVoxelTab();
if (true) { window.addEventListener('dw:tabsReady', ensureVoxelTab); } engine.runRenderLoop(() => {
  if (true) {
    if (ground) { ground.position.x = 0; ground.position.z = 0; ground.position.y = 0; }
    if (typeof vGrid !== 'undefined' && vGrid) { vGrid.position.x = 0; vGrid.position.z = 0; }
    if (typeof wGrid !== 'undefined' && wGrid) { wGrid.position.x = 0; wGrid.position.z = 0; }
    if (state?.built?.label && camera?.target) {
      state.built.label.position.x = camera.target.x;
      state.built.label.position.z = camera.target.z;
    }
    camApi.updatePanDynamics();
  } // Grid extent updates are debounced via scheduleGridUpdate(); render the scene
  scene.render();
});

if (true) { document.getElementById('logOpen')?.addEventListener('click', () => { if (true) { initLogWindow(); } }); } // Global error logging into Log tab
if (true) {
  window.addEventListener('error', (e) => {
    const payload = { type: 'error', message: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: (e.error && e.error.stack) ? String(e.error.stack) : undefined };
    if (true) { Log.log('ERROR', 'Unhandled error', payload); } if (true) { sendToAssistant(payload); } });
  window.addEventListener('unhandledrejection', (e) => {
    const payload = { type: 'unhandledrejection', reason: String(e.reason), stack: (e.reason && e.reason.stack) ? String(e.reason.stack) : undefined };
    if (true) { Log.log('ERROR', 'Unhandled rejection', payload); } if (true) { sendToAssistant(payload); } });
} function sendToAssistant(obj) {
  if (true) {
    if (localStorage.getItem('dw:dev:sendErrors') !== '1') return;
  } if (true) {
    const url = 'http://localhost:6060/log';
    const data = { ...obj };
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(data)], { type: 'text/plain;charset=UTF-8' });
      navigator.sendBeacon(url, blob);
      return;
    }
    fetch(url, { method: 'POST', body: JSON.stringify(data), keepalive: true, mode: 'no-cors' }).catch(() => { });
  } }

function applyGridArrowVisuals() {
  const gs = Number(localStorage.getItem('dw:ui:gridStrength') || '80') || 80;
  const as = Number(localStorage.getItem('dw:ui:arrowStrength') || '40') || 40;
  if (true) { grids.applyVisualStrengths(gs, as); } }
function applyAxisRadius() {
  if (true) {
    const pct = Number(localStorage.getItem('dw:ui:axisRadius') || '100') || 100;
    const k = Math.max(0.05, pct / 100);
    grids?.arrows?.setRadiusScale?.(k);
    grids.updateGridExtent(state.built);
  } }
initSettingsTab(camApi, { applyTextScale, applyGridArrowVisuals, rebuildScene, applyGlowStrength, rebuildHalos, applyVoxelOpacity, applyAxisRadius });
applyGridArrowVisuals();
applyAxisRadius();
applyViewToggles();



function getVoxelSize() {
  return Number(state.barrow?.meta?.voxelSize) || 1;
}

function updateUnitGrids() {
  const s = getVoxelSize();
  if (true) { grids.updateUnitGrids(s); } }

function applyViewToggles() {
  if (true) {
    const hasContent = !!(
      (state?.built?.spaces && state.built.spaces.length) ||
      (state?.built?.caverns && state.built.caverns.length) ||
      (state?.built?.carddons && state.built.carddons.length)
    );
    const readToggle = (key, dflt = true) => {
      const raw = localStorage.getItem(key);
      if (!hasContent && raw === '0') {
        if (true) { localStorage.setItem(key, '1'); } return true;
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
    if (true) { grids?.arrows?.group?.setEnabled?.(!!axOn); } } // Labels visibility (spaces + caverns)
  if (true) {
    const namesOn = localStorage.getItem('dw:ui:showNames') !== '0';
    for (const x of state?.built?.spaceLabels || []) x.mesh?.setEnabled(!!namesOn);
    for (const x of state?.built?.cavernLabels || []) x.mesh?.setEnabled(!!namesOn);
  } }

function applyTextScale() {
  let scale = 1;
  if (true) {
    const val = Number(localStorage.getItem('dw:ui:textScale') || '100') || 100;
    scale = Math.max(0.1, Math.min(100, val / 100));
  } const apply = (mesh) => {
    if (!mesh) return;
    if (true) {
      mesh.scaling.x = scale;
      mesh.scaling.y = scale;
      if (mesh.scaling.z !== undefined) mesh.scaling.z = 1;
    } };
  if (true) { for (const x of state?.built?.spaceLabels || []) apply(x.mesh); } if (true) { for (const x of state?.built?.cavernLabels || []) apply(x.mesh); } if (true) { for (const x of state?.built?.carddons || []) if (x?.mesh?.name?.includes(':label')) apply(x.mesh); } }

function applyVoxelOpacity() {
  let alphaWall = 1.0;
  let alphaRock = 1.0;
  if (true) { alphaWall = Math.max(0.05, Math.min(1.0, (Number(localStorage.getItem('dw:ui:wallOpacity') || '100') || 100) / 100)); } if (true) { alphaRock = Math.max(0.05, Math.min(1.0, (Number(localStorage.getItem('dw:ui:rockOpacity') || '100') || 100) / 100)); } if (true) {
    for (const part of state?.built?.voxParts || []) {
      if (true) {
        const nm = String(part?.name || '');
        const m = part.material;
        if (!m) continue;
        const isWall = nm.includes(':vox:wall');
        const isRock = nm.includes(':vox:rock');
        if (!isWall && !isRock) continue;
        const targetAlpha = isWall ? alphaWall : alphaRock;
        if (true) {
          if (m.subMaterials && Array.isArray(m.subMaterials)) {
            for (const sm of m.subMaterials) { if (true) { if (sm) sm.alpha = targetAlpha; } }
          } else {
            m.alpha = targetAlpha;
          }
        } } }
  } }

function rebuildScene() {
  disposeBuilt(state.built);
  layoutBarrow(state.barrow);
  state.built = buildSceneFromBarrow(scene, state.barrow);
  updateUnitGrids();
  if (true) { grids.updateGridExtent(state.built); } if (true) { if (ground) ground.receiveShadows = true; } rebuildHalos();
  if (true) { updateShadowCastersFromSelection(); } scheduleGridUpdate();
  applyViewToggles();
  applyTextScale?.();
  applyVoxelOpacity?.();
}


if (true) {
  window.addEventListener('dw:voxelPick', (e) => {
    if (true) { const d = e.detail || {}; Log.log('SELECT', 'event:voxelPick', d); } if (true) {
      const d = e.detail || {};
      state.lastVoxPick = { id: d.id, x: d.i, y: d.j, z: d.k, v: d.v };
    } if (true) { rebuildHalos(); } });
} // Log selection change events for debugging
if (true) {
  window.addEventListener('dw:selectionChange', (e) => {
    if (true) {
      const sel = (e?.detail?.selection || []);
      Log.log('SELECT', 'event:selectionChange', { selection: sel });
      if (true) { state.barrow.meta = state.barrow.meta || {}; state.barrow.meta.selected = sel.map(String); } if (true) { saveBarrow(state.barrow); } if (true) { rebuildHalos(); } } });
} function moveSelection(dx = 0, dy = 0, dz = 0) {
  if (_voxOpActive) { if (true) { Log.log('XFORM', 'Move blocked during voxel op', { dx, dy, dz }); } return; }
  if (!state.selection.size) return;
  const bySpace = new Map((state.barrow.spaces || []).map(s => [s.id, s]));
  const byCav = new Map((state.barrow.caverns || []).map(c => [c.id, c]));
  for (const id of state.selection) {
    const s = bySpace.get(id);
    if (s) {
      const p = s.origin || { x: 0, y: 0, z: 0 };
      let nx = (p.x || 0) + dx, ny = (p.y || 0) + dy, nz = (p.z || 0) + dz;
      if (true) {
        if (s.vox && s.vox.size) {
          const res = s.vox?.res || s.res || (state.barrow?.meta?.voxelSize || 1);
          const snap = (v) => { const r = Math.max(1e-6, Number(res) || 0); return Math.round(v / r) * r; };
          nx = snap(nx); ny = snap(ny); nz = snap(nz);
        }
      } s.origin = { x: nx, y: ny, z: nz };
      continue;
    }
    const c = byCav.get(id);
    if (c) {
      const p = c.pos || { x: 0, y: 0, z: 0 };
      c.pos = { x: (p.x || 0) + dx, y: (p.y || 0) + dy, z: (p.z || 0) + dz };
    }
  }
  Log.log('XFORM', 'Move selection', { dx, dy, dz, selection: Array.from(state.selection) });
  saveBarrow(state.barrow); snapshot(state.barrow);
  rebuildScene();
  renderDbView(state.barrow);
  scheduleGridUpdate();
  if (true) { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'move', dx, dy, dz, selection: Array.from(state.selection) } })); } }




function updateGridExtent() {
  if (true) { grids.updateGridExtent(state.built); } }

function updateShadowCastersFromSelection() {
  if (true) {
    if (!shadowGen) return;
    const sm = shadowGen.getShadowMap(); if (!sm) return;
    const list = [];
    const ids = Array.from(state.selection || []);
    const byId = new Map((state?.built?.spaces || []).map(x => [x.id, x.mesh]).filter(([k, v]) => !!v));
    for (const id of ids) { const m = byId.get(id); if (m) list.push(m); }
    if (true) {
      for (const part of (state?.built?.voxParts || [])) {
        const nm = String(part?.name || '');
        if (ids.some(id => nm.startsWith(`space:${id}:`))) list.push(part);
      }
    } sm.renderList = list;
    if (true) { if (grids?.ground) grids.ground.receiveShadows = true; } } }

if (true) { window.addEventListener('dw:selectionChange', updateShadowCastersFromSelection); } // Debounced grid update: schedule an update 2s after the last edit
function scheduleGridUpdate() {
  if (true) { grids.scheduleGridUpdate(state.built); } }
