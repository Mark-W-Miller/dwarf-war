// Router click/drag handling: camera gestures + routing helpers
import { log } from '../util/log.mjs';
import { decompressVox, VoxelType } from '../voxels/voxelize.mjs';

function isSolidVoxel(value) {
  return value === VoxelType.Rock || value === VoxelType.Wall;
}
import { modsOf as modsOfEvent } from '../util/log.mjs';
import { pickPPNode, pickPPSegment, pickConnectGizmo, pickRotGizmo, pickMoveGizmo, pickScryBall, pickSpace, refreshPPNodeSelection } from './routerHover.mjs';
import { ensureConnectState, rebuildConnectMeshes, syncConnectPathToDb } from './connectMeshes.mjs';

// ————— Primary click actions (selection) —————
export function routerHandlePrimaryClick(e, routerState) {
  const { scene, state } = routerState;
  const sceneApi = routerState.sceneApi || state?._sceneApi || null;
  const x = scene.pointerX, y = scene.pointerY;
  const isLeft = (e && typeof e.button === 'number') ? (e.button === 0) : true;
  if (!isLeft) return false;

  const mods = { meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey };
  const metaOrCtrl = mods.meta || mods.ctrl;
  if (metaOrCtrl) {
    const seg = pickPPSegment({ scene, x, y });
    if (seg && seg.pickedMesh && insertPPNodeOnSegment({ routerState, segHit: seg, mods })) {
      return true;
    }
  }
  const forceSpaceSelection = metaOrCtrl;
  const ignorePriorityTargets = metaOrCtrl;

  // 1) PP nodes (Shift toggles, else single select) — skipped when Cmd/Ctrl held
  if (!forceSpaceSelection && !ignorePriorityTargets) {
    const pp = pickPPNode({ scene, x, y });
    if (pp && pp.pickedMesh) {
      const name = String(pp.pickedMesh.name || '');
      state._connect = state._connect || {};
      if (!(state._connect.sel instanceof Set)) state._connect.sel = new Set();
      // Clear space/voxel selections when focusing PP nodes
      if (!(state.selection instanceof Set)) state.selection = new Set(Array.isArray(state.selection) ? state.selection : []);
      const clearedSpaceSel = state.selection.size > 0;
      state.selection.clear();
      sceneApi?.disposeMoveWidget?.();
      sceneApi?.disposeRotWidget?.();
      state.voxSel = [];
      state.lastVoxPick = null;
      routerState._brush = null;
      if (clearedSpaceSel) {
        dispatchWindowEvent('dw:selectionChange', { selection: [] });
      }
      sceneApi?.disposeConnectGizmo?.();
      sceneApi?.updateContactShadowPlacement?.();
      dispatchWindowEvent('dw:transform', { kind: 'voxsel:clear' });
      if (mods.shift) {
        if (state._connect.sel.has(name)) state._connect.sel.delete(name); else state._connect.sel.add(name);
 } else {
        state._connect.sel.clear(); state._connect.sel.add(name);
      }
      refreshPPNodeSelection(routerState);
      dispatchWindowEvent('dw:connect:update');
      log('SELECT', 'pp:select', { name, shift: mods.shift });
      return true;
    }
  }

  // 2) Scry ball focus (double-click handled elsewhere; single click suppresses camera gestures)
  if (!forceSpaceSelection && !ignorePriorityTargets) {
    const scry = pickScryBall({ scene, state, x, y });
    if (scry && scry.pickedMesh) {
      log('SELECT', 'scryBall:click', { name: scry.pickedMesh?.name || 'scryBall' });
      return true;
    }
  }

  // 3) Voxels (unless Cmd/Ctrl without Shift forces space selection)
  const sp = pickSpace({ scene, state, x, y });
  if (!forceSpaceSelection && sp && sp.pickedMesh) {
    const pickedName = String(sp.pickedMesh.name || '');
    const id = pickedName.slice('space:'.length).split(':')[0];
    const space = (state?.barrow?.spaces || []).find(s => s && String(s.id) === String(id)) || null;
    const hasVox = !!(space && space.vox && space.vox.size);
    if (hasVox) {
      const stroke = routerState._brush || null;
      const hit = voxelHitAtPointerForSpaceClick(routerState, space);
      if (hit) {
        const addMode = stroke ? !!stroke.add : !!mods.shift;
        ensureVoxSelForClick(routerState, space.id, hit.ix, hit.iy, hit.iz, addMode, hit.v);
        const brushActive = !!(stroke && stroke.spaceId === space.id && stroke.active);
        log('SELECT', 'voxel:click', { id: space.id, i: hit.ix, j: hit.iy, k: hit.iz, add: addMode, brush: brushActive });
        return true;
      }
    }
  }

  // 4) Space selection (plain click selects; Shift toggles; Cmd/Ctrl supported)
  if (sp && sp.pickedMesh) {
    if (!metaOrCtrl) {
      return false;
    }
    if (state?._connect?.sel instanceof Set && state._connect.sel.size) {
      state._connect.sel.clear();
      sceneApi?.disposeConnectGizmo?.();
      dispatchWindowEvent('dw:connect:update');
    }
    const pickedName = String(sp.pickedMesh.name || '');
    const id = pickedName.slice('space:'.length).split(':')[0];
    if (!(state.selection instanceof Set)) state.selection = new Set(Array.isArray(state.selection) ? state.selection : []);
    const previouslySelected = state.selection.has(id);
    if (mods.shift) {
      if (state.selection.has(id)) {
        state.selection.delete(id);
 } else {
        state.selection.add(id);
      }
 } else {
      state.selection.clear();
      sceneApi?.disposeMoveWidget?.();
      sceneApi?.disposeRotWidget?.();
      sceneApi?.disposeConnectGizmo?.();
      sceneApi?.updateContactShadowPlacement?.();
      state.selection.add(id);
    }
    routerState._brush = null;
    const removed = mods.shift && previouslySelected && !state.selection.has(id);
    dispatchWindowEvent('dw:selectionChange', { selection: Array.from(state.selection) });
    log('SELECT', removed ? 'space:deselect' : 'space:select', { id, shift: mods.shift, meta: mods.meta || mods.ctrl });
    return true;
  }

  return false;
}

