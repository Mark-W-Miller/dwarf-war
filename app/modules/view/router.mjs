// Unified input router: logs route decisions and owns camera gestures.
// Extracted from routeDebug.mjs and renamed for clarity.
import { log } from '../util/log.mjs';

// ——————————— Public API (top) ———————————
export function initRouter(ctx) {
  // Single Babylon onPointerObservable for logging + camera gestures
  const { scene, engine, camera, state, Log } = ctx;
  const canvas = engine.getRenderingCanvas();
  const routerState = { scene, engine, camera, state, Log, canvas, gesture: { decision: null, ptrId: null, panGuard: null } };
  scene.onPointerObservable.add((pi) => routerOnPointer(pi, routerState));
}

// ——————————— Helpers ———————————
function routerLogsEnabled() { try { return (localStorage.getItem('dw:dev:routerLogs') ?? '1') === '1'; } catch { return true; } }
function modsOfEvent(e) { return { cmd: !!e.metaKey, shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey }; }

// ——————————— Pickers ———————————
function pickPPNode({ scene, x, y }) { try { const r = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('connect:node:')); return (r?.hit && r.pickedMesh) ? r : null; } catch { return null; } }
function pickConnectGizmo({ scene, x, y }) { try { const r = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('connectGizmo:')); return (r?.hit && r.pickedMesh) ? r : null; } catch { return null; } }
function pickRotGizmo({ scene, x, y }) { try { const r = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('rotGizmo:')); return (r?.hit && r.pickedMesh) ? r : null; } catch { return null; } }
function pickMoveGizmo({ scene, x, y }) { try { const md = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:')); const mg = md?.hit ? md : scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('moveGizmo:')); return (mg?.hit && mg.pickedMesh) ? mg : null; } catch { return null; } }
function pickSpace({ scene, x, y }) { try { const r = scene.pick(x, y, (m) => m && typeof m.name === 'string' && m.name.startsWith('space:')); return (r?.hit && r.pickedMesh) ? r : null; } catch { return null; } }
function spaceHasVox({ state, id }) { try { const s = (state?.barrow?.spaces || []).find(xx => xx && xx.id === id); return !!(s && s.vox && s.vox.size); } catch { return false; } }

// ——————————— Classifier ———————————
function classifyPointerDown({ scene, state, e }) {
  const phase = 'pre'; const mode = state.mode || 'edit'; const x = scene.pointerX; const y = scene.pointerY; const mods = modsOfEvent(e || {});
  const pp = pickPPNode({ scene, x, y }); if (pp) return { phase, mode, hit: 'pp', name: pp.pickedMesh?.name || null, x, y, mods };
  const cg = pickConnectGizmo({ scene, x, y }); if (cg) return { phase, mode, hit: 'gizmo', name: cg.pickedMesh?.name || null, x, y, mods };
  const rg = pickRotGizmo({ scene, x, y }); if (rg) return { phase, mode, hit: 'gizmo', name: rg.pickedMesh?.name || null, x, y, mods };
  const mg = pickMoveGizmo({ scene, x, y }); if (mg) return { phase, mode, hit: 'gizmo', name: mg.pickedMesh?.name || null, x, y, mods };
  const sp = pickSpace({ scene, x, y }); if (sp) { const pickedName = String(sp.pickedMesh?.name || ''); const id = pickedName.slice('space:'.length).split(':')[0]; const voxelBacked = spaceHasVox({ state, id }); return { phase, mode, hit: (voxelBacked ? 'voxel|space' : 'space'), id, x, y, mods }; }
  return { phase, mode, hit: 'empty|camera', x, y, mods };
}

function ensureTargetDot({ scene, camera }) {
  try {
    let dot = scene.getMeshByName('cam:targetDot');
    if (!dot) {
      const s = BABYLON.MeshBuilder.CreateSphere('cam:targetDot', { diameter: 0.6, segments: 16 }, scene);
      const m = new BABYLON.StandardMaterial('cam:targetDot:mat', scene); m.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.05); m.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.0); m.specularColor = new BABYLON.Color3(0,0,0);
      s.material = m; s.isPickable = false; s.renderingGroupId = 3;
    }
    scene.onBeforeRenderObservable.add(() => { try { const d = scene.getMeshByName('cam:targetDot'); if (d) d.position.copyFrom(camera.target); } catch {} });
  } catch {}
}
// ——————————— Router (flat, Java-style) ———————————

