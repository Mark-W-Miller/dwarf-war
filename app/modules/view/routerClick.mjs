// Router click/drag handling: camera gestures + routing helpers
import { log } from '../util/log.mjs';
import { modsOf as modsOfEvent } from '../util/log.mjs';
import { pickPPNode, pickConnectGizmo, pickRotGizmo, pickMoveGizmo, pickSpace } from './routerHover.mjs';

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
    return { phase, mode, hit: (voxelBacked ? 'voxel|space' : 'space'), id, x, y, mods };
  }
  return { phase, mode, hit: 'empty|camera', x, y, mods };
}

export function ensureTargetDot({ scene, camera }) {
  let dot = scene.getMeshByName('cam:targetDot');
  if (!dot) {
    const s = BABYLON.MeshBuilder.CreateSphere('cam:targetDot', { diameter: 0.6, segments: 16 }, scene);
    const m = new BABYLON.StandardMaterial('cam:targetDot:mat', scene);
    m.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.05);
    m.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    s.material = m; s.isPickable = false; s.renderingGroupId = 3;
  }
  scene.onBeforeRenderObservable.add(() => {
    const d = scene.getMeshByName('cam:targetDot');
    if (d) d.position.copyFrom(camera.target);
  });
}

export function routerIsOverPPOrGizmo(e, routerState) {
  const { scene } = routerState;
  const x = scene.pointerX, y = scene.pointerY;
  return !!(
    pickPPNode({ scene, x, y }) ||
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
  else if (e.button === 2) decision = 'pan';

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
  if (gesture.panGuard && typeof gesture.panGuard.saved === 'number') camera.panningSensibility = gesture.panGuard.saved;
  const ptr = camera?.inputs?.attached?.pointers;
  if (ptr && Array.isArray(ptr._savedButtons)) { ptr.buttons = [...ptr._savedButtons]; delete ptr._savedButtons; }
  camera.inputs?.attached?.pointers?.attachControl(canvas, true);
  routerState.gesture = { decision: null, ptrId: null, panGuard: null, lastX: 0, lastY: 0 };
}