// ————— Helpers —————
function spaceHasVox({ state, id }) {
  const s = (state?.barrow?.spaces || []).find(xx => xx && xx.id === id);
  return !!(s && s.vox && s.vox.size);
}

export function classifyPointerDown({ scene, state, e }) {
  const phase = 'pre';
  const mode = state.mode || 'edit';
  const x = scene.pointerX;
  const y = scene.pointerY;
  const mods = modsOfEvent(e || {});
  const pp = pickPPNode({ scene, x, y });
  if (pp) return { phase, mode, hit: 'pp', name: pp.pickedMesh?.name || null, x, y, mods };
  const gizmo2Active = !!((state?._selectionGizmo || state?._testGizmo)?.isActive?.());
  if (!gizmo2Active) {
    const cg = pickConnectGizmo({ scene, x, y });
    if (cg) return { phase, mode, hit: 'gizmo', name: cg.pickedMesh?.name || null, x, y, mods };
    const rg = pickRotGizmo({ scene, x, y });
    if (rg) return { phase, mode, hit: 'gizmo', name: rg.pickedMesh?.name || null, x, y, mods };
    const mg = pickMoveGizmo({ scene, x, y });
    if (mg) return { phase, mode, hit: 'gizmo', name: mg.pickedMesh?.name || null, x, y, mods };
  }
  const scry = pickScryBall({ scene, state, x, y });
  if (scry) {
    const name = scry.pickedMesh?.name || 'scryBall';
    return { phase, mode, hit: 'scryball', id: name, name, x, y, mods };
  }
  const sp = pickSpace({ scene, state, x, y });
  if (sp) {
    const pickedName = String(sp.pickedMesh?.name || '');
    const id = pickedName.slice('space:'.length).split(':')[0];
    const voxelBacked = spaceHasVox({ state, id });
    return { phase, mode, hit: (voxelBacked ? 'voxel|space' : 'space'), id, x, y, mods };
  }
  return { phase, mode, hit: 'empty|camera', x, y, mods };
}

