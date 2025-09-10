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
  const resizeGridBtn = document.getElementById('resizeGrid');

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

  // Manual grid resize to fit all spaces
  resizeGridBtn?.addEventListener('click', () => {
    try { helpers.updateGridExtent?.(); } catch {}
    Log.log('UI', 'Resize Grid', {});
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
    const TSTEP_KEY = 'dw:ui:baseStep';
    function getBaseStep() {
      const data = Number(stepEl?.dataset?.base);
      if (isFinite(data) && data > 0) return data;
      const stored = Number(localStorage.getItem(TSTEP_KEY) || '10') || 10;
      return stored;
    }
    function setBaseStep(n) {
      const v = Math.max(0.01, Number(n) || 1);
      if (stepEl) stepEl.dataset.base = String(v);
      try { localStorage.setItem(TSTEP_KEY, String(v)); } catch {}
    }
    function effectiveStep() {
      const base = getBaseStep();
      const r = camera?.radius || 50;
      const norm = Math.max(0, r / 100);
      const mult = Math.max(1, Math.min(100, Math.sqrt(norm)));
      return base * mult;
    }
    function fmt(n) {
      if (!isFinite(n)) return '0';
      if (n >= 100) return String(Math.round(n));
      if (n >= 10) return String(Math.round(n));
      if (n >= 1) return String(Math.round(n));
      return String(Math.round(n * 100) / 100);
    }
    // Initialize base value once
    if (stepEl && !stepEl.dataset.base) { setBaseStep(Number(stepEl.value) || 10); }
    // Show effective step unless focused for editing
    function updateStepDisplay() {
      if (!stepEl) return;
      if (document.activeElement === stepEl) return; // do not override while editing
      stepEl.value = fmt(effectiveStep());
    }
    // Keep display in sync with camera zoom
    try { engine.onBeginFrameObservable.add(updateStepDisplay); } catch {}
    // Editing handlers: show base while focused, commit on blur
    stepEl?.addEventListener('focus', () => { try { stepEl.value = fmt(getBaseStep()); } catch {} });
    stepEl?.addEventListener('input', () => { setBaseStep(stepEl.value); });
    stepEl?.addEventListener('blur', () => { updateStepDisplay(); });
    // Step used for transforms
    function step() { return effectiveStep(); }
    function addRepeat(btn, fn){
      if (!btn) return;
      let timer = null;
      const fire = () => fn();
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

  // ——————————— Rotation widget (Y-axis) ———————————
  let rotWidget = { mesh: null, spaceId: null, dragging: false, startAngle: 0, startRot: 0, centerY: 0, lastRot: 0, baseDiam: 0 };
  let _lastDbRefresh = 0;
  function disposeRotWidget() {
    try {
      if (rotWidget.mesh) {
        Log.log('GIZMO', 'Dispose rot widget', { id: rotWidget.spaceId });
        rotWidget.mesh.dispose();
      }
    } catch {}
    rotWidget = { mesh: null, spaceId: null, dragging: false, startAngle: 0, startRot: 0, centerY: 0 };
  }
  function ensureRotWidget() {
    try {
      try { Log.log('GIZMO', 'Ensure widget', { selection: Array.from(state.selection||[]) }); } catch {}
      // Only when exactly one space selected
      const sel = Array.from(state.selection || []);
      if (sel.length !== 1) { Log.log('GIZMO', 'No widget: selection count not 1', { count: sel.length }); disposeRotWidget(); return; }
      const id = sel[0];
      const entry = (state?.built?.spaces || []).find(x => x.id === id);
      if (!entry?.mesh) { Log.log('GIZMO', 'No widget: mesh not found', { id }); disposeRotWidget(); return; }
      const mesh = entry.mesh;
      // Compute ring radius from mesh bounds
      const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) { disposeRotWidget(); return; }
      const min = bb.minimumWorld, max = bb.maximumWorld;
      const halfX = Math.max(0.1, (max.x - min.x) / 2);
      const halfZ = Math.max(0.1, (max.z - min.z) / 2);
      const rad = Math.max(halfX, halfZ) * 1.05; // just outside bounds
      const thickness = Math.max(0.06, rad * 0.06);
      // Rebuild if missing or different target
      if (!rotWidget.mesh || rotWidget.spaceId !== id) {
        disposeRotWidget();
        const diam = rad * 2;
        const ring = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:${id}`, { diameter: diam, thickness, tessellation: 96 }, scene);
        const mat = new BABYLON.StandardMaterial(`rotGizmo:${id}:mat`, scene);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.05);
        mat.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.2);
        mat.specularColor = new BABYLON.Color3(0,0,0);
        mat.zOffset = 4; // draw slightly in front to avoid z-fighting
        ring.material = mat; ring.isPickable = true; ring.alwaysSelectAsActiveMesh = true; ring.renderingGroupId = 2;
        rotWidget.mesh = ring; rotWidget.spaceId = id; rotWidget.baseDiam = diam;
        Log.log('GIZMO', 'Create rot widget', { id, radius: rad, diameter: diam, thickness });
      }
      // Update size and position
      try {
        const desiredDiam = Math.max(0.001, (Math.max(halfX, halfZ) * 1.05) * 2);
        const base = rotWidget.baseDiam || desiredDiam;
        const s = Math.max(0.001, desiredDiam / base);
        rotWidget.mesh.scaling.set(s, s, s);
        rotWidget.mesh.position.copyFrom(mesh.position);
      } catch {}
      // If diameter changed significantly, recreate with new size
      try {
        const currentDiam = rotWidget.mesh?._geometry?.boundingBias ? null : rotWidget.mesh?.getBoundingInfo()?.boundingSphere?.radius * 2;
        // We skip expensive checks; ring recreated on selection change anyway
      } catch {}
      rotWidget.centerY = mesh.position.y;
    } catch (e) { try { disposeRotWidget(); } catch {} }
  }

  function updateRotWidgetFromMesh(mesh) {
    if (!rotWidget?.mesh || !mesh) return;
    try {
      const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) return;
      const min = bb.minimumWorld, max = bb.maximumWorld;
      const halfX = Math.max(0.1, (max.x - min.x) / 2);
      const halfZ = Math.max(0.1, (max.z - min.z) / 2);
      const desiredDiam = Math.max(0.001, (Math.max(halfX, halfZ) * 1.05) * 2);
      const base = rotWidget.baseDiam || desiredDiam;
      const s = Math.max(0.001, desiredDiam / base);
      rotWidget.mesh.scaling.set(s, s, s);
      rotWidget.mesh.position.copyFrom(mesh.position);
    } catch {}
  }
  // no global canvas event blocking; we detach only camera pointer input during gizmo drag
  let _lastPickMissLog = 0;
  function pickPointOnYPlane(y) {
    try {
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const ro = ray.origin, rd = ray.direction;
      const eps = 1e-6;
      const denom = rd.y;
      if (Math.abs(denom) < eps) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: ray parallel to plane', { y }); } catch {} }
        return null;
      }
      const t = (y - ro.y) / denom;
      if (!isFinite(t) || t < 0) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: behind origin', { y, t }); } catch {} }
        return null;
      }
      const pt = ro.add(rd.scale(t));
      return pt;
    } catch (e) { try { Log.log('GIZMO', 'Pick error', { err: String(e) }); } catch {}; return null; }
  }
  function getSelectedSpaceAndMesh() {
    const sel = Array.from(state.selection || []);
    if (sel.length !== 1) return { space: null, mesh: null, id: null };
    const id = sel[0];
    const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || null;
    const space = (state?.barrow?.spaces || []).find(x => x.id === id) || null;
    return { space, mesh, id };
  }

  // ——————————— Move widget (drag on XZ plane) ———————————
  let moveWidget = { mesh: null, spaceId: null, dragging: false, startPoint: null, startOrigin: null, offset: null, planeY: 0 };
  function disposeMoveWidget() {
    try { if (moveWidget.mesh) { Log.log('GIZMO', 'Dispose move widget', { id: moveWidget.spaceId }); moveWidget.mesh.dispose(); } } catch {}
    moveWidget = { mesh: null, spaceId: null, dragging: false, startPoint: null, startOrigin: null, offset: null, planeY: 0 };
  }
  function ensureMoveWidget() {
    try {
      const sel = Array.from(state.selection || []);
      if (sel.length !== 1) { disposeMoveWidget(); return; }
      const id = sel[0];
      const entry = (state?.built?.spaces || []).find(x => x.id === id);
      if (!entry?.mesh) { disposeMoveWidget(); return; }
      const mesh = entry.mesh;
      const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) { disposeMoveWidget(); return; }
      const min = bb.minimumWorld, max = bb.maximumWorld;
      const halfX = Math.max(0.1, (max.x - min.x) / 2);
      const halfZ = Math.max(0.1, (max.z - min.z) / 2);
      const rad = Math.max(halfX, halfZ) * 0.9; // slightly inside
      if (!moveWidget.mesh || moveWidget.spaceId !== id) {
        disposeMoveWidget();
        const disc = BABYLON.MeshBuilder.CreateDisc(`moveGizmo:${id}`, { radius: rad, tessellation: 64 }, scene);
        disc.rotation.x = Math.PI / 2; // lie on XZ plane
        const mat = new BABYLON.StandardMaterial(`moveGizmo:${id}:mat`, scene);
        mat.diffuseColor = new BABYLON.Color3(0.05, 0.2, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.1, 0.8, 0.8);
        mat.alpha = 0.25; mat.specularColor = new BABYLON.Color3(0,0,0); mat.zOffset = 5;
        disc.material = mat; disc.isPickable = true; disc.alwaysSelectAsActiveMesh = true; disc.renderingGroupId = 2;
        moveWidget.mesh = disc; moveWidget.spaceId = id;
        Log.log('GIZMO', 'Create move widget', { id, radius: rad });
      }
      try { moveWidget.mesh.position.copyFrom(mesh.position); } catch {}
      moveWidget.planeY = mesh.position.y;
    } catch { try { disposeMoveWidget(); } catch {} }
  }

  // Pointer interactions for rotation widget
  scene.onPointerObservable.add((pi) => {
    if (state.mode !== 'edit') return;
    const type = pi.type;
    if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
      if (pick?.hit && pick.pickedMesh && rotWidget.mesh && pick.pickedMesh === rotWidget.mesh) {
        // Swallow this click from other handlers and camera
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const { space, mesh } = getSelectedSpaceAndMesh(); if (!mesh) { Log.log('GIZMO', 'No mesh on drag start'); return; }
        const p0 = pickPointOnYPlane(mesh.position.y) || pick.pickedPoint || mesh.position.clone();
        const v = new BABYLON.Vector3(p0.x - mesh.position.x, 0, p0.z - mesh.position.z);
        rotWidget.startAngle = Math.atan2(v.z, v.x);
        const ry = (space?.rotation && typeof space.rotation.y === 'number') ? space.rotation.y : (space?.rotY || mesh.rotation.y || 0);
        rotWidget.startRot = ry;
        rotWidget.dragging = true;
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.detachControl(canvas);
          Log.log('GIZMO', 'Drag start', { id: rotWidget.spaceId, startAngle: rotWidget.startAngle, startRot: rotWidget.startRot, action: 'detachCameraPointers' });
        } catch {}
        // Sync DB view immediately with current values
        try {
          if (space) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: ry, z: 0 };
            else space.rotation.y = ry;
            space.rotY = ry;
            renderDbView(state.barrow);
          }
        } catch {}
      }
      // Move widget start
      const pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
      if (pick2?.hit && pick2.pickedMesh && moveWidget.mesh && pick2.pickedMesh === moveWidget.mesh) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const { space, mesh } = getSelectedSpaceAndMesh(); if (!mesh || !space) return;
        const p0 = pickPointOnYPlane(mesh.position.y) || pick2.pickedPoint || mesh.position.clone();
        moveWidget.startPoint = p0.clone();
        moveWidget.startOrigin = { x: space.origin?.x || mesh.position.x, y: space.origin?.y || mesh.position.y, z: space.origin?.z || mesh.position.z };
        moveWidget.offset = { x: (moveWidget.startOrigin.x - p0.x), z: (moveWidget.startOrigin.z - p0.z) };
        moveWidget.planeY = mesh.position.y;
        moveWidget.dragging = true;
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.detachControl(canvas);
          Log.log('GIZMO', 'Move start', { id: moveWidget.spaceId, start: moveWidget.startOrigin, offset: moveWidget.offset });
        } catch {}
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERUP) {
      if (rotWidget.dragging) {
        rotWidget.dragging = false;
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.attachControl(canvas, true);
          Log.log('GIZMO', 'Drag end', { id: rotWidget.spaceId, action: 'attachCameraPointers' });
        } catch {}
        // Persist rotation using last computed value
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            const y = Number.isFinite(rotWidget.lastRot) ? rotWidget.lastRot : Number(mesh.rotation?.y) || 0;
            mesh.rotation.y = y;
            space.rotY = y;
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y, z: 0 };
            else space.rotation.y = y;
            const deg = Math.round((y * 180 / Math.PI) * 10) / 10;
            Log.log('GIZMO', 'Persist rotation', { id: rotWidget.spaceId, y, deg });
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
          }
        } catch {}
      }
      if (moveWidget.dragging) {
        moveWidget.dragging = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); Log.log('GIZMO', 'Move end', { id: moveWidget.spaceId }); } catch {}
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            // Persist origin
            space.origin = space.origin || { x: 0, y: 0, z: 0 };
            space.origin.x = mesh.position.x;
            space.origin.y = mesh.position.y;
            space.origin.z = mesh.position.z;
            Log.log('GIZMO', 'Persist move', { id: moveWidget.spaceId, origin: space.origin });
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
          }
        } catch {}
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const { space, mesh } = getSelectedSpaceAndMesh(); if (!mesh) return;
      // Rotation drag
      if (rotWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const p = pickPointOnYPlane(mesh.position.y); if (!p) return;
        const v = new BABYLON.Vector3(p.x - mesh.position.x, 0, p.z - mesh.position.z);
        const ang = Math.atan2(v.z, v.x);
        const delta = ang - rotWidget.startAngle;
        // Flip sign to match expected rotation direction
        let rot = rotWidget.startRot - delta;
        if (!isFinite(rot)) {
          const now = performance.now();
          if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Compute rot NaN', { ang, delta }); } catch {} }
          return;
        }
        mesh.rotation.y = rot;
        rotWidget.lastRot = rot;
        try { updateRotWidgetFromMesh(mesh); } catch {}
        // Live update model rotation (Y) and DB display (throttled)
        try {
          if (space) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
            space.rotation.y = rot;
            space.rotY = rot;
            const now = performance.now();
            if (now - _lastDbRefresh > 60) {
              _lastDbRefresh = now;
              const deg = (rot * 180 / Math.PI);
              Log.log('GIZMO', 'Drag update', { id: rotWidget.spaceId, angle: ang, delta, rot, deg: isFinite(deg) ? Math.round(deg*10)/10 : null });
              try { renderDbView(state.barrow); } catch {}
            }
          }
        } catch {}
        return;
      }
      // Move drag
      if (moveWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const p = pickPointOnYPlane(moveWidget.planeY); if (!p) return;
        const nx = p.x + (moveWidget.offset?.x || 0);
        const nz = p.z + (moveWidget.offset?.z || 0);
        // Apply new position
        mesh.position.x = nx; mesh.position.z = nz;
        // Keep gizmos following and scaling with the mesh while dragging
        try { if (moveWidget.mesh) moveWidget.mesh.position.copyFrom(mesh.position); } catch {}
        try { updateRotWidgetFromMesh(mesh); } catch {}
        try {
          if (space) {
            space.origin = space.origin || { x: 0, y: 0, z: 0 };
            space.origin.x = nx; space.origin.z = nz; space.origin.y = mesh.position.y;
            const now = performance.now();
            if (now - _lastDbRefresh > 60) {
              _lastDbRefresh = now;
              Log.log('GIZMO', 'Move update', { id: moveWidget.spaceId, origin: space.origin });
              try { renderDbView(state.barrow); } catch {}
            }
          }
        } catch {}
      }
      }
  });

  // ——————————— Pointer selection & double-click ———————————
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  let lastPickName = null;
  let lastPickTime = 0;
  scene.onPointerObservable.add((pi) => {
    if (state.mode !== 'edit') return;
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    if (rotWidget.dragging || moveWidget.dragging) return; // do not interfere while dragging gizmo
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
    ensureRotWidget(); ensureMoveWidget();

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
    try { ensureRotWidget(); ensureMoveWidget(); } catch {}
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
      try { state.selection.clear(); state.selection.add(id); rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); } catch {}
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
