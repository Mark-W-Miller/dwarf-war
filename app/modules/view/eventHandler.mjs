import { makeDefaultBarrow, mergeInstructions, layoutBarrow } from '../barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot, cloneForSave, inflateAfterLoad } from '../barrow/store.mjs';
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

  // ——————————— Resizable panel ———————————
  (function setupPanelResizer(){
    if (!panel) return;
    // Apply stored width
    try {
      const w = Number(localStorage.getItem('dw:ui:panelWidth')||'0')||0;
      if (w >= 240 && w <= Math.max(260, window.innerWidth - 80)) panel.style.width = w + 'px';
    } catch {}
    // Create resizer handle on the left edge
    const handle = document.createElement('div');
    handle.id = 'panelResizer';
    handle.style.position = 'absolute';
    handle.style.left = '-6px';
    handle.style.top = '0';
    handle.style.width = '8px';
    handle.style.height = '100%';
    handle.style.cursor = 'ew-resize';
    handle.style.background = 'transparent';
    handle.style.zIndex = '5';
    handle.title = 'Drag to resize panel';
    panel.appendChild(handle);

    let dragging = false; let startX = 0; let startW = 0;
    function onMove(e){
      if (!dragging) return;
      const dx = (startX - (e.clientX || 0)); // dragging left increases width
      let w = Math.round(startW + dx);
      const maxW = Math.max(260, window.innerWidth - 80);
      w = Math.max(240, Math.min(maxW, w));
      panel.style.width = w + 'px';
      try { localStorage.setItem('dw:ui:panelWidth', String(w)); } catch {}
    }
    function onUp(e){
      if (!dragging) return;
      dragging = false;
      try { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); } catch {}
      try { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); } catch {}
    }
    handle.addEventListener('mousedown', (e) => {
      if (panel.classList.contains('collapsed')) return;
      dragging = true; startX = e.clientX || 0; startW = panel.getBoundingClientRect().width;
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      e.preventDefault(); e.stopPropagation();
    });
    handle.addEventListener('touchstart', (e) => {
      if (panel.classList.contains('collapsed')) return;
      const t = e.touches && e.touches[0]; if (!t) return;
      dragging = true; startX = t.clientX; startW = panel.getBoundingClientRect().width;
      document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onUp);
      e.preventDefault(); e.stopPropagation();
    }, { passive:false });
    // Hide resizer when collapsed
    const obs = new MutationObserver(() => { handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block'; });
    try { obs.observe(panel, { attributes:true, attributeFilter:['class'] }); } catch {}
    handle.style.display = panel.classList.contains('collapsed') ? 'none' : 'block';
    window.addEventListener('resize', () => {
      // Clamp panel width on viewport resize
      try {
        const maxW = Math.max(260, window.innerWidth - 80);
        const cur = panel.getBoundingClientRect().width;
        if (cur > maxW) { panel.style.width = maxW + 'px'; localStorage.setItem('dw:ui:panelWidth', String(maxW)); }
      } catch {}
    });
  })();

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
  // Rotation helper: quaternion rotating from a to b
  function quatFromTo(vFrom, vTo) {
    const a = vFrom.clone(); try { a.normalize(); } catch {}
    const b = vTo.clone(); try { b.normalize(); } catch {}
    const dot = BABYLON.Vector3.Dot(a, b);
    if (dot > 0.999999) return BABYLON.Quaternion.Identity();
    if (dot < -0.999999) {
      let axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(1,0,0));
      if (axis.lengthSquared() < 1e-6) axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(0,0,1));
      try { axis.normalize(); } catch {}
      return BABYLON.Quaternion.RotationAxis(axis, Math.PI);
    }
    let axis = BABYLON.Vector3.Cross(a, b); try { axis.normalize(); } catch {}
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    return BABYLON.Quaternion.RotationAxis(axis, angle);
  }
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
    try {
      Log.log('UI', 'View toggles', {
        names: !!showNamesCb?.checked,
        ground: !!gridGroundCb?.checked,
        xy: !!gridXYCb?.checked,
        yz: !!gridYZCb?.checked
      });
    } catch {}
  }
  showNamesCb?.addEventListener('change', applyTogglesFromUI);
  gridGroundCb?.addEventListener('change', applyTogglesFromUI);
  gridXYCb?.addEventListener('change', applyTogglesFromUI);
  gridYZCb?.addEventListener('change', applyTogglesFromUI);
  // Apply once on init
  applyTogglesFromUI();

  // ——————————— Debug helpers ———————————
  function pickDebugOn() { try { return localStorage.getItem('dw:debug:picking') === '1'; } catch { return false; } }
  function dPick(event, data) { if (!pickDebugOn()) return; try { Log.log('PICK', event, data); } catch {} }

  // Screen-space projection helper for robust angle computation
  function projectToScreen(v) {
    try {
      const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
      const proj = BABYLON.Vector3.Project(v, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport);
      return { x: proj.x, y: proj.y };
    } catch { return { x: 0, y: 0 }; }
  }
  function angleToPointerFrom(centerWorld) {
    const scr = projectToScreen(centerWorld);
    const dx = (scene.pointerX - scr.x), dy = (scene.pointerY - scr.y);
    return Math.atan2(dy, dx);
  }

  // ——————————— Gizmo HUD (temporary) ———————————
  let _gizmoHudEl = null;
  function ensureGizmoHud() {
    if (_gizmoHudEl && document.body.contains(_gizmoHudEl)) return _gizmoHudEl;
    const el = document.createElement('div'); el.id = 'gizmoHud';
    el.style.position = 'absolute'; el.style.left = '10px'; el.style.top = '32px';
    el.style.background = 'rgba(10,14,18,0.85)'; el.style.border = '1px solid #1e2a30'; el.style.borderRadius = '6px';
    el.style.padding = '6px 8px'; el.style.color = '#e3edf3'; el.style.fontSize = '11px'; el.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    el.style.pointerEvents = 'none'; el.style.zIndex = '9999'; el.style.display = 'none';
    el.textContent = 'Gizmo Live';
    document.body.appendChild(el); _gizmoHudEl = el; return el;
  }
  function setGizmoHudVisible(v) { try { ensureGizmoHud().style.display = v ? 'block' : 'none'; } catch {} }
  function renderGizmoHud({ selCount=0, center=null, deltaDeg=null, pickMode='-' }={}) {
    try {
      const el = ensureGizmoHud();
      const c = center ? { x: Number(center.x||0).toFixed(2), y: Number(center.y||0).toFixed(2), z: Number(center.z||0).toFixed(2) } : { x: '-', y: '-', z: '-' };
      const d = (deltaDeg == null || !isFinite(deltaDeg)) ? '-' : String(Math.round(deltaDeg));
      el.innerHTML = `
        <div style="opacity:0.8; font-weight:600; margin-bottom:2px;">Gizmo Live</div>
        <div>Sel: ${selCount}</div>
        <div>Center: ${c.x}, ${c.y}, ${c.z}</div>
        <div>Δ: ${d}°</div>
        <div>Mode: ${pickMode}</div>
      `;
    } catch {}
  }

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
    Log.log('UI', 'Reset barrow', {});
  });

  exportBtn?.addEventListener('click', () => {
    // Export a compressed clone for storage parity
    const toExport = cloneForSave(state.barrow);
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' });
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
      let data = JSON.parse(text);
      try { data = inflateAfterLoad(data); } catch {}
      disposeBuilt(state.built);
      state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
      layoutBarrow(state.barrow);
      state.built = buildSceneFromBarrow(scene, state.barrow);
      saveBarrow(state.barrow); snapshot(state.barrow);
      renderDbView(state.barrow);
      rebuildScene();
      try { updateHud?.(); } catch {}
      try { Log.log('UI', 'Import barrow', { size: text.length }); } catch {}
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
  let rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '', mStartX: 0, mStartY: 0 };
  let _lastDbRefresh = 0;
  function disposeRotWidget() {
    try {
      for (const k of ['x','y','z']) { try { rotWidget.meshes[k]?.dispose?.(); } catch {} }
      try { rotWidget.groupNode?.dispose?.(); } catch {}
      Log.log('GIZMO', 'Dispose rot widget', { id: rotWidget.spaceId });
    } catch {}
    rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '' };
  }
  function ensureRotWidget() {
    try {
      try { Log.log('GIZMO', 'Ensure widget', { selection: Array.from(state.selection||[]) }); } catch {}
      // Support single or multi selection
      const sel = Array.from(state.selection || []).filter(id => (state?.built?.spaces || []).some(x => x.id === id));
      if (sel.length < 1) { Log.log('GIZMO', 'No widget: empty selection', { count: 0 }); disposeRotWidget(); return; }
      // Suppress rotation gizmo for voxelized spaces
      try {
        const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
        const anyVox = sel.some(id => !!byId.get(id)?.vox);
        if (anyVox) { disposeRotWidget(); Log.log('GIZMO', 'Skip rot widget for voxelized selection', { sel }); return; }
      } catch {}
      const isGroup = sel.length > 1;
      const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0];
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => sel.includes(x.id));
      if (entries.length < 1) { disposeRotWidget(); return; }
      const primary = entries[0];
      const mesh = primary.mesh;
      // Compute ring radii from bounds (single or group)
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let com = new BABYLON.Vector3(0,0,0); let mass = 0;
      for (const e of entries) {
        try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
        const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
        const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
        minX = Math.min(minX, bmin.x); minY = Math.min(minY, bmin.y); minZ = Math.min(minZ, bmin.z);
        maxX = Math.max(maxX, bmax.x); maxY = Math.max(maxY, bmax.y); maxZ = Math.max(maxZ, bmax.z);
        const cx = (bmin.x + bmax.x) / 2, cy = (bmin.y + bmax.y) / 2, cz = (bmin.z + bmax.z) / 2;
        const dx = (bmax.x - bmin.x), dy = (bmax.y - bmin.y), dz = (bmax.z - bmin.z);
        const m = Math.max(1e-6, dx * dy * dz);
        com.x += cx * m; com.y += cy * m; com.z += cz * m; mass += m;
      }
      if (!isFinite(minX) || !isFinite(maxX)) { disposeRotWidget(); return; }
      if (mass > 0) { com.x /= mass; com.y /= mass; com.z /= mass; }
      const halfX = Math.max(0.1, (maxX - minX) / 2);
      const halfY = Math.max(0.1, (maxY - minY) / 2);
      const halfZ = Math.max(0.1, (maxZ - minZ) / 2);
      // Apply user scale to gizmo diameters
      const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100;
      const gScale = Math.max(0.1, scalePct / 100);
      const radY = Math.max(halfX, halfZ) * 1.05 * gScale; // ring in XZ plane => rotate around Y
      const radX = Math.max(halfY, halfZ) * 1.05 * gScale; // ring in YZ plane => rotate around X
      const radZ = Math.max(halfX, halfY) * 1.05 * gScale; // ring in XY plane => rotate around Z
      const thicknessY = Math.max(0.08, radY * 0.085);
      const thicknessX = Math.max(0.08, radX * 0.085);
      const thicknessZ = Math.max(0.08, radZ * 0.085);
      // Rebuild if missing or different target
      const id = primary.id;
      if (!rotWidget.meshes.y || rotWidget.group !== isGroup || rotWidget.groupKey !== groupKey || (rotWidget.meshes.y.isDisposed && rotWidget.meshes.y.isDisposed())) {
        disposeRotWidget();
        // Y ring (base ring, will orient to surface axis if provided)
        const diamY = radY * 2;
        const ringY = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Y:${isGroup ? 'group' : id}`, { diameter: diamY, thickness: thicknessY, tessellation: 96 }, scene);
        const matY = new BABYLON.StandardMaterial(`rotGizmo:Y:${id}:mat`, scene);
        const baseY = new BABYLON.Color3(0.2, 0.9, 0.2); // green
        matY.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.05);
        matY.emissiveColor = baseY.clone();
        try { matY.metadata = { baseColor: baseY.clone() }; } catch {}
        matY.specularColor = new BABYLON.Color3(0,0,0);
        matY.zOffset = 4;
        ringY.material = matY; ringY.isPickable = true; ringY.alwaysSelectAsActiveMesh = true; ringY.renderingGroupId = 2;
        // X ring
        const diamX = radX * 2;
        const ringX = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:X:${isGroup ? 'group' : id}`, { diameter: diamX, thickness: thicknessX, tessellation: 96 }, scene);
        const matX = new BABYLON.StandardMaterial(`rotGizmo:X:${id}:mat`, scene);
        const baseX = new BABYLON.Color3(0.95, 0.1, 0.1); // red
        matX.diffuseColor = new BABYLON.Color3(0.2, 0.05, 0.05);
        matX.emissiveColor = baseX.clone();
        try { matX.metadata = { baseColor: baseX.clone() }; } catch {}
        matX.specularColor = new BABYLON.Color3(0,0,0);
        matX.zOffset = 4;
        ringX.rotation.z = Math.PI / 2; // plane YZ
        ringX.material = matX; ringX.isPickable = true; ringX.alwaysSelectAsActiveMesh = true; ringX.renderingGroupId = 2;
        // Z ring
        const diamZ = radZ * 2;
        const ringZ = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Z:${isGroup ? 'group' : id}`, { diameter: diamZ, thickness: thicknessZ, tessellation: 96 }, scene);
        const matZ = new BABYLON.StandardMaterial(`rotGizmo:Z:${id}:mat`, scene);
        const baseZ = new BABYLON.Color3(0.1, 0.1, 0.95); // blue
        matZ.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.2);
        matZ.emissiveColor = baseZ.clone();
        try { matZ.metadata = { baseColor: baseZ.clone() }; } catch {}
        matZ.specularColor = new BABYLON.Color3(0,0,0);
        matZ.zOffset = 4;
        ringZ.rotation.x = Math.PI / 2; // plane XY
        ringZ.material = matZ; ringZ.isPickable = true; ringZ.alwaysSelectAsActiveMesh = true; ringZ.renderingGroupId = 2;
        // Parent rings
        if (isGroup) {
          const group = new BABYLON.TransformNode(`rotGizmoGroup`, scene);
          group.position.copyFrom(com);
          ringX.parent = group; ringY.parent = group; ringZ.parent = group;
          rotWidget.groupNode = group;
        } else {
          try { ringX.parent = mesh; ringY.parent = mesh; ringZ.parent = mesh; ringX.position.set(0,0,0); ringY.position.set(0,0,0); ringZ.position.set(0,0,0); } catch {}
        }
        // Assign
        rotWidget.meshes = { x: ringX, y: ringY, z: ringZ };
        rotWidget.mats = { x: matX, y: matY, z: matZ };
        rotWidget.baseDiam = { x: diamX, y: diamY, z: diamZ };
        rotWidget.spaceId = isGroup ? 'group' : id;
        rotWidget.group = isGroup; rotWidget.groupIDs = sel.slice(); rotWidget.groupCenter = com; rotWidget.groupKey = groupKey;
        Log.log('GIZMO', 'Create rot widget', { id: rotWidget.spaceId, radius: { x: radX, y: radY, z: radZ }, diameter: { x: diamX, y: diamY, z: diamZ } });
      }
      // Update size and position for all rings
      try {
        const desiredX = Math.max(0.001, radX * 2);
        const desiredY = Math.max(0.001, radY * 2);
        const desiredZ = Math.max(0.001, radZ * 2);
        const sx = Math.max(0.001, desiredX / (rotWidget.baseDiam.x || desiredX));
        const sy = Math.max(0.001, desiredY / (rotWidget.baseDiam.y || desiredY));
        const sz = Math.max(0.001, desiredZ / (rotWidget.baseDiam.z || desiredZ));
        rotWidget.meshes.x.scaling.set(sx, sx, sx);
        rotWidget.meshes.y.scaling.set(sy, sy, sy);
        rotWidget.meshes.z.scaling.set(sz, sz, sz);
        if (isGroup) {
          try { rotWidget.groupNode.position.copyFrom(com); } catch {}
          try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
        } else {
          try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
        }
      } catch {}
      // Default visual: all rings dim
      try { setRingsDim(); } catch {}
    } catch (e) { try { disposeRotWidget(); } catch {} }
  }

  function updateRotWidgetFromMesh(mesh) {
    if (!rotWidget?.meshes?.y || !mesh) return;
    // Avoid resizing during active drag to prevent visual jumps
    if (rotWidget.dragging) return;
    try {
      const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) return;
      const min = bb.minimumWorld, max = bb.maximumWorld;
      const halfX = Math.max(0.1, (max.x - min.x) / 2);
      const halfY = Math.max(0.1, (max.y - min.y) / 2);
      const halfZ = Math.max(0.1, (max.z - min.z) / 2);
      const radY = Math.max(halfX, halfZ) * 1.05;
      const radX = Math.max(halfY, halfZ) * 1.05;
      const radZ = Math.max(halfX, halfY) * 1.05;
      const desiredX = Math.max(0.001, radX * 2);
      const desiredY = Math.max(0.001, radY * 2);
      const desiredZ = Math.max(0.001, radZ * 2);
      const sx = Math.max(0.001, desiredX / (rotWidget.baseDiam.x || desiredX));
      const sy = Math.max(0.001, desiredY / (rotWidget.baseDiam.y || desiredY));
      const sz = Math.max(0.001, desiredZ / (rotWidget.baseDiam.z || desiredZ));
      rotWidget.meshes.x.scaling.set(sx, sx, sx);
      rotWidget.meshes.y.scaling.set(sy, sy, sy);
      rotWidget.meshes.z.scaling.set(sz, sz, sz);
      try { rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
    } catch {}
  }
  // no global canvas event blocking; we detach only camera pointer input during gizmo drag
  let _lastPickMissLog = 0;
  function pickPointOnYPlane(y) { return pickPointOnPlane(new BABYLON.Vector3(1e-30,1,1e-30), new BABYLON.Vector3(0,y,0)); }
  function pickPointOnPlane(normal, point) {
    try {
      let n = normal.clone(); n.normalize();
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const ro = ray.origin, rd = ray.direction;
      const eps = 1e-6;
      let denom = BABYLON.Vector3.Dot(n, rd);
      if (Math.abs(denom) < eps) {
        // Nudge plane normal slightly towards camera to avoid parallel cases
        try {
          const fwd = camera.getForwardRay()?.direction || new BABYLON.Vector3(0,0,1);
          n = n.add(fwd.scale(0.001)); n.normalize();
          denom = BABYLON.Vector3.Dot(n, rd);
        } catch {}
      }
      if (Math.abs(denom) < eps) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: ray parallel to plane', { normal: n.asArray() }); } catch {} }
        return null;
      }
      const t = BABYLON.Vector3.Dot(point.subtract(ro), n) / denom;
      if (!isFinite(t) || t < 0) {
        const now = performance.now();
        if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: behind origin', { t }); } catch {} }
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

  // ——————————— Live intersection preview (selected vs others) ———————————
  const liveIx = new Map(); // key -> mesh
  const ixLastExact = new Map(); // key -> last CSG timestamp
  const ixMat = (() => {
    try {
      const m = new BABYLON.StandardMaterial('ixLive:mat', scene);
      m.diffuseColor = new BABYLON.Color3(0,0,0);
      m.emissiveColor = new BABYLON.Color3(0.95, 0.9, 0.2);
      m.alpha = 0.25; m.specularColor = new BABYLON.Color3(0,0,0); m.zOffset = 3;
      return m;
    } catch { return null; }
  })();
  function disposeLiveIntersections(){
    try { for (const m of liveIx.values()) { try { state.hl?.removeMesh(m); } catch {}; try { m.dispose(); } catch {} } } catch {}
    liveIx.clear();
  }
  function aabbForSpace(space) {
    const res = (space?.res || (state.barrow?.meta?.voxelSize || 1));
    const w = Math.max(0, (space?.size?.x || 0) * res);
    const h = Math.max(0, (space?.size?.y || 0) * res);
    const d = Math.max(0, (space?.size?.z || 0) * res);
    const cx = space?.origin?.x || 0, cy = space?.origin?.y || 0, cz = space?.origin?.z || 0;
    return { min:{x:cx-w/2,y:cy-h/2,z:cz-d/2}, max:{x:cx+w/2,y:cy+h/2,z:cz+d/2} };
  }
  function updateLiveIntersectionsFor(selectedId){
    try {
      if (!selectedId) { disposeLiveIntersections(); return; }
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      const selEntry = builtSpaces.find(x => x.id === selectedId); if (!selEntry?.mesh) { disposeLiveIntersections(); return; }
      const bba = selEntry.mesh.getBoundingInfo()?.boundingBox; if (!bba) { disposeLiveIntersections(); return; }
      const amin = bba.minimumWorld, amax = bba.maximumWorld;
      const seen = new Set();
      const exactOn = (() => { try { return localStorage.getItem('dw:ui:exactCSG') === '1'; } catch { return false; } })();
      const canCSG = exactOn && !!(BABYLON && BABYLON.CSG);
      for (const entry of builtSpaces) {
        if (!entry || entry.id === selectedId || !entry.mesh) continue;
        const bbb = entry.mesh.getBoundingInfo()?.boundingBox; if (!bbb) continue;
        const bmin = bbb.minimumWorld, bmax = bbb.maximumWorld;
        const ixmin = { x: Math.max(amin.x, bmin.x), y: Math.max(amin.y, bmin.y), z: Math.max(amin.z, bmin.z) };
        const ixmax = { x: Math.min(amax.x, bmax.x), y: Math.min(amax.y, bmax.y), z: Math.min(amax.z, bmax.z) };
        const dx = ixmax.x - ixmin.x, dy = ixmax.y - ixmin.y, dz = ixmax.z - ixmin.z;
        const key = `live:${selectedId}&${entry.id}`;
        if (dx > 0.001 && dy > 0.001 && dz > 0.001) {
          seen.add(key);
          const cx = (ixmin.x + ixmax.x) / 2, cy = (ixmin.y + ixmax.y) / 2, cz = (ixmin.z + ixmax.z) / 2;
          if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz) || !isFinite(dx) || !isFinite(dy) || !isFinite(dz)) continue;

          let mesh = liveIx.get(key);
          if (canCSG) {
            const now = performance.now();
            const last = ixLastExact.get(key) || 0;
            const needExact = (!mesh) || (now - last > 220);
            if (needExact) {
              try {
                if (mesh) { try { state.hl?.removeMesh(mesh); } catch {}; try { mesh.dispose(); } catch {}; liveIx.delete(key); }
                const csgA = BABYLON.CSG.FromMesh(selEntry.mesh);
                const csgB = BABYLON.CSG.FromMesh(entry.mesh);
                const inter = csgA.intersect(csgB);
                const csgMesh = inter.toMesh(key, ixMat || undefined, scene, true);
                csgMesh.isPickable = false; csgMesh.renderingGroupId = 1;
                liveIx.set(key, csgMesh);
                ixLastExact.set(key, now);
                try { state.hl?.addMesh(csgMesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
              } catch {
                // If exact fails on first pass, fallback to AABB to show something
                if (!mesh) {
                  const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
                  if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
                  liveIx.set(key, box);
                  box.position.set(cx, cy, cz);
                  try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
                }
              }
            } else {
              // keep existing CSG mesh until next exact tick (no AABB toggling)
            }
          } else {
            // AABB-only preview
            if (!mesh) {
              mesh = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) mesh.material = ixMat;
              mesh.isPickable = false; mesh.renderingGroupId = 1;
              liveIx.set(key, mesh);
              mesh.position.set(cx, cy, cz);
              try { state.hl?.addMesh(mesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            } else {
              try { state.hl?.removeMesh(mesh); mesh.dispose(); } catch {}
              const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
              liveIx.set(key, box);
              box.position.set(cx, cy, cz);
              try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            }
          }
        } else {
          // remove if existed
          if (liveIx.has(key)) { try { const old = liveIx.get(key); state.hl?.removeMesh(old); old?.dispose(); } catch {}; liveIx.delete(key); ixLastExact.delete(key); }
        }
      }
      // cleanup any not seen
      for (const [k, m] of Array.from(liveIx.entries())) {
        if (!k.startsWith(`live:${selectedId}&`) || !seen.has(k)) { try { state.hl?.removeMesh(m); m.dispose(); } catch {}; liveIx.delete(k); ixLastExact.delete(k); }
      }
    } catch {}
  }

  // ——————————— Move widget (drag on XZ plane) ———————————
  let moveWidget = { mesh: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '' };
  function disposeMoveWidget() {
    try { if (moveWidget.mesh) { Log.log('GIZMO', 'Dispose move widget', { id: moveWidget.spaceId }); moveWidget.mesh.dispose(); } } catch {}
    moveWidget = { mesh: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '' };
  }
  function ensureMoveWidget() {
    try {
      const sel = Array.from(state.selection || []);
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => sel.includes(x.id));
      if (entries.length < 1) { disposeMoveWidget(); return; }
      // Suppress move gizmo for voxelized spaces
      try {
        const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
        const anyVox = sel.some(id => !!byId.get(id)?.vox);
        if (anyVox) { disposeMoveWidget(); Log.log('GIZMO', 'Skip move widget for voxelized selection', { sel }); return; }
      } catch {}
      const isGroup = sel.length > 1;
      const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0];
      let id = entries[0].id;
      let rad = 1; let center = null;
      if (isGroup) {
        // Compute group bbox and center of mass for radius and position
        let minX = Infinity, minZ = Infinity; let maxX = -Infinity, maxZ = -Infinity;
        let cx = 0, cy = 0, cz = 0, mass = 0;
        for (const e of entries) {
          try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
          const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
          const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
          minX = Math.min(minX, bmin.x); maxX = Math.max(maxX, bmax.x);
          minZ = Math.min(minZ, bmin.z); maxZ = Math.max(maxZ, bmax.z);
          const cxi = (bmin.x + bmax.x) / 2, cyi = (bmin.y + bmax.y) / 2, czi = (bmin.z + bmax.z) / 2;
          const dx = (bmax.x - bmin.x), dy = (bmax.y - bmin.y), dz = (bmax.z - bmin.z);
          const m = Math.max(1e-6, dx * dy * dz);
          cx += cxi * m; cy += cyi * m; cz += czi * m; mass += m;
        }
        if (mass > 0) { cx /= mass; cy /= mass; cz /= mass; }
        center = new BABYLON.Vector3(cx, cy, cz);
        const halfX = Math.max(0.1, (maxX - minX) / 2);
        const halfZ = Math.max(0.1, (maxZ - minZ) / 2);
        rad = Math.max(halfX, halfZ) * 0.9;
        id = 'group';
      } else {
        const mesh = entries[0].mesh;
        const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) { disposeMoveWidget(); return; }
        const min = bb.minimumWorld, max = bb.maximumWorld;
        const halfX = Math.max(0.1, (max.x - min.x) / 2);
        const halfZ = Math.max(0.1, (max.z - min.z) / 2);
        rad = Math.max(halfX, halfZ) * 0.9; // slightly inside
      }
      if (!moveWidget.mesh || moveWidget.group !== isGroup || moveWidget.groupKey !== groupKey || (moveWidget.mesh.isDisposed && moveWidget.mesh.isDisposed())) {
        disposeMoveWidget();
        // Apply user scale to move disc radius
        const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100;
        const gScale = Math.max(0.1, scalePct / 100);
        const disc = BABYLON.MeshBuilder.CreateDisc(`moveGizmo:${id}`, { radius: rad * gScale, tessellation: 64 }, scene);
        disc.rotation.x = Math.PI / 2; // lie on XZ plane
        const mat = new BABYLON.StandardMaterial(`moveGizmo:${id}:mat`, scene);
        mat.diffuseColor = new BABYLON.Color3(0.05, 0.2, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.1, 0.8, 0.8);
        mat.alpha = 0.25; mat.specularColor = new BABYLON.Color3(0,0,0); mat.zOffset = 5;
        disc.material = mat; disc.isPickable = true; disc.alwaysSelectAsActiveMesh = true; disc.renderingGroupId = 2;
        moveWidget.mesh = disc; moveWidget.spaceId = id; moveWidget.group = isGroup; moveWidget.groupIDs = sel.slice(); moveWidget.groupKey = groupKey;
        Log.log('GIZMO', 'Create move widget', { id, radius: rad });
      }
      // Position the disc
      if (isGroup) {
        try { moveWidget.mesh.parent = null; } catch {}
        try { moveWidget.mesh.position.copyFrom(center); } catch {}
        moveWidget.groupCenter = center;
        moveWidget.startCenter = null;
        moveWidget.planeNormal = new BABYLON.Vector3(0,1,0);
      } else {
        const mesh = entries[0].mesh;
        // Parent to mesh so it orients in local space
        try { moveWidget.mesh.parent = mesh; moveWidget.mesh.position.set(0,0,0); } catch {}
        // Plane normal for drag is the object's local Y axis in world space
        try { mesh.computeWorldMatrix(true); } catch {}
        try { moveWidget.planeNormal = mesh.getDirection(BABYLON.Axis.Y).normalize(); } catch { moveWidget.planeNormal = new BABYLON.Vector3(0,1,0); }
      }
    } catch { try { disposeMoveWidget(); } catch {} }
  }

  // Pointer interactions for rotation widget
  let _lastGizmoClick = 0;
  const _GIZMO_DCLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  scene.onPointerObservable.add((pi) => {
    if (state.mode !== 'edit') return;
    const type = pi.type;
    if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
      if (pick?.hit && pick.pickedMesh) {
        const nm = String(pick.pickedMesh.name || '');
        const mY = rotWidget.meshes?.y, mX = rotWidget.meshes?.x, mZ = rotWidget.meshes?.z;
        let axis = null;
        if (nm.startsWith('rotGizmo:Y:') && pick.pickedMesh === mY) axis = 'y';
        else if (nm.startsWith('rotGizmo:X:') && pick.pickedMesh === mX) axis = 'x';
        else if (nm.startsWith('rotGizmo:Z:') && pick.pickedMesh === mZ) axis = 'z';
        if (axis) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          rotWidget.axis = axis;
          rotWidget.preDrag = false;
          rotWidget.downX = scene.pointerX; rotWidget.downY = scene.pointerY;
          dPick('preDrag:rot', { axis, x: rotWidget.downX, y: rotWidget.downY });
          try { setRingActive(axis); } catch {}
          // Initialize local-axis rotation baseline and start dragging immediately
          try {
            const ax = rotWidget.axis || 'y';
            const sel = Array.from(state.selection || []);
            const isGroup = (sel.length > 1);
            if (isGroup) {
              // Group baseline: world axis and center-of-mass
              const axisWorld = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
              rotWidget.axisWorld = axisWorld.clone();
              const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
              const p0 = pickPointOnPlane(axisWorld, center) || center.clone();
              let ref = p0.subtract(center);
              ref = ref.subtract(axisWorld.scale(BABYLON.Vector3.Dot(ref, axisWorld)));
              if (ref.lengthSquared() < 1e-6) ref = new BABYLON.Vector3(1,0,0); else ref.normalize();
              rotWidget.refWorld = ref;
              // Screen-space baseline angle around the projected center (robust if plane pick fails)
              try { rotWidget.startAngle = angleToPointerFrom(center); } catch {}
              rotWidget.mStartX = scene.pointerX; rotWidget.mStartY = scene.pointerY;
              // Snapshot starts for each selected mesh
              const map = new Map();
              for (const id of rotWidget.groupIDs || []) {
                const m = (state?.built?.spaces || []).find(x => x.id === id)?.mesh; if (!m) continue;
                try { if (!m.rotationQuaternion) m.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0); } catch {}
                map.set(id, { q: m.rotationQuaternion?.clone ? m.rotationQuaternion.clone() : null, p: m.position?.clone ? m.position.clone() : new BABYLON.Vector3(m.position.x, m.position.y, m.position.z) });
              }
              rotWidget.startById = map; rotWidget.dragging = true;
            } else {
              // Single baseline: local axis
              const { space, mesh } = getSelectedSpaceAndMesh(); if (!mesh) return;
              const center = mesh.position.clone();
              const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
              rotWidget.axisLocal = axisLocal.clone();
              if (!mesh.rotationQuaternion) {
                mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x || 0, mesh.rotation.y || 0, mesh.rotation.z || 0);
              }
              rotWidget.startQuat = mesh.rotationQuaternion.clone();
              const wm = mesh.getWorldMatrix();
              const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
              const p0 = pickPointOnPlane(nWorld, center) || center.clone();
              const inv = BABYLON.Matrix.Invert(wm);
              const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
              let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal)));
              if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0); else refLocal.normalize();
              rotWidget.refLocal = refLocal; rotWidget.dragging = true;
            }
            const canvas = engine.getRenderingCanvas();
            camera.inputs?.attached?.pointers?.detachControl(canvas);
            try { const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); } catch {}
          } catch {}
          // Gizmo double-click opens DB for selected space
          try {
            const now = performance.now();
            if (now - _lastGizmoClick <= _GIZMO_DCLICK_MS) {
              const { id } = getSelectedSpaceAndMesh();
              if (id) window.dispatchEvent(new CustomEvent('dw:showDbForSpace', { detail: { id } }));
            }
            _lastGizmoClick = now;
          } catch {}
        }
      }
      // Move widget start
      const pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
      if (pick2?.hit && pick2.pickedMesh && moveWidget.mesh && pick2.pickedMesh === moveWidget.mesh) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        // Prepare possible drag
        moveWidget.preDrag = true;
        moveWidget.downX = scene.pointerX; moveWidget.downY = scene.pointerY;
        dPick('preDrag:move', { x: moveWidget.downX, y: moveWidget.downY });
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERUP) {
      if (rotWidget.dragging) {
        rotWidget.dragging = false;
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.attachControl(canvas, true);
          try { const pe = pi.event; if (pe && pe.pointerId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(pe.pointerId); } catch {}
          Log.log('GIZMO', 'Drag end', { id: rotWidget.spaceId, action: 'attachCameraPointers' });
        } catch {}
        // Persist rotation using quaternion → Euler
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
            try {
              const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
              space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
              const deg = Math.round((e.y * 180 / Math.PI) * 10) / 10;
              Log.log('GIZMO', 'Persist rotation', { id: rotWidget.spaceId, euler: { x: e.x, y: e.y, z: e.z }, degY: deg });
            } catch {}
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
      // Clear pending pre-drag state on mouse up
      rotWidget.preDrag = false;
      moveWidget.preDrag = false;
      if (moveWidget.dragging) {
        moveWidget.dragging = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); const pe = pi.event; if (pe && pe.pointerId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(pe.pointerId); Log.log('GIZMO', 'Move end', { id: moveWidget.spaceId }); } catch {}
        try {
          const selNow = Array.from(state.selection || []);
          const isGroup = selNow.length > 1;
          if (isGroup) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of moveWidget.groupIDs || []) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              sp.origin = { x: m2.position.x, y: m2.position.y, z: m2.position.z };
            }
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          } else {
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
              try { disposeLiveIntersections(); rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
    } else if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const selNowGlobal = Array.from(state.selection || []);
      const isGroupGlobal = selNowGlobal.length > 1;
      const { space, mesh, id } = getSelectedSpaceAndMesh(); if (!isGroupGlobal && !mesh) return;
      // Hover highlight for rotation rings when not dragging/pre-dragging any gizmo
      try {
        if (!rotWidget.dragging && !rotWidget.preDrag && !moveWidget.dragging && !moveWidget.preDrag) {
          const hp = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
          let hAxis = null;
          if (hp?.hit && hp.pickedMesh) {
            const n = String(hp.pickedMesh.name || '');
            if (n.startsWith('rotGizmo:Y:') && rotWidget.meshes?.y && hp.pickedMesh === rotWidget.meshes.y) hAxis = 'y';
            else if (n.startsWith('rotGizmo:X:') && rotWidget.meshes?.x && hp.pickedMesh === rotWidget.meshes.x) hAxis = 'x';
            else if (n.startsWith('rotGizmo:Z:') && rotWidget.meshes?.z && hp.pickedMesh === rotWidget.meshes.z) hAxis = 'z';
          }
          if (hAxis) {
            if (rotWidget.activeAxis !== hAxis) { try { setRingActive(hAxis); } catch {} }
          } else {
            if (rotWidget.activeAxis) { try { setRingsDim(); } catch {} }
          }
        }
      } catch {}
      const dragThreshold = 6; // pixels
      // Possibly start rotation drag if moved enough after pressing ring
      if (!rotWidget.dragging && rotWidget.preDrag) {
        const dx = (scene.pointerX - rotWidget.downX); const dy = (scene.pointerY - rotWidget.downY);
        if (Math.hypot(dx, dy) >= dragThreshold) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const ax = rotWidget.axis || 'y';
          const center = mesh.position.clone();
          // Local axis unit vector
          const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
          rotWidget.axisLocal = axisLocal.clone();
          // Ensure quaternion use
          try {
            if (!mesh.rotationQuaternion) {
              mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x || 0, mesh.rotation.y || 0, mesh.rotation.z || 0);
            }
          } catch {}
          rotWidget.startQuat = (mesh.rotationQuaternion && mesh.rotationQuaternion.clone) ? mesh.rotationQuaternion.clone() : null;
          // World plane normal from current local axis
          const wm = mesh.getWorldMatrix();
          const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
          const p0 = pickPointOnPlane(nWorld, center) || center.clone();
          // Build reference vector in LOCAL space (project p0 to local plane)
          const inv = BABYLON.Matrix.Invert(wm);
          const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
          let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal)));
          if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0);
          else refLocal.normalize();
          rotWidget.refLocal = refLocal;
          rotWidget.dragging = true; rotWidget.preDrag = false;
          try {
            const canvas = engine.getRenderingCanvas();
            camera.inputs?.attached?.pointers?.detachControl(canvas);
            Log.log('GIZMO', 'Drag start', { id: rotWidget.spaceId, axis: ax, startAngle: rotWidget.startAngle, startRot: rotWidget.startRot, action: 'detachCameraPointers' });
          } catch {}
          dPick('dragStart:rot', {});
          // Hide built intersections during drag to avoid stale boxes
          try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
          // Sync DB view immediately with current values
          try {
            if (space) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              try { const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y; } catch {}
              renderDbView(state.barrow);
            }
          } catch {}
        }
      }
      // Rotation drag
      if (rotWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const ax = rotWidget.axis || 'y';
        const sel = Array.from(state.selection || []);
        const isGroup = (sel.length > 1);
        let delta = 0;
        if (isGroup) {
          // Screen-space angle delta around projected center (stable across camera angles)
          const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
          let ok = true;
          try {
            const angNow = angleToPointerFrom(center);
            const ang0 = rotWidget.startAngle || angNow;
            delta = angNow - ang0;
          } catch { ok = false; }
          // Fallback: derive delta from mouse movement if projection fails
          if (!isFinite(delta) || Math.abs(delta) < 1e-6 || ok === false) {
            const dx = (scene.pointerX - rotWidget.mStartX);
            const sens2 = (() => { try { return Math.max(0.0005, Math.min(0.01, Number(localStorage.getItem('dw:ui:rotSens') || '0.008')/100)); } catch { return 0.008/100; } })();
            delta = dx * sens2 * Math.PI; // screen pixels to radians
          }
          // normalize to [-pi, pi]
          if (delta > Math.PI) delta -= 2*Math.PI; else if (delta < -Math.PI) delta += 2*Math.PI;
          // Apply to each selected mesh
          const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })();
          const nWorld = rotWidget.axisWorld || new BABYLON.Vector3(0,1,0);
          const qRot = BABYLON.Quaternion.RotationAxis(nWorld, sens * delta);
          // Build rotation matrix from axis/angle (avoid Matrix.FromQuaternion which may not exist in CDN build)
          const mRot = BABYLON.Matrix.RotationAxis(nWorld, sens * delta);
          for (const id of rotWidget.groupIDs || []) {
            const entry = (state?.built?.spaces || []).find(x => x.id === id); if (!entry?.mesh) continue;
            const start = rotWidget.startById?.get?.(id);
            if (!start) continue;
            const m = entry.mesh;
            // Position
            const p0 = start.p || m.position;
            const rel = p0.subtract(center);
            const relRot = BABYLON.Vector3.TransformCoordinates(rel, mRot);
            const pNew = center.add(relRot);
            m.position.copyFrom(pNew);
            // Orientation (world axis pre-multiply)
            try {
              const q0 = start.q || m.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0);
              m.rotationQuaternion = qRot.multiply ? qRot.multiply(q0) : q0;
              m.rotation.set(0,0,0);
            } catch {}
            try { m.computeWorldMatrix(true); m.refreshBoundingInfo(); } catch {}
          }
          rotWidget.lastRot = delta;
          try { renderGizmoHud({ selCount: sel.length, center, deltaDeg: (delta*180/Math.PI), pickMode: 'screen|mouse' }); } catch {}
        } else {
          // Single: local space delta
          const center = mesh.position.clone();
          const axisLocal = rotWidget.axisLocal || ((ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1));
          const wm = mesh.getWorldMatrix();
          const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
          const p = pickPointOnPlane(nWorld, center); if (!p) return;
          const inv = BABYLON.Matrix.Invert(wm);
          const pLocal = BABYLON.Vector3.TransformCoordinates(p, inv);
          let curLocal = pLocal.subtract(axisLocal.scale(BABYLON.Vector3.Dot(pLocal, axisLocal)));
          if (curLocal.lengthSquared() < 1e-8) return; curLocal.normalize();
          const refLocal = rotWidget.refLocal || new BABYLON.Vector3(1,0,0);
          const crossL = BABYLON.Vector3.Cross(refLocal, curLocal);
          const s = BABYLON.Vector3.Dot(axisLocal, crossL);
          const c = BABYLON.Vector3.Dot(refLocal, curLocal);
          delta = Math.atan2(s, c);
          try {
            const qStart = rotWidget.startQuat || mesh.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
            mesh.rotationQuaternion = (qStart.clone ? qStart.clone() : qStart);
            const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })();
            mesh.rotate(axisLocal, sens * delta, BABYLON.Space.LOCAL);
            mesh.rotation.set(0,0,0);
          } catch {}
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
          rotWidget.lastRot = delta;
          try { renderGizmoHud({ selCount: 1, center, deltaDeg: (delta*180/Math.PI), pickMode: 'plane' }); } catch {}
        }
        try { updateRotWidgetFromMesh(mesh); } catch {}
        // Live update model rotation and DB (throttled), and always log drag update for visibility
        try {
          const selLive = Array.from(state.selection || []);
          const isGroupLive = selLive.length > 1;
          if (isGroupLive) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of selLive) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
              sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
            }
          } else if (space && mesh) {
            if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
            const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
            space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
          }
          const now = performance.now();
          if (now - _lastDbRefresh > 60) {
            _lastDbRefresh = now;
            const deg = (delta * 180 / Math.PI);
            Log.log('GIZMO', 'Drag update', { id: rotWidget.spaceId, axis: ax, delta, deg: isFinite(deg) ? Math.round(deg*10)/10 : null });
            try { renderDbView(state.barrow); } catch {}
          }
          // Live intersection preview (use any id in selection for highlight updates)
          try { if (!isGroupLive) updateLiveIntersectionsFor(id); else if (selLive.length) updateLiveIntersectionsFor(selLive[0]); } catch {}
        } catch {}
        return;
      }
      // Possibly start move drag if moved enough after pressing disc
      if (!moveWidget.dragging && moveWidget.preDrag) {
        const dx = (scene.pointerX - moveWidget.downX); const dy = (scene.pointerY - moveWidget.downY);
        if (Math.hypot(dx, dy) >= dragThreshold) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const selNow = Array.from(state.selection || []);
          const isGroup = selNow.length > 1;
          if (isGroup) {
            const center = moveWidget.groupCenter || new BABYLON.Vector3(0,0,0);
            const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
            const p0 = pickPointOnPlane(n, center) || center.clone();
            moveWidget.startPoint = p0.clone();
            moveWidget.offsetVec = center.subtract(p0);
            moveWidget.startCenter = center.clone ? center.clone() : new BABYLON.Vector3(center.x, center.y, center.z);
            moveWidget.startById = new Map();
            // Snapshot current selection to move together
            moveWidget.groupIDs = selNow.slice();
            for (const id2 of moveWidget.groupIDs) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              moveWidget.startById.set(id2, m2.position?.clone ? m2.position.clone() : new BABYLON.Vector3(m2.position.x, m2.position.y, m2.position.z));
            }
            moveWidget.dragging = true; moveWidget.preDrag = false;
            try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', 'Group Move start', { ids: moveWidget.groupIDs }); } catch {}
          } else {
            const center = mesh.position.clone();
            try { mesh.computeWorldMatrix(true); } catch {}
            const n = mesh.getDirection(BABYLON.Axis.Y).normalize();
            const p0 = pickPointOnPlane(n, center) || center.clone();
            moveWidget.startPoint = p0.clone();
            moveWidget.startOrigin = { x: space?.origin?.x || center.x, y: space?.origin?.y || center.y, z: space?.origin?.z || center.z };
            moveWidget.offsetVec = new BABYLON.Vector3(moveWidget.startOrigin.x - p0.x, moveWidget.startOrigin.y - p0.y, moveWidget.startOrigin.z - p0.z);
            moveWidget.planeNormal = n.clone();
            moveWidget.dragging = true; moveWidget.preDrag = false;
            try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', 'Move start', { id: moveWidget.spaceId, start: moveWidget.startOrigin, offset: moveWidget.offsetVec }); } catch {}
          }
          dPick('dragStart:move', {});
          // Hide built intersections during drag to avoid stale boxes
          try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
        }
      }
      // Move drag
      if (moveWidget.dragging) {
        try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
        const selNow = Array.from(state.selection || []);
        const isGroup = selNow.length > 1;
        if (isGroup) {
          const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
          const p = pickPointOnPlane(n, moveWidget.groupCenter || new BABYLON.Vector3(0,0,0)); if (!p) return;
          const targetCenter = p.add(moveWidget.offsetVec || new BABYLON.Vector3(0,0,0));
          const delta = targetCenter.subtract(moveWidget.startCenter || moveWidget.groupCenter || new BABYLON.Vector3(0,0,0));
          // Apply translation to each selected mesh
          for (const id2 of moveWidget.groupIDs || []) {
            const entry = (state?.built?.spaces || []).find(x => x.id === id2); if (!entry?.mesh) continue;
            const startPos = moveWidget.startById?.get?.(id2); if (!startPos) continue;
            const m2 = entry.mesh;
            m2.position.copyFrom(startPos.add(delta));
            try { m2.computeWorldMatrix(true); m2.refreshBoundingInfo(); } catch {}
          }
          // Move disc to follow and update group center baseline
          try { moveWidget.mesh.position.copyFrom(targetCenter); } catch {}
          moveWidget.groupCenter = targetCenter.clone ? targetCenter.clone() : new BABYLON.Vector3(targetCenter.x, targetCenter.y, targetCenter.z);
          // Keep rotation gizmo (group rings) following
          try { if (rotWidget.group && rotWidget.groupNode) rotWidget.groupNode.position.copyFrom(targetCenter); } catch {}
          // Persist model origins live (throttled with DB refresh debounce)
          try {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of moveWidget.groupIDs || []) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              sp.origin = { x: m2.position.x, y: m2.position.y, z: m2.position.z };
            }
            const now = performance.now();
            if (now - _lastDbRefresh > 60) {
              _lastDbRefresh = now;
              Log.log('GIZMO', 'Group Move update', { ids: moveWidget.groupIDs });
              try { renderDbView(state.barrow); } catch {}
            }
          } catch {}
        } else {
          const n = moveWidget.planeNormal || mesh.getDirection(BABYLON.Axis.Y);
          const p = pickPointOnPlane(n, mesh.position); if (!p) return;
          const target = p.add(moveWidget.offsetVec || new BABYLON.Vector3(0,0,0));
          // Apply new position (in world space)
          mesh.position.copyFrom(target);
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
          // Keep gizmos following and scaling with the mesh while dragging
          try { if (moveWidget.mesh) moveWidget.mesh.position.set(0,0,0); } catch {}
          try { updateRotWidgetFromMesh(mesh); } catch {}
          try {
            if (space) {
              space.origin = space.origin || { x: 0, y: 0, z: 0 };
              space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
              const now = performance.now();
              if (now - _lastDbRefresh > 60) {
                _lastDbRefresh = now;
                Log.log('GIZMO', 'Move update', { id: moveWidget.spaceId, origin: space.origin });
                try { renderDbView(state.barrow); } catch {}
              }
              // Live intersection preview (selected vs others)
              try { updateLiveIntersectionsFor(id); } catch {}
            }
          } catch {}
        }
      }
      }
  });

  // Global pointerup failsafe (release outside canvas)
  window.addEventListener('pointerup', () => {
    try {
      if (rotWidget.dragging) {
        rotWidget.dragging = false; rotWidget.preDrag = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        // Persist latest rotation
        try {
          const sel = Array.from(state.selection || []);
          if (sel.length > 1) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of sel) {
              const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
              const sp = byId.get(id2); if (!sp) continue;
              try {
                const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
                sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
              } catch {}
            }
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          } else {
            const { space, mesh } = getSelectedSpaceAndMesh();
            if (space && mesh) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              try {
                const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
                space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
              } catch {}
              saveBarrow(state.barrow); snapshot(state.barrow);
              renderDbView(state.barrow);
              scheduleGridUpdate();
              try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          }
        } catch {}
      }
      if (moveWidget.dragging) {
        moveWidget.dragging = false; moveWidget.preDrag = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        // Persist latest origin
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            space.origin = space.origin || { x: 0, y: 0, z: 0 };
            space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
            saveBarrow(state.barrow); snapshot(state.barrow);
            renderDbView(state.barrow);
            scheduleGridUpdate();
            try { rebuildScene(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          }
        } catch {}
      }
      try { setRingsDim(); } catch {}
    } catch {}
  }, { passive: true });

  // ——————————— Pointer selection & double-click ———————————
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  let lastPickName = null;
  let lastPickTime = 0;
  function setRingsDim() {
    try {
      const mats = rotWidget?.mats || {};
      const dims = 0.35;
      for (const k of ['x','y','z']) {
        const m = mats[k]; if (!m) continue;
        const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1));
        m.emissiveColor = base.scale(dims);
        m.diffuseColor = base.scale(0.05 + 0.15 * dims);
      }
      rotWidget.activeAxis = null;
    } catch {}
  }
  function setRingActive(axis) {
    try {
      const mats = rotWidget?.mats || {};
      const kActive = 1.1, kDim = 0.35;
      for (const k of ['x','y','z']) {
        const m = mats[k]; if (!m) continue;
        const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1));
        const kf = (k === axis) ? kActive : kDim;
        m.emissiveColor = base.scale(kf);
        m.diffuseColor = base.scale(0.05 + 0.15 * kf);
      }
      rotWidget.activeAxis = axis;
    } catch {}
  }
  scene.onPointerObservable.add((pi) => {
    if (state.mode !== 'edit') return;
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
    if (rotWidget.dragging || moveWidget.dragging) return; // do not interfere while dragging gizmo
    const ev = pi.event || window.event;
    dPick('pointerdown', { x: scene.pointerX, y: scene.pointerY });
    let pick = scene.pick(
      scene.pointerX,
      scene.pointerY,
      (m) => {
        if (!m || typeof m.name !== 'string') return false;
        const n = m.name;
        if (n.startsWith('space:')) {
          // Only pick the base space mesh (no suffix like :label or :wall)
          const rest = n.slice('space:'.length);
          return !rest.includes(':');
        }
        return n.startsWith('cavern:');
      }
    );
    dPick('primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null });
    // Fallback: robust ray/mesh intersection if Babylon pick misses
    if (!pick?.hit || !pick.pickedMesh) {
      try {
        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
        let best = null;
        for (const entry of (state?.built?.spaces || [])) {
          const mesh = entry?.mesh; if (!mesh) continue;
          const info = ray.intersectsMesh(mesh, false);
          if (info?.hit) {
            if (!best || info.distance < best.distance) best = { info, mesh, id: entry.id };
          }
        }
        if (best) {
          pick = { hit: true, pickedMesh: best.mesh, distance: best.info.distance };
          dPick('fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance });
        } else {
          dPick('fallbackPickMiss', {});
        }
      } catch {}
    }
    if (!pick?.hit || !pick.pickedMesh) return;
    const pickedName = pick.pickedMesh.name; // space:<id> or cavern:<id> or space:<id>:label
    let id = '';
    let name = pickedName;
    if (pickedName.startsWith('space:')) {
      const rest = pickedName.slice('space:'.length);
      // Extract bare id before any suffix like :label or :wall:...
      id = rest.split(':')[0];
      name = 'space:' + id; // normalize for double-click detection
    } else if (pickedName.startsWith('cavern:')) {
      id = pickedName.slice('cavern:'.length);
      name = 'cavern:' + id;
    }
    dPick('selectId', { id, name });
    if (ev && ev.shiftKey) {
      if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    } else {
      state.selection.clear();
      state.selection.add(id);
    }
    Log.log('UI', 'Select space(s)', { selection: Array.from(state.selection) });
    rebuildHalos();
    ensureRotWidget(); ensureMoveWidget(); disposeLiveIntersections();
    try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}

    // Handle double-click/tap with adjustable threshold
    const now = performance.now();
    if (name === lastPickName && (now - lastPickTime) <= DOUBLE_CLICK_MS) {
      dPick('doubleClick', { name, id });
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
      try {
        // Toggle all panes generically
        const panes = panelContent.querySelectorAll('.tab-pane');
        panes.forEach(p => p.classList.toggle('active', p.id === tabId));
        // Toggle all tabs generically
        const tabs = tabsBar.querySelectorAll('.tab');
        tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
        // Notify listeners about tab change
        try { window.dispatchEvent(new CustomEvent('dw:tabChange', { detail: { id: tabId } })); } catch {}
      } catch {}
    }
    // Generic delegation: any button with class 'tab' switches panes
    tabsBar.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.tab') : null;
      if (!btn || !btn.dataset || !btn.dataset.tab) return;
      activate(btn.dataset.tab);
    });
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

  // ——————————— External transforms (buttons/commands) ———————————
  window.addEventListener('dw:transform', (e) => {
    try { ensureRotWidget(); ensureMoveWidget(); rebuildHalos(); } catch {}
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
      try { state.selection.clear(); state.selection.add(id); rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
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
        // Open nested transform sections as well
        try { target.querySelectorAll('details[data-section]').forEach(sec => { sec.open = true; }); } catch {}
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