const TARGET_PREF_KEY = 'dw:ui:targetDot';
export function ensureTargetDot({ scene, camera }) {
  if (localStorage.getItem(TARGET_PREF_KEY) === '0') return;
  let dot = scene.getMeshByName('cam:targetDot');
  if (!dot) {
    const s = BABYLON.MeshBuilder.CreateSphere('cam:targetDot', { diameter: 0.24, segments: 16 }, scene);
    const m = new BABYLON.StandardMaterial('cam:targetDot:mat', scene);
    m.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.05);
    m.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    s.material = m; s.isPickable = false; s.renderingGroupId = 3;
    dot = s;
  }
  scene.onBeforeRenderObservable.add(() => {
    const d = scene.getMeshByName('cam:targetDot');
    if (!d) return;
    d.position.copyFrom(camera.target);
    const radius = (typeof camera.radius === 'number' && isFinite(camera.radius)) ? camera.radius : BABYLON.Vector3.Distance(camera.position, camera.target);
    const scale = Math.max(0.08, (radius || 1) * 0.012);
    d.scaling.set(scale, scale, scale);

 });
}

export function routerIsOverPPOrGizmo(e, routerState) {
  const { scene } = routerState;
  const x = scene.pointerX, y = scene.pointerY;
  return !!(
    pickPPNode({ scene, x, y }) ||
    pickPPSegment({ scene, x, y }) ||
    pickConnectGizmo({ scene, x, y }) ||
    pickRotGizmo({ scene, x, y }) ||
    pickMoveGizmo({ scene, x, y })
  );
}

export function routerHandleCameraDown(e, routerState) {
  const { scene, camera, canvas } = routerState;
  // Mapping: LC → rotate, RC → pan. No modifiers
  let decision = 'unknown';
  if (e.button === 0) decision = 'rotate';
  else if (e.button === 1) decision = 'pan';

  const ptr = camera?.inputs?.attached?.pointers;
  switch (decision) {
    case 'pan': {
      routerState.gesture.lastX = scene.pointerX;
      routerState.gesture.lastY = scene.pointerY;
      if (ptr && Array.isArray(ptr.buttons)) ptr._savedButtons = [...ptr.buttons];
      if (ptr && Array.isArray(ptr.buttons)) ptr.buttons = [0];
      break;
    }
    case 'rotate': {
      if (ptr && Array.isArray(ptr.buttons)) ptr._savedButtons = [...ptr.buttons];
      if (ptr && Array.isArray(ptr.buttons)) ptr.buttons = [0];
      routerState.gesture.panGuard = { saved: camera.panningSensibility };
      camera.panningSensibility = 1e9;
      break;
    }
    default: return false;
  }

  routerState.gesture.decision = decision;
  if (e.pointerId != null && canvas.setPointerCapture) {
    canvas.setPointerCapture(e.pointerId);
    routerState.gesture.ptrId = e.pointerId;
  }
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  ensureTargetDot({ scene, camera });
  log('CAMERA', decision === 'pan' ? 'start:pan' : 'start:orbit', { button: e.button });
  return true;
}

export function routerHandleCameraMove(routerState) {
  const { camera, scene, gesture } = routerState;
  if (gesture.decision === 'rotate') {
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
 } else if (gesture.decision === 'pan') {
    const lastX = (gesture.lastX ?? scene.pointerX);
    const lastY = (gesture.lastY ?? scene.pointerY);
    const dx = scene.pointerX - lastX;
    const dy = scene.pointerY - lastY;
    const sens = Math.max(1, Number(camera.panningSensibility) || 40);
    camera.inertialPanningX -= dx / sens;
    camera.inertialPanningY -= dy / sens;
    gesture.lastX = scene.pointerX;
    gesture.lastY = scene.pointerY;
  }
}

