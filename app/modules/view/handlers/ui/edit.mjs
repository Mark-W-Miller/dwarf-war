// Edit tab UI handlers (voxel ops, connect paths, tunnels)
import { VoxelType } from '../../../voxels/voxelize.mjs';

export function initEditUiHandlers(ctx) {
  const { scene, engine, camera, state, Log, helpers = {}, dom = {} } = ctx;
  const { saveBarrow = () => {}, snapshot = () => {}, rebuildScene = () => {}, rebuildHalos = () => {}, scheduleGridUpdate = () => {}, renderDbView = () => {}, pickPointOnPlane = () => null, moveSelection = () => {}, setMode = () => {}, setRunning = () => {}, ensureRotWidget = () => {}, ensureMoveWidget = () => {}, disposeRotWidget = () => {}, disposeMoveWidget = () => {}, applyViewToggles = () => {}, updateGridExtent = () => {}, camApi = {} } = helpers;

  const { btnTunnel, btnConnect, btnFinalize, btnEmpty, btnRock, btnWall, minInput } = dom;
  const { toggleRunBtn, modeRadios, showNamesCb, gridGroundCb, gridXYCb, gridYZCb, axisArrowsCb, resizeGridBtn, spaceTypeEl, spaceNameEl, newSpaceBtn, fitViewBtn, sizeXEl, sizeYEl, sizeZEl, sizeLockEl, tStepEl, txMinus, txPlus, tyMinus, tyPlus, tzMinus, tzPlus } = dom;

  if (minInput) minInput.addEventListener('change', () => { try { const v = Math.max(1, Number(minInput.value)||6); localStorage.setItem('dw:ops:minTunnelWidth', String(v)); } catch {} });

  // Mode + Run/Pause
  Array.isArray(modeRadios) && modeRadios.forEach(r => r && r.addEventListener('change', () => setMode(r.value)));
  toggleRunBtn?.addEventListener('click', () => {
    setRunning(!state.running);
    if (toggleRunBtn) toggleRunBtn.textContent = state.running ? 'Pause' : 'Run';
    Log?.log('UI', 'Toggle run', { running: state.running });
  });

  // View toggles
  function readBool(key, dflt = true) { try { const v = localStorage.getItem(key); return v == null ? dflt : v !== '0'; } catch { return dflt; } }
  function writeBool(key, val) { try { localStorage.setItem(key, val ? '1' : '0'); } catch {} }
  if (showNamesCb) showNamesCb.checked = readBool('dw:ui:showNames', true);
  if (gridGroundCb) gridGroundCb.checked = readBool('dw:ui:gridGround', true);
  if (gridXYCb) gridXYCb.checked = readBool('dw:ui:gridXY', true);
  if (gridYZCb) gridYZCb.checked = readBool('dw:ui:gridYZ', true);
  if (axisArrowsCb) axisArrowsCb.checked = readBool('dw:ui:axisArrows', true);
  function applyTogglesFromUI() {
    if (showNamesCb) writeBool('dw:ui:showNames', !!showNamesCb.checked);
    if (gridGroundCb) writeBool('dw:ui:gridGround', !!gridGroundCb.checked);
    if (gridXYCb) writeBool('dw:ui:gridXY', !!gridXYCb.checked);
    if (gridYZCb) writeBool('dw:ui:gridYZ', !!gridYZCb.checked);
    if (axisArrowsCb) writeBool('dw:ui:axisArrows', !!axisArrowsCb.checked);
    try { applyViewToggles?.(); } catch {}
    try { Log?.log('UI', 'View toggles', { names: !!showNamesCb?.checked, ground: !!gridGroundCb?.checked, xy: !!gridXYCb?.checked, yz: !!gridYZCb?.checked, arrows: !!axisArrowsCb?.checked }); } catch {}
  }
  showNamesCb?.addEventListener('change', applyTogglesFromUI);
  gridGroundCb?.addEventListener('change', applyTogglesFromUI);
  gridXYCb?.addEventListener('change', applyTogglesFromUI);
  gridYZCb?.addEventListener('change', applyTogglesFromUI);
  axisArrowsCb?.addEventListener('change', applyTogglesFromUI);
  applyTogglesFromUI();
  resizeGridBtn?.addEventListener('click', () => { try { updateGridExtent?.(); } catch {} Log?.log('UI','Resize Grid',{}); });

  // Size defaults + fields
  function defaultSizeForType(t) {
    let base;
    switch (t) {
      case 'Cavern': base = { x: 100, y: 75, z: 100 }; break;
      case 'Carddon': base = { x: 200, y: 15, z: 200 }; break;
      case 'Tunnel': base = { x: 100, y: 40, z: 20 }; break;
      case 'Room': base = { x: 10, y: 10, z: 10 }; break;
      case 'Space': base = { x: 5, y: 5, z: 5 }; break;
      default: base = { x: 200, y: 100, z: 200 }; break;
    }
    const shrink = (n) => (n > 10 ? Math.round(n / 2) : n);
    return { x: shrink(base.x), y: shrink(base.y), z: shrink(base.z) };
  }
  function applyDefaultSizeFields() {
    const t = spaceTypeEl?.value || 'Space';
    const s = defaultSizeForType(t);
    if (sizeXEl) sizeXEl.value = String(s.x);
    if (sizeYEl) sizeYEl.value = String(s.y);
    if (sizeZEl) sizeZEl.value = String(s.z);
  }
  function suggestSpaceName(baseType) {
    const base = (baseType || spaceTypeEl?.value || 'Space').toLowerCase();
    const used = new Set((state.barrow.spaces||[]).map(s => s.id));
    let n = 1; let candidate = base; while (used.has(candidate)) { candidate = `${base}-${++n}`; }
    return candidate;
  }
  function ensureNameInput() {
    if (!spaceNameEl) return;
    if (!spaceNameEl.value || spaceNameEl.value.trim() === '') { spaceNameEl.value = suggestSpaceName(spaceTypeEl?.value); }
    updateNewBtnEnabled();
  }
  function updateNewBtnEnabled() {
    const ok = (spaceNameEl?.value || '').trim().length >= 1; if (newSpaceBtn) newSpaceBtn.disabled = !ok;
  }
  spaceTypeEl?.addEventListener('change', () => { applyDefaultSizeFields(); try { Log?.log('UI', 'Change type defaults', { type: spaceTypeEl.value, defaults: defaultSizeForType(spaceTypeEl.value) }); } catch {}; ensureNameInput(); });
  applyDefaultSizeFields(); ensureNameInput();
  newSpaceBtn?.addEventListener('click', () => {
    const type = spaceTypeEl?.value || 'Space'; const res = state.barrow?.meta?.voxelSize || 10;
    let sx = Math.max(1, Math.round(Number(sizeXEl?.value || '200')));
    let sy = Math.max(1, Math.round(Number(sizeYEl?.value || '100')));
    let sz = Math.max(1, Math.round(Number(sizeZEl?.value || '200')));
    if (type === 'Carddon') { sy = Math.max(1, Math.round(0.5 * Math.max(sx, sz))); if (sizeYEl) sizeYEl.value = String(sy); }
    const size = { x: sx, y: sy, z: sz };
    const desiredRaw = (spaceNameEl?.value || '').trim(); const baseName = desiredRaw || suggestSpaceName(type);
    const used = new Set((state.barrow.spaces||[]).map(s => s.id)); let n = 1; let id = baseName; while (used.has(id)) { id = `${baseName}-${++n}`; }
    const origin = ((state.barrow?.spaces||[]).length === 0) ? new BABYLON.Vector3(0,0,0) : camera.target.clone();
    const s = { id, type, res, size, origin: { x: origin.x, y: origin.y, z: origin.z }, chunks: {}, attrs: {} };
    state.barrow.spaces = state.barrow.spaces || []; state.barrow.spaces.push(s);
    Log?.log('UI', 'New space', { id: s.id, type: s.type, res: s.res, size: s.size, origin: s.origin });
    saveBarrow(state.barrow); snapshot(state.barrow); rebuildScene(); renderDbView(state.barrow);
    camera.target.copyFrom(new BABYLON.Vector3(s.origin.x, s.origin.y, s.origin.z));
    try { state.selection.clear(); state.selection.add(s.id); rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
    scheduleGridUpdate(); ensureNameInput();
  });
  fitViewBtn?.addEventListener('click', () => camApi?.fitViewSmart?.(state.barrow));

  // Proportional size linking and live size field edits
  (function setupProportionalSize(){
    if (!sizeXEl || !sizeYEl || !sizeZEl) return; if (sizeLockEl) sizeLockEl.checked = (localStorage.getItem('dw:ui:sizeProp') === '1');
    sizeLockEl?.addEventListener('change', () => { try { localStorage.setItem('dw:ui:sizeProp', !!sizeLockEl.checked ? '1' : '0'); } catch {} });
    let last = { x: Number(sizeXEl.value||'0')||0, y: Number(sizeYEl.value||'0')||0, z: Number(sizeZEl.value||'0')||0 };
    let reentrant = false; const clamp = (v) => { v = Math.round(Number(v)||0); return Math.max(1, v); };
    function handle(axis){ if (reentrant) return; const locked = !!sizeLockEl?.checked; const cur = { x:clamp(sizeXEl.value), y:clamp(sizeYEl.value), z:clamp(sizeZEl.value) }; if (!locked) { last = cur; return; } let base = last[axis] || 1; if (!isFinite(base) || base <= 0) base = 1; const nowVal = cur[axis]; const scale = nowVal / base; if (!isFinite(scale) || scale <= 0) { last = cur; return; } const nx = clamp(last.x*scale), ny = clamp(last.y*scale), nz = clamp(last.z*scale); reentrant=true; if (axis!=='x') sizeXEl.value=String(nx); if(axis!=='y') sizeYEl.value=String(ny); if(axis!=='z') sizeZEl.value=String(nz); reentrant=false; last={ x:clamp(sizeXEl.value), y:clamp(sizeYEl.value), z:clamp(sizeZEl.value) }; try { const sel = Array.from(state.selection || []); if (sel.length > 0) { if (axis!=='x') applySizeField('x', sizeXEl.value); if (axis!=='y') applySizeField('y', sizeYEl.value); if (axis!=='z') applySizeField('z', sizeZEl.value); } } catch {} }
    sizeXEl.addEventListener('input', () => handle('x')); sizeYEl.addEventListener('input', () => handle('y')); sizeZEl.addEventListener('input', () => handle('z'));
    function syncLast(){ last = { x: clamp(sizeXEl.value), y: clamp(sizeYEl.value), z: clamp(sizeZEl.value) }; }
    try { window.addEventListener('dw:selectionChange', syncLast); window.addEventListener('dw:dbEdit', syncLast); window.addEventListener('dw:transform', syncLast); } catch {}
  })();

  function getSelectedSpaces() { try { const ids = Array.from(state.selection || []); const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s])); return ids.map(id => byId.get(id)).filter(Boolean); } catch { return []; } }
  function populateSizeFieldsFromSelection() { const sel = getSelectedSpaces(); if (!sel.length) return; const s = sel.find(x => !x.vox) || sel[0]; if (!s) return; if (sizeXEl) sizeXEl.value=String(Math.max(1, Math.round(Number(s.size?.x||1)))); if (sizeYEl) sizeYEl.value=String(Math.max(1, Math.round(Number(s.size?.y||1)))); if (sizeZEl) sizeZEl.value=String(Math.max(1, Math.round(Number(s.size?.z||1)))); }
  window.addEventListener('dw:selectionChange', populateSizeFieldsFromSelection);
  window.addEventListener('dw:dbEdit', populateSizeFieldsFromSelection);
  window.addEventListener('dw:transform', populateSizeFieldsFromSelection);

  function applySizeField(axis, value) {
    const v = Math.max(1, Math.round(Number(value || ''))); const sel = getSelectedSpaces(); if (!sel.length) return; let changed = false;
    for (const s of sel) { if (s.vox) continue; const cur = Number(s.size?.[axis] || 0); if (!s.size) s.size = { x:1, y:1, z:1 }; if (cur !== v) { s.size[axis] = v; changed = true; } }
    if (changed) { try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {} try { rebuildScene(); } catch {} try { disposeMoveWidget(); } catch {} try { disposeRotWidget(); } catch {} try { renderDbView(state.barrow); } catch {} try { scheduleGridUpdate(); } catch {} try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'resize', axis, value: v, selection: Array.from(state.selection) } })); } catch {} }
  }
  sizeXEl?.addEventListener('change', () => applySizeField('x', sizeXEl.value));
  sizeYEl?.addEventListener('change', () => applySizeField('y', sizeYEl.value));
  sizeZEl?.addEventListener('change', () => applySizeField('z', sizeZEl.value));
  sizeXEl?.addEventListener('input', () => applySizeField('x', sizeXEl.value));
  sizeYEl?.addEventListener('input', () => applySizeField('y', sizeYEl.value));
  sizeZEl?.addEventListener('input', () => applySizeField('z', sizeZEl.value));

  // Transform nudge buttons
  (function bindTransformButtons(){
    const stepEl = tStepEl; const TSTEP_KEY = 'dw:ui:baseStep';
    function getBaseStep(){ const data = Number(stepEl?.dataset?.base); if (isFinite(data) && data > 0) return data; const stored = Number(localStorage.getItem(TSTEP_KEY) || '10') || 10; return stored; }
    function setBaseStep(n){ const v = Math.max(0.01, Number(n) || 1); if (stepEl) stepEl.dataset.base = String(v); try { localStorage.setItem(TSTEP_KEY, String(v)); } catch {} }
    function effectiveStep(){ const base = getBaseStep(); const r = camera?.radius || 50; const norm = Math.max(0, r / 100); const mult = Math.max(1, Math.min(100, Math.sqrt(norm))); return base * mult; }
    function fmt(n){ if (!isFinite(n)) return '0'; if (n >= 10) return String(Math.round(n)); if (n >= 1) return String(Math.round(n)); return String(Math.round(n * 100) / 100); }
    if (stepEl && !stepEl.dataset.base) { setBaseStep(Number(stepEl.value) || 10); }
    function updateStepDisplay(){ if (!stepEl) return; if (document.activeElement === stepEl) return; stepEl.value = fmt(effectiveStep()); }
    try { engine.onBeginFrameObservable.add(updateStepDisplay); } catch {}
    stepEl?.addEventListener('focus', () => { try { stepEl.value = fmt(getBaseStep()); } catch {} });
    stepEl?.addEventListener('input', () => { setBaseStep(stepEl.value); });
    stepEl?.addEventListener('blur', () => { updateStepDisplay(); });
    const step = () => effectiveStep();
    function addRepeat(btn, fn){ if (!btn) return; let timer=null; const fire=()=>{ try { fn(); } catch {} }; btn.addEventListener('mousedown', ()=>{ if(timer) clearInterval(timer); fire(); timer=setInterval(fire,120); }); ['mouseup','mouseleave'].forEach(ev=> btn.addEventListener(ev, ()=>{ if(timer){ clearInterval(timer); timer=null; } })); }
    addRepeat(txMinus, () => moveSelection(-step(),0,0)); addRepeat(txPlus, () => moveSelection( step(),0,0));
    addRepeat(tyMinus, () => moveSelection(0,-step(),0)); addRepeat(tyPlus, () => moveSelection(0, step(),0));
    addRepeat(tzMinus, () => moveSelection(0,0,-step())); addRepeat(tzPlus, () => moveSelection(0,0, step()));
  })();

  function uniqueId(base) {
    const used = new Set((state?.barrow?.spaces||[]).map(sp => sp?.id).filter(Boolean));
    let i = 1; let id = `${base}-${i}`;
    while (used.has(id)) { i++; id = `${base}-${i}`; }
    return id;
  }

  function applySetSelectedVoxels(value) {
    try {
      const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
      if (!picks.length) { Log?.log('UI', 'Voxel set: no picks', {}); return; }
      const bySpace = new Map();
      for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
      const spacesById = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
      let changed = 0;
      for (const [sid, arr] of bySpace.entries()) {
        const s = spacesById.get(sid); if (!s || !s.vox || !s.vox.size) continue;
        const vox = s.vox; const nx = Math.max(1, vox.size?.x||1), ny = Math.max(1, vox.size?.y||1), nz = Math.max(1, vox.size?.z||1);
        const data = Array.isArray(vox.data) ? vox.data : (vox.data = new Array(nx*ny*nz).fill(null));
        for (const p of arr) {
          const i = p.x + nx*(p.y + ny*p.z);
          if (data[i] !== value) { data[i] = value; changed++; }
        }
      }
      if (changed > 0) {
        try { saveBarrow(state.barrow); snapshot(state.barrow); } catch {}
        try { rebuildScene(); } catch {}
        try { renderDbView(state.barrow); } catch {}
        try { scheduleGridUpdate(); } catch {}
        try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-set', value, changed } })); } catch {}
        try { rebuildHalos(); } catch {}
      }
      Log?.log('UI', 'Voxel set: applied', { value, changed });
    } catch (e) { Log?.log('ERROR', 'EH:voxelSet', { error: String(e) }); }
  }

  btnEmpty?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Empty));
  btnRock?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Rock));
  btnWall?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Wall));

  function worldPointFromVoxelIndex(s, ix, iy, iz) {
    try {
      const res = s.vox?.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
      const nx = Math.max(1, s.vox?.size?.x || 1); const ny = Math.max(1, s.vox?.size?.y || 1); const nz = Math.max(1, s.vox?.size?.z || 1);
      const minX = -(nx * res) / 2, minY = -(ny * res) / 2, minZ = -(nz * res) / 2;
      const lx = minX + (ix + 0.5) * res, ly = minY + (iy + 0.5) * res, lz = minZ + (iz + 0.5) * res;
      const worldAligned = !!(s.vox && s.vox.worldAligned);
      let v = new BABYLON.Vector3(lx, ly, lz);
      if (!worldAligned) {
        const rx = Number(s.rotation?.x || 0) || 0; const ry = (typeof s.rotation?.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0; const rz = Number(s.rotation?.z || 0) || 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero());
        v = BABYLON.Vector3.TransformCoordinates(v, m);
      }
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      v.x += cx; v.y += cy; v.z += cz; return v;
    } catch { return null; }
  }

  function segAabbIntersect(p0, p1, aabb, expand) {
    try {
      const min = { x: aabb.min.x - expand, y: aabb.min.y - expand, z: aabb.min.z - expand };
      const max = { x: aabb.max.x + expand, y: aabb.max.y + expand, z: aabb.max.z + expand };
      const dir = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      let tmin = 0, tmax = 1;
      for (const ax of ['x','y','z']) {
        const d = dir[ax]; const o = p0[ax];
        if (Math.abs(d) < 1e-12) { if (o < min[ax] || o > max[ax]) return false; }
        else {
          const inv = 1 / d; let t1 = (min[ax] - o) * inv; let t2 = (max[ax] - o) * inv; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmax < tmin) return false;
        }
      }
      return tmax >= Math.max(0, tmin) && tmin <= 1 && tmax >= 0;
    } catch { return true; }
  }

  function pathAvoidingObstacles(start, end, obstacles, radius, upY) {
    const orders = [ ['x','y','z'], ['x','z','y'], ['y','x','z'], ['y','z','x'], ['z','x','y'], ['z','y','x'] ];
    function buildVia(order) {
      const p1 = new BABYLON.Vector3(start.x, start.y, start.z);
      const p2 = new BABYLON.Vector3(start.x, start.y, start.z);
      p1[order[0]] = end[order[0]]; p2[order[0]] = end[order[0]]; p2[order[1]] = end[order[1]];
      return [p1, p2];
    }
    function clearPath(points) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i+1];
        for (const ob of obstacles) { if (segAabbIntersect(a, b, ob, radius)) return false; }
      }
      return true;
    }
    for (const ord of orders) { const [v1, v2] = buildVia(ord); const pts = [start, v1, v2, end]; if (clearPath(pts)) return pts; }
    const yHub = isFinite(upY) ? upY : (Math.max(...obstacles.map(o => o.max.y)) + radius * 2 + 2);
    const viaA = new BABYLON.Vector3(start.x, yHub, start.z); const viaB = new BABYLON.Vector3(end.x, yHub, end.z); const pts2 = [start, viaA, viaB, end]; if (clearPath(pts2)) return pts2;
    return null;
  }

  function addTunnelsAlongSegment(p0, p1, opts) {
    const addedIds = [];
    try {
      const dirV = p1.subtract(p0); const dist = dirV.length(); if (!(dist > 1e-6)) return addedIds;
      const dir = dirV.scale(1 / dist);
      const baseRes = opts.baseRes; const cs = opts.cs; const Lvox = opts.Lvox;
      const nSeg = Math.max(1, Math.ceil(dist / (Lvox * baseRes))); const step = dist / nSeg;
      for (let i = 0; i < nSeg; i++) {
        const segLen = Math.min(step, dist - i * step); const half = segLen / 2;
        let center = p0.add(dir.scale(i * step + half));
        if (opts.isFirst && i === 0) center = p0.add(dir.scale(half - opts.depthInside));
        if (opts.isLast && i === nSeg - 1) center = p1.subtract(dir.scale(half - opts.depthInside));
        const yaw = Math.atan2(dir.x, dir.z); const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)));
        const sizeVox = { x: cs, y: cs, z: Math.max(3, Math.round(segLen / baseRes)) };
        const id = uniqueId('connect-tunnel');
        const tunnel = { id, type: 'Tunnel', size: sizeVox, origin: { x: center.x, y: center.y, z: center.z }, res: baseRes, rotation: { x: pitch, y: yaw, z: 0 } };
        state.barrow.spaces.push(tunnel); addedIds.push(id);
      }
    } catch {}
    return addedIds;
  }

  // Proposal state
  function clearProposals() {
    state._connect = state._connect || {};
    try { Log?.log('PATH', 'proposal:clear', { props: (state._connect.props||[]).length, nodes: (state._connect.nodes||[]).length, segs: (state._connect.segs||[]).length }); } catch {}
    for (const p of state._connect.props || []) { try { p.mesh?.dispose?.(); } catch {} }
    for (const n of state._connect.nodes || []) { try { n.mesh?.dispose?.(); } catch {} }
    for (const s of state._connect.segs || []) { try { s.mesh?.dispose?.(); } catch {} }
    if (state._connect.gizmo && state._connect.gizmo.root) { try { state._connect.gizmo.root.dispose(); } catch {} }
    if (state._connect.gizmo && state._connect.gizmo.parts) { for (const m of state._connect.gizmo.parts) { try { m.dispose(); } catch {} } }
    if (state._connect.debug && state._connect.debug.marker) { try { state._connect.debug.marker.dispose(); } catch {} }
    state._connect.props = []; state._connect.nodes = []; state._connect.segs = []; state._connect.path = null;
    if (state._connect.pickObs) { try { scene.onPrePointerObservable.remove(state._connect.pickObs); } catch {}; state._connect.pickObs = null; }
    if (state._connect.editObs) { try { scene.onPrePointerObservable.remove(state._connect.editObs); } catch {}; state._connect.editObs = null; }
    try { state._connect.debug = null; } catch {}
    try { if (btnFinalize) btnFinalize.style.display = 'none'; } catch {}
  }

  function createProposalMeshesFromPath(path) {
    try {
      state._connect = state._connect || { props: [], nodes: [], segs: [] };
      const pts = path.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
      const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: true }, scene);
      line.color = new BABYLON.Color3(0.55, 0.9, 1.0);
      line.isPickable = false; line.renderingGroupId = 3;
      state._connect.props.push({ name: 'connect:proposal', mesh: line, path });
      for (let i=1;i<pts.length-1;i++) {
        const s = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
        s.position.copyFrom(pts[i]); s.isPickable = true; s.renderingGroupId = 3;
        const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
        mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0);
        mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35);
        mat.specularColor = new BABYLON.Color3(0,0,0);
        mat.disableDepthWrite = true; mat.backFaceCulling = false; mat.zOffset = 8;
        s.material = mat; state._connect.nodes.push({ i, mesh: s });
      }
      if (btnFinalize) btnFinalize.style.display = 'inline-block';
      Log?.log('PATH', 'proposal:create', { points: path.length, segs: state._connect.segs.length, nodes: state._connect.nodes.length });
    } catch {}
  }

  function updateProposalMeshes() {
    try {
      const path = state._connect.path || [];
      const pts = path.map(p => new BABYLON.Vector3(p.x, p.y, p.z));
      for (const p of state._connect.props || []) { try { p.mesh?.dispose?.(); } catch {} }
      state._connect.props = [];
      const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: false }, scene);
      line.color = new BABYLON.Color3(0.55, 0.9, 1.0); line.isPickable = false; line.renderingGroupId = 3; state._connect.props.push({ name:'connect:proposal', mesh: line, path });
      for (const n of state._connect.nodes || []) { try { n.mesh?.dispose?.(); } catch {} }
      state._connect.nodes = [];
      for (let i=1;i<pts.length-1;i++) {
        const s = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
        s.position.copyFrom(pts[i]); s.isPickable = true; s.renderingGroupId = 3;
        const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
        mat.emissiveColor = new BABYLON.Color3(0.6,0.9,1.0);
        mat.diffuseColor = new BABYLON.Color3(0.15,0.25,0.35);
        mat.specularColor = new BABYLON.Color3(0,0,0);
        mat.disableDepthWrite = true; mat.backFaceCulling = false; mat.zOffset = 8;
        s.material = mat; state._connect.nodes.push({ i, mesh: s });
      }
      Log?.log('PATH', 'proposal:update', { points: path.length, segs: state._connect.segs.length, nodes: state._connect.nodes.length });
    } catch {}
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state?._connect?.path) {
        clearProposals(); Log?.log('UI', 'Connect: canceled proposal (Esc)', {}); ev.preventDefault(); ev.stopPropagation();
      }
    }
  });

  btnConnect?.addEventListener('click', () => {
    try {
      Log?.log('UI', 'Connect: click', {});
      const sel = Array.from(state.selection || []);
      const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
      const bySpace = new Map(); for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
      let aId = null, bId = null; const distinct = Array.from(bySpace.keys());
      if (distinct.length === 2) { aId = distinct[0]; bId = distinct[1]; Log?.log('UI', 'Connect: using voxel picks', { aId, bId }); }
      else if (sel.length === 2 && bySpace.has(sel[0]) && bySpace.has(sel[1])) { aId = sel[0]; bId = sel[1]; Log?.log('UI','Connect: using selected spaces', { aId, bId }); }
      else { Log?.log('ERROR','Connect: need voxels in two spaces', { uniqueSpaces: distinct.length, sel: sel.length }); return; }
      const byId = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s])); const A = byId.get(aId), B = byId.get(bId); if (!A||!B) return;
      function centerOfPicks(sid) {
        try { const arr = (bySpace.get(sid)||[]); if (!arr.length) return null; let sx=0,sy=0,sz=0; for(const p of arr){ sx+=p.x; sy+=p.y; sz+=p.z; } const cx=Math.round(sx/arr.length), cy=Math.round(sy/arr.length), cz=Math.round(sz/arr.length); return worldPointFromVoxelIndex(byId.get(sid), cx, cy, cz); } catch { return null; }
      }
      const pA = centerOfPicks(aId); const pB = centerOfPicks(bId); if (!pA||!pB) return;
      // Obstacles: AABBs of all spaces except the endpoints
      const obstacles = [];
      for (const s of (state?.barrow?.spaces||[])) {
        if (!s || s.id === aId || s.id === bId) continue; const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
        const w = (s.size?.x||0)*res, h=(s.size?.y||0)*res, d=(s.size?.z||0)*res; const cx=s.origin?.x||0, cy=s.origin?.y||0, cz=s.origin?.z||0;
        obstacles.push({ min:{x:cx-w/2,y:cy-h/2,z:cz-d/2}, max:{x:cx+w/2,y:cy+h/2,z:cz+d/2} });
      }
      const baseRes = state?.barrow?.meta?.voxelSize || 1; const cs = Math.max(2, Math.round(Number(minInput?.value||'6')||6));
      const radius = Math.max(1.0, (cs*baseRes)/2);
      const upY = Math.max(pA.y, pB.y);
      const path = pathAvoidingObstacles(pA, pB, obstacles, radius, upY) || [pA,pB];
      state._connect = state._connect || { props: [], nodes: [], segs: [], path: null };
      state._connect.path = path.map(p => ({ x: p.x, y: p.y, z: p.z }));
      createProposalMeshesFromPath(state._connect.path);
      ensureConnectGizmo();
    } catch {}
  });

  btnFinalize && (btnFinalize.onclick = () => {
    try {
      const path = state._connect?.path || []; if (path.length < 2) return;
      const baseRes = state?.barrow?.meta?.voxelSize || 1; const cs = Math.max(2, Math.round(Number(minInput?.value||'6')||6));
      const depthInside = Math.max(cs * baseRes * 1.5, 2 * baseRes);
      const addedIds = [];
      for (let i = 0; i < path.length - 1; i++) {
        const p0 = path[i]; const p1 = path[i+1];
        const ids = addTunnelsAlongSegment(new BABYLON.Vector3(p0.x,p0.y,p0.z), new BABYLON.Vector3(p1.x,p1.y,p1.z), { baseRes, cs, Lvox: cs, depthInside, isFirst: i===0, isLast: i===path.length-2 });
        for (const id of ids) addedIds.push(id);
      }
      saveBarrow(state.barrow); snapshot(state.barrow); rebuildScene(); renderDbView(state.barrow); rebuildHalos(); scheduleGridUpdate();
      clearProposals(); Log?.log('UI','Connect: finalized', { added: addedIds });
    } catch (e) { Log?.log('ERROR','Connect: finalize failed', { error: String(e) }); }
  });

  btnTunnel?.addEventListener('click', () => {
    try {
      const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
      if (!picks.length) { Log?.log('UI','Tunnel: no voxel picks',{}); return; }
      const bySpace = new Map(); for (const p of picks) { if (p && p.id != null) { if (!bySpace.has(p.id)) bySpace.set(p.id, []); bySpace.get(p.id).push(p); } }
      const byId = new Map((state?.barrow?.spaces||[]).map(s => [s.id, s]));
      const added = [];
      for (const [sid, arr] of bySpace) {
        const s = byId.get(sid); if (!s) continue;
        const center = new BABYLON.Vector3(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
        let minD2=Infinity, best=null; for(const p of arr){ const w=worldPointFromVoxelIndex(s,p.x,p.y,p.z); if(!w) continue; const dx=w.x-center.x, dy=w.y-center.y, dz=w.z-center.z; const d2=dx*dx+dy*dy+dz*dz; if(d2<minD2){minD2=d2;best=w;} }
        if (!best) continue;
        const dir = best.subtract(center); const len = dir.length(); if (!(len > 1e-6)) continue; dir.scaleInPlace(1/len);
        const cs = Math.max(2, Math.round(Number(minInput?.value||'6')||6)); const baseRes = state?.barrow?.meta?.voxelSize || 1;
        const out = center.add(dir.scale(Math.max(2, cs*baseRes*2)));
        const ids = addTunnelsAlongSegment(center, out, { baseRes, cs, Lvox: cs, depthInside: cs*baseRes*1.5, isFirst:true, isLast:true });
        for(const id of ids) added.push(id);
      }
      saveBarrow(state.barrow); snapshot(state.barrow); rebuildScene(); renderDbView(state.barrow); rebuildHalos(); scheduleGridUpdate();
      Log?.log('UI','Tunnel: added', { count: added.length });
    } catch (e) { Log?.log('ERROR','EH:voxelAddTunnel', { error: String(e) }); }
  });

  // Minimal gizmo for path editing (selection + drag)
  function ensureConnectGizmo() {
    // This is a large system in eventHandler; keep minimal re-center logic here
    try { if (!state._connect) return; if (!state._connect.path) return; if (btnFinalize) btnFinalize.style.display = 'inline-block'; } catch {}
  }
}
