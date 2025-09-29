// Unified input router: logs route decisions and owns camera gestures.
// Extracted from routeDebug.mjs and renamed for clarity.
import { log, logErr } from '../util/log.mjs';

// ——————————— Public API (top) ———————————
export function initRouter(ctx) {
  // Single Babylon onPointerObservable for logging + camera gestures
  const { scene, engine, camera, state, Log } = ctx;
  const canvas = engine.getRenderingCanvas();
  const routerState = { scene, engine, camera, state, Log, canvas,
    gesture: { decision: null, ptrId: null, panGuard: null, lastX: 0, lastY: 0 },
    hover: { kind: null, axis: null, mat: null },
    hoverSpace: { id: null, mesh: null },
    ppHover: { mat: null, name: null }
  };
  scene.onPointerObservable.add((pi) => routerOnPointer(pi, routerState));
  window.addEventListener('dw:selectionChange', () => {
    clearSpaceHover(routerState);
  });
}

// ——————————— Helpers ———————————
function routerLogsEnabled() {
  const v = localStorage.getItem('dw:dev:routerLogs');
  return (v ?? '1') === '1';
}
function modsOfEvent(e) {
  return {
    cmd: !!e.metaKey,
    shift: !!e.shiftKey,
    ctrl: !!e.ctrlKey,
    alt: !!e.altKey,
  };
}