function routerOnPointer(pi, rs) {
  const { scene, camera, state, Log, canvas } = rs;
  const t = pi.type;
  const e = pi.event || window.event;
  if (t === BABYLON.PointerEventTypes.POINTERDOWN) {
    if (routerLogsEnabled()) {
      const route = classifyPointerDown({ scene, state, e });
      log('ROUTER', 'route', route);
    }
    if (routerIsOverPPOrGizmo(e, rs)) {
      camera.inputs?.attached?.pointers?.detachControl(canvas);
      if (e.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      log('GIZMO', 'pre-capture:router', { pointerId: e.pointerId ?? null });
      return;
    }
    routerHandleCameraDown(e, rs);
  } else if (t === BABYLON.PointerEventTypes.POINTERMOVE) {
    routerHandleCameraMove(rs);
  } else if (t === BABYLON.PointerEventTypes.POINTERUP) {
    routerHandleCameraUp(rs);
  }
}

function routerHandleCameraDown(e, rs) {
  const { scene, camera, state, canvas } = rs;
  if (state.mode !== 'edit') return false;
  const mods = modsOfEvent(e);
  const emulateRC = (e.button === 0 && !!mods.ctrl && !mods.cmd);
  const isRightLike = (e.button === 2) || emulateRC;
  let decision = null;
  if (e.button === 0 && !mods.cmd && !mods.shift && !mods.ctrl && !mods.alt) decision = 'rotate';
  else if (isRightLike && !mods.cmd) decision = 'rotate';
  else if (isRightLike && mods.cmd) decision = 'pan';
  else return false;

  if (decision === 'pan') {
    camera.panningMouseButton = 2;
    const ptr = camera?.inputs?.attached?.pointers;
    if (ptr && Array.isArray(ptr.buttons)) ptr.buttons = [0];
    if (ptr && typeof ptr.useCtrlForPanning === 'boolean') ptr.useCtrlForPanning = false;
  } else {
    camera.panningMouseButton = 1;
    rs.gesture.panGuard = { saved: camera.panningSensibility };
    camera.panningSensibility = 1e9;
  }
  rs.gesture.decision = decision;

  const ptr = camera?.inputs?.attached?.pointers;
  if (ptr && decision === 'rotate') {
    const rotateBtn = (e.button === 0) ? 0 : 2;
    if (Array.isArray(ptr.buttons)) ptr.buttons = [rotateBtn];
    if (typeof ptr.useCtrlForPanning === 'boolean') ptr.useCtrlForPanning = false;
  }

  if (e.pointerId != null && canvas.setPointerCapture) {
    canvas.setPointerCapture(e.pointerId);
    rs.gesture.ptrId = e.pointerId;
  }
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  ensureTargetDot({ scene, camera });
  log('CAMERA', decision === 'pan' ? 'start:pan' : 'start:orbit', { button: e.button, mods });
  return true;
}

function routerHandleCameraMove(rs) {
  const { camera, scene, gesture } = rs;
  if (gesture.decision === 'rotate') {
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
  }
  // log('CAMERA', 'drag', { decision: gesture.decision, x: scene.pointerX, y: scene.pointerY });
}

function routerHandleCameraUp(rs) {
  const { camera, canvas, gesture } = rs;
  camera.panningMouseButton = 1;
  if (gesture.ptrId != null && canvas.releasePointerCapture) {
    canvas.releasePointerCapture(gesture.ptrId);
  }
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  if (gesture.panGuard && typeof gesture.panGuard.saved === 'number') {
    camera.panningSensibility = gesture.panGuard.saved;
  }
  rs.gesture = { decision: null, ptrId: null, panGuard: null };
}

function routerIsOverPPOrGizmo(e, rs) {
  const { scene } = rs;
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
