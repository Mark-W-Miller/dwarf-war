// Edit tab UI handlers (voxel ops, connect paths, tunnels)
import { VoxelType } from '../../../voxels/voxelize.mjs';
import { rebuildConnectMeshes, disposeConnectMeshes, ensureConnectState, syncConnectPathToDb } from '../../connectMeshes.mjs';

export function initEditUiHandlers(ctx) {
  const { scene, engine, camera, state, Log, helpers = {}, dom = {} } = ctx;
  const { saveBarrow = () => {}, snapshot = () => {}, rebuildScene = () => {}, rebuildHalos = () => {}, scheduleGridUpdate = () => {}, renderDbView = () => {}, pickPointOnPlane = () => null, moveSelection = () => {}, setMode = () => {}, setRunning = () => {}, ensureRotWidget = () => {}, ensureMoveWidget = () => {}, disposeRotWidget = () => {}, disposeMoveWidget = () => {}, applyViewToggles = () => {}, updateGridExtent = () => {}, camApi = {} } = helpers;

  const { btnTunnel, btnConnect, btnFinalize, btnEmpty, btnRock, btnWall, minInput } = dom;
  const { showNamesCb, gridGroundCb, gridXYCb, gridYZCb, axisArrowsCb, targetDotCb, resizeGridBtn, spaceTypeEl, spaceNameEl, newSpaceBtn, fitViewBtn, sizeXEl, sizeYEl, sizeZEl, sizeLockEl, scrySpaceName, tStepEl, txMinus, txPlus, tyMinus, tyPlus, tzMinus, tzPlus } = dom;

  if (minInput) minInput.addEventListener('change', () => { const v = Math.max(1, Number(minInput.value)||6); localStorage.setItem('dw:ops:minTunnelWidth', String(v)); });

  // Mode controls removed (build later). Run/Pause removed.

  // View toggles
  function readBool(key, dflt = true) { const v = localStorage.getItem(key); return v == null ? dflt : v !== '0';  }
  function writeBool(key, val) { localStorage.setItem(key, val ? '1' : '0');  }
  if (showNamesCb) showNamesCb.checked = readBool('dw:ui:showNames', true);
  if (gridGroundCb) gridGroundCb.checked = readBool('dw:ui:gridGround', true);
  if (gridXYCb) gridXYCb.checked = readBool('dw:ui:gridXY', true);
  if (gridYZCb) gridYZCb.checked = readBool('dw:ui:gridYZ', true);
  if (axisArrowsCb) axisArrowsCb.checked = readBool('dw:ui:axisArrows', true);
  if (targetDotCb) targetDotCb.checked = readBool('dw:ui:targetDot', true);
  function applyTogglesFromUI() {
    if (showNamesCb) writeBool('dw:ui:showNames', !!showNamesCb.checked);
    if (gridGroundCb) writeBool('dw:ui:gridGround', !!gridGroundCb.checked);
    if (gridXYCb) writeBool('dw:ui:gridXY', !!gridXYCb.checked);
    if (gridYZCb) writeBool('dw:ui:gridYZ', !!gridYZCb.checked);
    if (axisArrowsCb) writeBool('dw:ui:axisArrows', !!axisArrowsCb.checked);
    if (targetDotCb) {
      writeBool('dw:ui:targetDot', !!targetDotCb.checked);
      helpers.setTargetDotVisible?.(!!targetDotCb.checked);
    }
    applyViewToggles?.();
    Log?.log('UI', 'View toggles', { names: !!showNamesCb?.checked, ground: !!gridGroundCb?.checked, xy: !!gridXYCb?.checked, yz: !!gridYZCb?.checked, arrows: !!axisArrowsCb?.checked, targetDot: !!targetDotCb?.checked });
  }
  showNamesCb?.addEventListener('change', applyTogglesFromUI);
  gridGroundCb?.addEventListener('change', applyTogglesFromUI);
  gridXYCb?.addEventListener('change', applyTogglesFromUI);
  gridYZCb?.addEventListener('change', applyTogglesFromUI);
  axisArrowsCb?.addEventListener('change', applyTogglesFromUI);
  targetDotCb?.addEventListener('change', applyTogglesFromUI);
  const updateScrySpaceLabel = (detail) => {
    if (!scrySpaceName) return;
    const active = detail?.active;
    const name = detail?.name || detail?.spaceId || null;
    scrySpaceName.textContent = active && name ? name : '—';
  };
  window.addEventListener('dw:scry:space', (event) => updateScrySpaceLabel(event.detail));
  updateScrySpaceLabel({ active: state?._scry?.scryMode, name: state?._scry?.spaceName || state?._scry?.spaceId });

  applyTogglesFromUI();
  resizeGridBtn?.addEventListener('click', () => { updateGridExtent?.();  Log?.log('UI','Resize Grid',{}); });

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
  spaceTypeEl?.addEventListener('change', () => { applyDefaultSizeFields();  Log?.log('UI', 'Change type defaults', { type: spaceTypeEl.value, defaults: defaultSizeForType(spaceTypeEl.value) }); ; ensureNameInput(); });
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
    // Place where the camera's view vector meets the ground plane (Y = 0).
    let origin = null;
    let viewRight = new BABYLON.Vector3(1, 0, 0);
    const ray = camera?.getForwardRay?.();
    if (ray && ray.direction) {
      const dir = ray.direction.clone();
      const pos = camera.position.clone();
      const EPS = 1e-5;
      if (Math.abs(dir.y) > EPS) {
        let t = -pos.y / dir.y;
        const maxDist = Math.max(10, (camera.radius || 50) * 1.5);
        if (Number.isFinite(t)) {
          t = Math.max(0, Math.min(t, maxDist));
          origin = pos.add(dir.scale(t));
        }
      }
      const forward = new BABYLON.Vector3(dir.x, dir.y, dir.z);
      forward.y = 0;
      if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
      forward.normalize();
      const up = new BABYLON.Vector3(0, 1, 0);
      viewRight = BABYLON.Vector3.Cross(up, forward);
      if (viewRight.lengthSquared() < 1e-6) viewRight.set(1, 0, 0);
      viewRight.normalize();
    }

    if (!origin || !isFinite(origin.x) || !isFinite(origin.z)) {
      // Fallback: align along +X axis just beyond existing spaces.
      origin = new BABYLON.Vector3(0, 0, 0);
      const existing = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
      if (existing.length > 0) {
        let maxRight = 0;
        for (const ex of existing) {
          if (!ex) continue;
          const exRes = Number(ex.res) || (state.barrow?.meta?.voxelSize || 1);
          const exWidth = (Number(ex.size?.x) || 0) * exRes;
          const center = Number(ex.origin?.x) || 0;
          const right = center + exWidth / 2;
          if (right > maxRight) maxRight = right;
        }
        const width = size.x * res;
        const spacing = Math.max(res, width * 0.25);
        origin = new BABYLON.Vector3(maxRight + width / 2 + spacing, 0, 0);
      }
    }
    origin.y = 0;
    const snap = (v, r) => {
      r = Math.max(1e-6, Number(r) || 1);
      return Math.round(v / r) * r;
 };
    origin.x = snap(origin.x, res);
    origin.z = snap(origin.z, res);

    // If a non-voxel space already occupies this spot, shift to the camera-right side.
    const tolerance = Math.max(res, 0.5);
    const nonVox = (state?.barrow?.spaces || []).filter((sp) => sp && !(sp.vox && sp.vox.size));
    const collide = nonVox.find((sp) => {
      const ox = Number(sp?.origin?.x) || 0;
      const oz = Number(sp?.origin?.z) || 0;
      return Math.hypot(ox - origin.x, oz - origin.z) <= tolerance;
 });
    if (collide) {
      const collideRes = Number(collide.res) || (state?.barrow?.meta?.voxelSize || 1);
      const collideWidth = (Number(collide.size?.x) || 0) * collideRes;
      const width = size.x * res;
      const spacing = Math.max(res, Math.max(width, collideWidth) * 0.1);
      const offset = collideWidth / 2 + width / 2 + spacing;
      const base = new BABYLON.Vector3(Number(collide.origin?.x) || 0, 0, Number(collide.origin?.z) || 0);
      origin = base.add(viewRight.scale(offset));
      origin.y = 0;
      const snap = (v, r) => { r = Math.max(1e-6, Number(r) || 1); return Math.round(v / r) * r; };
      origin.x = snap(origin.x, res);
      origin.z = snap(origin.z, res);
    }

    const s = { id, type, res, size, origin: { x: origin.x, y: origin.y, z: origin.z }, chunks: {}, attrs: {} };
    state.barrow.spaces = state.barrow.spaces || []; state.barrow.spaces.push(s);
    Log?.log('UI', 'New space', { id: s.id, type: s.type, res: s.res, size: s.size, origin: s.origin });
    saveBarrow(state.barrow); snapshot(state.barrow); rebuildScene(); renderDbView(state.barrow);
    camera.target.copyFrom(new BABYLON.Vector3(s.origin.x, s.origin.y, s.origin.z));
    state.selection.clear(); state.selection.add(s.id); rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } }));
    scheduleGridUpdate(); ensureNameInput();
 });
  fitViewBtn?.addEventListener('click', () => camApi?.fitViewSmart?.(state.barrow));

  // Proportional size linking and live size field edits
  (function setupProportionalSize(){
    if (!sizeXEl || !sizeYEl || !sizeZEl) return; if (sizeLockEl) sizeLockEl.checked = (localStorage.getItem('dw:ui:sizeProp') === '1');
    sizeLockEl?.addEventListener('change', () => { localStorage.setItem('dw:ui:sizeProp', !!sizeLockEl.checked ? '1' : '0'); });
    let last = { x: Number(sizeXEl.value||'0')||0, y: Number(sizeYEl.value||'0')||0, z: Number(sizeZEl.value||'0')||0 };
    let reentrant = false; const clamp = (v) => { v = Math.round(Number(v)||0); return Math.max(1, v); };
    function handle(axis){ if (reentrant) return; const locked = !!sizeLockEl?.checked; const cur = { x:clamp(sizeXEl.value), y:clamp(sizeYEl.value), z:clamp(sizeZEl.value) }; if (!locked) { last = cur; return; } let base = last[axis] || 1; if (!isFinite(base) || base <= 0) base = 1; const nowVal = cur[axis]; const scale = nowVal / base; if (!isFinite(scale) || scale <= 0) { last = cur; return; } const nx = clamp(last.x*scale), ny = clamp(last.y*scale), nz = clamp(last.z*scale); reentrant=true; if (axis!=='x') sizeXEl.value=String(nx); if(axis!=='y') sizeYEl.value=String(ny); if(axis!=='z') sizeZEl.value=String(nz); reentrant=false; last={ x:clamp(sizeXEl.value), y:clamp(sizeYEl.value), z:clamp(sizeZEl.value) };  const sel = Array.from(state.selection || []); if (sel.length > 0) { if (axis!=='x') applySizeField('x', sizeXEl.value); if (axis!=='y') applySizeField('y', sizeYEl.value); if (axis!=='z') applySizeField('z', sizeZEl.value); }  }
    sizeXEl.addEventListener('input', () => handle('x')); sizeYEl.addEventListener('input', () => handle('y')); sizeZEl.addEventListener('input', () => handle('z'));
    function syncLast(){ last = { x: clamp(sizeXEl.value), y: clamp(sizeYEl.value), z: clamp(sizeZEl.value) }; }
    window.addEventListener('dw:selectionChange', syncLast); window.addEventListener('dw:dbEdit', syncLast); window.addEventListener('dw:transform', syncLast);
 })();

  function getSelectedSpaces() { const ids = Array.from(state.selection || []); const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s])); return ids.map(id => byId.get(id)).filter(Boolean);  }
  function populateSizeFieldsFromSelection() { const sel = getSelectedSpaces(); if (!sel.length) return; const s = sel.find(x => !x.vox) || sel[0]; if (!s) return; if (sizeXEl) sizeXEl.value=String(Math.max(1, Math.round(Number(s.size?.x||1)))); if (sizeYEl) sizeYEl.value=String(Math.max(1, Math.round(Number(s.size?.y||1)))); if (sizeZEl) sizeZEl.value=String(Math.max(1, Math.round(Number(s.size?.z||1)))); }
  window.addEventListener('dw:selectionChange', populateSizeFieldsFromSelection);
  window.addEventListener('dw:dbEdit', populateSizeFieldsFromSelection);
  window.addEventListener('dw:transform', populateSizeFieldsFromSelection);

  function applySizeField(axis, value) {
    const v = Math.max(1, Math.round(Number(value || ''))); const sel = getSelectedSpaces(); if (!sel.length) return; let changed = false;
    for (const s of sel) { if (s.vox) continue; const cur = Number(s.size?.[axis] || 0); if (!s.size) s.size = { x:1, y:1, z:1 }; if (cur !== v) { s.size[axis] = v; changed = true; } }
    if (changed) { saveBarrow(state.barrow); snapshot(state.barrow);   rebuildScene();   disposeMoveWidget();   disposeRotWidget();   renderDbView(state.barrow);   scheduleGridUpdate();   window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'resize', axis, value: v, selection: Array.from(state.selection) } }));  }
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
    function setBaseStep(n){ const v = Math.max(0.01, Number(n) || 1); if (stepEl) stepEl.dataset.base = String(v);  localStorage.setItem(TSTEP_KEY, String(v));  }
    function effectiveStep(){ const base = getBaseStep(); const r = camera?.radius || 50; const norm = Math.max(0, r / 100); const mult = Math.max(1, Math.min(100, Math.sqrt(norm))); return base * mult; }
    function fmt(n){ if (!isFinite(n)) return '0'; if (n >= 10) return String(Math.round(n)); if (n >= 1) return String(Math.round(n)); return String(Math.round(n * 100) / 100); }
    if (stepEl && !stepEl.dataset.base) { setBaseStep(Number(stepEl.value) || 10); }
    function updateStepDisplay(){ if (!stepEl) return; if (document.activeElement === stepEl) return; stepEl.value = fmt(effectiveStep()); }
    engine.onBeginFrameObservable.add(updateStepDisplay);
    stepEl?.addEventListener('focus', () => { stepEl.value = fmt(getBaseStep()); });
    stepEl?.addEventListener('input', () => { setBaseStep(stepEl.value); });
    stepEl?.addEventListener('blur', () => { updateStepDisplay(); });
    const step = () => effectiveStep();
    function addRepeat(btn, fn){ if (!btn) return; let timer=null; const fire=()=>{ fn(); }; btn.addEventListener('mousedown', ()=>{ if(timer) clearInterval(timer); fire(); timer=setInterval(fire,120); }); ['mouseup','mouseleave'].forEach(ev=> btn.addEventListener(ev, ()=>{ if(timer){ clearInterval(timer); timer=null; } })); }
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
      saveBarrow(state.barrow); snapshot(state.barrow);
      rebuildScene();
      renderDbView(state.barrow);
      scheduleGridUpdate();
      window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-set', value, changed } }));
      rebuildHalos();
    }
    Log?.log('UI', 'Voxel set: applied', { value, changed });

  }

  btnEmpty?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Empty));
  btnRock?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Rock));
  btnWall?.addEventListener('click', () => applySetSelectedVoxels(VoxelType.Wall));

  function worldPointFromVoxelIndex(s, ix, iy, iz) {
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

  }

  function segAabbIntersect(p0, p1, aabb, expand) {
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

    return addedIds;
  }

  // Proposal state
  function clearProposals() {
    state._connect = state._connect || {};
    const propsCount = (state._connect.props || []).length;
    const nodeCount = (state._connect.nodes || []).length;
    const segCount = (state._connect.segs || []).length;
    Log?.log('PATH', 'proposal:clear', { props: propsCount, nodes: nodeCount, segs: segCount });
    disposeConnectMeshes(state);
    if (state._connect.gizmo && state._connect.gizmo.root) { state._connect.gizmo.root.dispose();  }
    if (state._connect.gizmo && state._connect.gizmo.parts) { for (const m of state._connect.gizmo.parts) { m.dispose(); } }
    if (state._connect.debug && state._connect.debug.marker) { state._connect.debug.marker.dispose();  }
    state._connect.props = []; state._connect.nodes = []; state._connect.segs = []; state._connect.path = null;
    // Remove from DB as well
    syncConnectPathToDb(state);
    saveBarrow(state.barrow); snapshot(state.barrow);
    window.dispatchEvent(new CustomEvent('dw:connect:update'));
    if (state._connect.pickObs) { scene.onPrePointerObservable.remove(state._connect.pickObs); ; state._connect.pickObs = null; }
    if (state._connect.editObs) { scene.onPrePointerObservable.remove(state._connect.editObs); ; state._connect.editObs = null; }
    state._connect.debug = null;
    if (btnFinalize) btnFinalize.style.display = 'none';
  }

  function createProposalMeshesFromPath(path) {
    ensureConnectState(state);
    rebuildConnectMeshes({ scene, state, path });
    if (btnFinalize) btnFinalize.style.display = 'inline-block';
    const conn = state._connect || {};
    Log?.log('PATH', 'proposal:create', {
      points: Array.isArray(conn.path) ? conn.path.length : 0,
      segs: Array.isArray(conn.segs) ? conn.segs.length : 0,
      nodes: Array.isArray(conn.nodes) ? conn.nodes.length : 0
 });

    syncConnectPathToDb(state);
    saveBarrow(state.barrow);
    window.dispatchEvent(new CustomEvent('dw:connect:update'));

  }

  function updateProposalMeshes() {
    ensureConnectState(state);
    rebuildConnectMeshes({ scene, state, path: state._connect.path || [] });
    const conn = state._connect || {};
    Log?.log('PATH', 'proposal:update', {
      points: Array.isArray(conn.path) ? conn.path.length : 0,
      segs: Array.isArray(conn.segs) ? conn.segs.length : 0,
      nodes: Array.isArray(conn.nodes) ? conn.nodes.length : 0
 });

    syncConnectPathToDb(state);
    saveBarrow(state.barrow);
    window.dispatchEvent(new CustomEvent('dw:connect:update'));

  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state?._connect?.path) {
        clearProposals(); Log?.log('UI', 'Connect: canceled proposal (Esc)', {}); ev.preventDefault(); ev.stopPropagation();
      }
    }
 });

  btnConnect?.addEventListener('click', () => {
    Log?.log('UI', 'Connect: click', {});
    const sel = Array.from(state.selection || []);
    const picks = Array.isArray(state.voxSel) ? state.voxSel : [];
    const bySpace = new Map();
    for (const p of picks) {
      if (!p || p.id == null) continue;
      if (!bySpace.has(p.id)) bySpace.set(p.id, []);
      bySpace.get(p.id).push(p);
    }

    let source = 'vox';
    if (bySpace.size < 2 && sel.length === 2) {
      for (const id of sel) {
        if (!bySpace.has(id)) bySpace.set(id, []);
      }
      source = picks.length ? 'mixed' : 'selection';
    }

    const distinct = Array.from(bySpace.keys());
    if (distinct.length !== 2) {
      Log?.log('ERROR', 'Connect: need voxels in two spaces', { uniqueSpaces: distinct.length, sel: sel.length });
      return;
    }

    const [aId, bId] = distinct;
    if (source === 'vox') Log?.log('UI', 'Connect: using voxel picks', { aId, bId });
    else if (source === 'mixed') Log?.log('UI', 'Connect: using vox/selection mix', { aId, bId });
    else Log?.log('UI', 'Connect: using selected spaces', { aId, bId });

    const byId = new Map((state?.barrow?.spaces || []).map(s => [s.id, s]));
    const A = byId.get(aId), B = byId.get(bId); if (!A || !B) return;
    function centerOfPicks(sid) {
      const arr = bySpace.get(sid) || [];
      if (!arr.length) {
        const space = byId.get(sid);
        if (!space) return null;
        return new BABYLON.Vector3(space.origin?.x || 0, space.origin?.y || 0, space.origin?.z || 0);
      }
      let sx = 0, sy = 0, sz = 0;
      for (const p of arr) { sx += p.x; sy += p.y; sz += p.z; }
      const cx = Math.round(sx / arr.length);
      const cy = Math.round(sy / arr.length);
      const cz = Math.round(sz / arr.length);
      const s = byId.get(sid);
      const world = worldPointFromVoxelIndex(s, cx, cy, cz);
      if (world) return world;
      return new BABYLON.Vector3(s?.origin?.x || 0, s?.origin?.y || 0, s?.origin?.z || 0);

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
    const newPath = path.map(p => ({ x: p.x, y: p.y, z: p.z }));
    createProposalMeshesFromPath(newPath);
    ensureConnectGizmo();

 });

  btnFinalize && (btnFinalize.onclick = () => {
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

 });

  btnTunnel?.addEventListener('click', () => {
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

 });

  // Minimal gizmo for path editing (selection + drag)
  function ensureConnectGizmo() {
    // This is a large system in eventHandler; keep minimal re-center logic here
    if (!state._connect) return; if (!state._connect.path) return; if (btnFinalize) btnFinalize.style.display = 'inline-block';
  }
}