export function routerHandleCameraUp(routerState) {
  const { camera, canvas, gesture } = routerState;
  if (gesture.ptrId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(gesture.ptrId);
  const ptr = camera?.inputs?.attached?.pointers;
  if (ptr && Array.isArray(ptr._savedButtons)) { ptr.buttons = [...ptr._savedButtons]; delete ptr._savedButtons; }
  if (gesture.panGuard && typeof gesture.panGuard.saved === 'number') camera.panningSensibility = gesture.panGuard.saved;
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  routerState.gesture = { decision: null, ptrId: null, panGuard: null, lastX: 0, lastY: 0 };
}

// ————— Primary click actions (selection) —————
// Local DDA to hit a voxel in the given space at the current pointer
function voxelHitAtPointerForSpaceClick(routerState, space, options = {}) {
  const { scene, camera, state } = routerState;
  if (!space || !space.vox || !space.vox.size) return null;
  const preferEmpty = !!options.preferEmpty;
  const vox = decompressVox(space.vox);
  const nx = Math.max(1, vox.size?.x || 1);
  const ny = Math.max(1, vox.size?.y || 1);
  const nz = Math.max(1, vox.size?.z || 1);
  const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);
  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
  const roW = ray.origin, rdW = ray.direction;
  const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
  let q = BABYLON.Quaternion.Identity();
  const worldAligned = !!(space.vox && space.vox.worldAligned);
  if (!worldAligned) {
    const rx = Number(space.rotation?.x ?? 0) || 0;
    const ry = (space.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0;
    const rz = Number(space.rotation?.z ?? 0) || 0;
    q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
  }
  const rotInv = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), BABYLON.Quaternion.Inverse(q), BABYLON.Vector3.Zero());
  const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
  const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
  const minX = -(nx * res) / 2, maxX = +(nx * res) / 2;
  const minY = -(ny * res) / 2, maxY = +(ny * res) / 2;
  const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
  const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
  const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
  const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
  const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
  const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
  const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
  if (!(tmax >= Math.max(0, tmin))) return null;
  const EPS = 1e-6; let t = Math.max(tmin, 0) + EPS;
  const toIdx = (x, y, z) => ({ ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))), iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))), iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))) });
  let pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
  let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
  const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0);
  const stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0);
  const stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
  const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
  let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
  let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
  let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
  const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity;
  const tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity;
  const tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
  let hideTop = 0;  hideTop = Math.max(0, Math.min(ny, Math.floor(Number(space.voxExposeTop || 0) || 0)));
  const yCut = ny - hideTop;
  const data = Array.isArray(vox.data) ? vox.data : [];
  let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
  let firstSolid = null;
  let emptyBeforeSolid = false;
  let seenSolid = false;
  while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
    if (iy < yCut) {
      const flat = ix + nx * (iy + ny * iz);
      const raw = Number(data[flat] ?? VoxelType.Uninstantiated);
      const v = Number.isFinite(raw) ? raw : VoxelType.Uninstantiated;
      const isSolid = v === VoxelType.Rock || v === VoxelType.Wall;
      const isEmpty = v === VoxelType.Empty;
      if (isSolid) {
        if (!preferEmpty) {
          return { ix, iy, iz, v, emptyBeforeSolid };
        }
        if (!firstSolid) firstSolid = { ix, iy, iz, v, emptyBeforeSolid };
        seenSolid = true;
 } else if (preferEmpty && seenSolid && isEmpty) {
        return { ix, iy, iz, v, emptyBeforeSolid };
 } else if (!seenSolid) {
        emptyBeforeSolid = true;
      }
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
    else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
    else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
  }
  if (preferEmpty && firstSolid) return firstSolid;
  return null;
}