// ——————————— Pickers ———————————
function pickPPNode({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('connect:node:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
function pickConnectGizmo({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('connectGizmo:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
function pickRotGizmo({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('rotGizmo:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
function pickMoveGizmo({ scene, x, y }) {
  const md = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:')
  );
  const mg = md?.hit ? md : scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('moveGizmo:')
  );
  return mg?.hit && mg.pickedMesh ? mg : null;
}
function pickSpace({ scene, state, x, y }) {
  // Primary: triangle-accurate pick against base space meshes only: `space:<id>`
  const r = scene.pick(x, y,
    (m) => {
      const n = m && m.name ? String(m.name) : '';
      if (!n.startsWith('space:')) return false;
      // Exclude labels and voxel part helpers (only base mesh `space:<id>`)
      const nextColon = n.indexOf(':', 'space:'.length);
      return nextColon === -1;
    }
  );
  if (r?.hit && r.pickedMesh) {
    if (routerLogsEnabled()) {
      const name = String(r.pickedMesh.name || '');
      log('PICK', 'space:hit:primary', { name, distance: r.distance ?? null, x, y });
    }
    return r;
  }
  // Fallback: ray vs. space meshes using Babylon's Ray.intersectsMesh
  // Helps when some materials/geometries interfere with predicate picks
  const enableFallback = (() => { try { return localStorage.getItem('dw:dev:spaceRayFallback') === '1'; } catch { return false; } })();
  if (!enableFallback) return null;
  if (!state || !state.built || !Array.isArray(state.built.spaces)) return null;
  const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), scene.activeCamera);
  let best = null; let hits = 0;
  for (const entry of state.built.spaces) {
    const mesh = entry?.mesh; if (!mesh) continue;
    const info = ray.intersectsMesh(mesh, true);
    if (info?.hit) {
      hits++;
      if (!best || info.distance < best.distance) {
        best = { hit: true, pickedMesh: mesh, distance: info.distance };
      }
    }
  }
  if (routerLogsEnabled()) {
    if (best) {
      const name = String(best.pickedMesh?.name || '');
      log('PICK', 'space:hit:fallback', { name, distance: best.distance ?? null, hits, x, y });
    } else {
      log('PICK', 'space:miss:both', { x, y, spaces: (state.built.spaces||[]).length });
    }
  }
  return best || null;
}
function spaceHasVox({ state, id }) {
  const s = (state?.barrow?.spaces || []).find((xx) => xx && xx.id === id);
  return !!(s && s.vox && s.vox.size);
}

// ——————————— Classifier ———————————
function classifyPointerDown({ scene, state, e }) {
  const phase = 'pre';
  const mode = state.mode || 'edit';
  const x = scene.pointerX;
  const y = scene.pointerY;
  const mods = modsOfEvent(e || {});
  const pp = pickPPNode({ scene, x, y });
  if (pp) return { phase, mode, hit: 'pp', name: pp.pickedMesh?.name || null, x, y, mods };
  const cg = pickConnectGizmo({ scene, x, y });
  if (cg) return { phase, mode, hit: 'gizmo', name: cg.pickedMesh?.name || null, x, y, mods };
  const rg = pickRotGizmo({ scene, x, y });
  if (rg) return { phase, mode, hit: 'gizmo', name: rg.pickedMesh?.name || null, x, y, mods };
  const mg = pickMoveGizmo({ scene, x, y });
  if (mg) return { phase, mode, hit: 'gizmo', name: mg.pickedMesh?.name || null, x, y, mods };
  const sp = pickSpace({ scene, state, x, y });
  if (sp) {
    const pickedName = String(sp.pickedMesh?.name || '');
    const id = pickedName.slice('space:'.length).split(':')[0];
    const voxelBacked = spaceHasVox({ state, id });
    return { phase, mode, hit: voxelBacked ? 'voxel|space' : 'space', id, x, y, mods };
  }
  return { phase, mode, hit: 'empty|camera', x, y, mods };
}

function ensureTargetDot({ scene, camera }) {
  let dot = scene.getMeshByName('cam:targetDot');
  if (!dot) {
    const s = BABYLON.MeshBuilder.CreateSphere(
      'cam:targetDot',
      { diameter: 0.6, segments: 16 },
      scene
    );
    const m = new BABYLON.StandardMaterial('cam:targetDot:mat', scene);
    m.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.05);
    m.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    s.material = m;
    s.isPickable = false;
    s.renderingGroupId = 3;
  }
  scene.onBeforeRenderObservable.add(() => {
    const d = scene.getMeshByName('cam:targetDot');
    if (d) d.position.copyFrom(camera.target);
  });
}
// ——————————— Router (flat, Java-style) ———————————

function routerOnPointer(pi, routerState) {
  try {
    const { scene, camera, state, Log, canvas } = routerState;
    const t = pi.type;
    const e = pi.event || window.event;
    if (t === BABYLON.PointerEventTypes.POINTERDOWN) {
      if (routerLogsEnabled()) {
        const route = classifyPointerDown({ scene, state, e });
        log('ROUTER', 'route', route);
      }
      if (routerIsOverPPOrGizmo(e, routerState)) {
        camera.inputs?.attached?.pointers?.detachControl(canvas);
        if (e.pointerId != null && canvas.setPointerCapture)
          canvas.setPointerCapture(e.pointerId);
        log('GIZMO', 'pre-capture:router', { pointerId: e.pointerId ?? null });
        return;
      }
      routerHandleCameraDown(e, routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERMOVE) {
      routerHandleCameraMove(routerState);
      routerHandleHover(routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERUP) {
      routerHandleCameraUp(routerState);
    }
  } catch (e) {
    logErr('router:onPointer', e);
  }
}

function routerHandleCameraDown(e, routerState) {
  const { scene, camera, canvas } = routerState;
  // Mapping (per user): LC → rotate, RC → pan. No modifiers considered.
  let decision = 'unknown';
  if (e.button === 0) decision = 'rotate';
  else if (e.button === 2) decision = 'pan';

  const ptr = camera?.inputs?.attached?.pointers;
  switch (decision) {
    case 'pan': {
      // Manual pan using pointer deltas. While panning on RC, disable camera rotation by switching allowed rotate button.
      routerState.gesture.lastX = scene.pointerX;
      routerState.gesture.lastY = scene.pointerY;
      if (ptr && Array.isArray(ptr.buttons)) ptr._savedButtons = [...ptr.buttons];
      if (ptr && Array.isArray(ptr.buttons)) ptr.buttons = [0];
      break;
    }
    case 'rotate': {
      // Allow rotation on LC by temporarily switching the allowed rotate button to 0, then restore on pointer up.
      if (ptr && Array.isArray(ptr.buttons)) ptr._savedButtons = [...ptr.buttons];
      if (ptr && Array.isArray(ptr.buttons)) ptr.buttons = [0];
      // Guard against stray pan inertia while rotating
      routerState.gesture.panGuard = { saved: camera.panningSensibility };
      camera.panningSensibility = 1e9;
      break;
    }
    default: {
      // Not a camera gesture we own (e.g., LC). Let other handlers run.
      return false;
    }
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

function routerHandleCameraMove(routerState) {
  const { camera, scene, gesture } = routerState;
  if (gesture.decision === 'rotate') {
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
  } else if (gesture.decision === 'pan') {
    // Manual pan fallback using pointer deltas (invert to match ArcRotateCamera)
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
  // log('CAMERA', 'drag', { decision: gesture.decision, x: scene.pointerX, y: scene.pointerY });
}

// ——————————— Hover Highlight (PP > Gizmo > Voxels) ———————————
function routerHandleHover(routerState) {
  const { scene, state, gesture } = routerState;
  // Do not update hover while camera gesture is active
  if (gesture?.decision) {
    // Ensure any prior hover visuals are cleared while dragging camera
    // Order matters: clear PP first, then others, so PP color restores correctly.
    clearPPHover(routerState);
    clearGizmoHover(routerState);
    clearSpaceHover(routerState);
    return;
  }
  const x = scene.pointerX, y = scene.pointerY;
    // 1) PP nodes have priority — highlight node and clear gizmo hover
    const pp = pickPPNode({ scene, x, y });
    if (pp && pp.pickedMesh) {
      clearSpaceHover(routerState);
      return setHoverPPNode(routerState, pp.pickedMesh);
    }
    // 2) Gizmo parts
    const mg = pickMoveGizmo({ scene, x, y });
    if (mg && mg.pickedMesh) {
      const nm = String(mg.pickedMesh.name || '');
      if (nm.startsWith('moveGizmo:disc:')) {
        clearPPHover(routerState);
        clearSpaceHover(routerState);
        return setHoverMoveDisc(routerState, mg.pickedMesh);
      }
      if (nm.startsWith('moveGizmo:')) {
        clearPPHover(routerState);
        clearSpaceHover(routerState);
        return setHoverMoveAxis(routerState, mg.pickedMesh);
      }
    }
    const rg = pickRotGizmo({ scene, x, y });
    if (rg && rg.pickedMesh) {
      const nm = String(rg.pickedMesh.name || '');
      const ax = nm.startsWith('rotGizmo:Y:') ? 'y' : nm.startsWith('rotGizmo:X:') ? 'x' : nm.startsWith('rotGizmo:Z:') ? 'z' : null;
      if (ax) {
        clearPPHover(routerState);
        clearSpaceHover(routerState);
        return setHoverRotAxis(routerState, ax);
      }
    }
    // 2.5) Spaces: if over an unselected space, draw its OBB wireframe
    const sp = pickSpace({ scene, state, x, y });
    if (sp && sp.pickedMesh) {
      const pickedName = String(sp.pickedMesh.name || '');
      const id = pickedName.slice('space:'.length).split(':')[0];
      const isSelected = !!(routerState?.state?.selection && routerState.state.selection.has(id));
      if (!isSelected) {
        clearPPHover(routerState);
        return setHoverSpaceOutline(routerState, id);
      }
    }
    // 3) Voxels (fallback): clear all hovers so voxel hover (handled elsewhere) is visible
    // Log miss-of-everything with previous hover space id for diagnosis
    const prevSpaceId = routerState?.hoverSpace?.id || null;
    log('HOVER', 'miss:all', { x, y, prevSpaceId, prevHoverKind: routerState?.hover?.kind || null });
    // Important: clear PP first, else gizmo clear would reset hover.kind and skip PP restore.
    clearPPHover(routerState);
    clearGizmoHover(routerState);
    clearSpaceHover(routerState);
    return;
}

function clearGizmoHover(routerState) {
  const { scene, hover } = routerState;
  if (hover?.kind === 'rotAxis') { dimRotRings(scene); }
  else if (hover?.kind === 'moveAxis') { resetMoveMat(hover.mat); }
  else if (hover?.kind === 'moveDisc') { resetDiscMat(hover.mat); }
  if (hover?.kind) { log('HOVER', 'gizmo:clear', { kind: hover.kind, axis: hover.axis || null }); }
  routerState.hover = { kind: null, axis: null, mat: null };
}

// — PP node hover (connect:node:*)
function ppNameFromMat(mat) {
  const nm = String(mat?.name || '');
  // Expected: connect:node:<i>:mat → connect:node:<i>
  return nm.startsWith('connect:node:') ? nm.replace(/:mat$/i, '') : null;
}
function setPPNodeColorForSelection(routerState, mat) {
  const name = ppNameFromMat(mat);
  const sel = (routerState?.state?._connect?.sel instanceof Set) ? routerState.state._connect.sel : null;
  const isSelected = !!(name && sel && sel.has(name));
  // Colors: selected = red, unselected = blue
  const red = new BABYLON.Color3(0.95, 0.2, 0.2);
  const blue = new BABYLON.Color3(0.6, 0.9, 1.0);
  mat.emissiveColor = isSelected ? red : blue;
}
function setHoverPPNode(routerState, mesh) {
  clearGizmoHover(routerState);
  const mat = mesh?.material || null;
  if (!mat) return clearPPHover(routerState);
  // No change
  if (routerState.ppHover?.mat === mat) return;
  // If switching PP node, restore previous first
  if (routerState.ppHover?.mat && routerState.ppHover.mat !== mat) {
    setPPNodeColorForSelection(routerState, routerState.ppHover.mat);
  }
  const orange = new BABYLON.Color3(0.95, 0.55, 0.12);
  mat.emissiveColor = orange;
  const name = ppNameFromMat(mat) || String(mesh?.name || '');
  routerState.ppHover = { mat, name };
  log('HOVER', 'pp:hover', { name, orange: true });
}
function clearPPHover(routerState) {
  const prev = routerState?.ppHover || { mat: null, name: null };
  if (!prev.mat) {
    log('HOVER_DETAIL', 'pp:clear', { had: false });
    return;
  }
  const name = prev.name || ppNameFromMat(prev.mat) || null;
  const sel = (routerState?.state?._connect?.sel instanceof Set) ? routerState.state._connect.sel : null;
  const selected = !!(name && sel && sel.has(name));
  setPPNodeColorForSelection(routerState, prev.mat);
  routerState.ppHover = { mat: null, name: null };
  log('HOVER_DETAIL', 'pp:clear', { had: true, name, selected });
}

// — Space OBB outline hover
function setHoverSpaceOutline(routerState, id) {
  const { scene, state } = routerState;
  if (routerState.hoverSpace?.id === id && routerState.hoverSpace.mesh && !routerState.hoverSpace.mesh.isDisposed?.()) return; // unchanged
  clearSpaceHover(routerState);
  const s = (state?.barrow?.spaces || []).find(
    (x) => x && String(x.id) === String(id)
  );
  if (!s) return;
  const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
  const w = (s.size?.x || 0) * sr,
    h = (s.size?.y || 0) * sr,
    d = (s.size?.z || 0) * sr;
  const hx = w / 2,
    hy = h / 2,
    hz = d / 2;
  const cx = s.origin?.x || 0,
    cy = s.origin?.y || 0,
    cz = s.origin?.z || 0;
  const rx = Number(s.rotation?.x ?? 0) || 0;
  const ry =
    (s.rotation && typeof s.rotation.y === 'number')
      ? Number(s.rotation.y)
      : Number(s.rotY || 0) || 0;
  const rz = Number(s.rotation?.z ?? 0) || 0;
  const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
  const mtx = BABYLON.Matrix.Compose(
    new BABYLON.Vector3(1, 1, 1),
    q,
    new BABYLON.Vector3(cx, cy, cz)
  );
  const locals = [
    new BABYLON.Vector3(-hx, -hy, -hz),
    new BABYLON.Vector3(+hx, -hy, -hz),
    new BABYLON.Vector3(-hx, +hy, -hz),
    new BABYLON.Vector3(+hx, +hy, -hz),
    new BABYLON.Vector3(-hx, -hy, +hz),
    new BABYLON.Vector3(+hx, -hy, +hz),
    new BABYLON.Vector3(-hx, +hy, +hz),
    new BABYLON.Vector3(+hx, +hy, +hz),
  ];
  const cs = locals.map((v) => BABYLON.Vector3.TransformCoordinates(v, mtx));
  const edges = [
    [cs[0], cs[1]],
    [cs[1], cs[3]],
    [cs[3], cs[2]],
    [cs[2], cs[0]],
    [cs[4], cs[5]],
    [cs[5], cs[7]],
    [cs[7], cs[6]],
    [cs[6], cs[4]],
    [cs[0], cs[4]],
    [cs[1], cs[5]],
    [cs[2], cs[6]],
    [cs[3], cs[7]],
  ];
  const lines = BABYLON.MeshBuilder.CreateLineSystem(
    `hover:obb:${id}`,
    { lines: edges },
    scene
  );
  lines.isPickable = false;
  lines.renderingGroupId = 3;
  lines.color = new BABYLON.Color3(0.28, 0.62, 0.95);
  routerState.hoverSpace = { id, mesh: lines };
  log('HOVER', 'space:hover', { id });
}
function clearSpaceHover(routerState) {
  const prev = routerState?.hoverSpace || { id: null, mesh: null };
  const had = !!(prev.mesh && !prev.mesh.isDisposed?.());
  if (had) prev.mesh.dispose();
  routerState.hoverSpace = { id: null, mesh: null };
  log('HOVER', 'space:clear', { had, prevId: prev.id || null });
}

// — Gizmo: Rotation ring hover
function setHoverRotAxis(routerState, axis) {
  const { scene, hover } = routerState;
  if (hover?.kind === 'rotAxis' && hover.axis === axis) return; // unchanged
  dimRotRings(scene);
  setRotRingActive(scene, axis);
  log('HOVER', 'gizmo:rot', { axis });
  routerState.hover = { kind: 'rotAxis', axis, mat: null };
}
function findRotRingMats(scene) {
  const mats = { x: null, y: null, z: null };
  for (const m of scene.meshes || []) {
    const n = String(m?.name || '');
    if (!n.startsWith('rotGizmo:')) continue;
    if (!m.material) continue;
    if (n.startsWith('rotGizmo:X:')) mats.x = m.material;
    else if (n.startsWith('rotGizmo:Y:')) mats.y = m.material;
    else if (n.startsWith('rotGizmo:Z:')) mats.z = m.material;
  }
  return mats;
}
function ensureBaseColor(metaMat) {
  if (!metaMat) return;
  metaMat.metadata = metaMat.metadata || {};
  if (!metaMat.metadata.baseColor && metaMat.emissiveColor)
    metaMat.metadata.baseColor = metaMat.emissiveColor.clone();
}
function dimRotRings(scene) {
  const mats = findRotRingMats(scene);
  const kDim = 0.35;
  for (const key of ['x', 'y', 'z']) {
    const m = mats[key];
    if (!m) continue;
    ensureBaseColor(m);
    const base = m.metadata?.baseColor || m.emissiveColor || new BABYLON.Color3(1, 1, 1);
    m.emissiveColor = base.scale(kDim);
    m.diffuseColor = base.scale(0.05 + 0.15 * kDim);
  }
}
function setRotRingActive(scene, axis) {
  const mats = findRotRingMats(scene);
  const kActive = 1.1,
    kDim = 0.35;
  for (const key of ['x', 'y', 'z']) {
    const m = mats[key];
    if (!m) continue;
    ensureBaseColor(m);
    const base = m.metadata?.baseColor || m.emissiveColor || new BABYLON.Color3(1, 1, 1);
    const k = key === axis ? kActive : kDim;
    m.emissiveColor = base.scale(k);
    m.diffuseColor = base.scale(0.05 + 0.15 * k);
  }
}

// — Gizmo: Move arrow hover
function setHoverMoveAxis(routerState, mesh) {
  const { hover } = routerState;
  const mat = mesh?.material || null;
  if (!mat) return clearGizmoHover(routerState);
  if (hover?.kind === 'moveAxis' && hover.mat === mat) return; // unchanged
  clearGizmoHover(routerState);
  ensureBaseColor(mat);
  const base = mat.metadata?.baseColor || mat.emissiveColor || new BABYLON.Color3(1, 1, 1);
  const k = 1.35;
  mat.emissiveColor = base.scale(k);
  mat.diffuseColor = base.scale(0.25);
  let axis = null;
  const nm = String(mesh?.name || '');
  if (nm.startsWith('moveGizmo:x:') || nm.startsWith('moveGizmo:X:')) axis = 'x';
  else if (nm.startsWith('moveGizmo:y:') || nm.startsWith('moveGizmo:Y:')) axis = 'y';
  else if (nm.startsWith('moveGizmo:z:') || nm.startsWith('moveGizmo:Z:')) axis = 'z';
  log('HOVER', 'gizmo:moveAxis', { name: nm, axis });
  routerState.hover = { kind: 'moveAxis', axis: null, mat };
}
function resetMoveMat(mat) {
  if (!mat) return;
  const base = mat.metadata?.baseColor || null;
  if (base) {
    mat.emissiveColor = base.clone();
    mat.diffuseColor = base.scale(0.25);
  }
}

// — Gizmo: Move disc hover
function setHoverMoveDisc(routerState, mesh) {
  const { hover } = routerState;
  const mat = mesh?.material || null;
  if (!mat) return clearGizmoHover(routerState);
  if (hover?.kind === 'moveDisc' && hover.mat === mat) return; // unchanged
  clearGizmoHover(routerState);
  mat.metadata = mat.metadata || {};
  if (mat.emissiveColor && !mat.metadata.baseColor)
    mat.metadata.baseColor = mat.emissiveColor.clone();
  if (typeof mat.alpha === 'number' && !('baseAlpha' in mat.metadata))
    mat.metadata.baseAlpha = mat.alpha;
  const base = mat.metadata?.baseColor || mat.emissiveColor || new BABYLON.Color3(0.12, 0.42, 0.85);
  mat.emissiveColor = base.scale(1.35);
  if (typeof mat.alpha === 'number')
    mat.alpha = Math.min(0.5, (mat.metadata.baseAlpha ?? mat.alpha) * 1.6);
  log('HOVER', 'gizmo:moveDisc', { name: String(mesh?.name || '') });
  routerState.hover = { kind: 'moveDisc', axis: null, mat };
}
function resetDiscMat(mat) {
  if (!mat) return;
  const base = mat.metadata?.baseColor || null;
  if (base) mat.emissiveColor = base.clone();
  if ('baseAlpha' in (mat.metadata || {})) mat.alpha = mat.metadata.baseAlpha;
}

function routerHandleCameraUp(routerState) {
  const { camera, canvas, gesture } = routerState;
  // Release capture
  if (gesture.ptrId != null && canvas.releasePointerCapture) {
    canvas.releasePointerCapture(gesture.ptrId);
  }
  // Restore any temporary camera dynamics
  if (gesture.panGuard && typeof gesture.panGuard.saved === 'number') {
    camera.panningSensibility = gesture.panGuard.saved;
  }
  // Restore pointer input rotate buttons if we changed them
  const ptr = camera?.inputs?.attached?.pointers;
  if (ptr && Array.isArray(ptr._savedButtons)) {
    ptr.buttons = [...ptr._savedButtons];
    delete ptr._savedButtons;
  }
  // Ensure camera input remains attached for next gesture
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  // Reset gesture state
  routerState.gesture = { decision: null, ptrId: null, panGuard: null, lastX: 0, lastY: 0 };
}

function routerIsOverPPOrGizmo(e, routerState) {
  const { scene } = routerState;
  const x = scene.pointerX, y = scene.pointerY;
  return !!(
    pickPPNode({ scene, x, y }) ||
    pickConnectGizmo({ scene, x, y }) ||
    pickRotGizmo({ scene, x, y }) ||
    pickMoveGizmo({ scene, x, y })
  );
}

// Re-export helpers used elsewhere (optional)
export { classifyPointerDown };