function ensureVoxSelForClick(routerState, spaceId, ix, iy, iz, addMode, voxelValue = null) {
  const { state } = routerState;
  if (!state) {
    log('VOXEL_SELECT', 'error:no-state', { spaceId, ix, iy, iz });
    return;
  }
  if (!Array.isArray(state.voxSel)) state.voxSel = [];
  const stroke = routerState?._brush;
  const isStroke = !!(stroke && stroke.active && stroke.spaceId === spaceId);
  const shouldClearThisCall = !addMode && (!isStroke || stroke.justStarted === true);
  log('VOXEL_SELECT', 'pre-update', {
    id: spaceId,
    addMode,
    isStroke,
    justStarted: stroke ? stroke.justStarted === true : null,
    existingCount: Array.isArray(state.voxSel) ? state.voxSel.length : 0,
    selectionCount: state.selection instanceof Set ? state.selection.size : Array.isArray(state.selection) ? state.selection.length : 0
 });
  // Clear picks for this space unless in add (brush-extend) mode or continuing an active stroke
  if (shouldClearThisCall) state.voxSel = state.voxSel.filter(p => p && p.id !== spaceId);
  // Avoid duplicates
  const exists = state.voxSel.some(p => p && p.id === spaceId && p.x === ix && p.y === iy && p.z === iz);
  if (!exists) {
    state.voxSel.push({ id: spaceId, x: ix, y: iy, z: iz });
    log('VOXEL_SELECT', 'update', {
      id: spaceId,
      size: state.voxSel.length,
      newest: { id: spaceId, x: ix, y: iy, z: iz, v: voxelValue }
 });
 } else {
    log('VOXEL_SELECT', 'duplicate', {
      id: spaceId,
      coords: { x: ix, y: iy, z: iz },
      size: state.voxSel.length
 });
  }

  const prevSelArr = state.selection instanceof Set
    ? Array.from(state.selection)
    : Array.isArray(state.selection) ? state.selection.slice() : [];
  if (!(state.selection instanceof Set)) state.selection = new Set(prevSelArr);
  let cleared = false;
  if (state.selection.size) {
    state.selection.clear();
    log('VOXEL_SELECT', 'selection:cleared', { prev: prevSelArr });
    cleared = true;
 } else if (prevSelArr.length) {
    cleared = true;
  }
  if (cleared && prevSelArr.length) {
    log('VOXEL_SELECT', 'selection:event', { selection: [] });
    dispatchWindowEvent('dw:selectionChange', { selection: [] });
  }

  const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
  const space = spaces.find((s) => s && String(s.id) === String(spaceId));
  if (space) {
    space.voxPick = { x: ix, y: iy, z: iz, v: voxelValue };
  }
  state.lastVoxPick = { id: spaceId, x: ix, y: iy, z: iz, v: voxelValue };
  dispatchWindowEvent('dw:voxelPick', { id: spaceId, i: ix, j: iy, k: iz, v: voxelValue });

  dispatchWindowEvent('dw:transform', { kind: 'voxsel', id: spaceId, x: ix, y: iy, z: iz, add: addMode });

  if (isStroke && stroke.justStarted) {
    stroke.justStarted = false;
  }
}

export function routerBeginVoxelStroke(e, routerState, route) {
  if (!routerState || !route || route.hit !== 'voxel|space') return false;
  if (e && typeof e.button === 'number' && e.button !== 0) return false;
  if (e && (e.metaKey || e.ctrlKey)) return false;
  const spaceId = route.id;
  const { state } = routerState;
  const space = (state?.barrow?.spaces || []).find(s => s && String(s.id) === String(spaceId)) || null;
  if (!space || !space.vox || !space.vox.size) return false;
  const stroke = {
    active: true,
    spaceId: space.id,
    add: !!(e && e.shiftKey),
    button: 0,
    justStarted: true,
    allowEmptyAfterSolid: false,
    anchor: null
 };
  routerState._brush = stroke;
  const hit = voxelHitAtPointerForSpaceClick(routerState, space);
  if (!hit) {
    log('VOXEL_SELECT', 'stroke-miss', { spaceId: space.id, add: stroke.add, pointer: { x: scene.pointerX, y: scene.pointerY } });
    routerState._brush = null;
    return true;
  }
  stroke.anchor = { ix: hit.ix, iy: hit.iy, iz: hit.iz };
  stroke.allowEmptyAfterSolid = isSolidVoxel(hit.v);
  ensureVoxSelForClick(routerState, space.id, hit.ix, hit.iy, hit.iz, stroke.add, hit.v);
  return true;
}

export function routerHandleBrushMove(routerState) {
  const { _brush } = routerState || {};
  if (!_brush || !_brush.active || _brush.button !== 0) return;
  const { scene, state } = routerState;
  const space = (state?.barrow?.spaces || []).find(s => s && String(s.id) === String(_brush.spaceId)) || null;
  if (!space || !space.vox || !space.vox.size) return;
  const allowEmpty = !!_brush.allowEmptyAfterSolid;
  const hit = voxelHitAtPointerForSpaceClick(routerState, space, { preferEmpty: allowEmpty });
  if (!hit) {
    log('VOXEL_SELECT', 'brush-miss', { spaceId: space.id, add: !!_brush.add, pointer: { x: scene.pointerX, y: scene.pointerY } });
    return;
  }
  let anchor = _brush.anchor;
  if (!anchor && routerState._lastNonSolidHit && routerState._lastNonSolidHit.spaceId === space.id) {
    anchor = { ...routerState._lastNonSolidHit.voxel };
    _brush.anchor = anchor;
    log('VOXEL_SELECT', 'brush:anchor:fromEmpty', { space: space.id, anchor });
  }

  if (anchor) {
    const maxDelta = Math.max(
      Math.abs(hit.ix - anchor.ix),
      Math.abs(hit.iy - anchor.iy),
      Math.abs(hit.iz - anchor.iz)
    );
    const limit = allowEmpty ? 3 : 4;
    if (maxDelta > limit) {
      log('VOXEL_SELECT', 'brush:skip:nonAdjacent', {
        id: space.id,
        anchor,
        hit: { ix: hit.ix, iy: hit.iy, iz: hit.iz, v: hit.v },
        limit,
        pointer: { x: scene.pointerX, y: scene.pointerY }
 });
      return;
    }
  }

  if (!allowEmpty && isSolidVoxel(hit.v)) {
    _brush.allowEmptyAfterSolid = true;
  }
  ensureVoxSelForClick(routerState, space.id, hit.ix, hit.iy, hit.iz, !!_brush.add, hit.v);
  if (!isSolidVoxel(hit.v)) {
    routerState._lastNonSolidHit = {
      spaceId: space.id,
      voxel: { ix: hit.ix, iy: hit.iy, iz: hit.iz }
 };
  }
  _brush.anchor = { ix: hit.ix, iy: hit.iy, iz: hit.iz };
}

function dispatchWindowEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function insertPPNodeOnSegment({ routerState, segHit, mods }) {
  const { scene, state } = routerState || {};
  if (!scene || !state || !segHit) return false;
  const connect = ensureConnectState(state);
  const path = Array.isArray(connect?.path) ? connect.path : null;
  if (!path || path.length < 2) return false;

  const meshName = String(segHit?.pickedMesh?.name || '');
  if (!meshName.startsWith('connect:seg:')) return false;
  const segIndex = Number(meshName.split(':').pop());
  if (!Number.isFinite(segIndex) || segIndex < 0 || segIndex >= path.length - 1) return false;

  const picked = segHit.pickedPoint || null;
  const fallback = (() => {
    const a = path[segIndex];
    const b = path[segIndex + 1];
    if (!a || !b) return null;
    return {
      x: (Number(a.x) + Number(b.x)) / 2,
      y: (Number(a.y) + Number(b.y)) / 2,
      z: (Number(a.z) + Number(b.z)) / 2
 };

 })();
  const target = picked ? { x: picked.x, y: picked.y, z: picked.z } : fallback;
  if (!target) return false;

  const newPath = [
    ...path.slice(0, segIndex + 1),
    { x: Number(target.x) || 0, y: Number(target.y) || 0, z: Number(target.z) || 0 },
    ...path.slice(segIndex + 1)
  ];

  rebuildConnectMeshes({ scene, state, path: newPath });
  const updated = ensureConnectState(state);
  const newNodeName = `connect:node:${segIndex + 1}`;
  const newSel = new Set([newNodeName]);
  updated.sel = newSel;
  state._connect.sel = newSel;
  refreshPPNodeSelection(routerState);
  syncConnectPathToDb(state);

  const sceneApi = routerState.sceneApi || state?._sceneApi || null;
  sceneApi?.ensureConnectGizmoFromSel?.();
  sceneApi?.updateContactShadowPlacement?.();

  dispatchWindowEvent('dw:connect:update');
  log('SELECT', 'pp:insertNode', {
    segment: segIndex,
    node: newNodeName,
    meta: !!mods?.meta,
    ctrl: !!mods?.ctrl
 });
  scene.render();
  return true;

}
