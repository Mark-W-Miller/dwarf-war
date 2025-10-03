import { Log } from '../util/log.mjs';

const AXIS_CONFIG = {
  x: { color: new BABYLON.Color3(0.95, 0.35, 0.35), dir: new BABYLON.Vector3(1, 0, 0), planeNormal: new BABYLON.Vector3(0, 1, 0) },
  y: { color: new BABYLON.Color3(0.35, 0.95, 0.35), dir: new BABYLON.Vector3(0, 1, 0), planeNormal: new BABYLON.Vector3(0, 0, 1) },
  z: { color: new BABYLON.Color3(0.35, 0.55, 0.95), dir: new BABYLON.Vector3(0, 0, 1), planeNormal: new BABYLON.Vector3(1, 0, 0) }
};

const AXIS_OFFSETS = {
  x: new BABYLON.Vector3(1, 0, 0),
  y: new BABYLON.Vector3(0, 1, 0),
  z: new BABYLON.Vector3(0, 0, 1)
};

const AXIS_BASE_QUAT = {
  x: BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(0, 0, 1), -Math.PI / 2),
  y: BABYLON.Quaternion.Identity(),
  z: BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI / 2)
};

const PLANE_CONFIG = [
  { key: 'plane:xy', normal: new BABYLON.Vector3(0, 0, 1), rotation: { x: Math.PI / 2, y: 0, z: 0 }, axisLabel: 'Z', color: new BABYLON.Color3(0.5, 0.32, 0.85), visible: false },
  { key: 'plane:yz', normal: new BABYLON.Vector3(1, 0, 0), rotation: { x: 0, y: 0, z: Math.PI / 2 }, axisLabel: 'X', color: new BABYLON.Color3(0.75, 0.55, 0.35), visible: false },
  { key: 'plane:xz', normal: new BABYLON.Vector3(0, 1, 0), rotation: { x: Math.PI / 2, y: 0, z: 0 }, axisLabel: 'Y', color: new BABYLON.Color3(0.12, 0.5, 0.95), visible: true, lockWorldNormal: true }
];

const ROTATION_CONFIG = {
  x: { color: new BABYLON.Color3(0.95, 0.45, 0.45), axis: new BABYLON.Vector3(1, 0, 0), rotation: { x: 0, y: 0, z: Math.PI / 2 } },
  y: { color: new BABYLON.Color3(0.45, 0.95, 0.45), axis: new BABYLON.Vector3(0, 1, 0), rotation: { x: 0, y: 0, z: 0 } },
  z: { color: new BABYLON.Color3(0.45, 0.65, 0.95), axis: new BABYLON.Vector3(0, 0, 1), rotation: { x: Math.PI / 2, y: 0, z: 0 } }
};

const PLANE_PRIMARY_AXIS = {
  'plane:xy': 'z',
  'plane:yz': 'x',
  'plane:xz': 'y'
};

function defaultLog(evt, data) {
  try { Log.log('GIZMO_2', evt, data); }
  catch { console.log('GIZMO_2', evt, data); }
}

function pickPointOnPlane({ scene, camera, normal, point }) {
  try {
    const n = normal.clone(); n.normalize();
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const ro = ray.origin, rd = ray.direction;
    let denom = BABYLON.Vector3.Dot(n, rd);
    if (Math.abs(denom) < 1e-6) {
      const view = camera.getForwardRay()?.direction || new BABYLON.Vector3(0, 0, 1);
      const adjust = BABYLON.Vector3.Cross(view, n);
      if (adjust.lengthSquared() > 1e-6) {
        n.addInPlace(adjust.scale(0.001));
        denom = BABYLON.Vector3.Dot(n, rd);
      }
    }
    if (Math.abs(denom) < 1e-6) return null;
    const t = BABYLON.Vector3.Dot(point.subtract(ro), n) / denom;
    if (!isFinite(t)) return null;
    return ro.add(rd.scale(t));
  } catch { return null; }
}

export function createGizmoBuilder({ scene, camera, log = defaultLog, translationHandler = null, rotationHandler = null }) {
  if (!scene || !camera) throw new Error('createGizmoBuilder: scene and camera required');
  const engine = scene.getEngine();
  const canvas = engine?.getRenderingCanvas?.() || null;

  const root = new BABYLON.TransformNode('gizmo2:root', scene);
  root.position.set(0, 0, 0);
  root.rotationQuaternion = BABYLON.Quaternion.Identity();

  const materials = [];
  const handles = new Map();
  const groupEnabled = {
    'move:x': true,
    'move:y': true,
    'move:z': true,
    'rotate:x': false,
    'rotate:y': false,
    'rotate:z': false,
    'plane:ground': true
  };

  let enabled = true;
  let hoverHandle = null;

  const dragState = {
    active: false,
    kind: null,
    axis: null,
    axisDir: null,
    planeNormal: null,
    planePoint: null,
    startPick: null,
    startPosition: null,
    startVector: null,
    startRotation: null,
    pointerId: null,
    translationHandler: translationHandler || null,
    translationContext: null,
    appliedOffset: new BABYLON.Vector3(0, 0, 0),
    rotationHandler: rotationHandler || null,
    rotationContext: null,
    appliedRotation: 0,
    lastRotationAngle: 0
  };

  function isGroupEnabled(group) {
    if (!group) return true;
    if (!(group in groupEnabled)) groupEnabled[group] = true;
    return groupEnabled[group];
  }

  function applyHandleState(handleKey) {
    const entry = handles.get(handleKey);
  if (!entry) return;
  const active = enabled && isGroupEnabled(entry.group);
  entry.enabled = active;
  const meshSet = entry.meshes ? new Set(entry.meshes.filter(Boolean)) : null;
    if (entry.meshes) {
      for (const mesh of entry.meshes) {
        if (!mesh) continue;
        try {
          if (typeof mesh.setEnabled === 'function') mesh.setEnabled(active);
          mesh.metadata = mesh.metadata || {};
          if (mesh.metadata.gizmoOriginalPickable === undefined) mesh.metadata.gizmoOriginalPickable = !!mesh.isPickable;
          if (typeof mesh.isPickable === 'boolean') mesh.isPickable = active && !!mesh.metadata.gizmoOriginalPickable;
        } catch {}
      }
    }
  if (entry.pick) {
    try {
      if (typeof entry.pick.setEnabled === 'function') entry.pick.setEnabled(active);
      entry.pick.metadata = entry.pick.metadata || {};
      if (entry.pick.metadata.gizmoOriginalPickable === undefined) entry.pick.metadata.gizmoOriginalPickable = !!entry.pick.isPickable;
      if (typeof entry.pick.isPickable === 'boolean') entry.pick.isPickable = active && !!entry.pick.metadata.gizmoOriginalPickable;
      if ((!meshSet || !meshSet.has(entry.pick)) && typeof entry.pick.isVisible === 'boolean') entry.pick.isVisible = false;
    } catch {}
  }
  if (!active && hoverHandle === handleKey) {
    resetHighlight();
  }
  if (active) {
    if (entry.type === 'axis') updateAxisEntry(entry);
    else if (entry.type === 'plane') updatePlaneEntry(entry);
    else if (entry.type === 'rotation') updateRotationEntry(entry);
  }
}

  function setGroupEnabledInternal(group, on) {
    if (!group) return;
    if (!(group in groupEnabled)) groupEnabled[group] = true;
    const next = !!on;
    if (groupEnabled[group] === next) return;
    groupEnabled[group] = next;
    for (const [key, entry] of handles.entries()) {
      if (entry.group === group) applyHandleState(key);
    }
    if (!next && hoverHandle) {
      const current = handles.get(hoverHandle);
      if (current && current.group === group) resetHighlight();
    }
  }

  function resetHighlight() {
    hoverHandle = null;
    for (const entry of handles.values()) {
      if (!entry || !entry.baseMat || !entry.baseColor) continue;
      if (entry.baseMat.isDisposed?.()) continue;
      try {
        entry.baseMat.emissiveColor = entry.baseColor.clone();
        if (entry.baseDiffuse) entry.baseMat.diffuseColor = entry.baseDiffuse.clone();
        if (typeof entry.baseAlpha === 'number') entry.baseMat.alpha = entry.baseAlpha;
      } catch {}
    }
  }

function setHighlight(handleKey) {
  if (hoverHandle === handleKey) return;
  resetHighlight();
  const entry = handles.get(handleKey);
  if (!entry || !entry.baseMat || !entry.baseColor || entry.enabled === false) return;
  const scale = entry.highlightScale || 2.2;
  try {
    entry.baseMat.emissiveColor = entry.baseColor.clone().scale(scale);
    if (entry.baseDiffuse) {
      const diffScale = Math.min(scale * 0.8, 2.5);
      entry.baseMat.diffuseColor = entry.baseDiffuse.clone().scale(diffScale);
    }
    if (typeof entry.baseAlpha === 'number') {
      const boosted = entry.baseAlpha * (1 + (scale - 1) * 0.5);
      entry.baseMat.alpha = Math.min(1, boosted);
    }
  } catch {}
  hoverHandle = handleKey;
  log('hover', { handle: handleKey });
}

function updateAxisEntry(entry) {
  if (!entry || entry.type !== 'axis') return;
  if (entry.enabled === false) return;
  const rootQuat = root.rotationQuaternion ? root.rotationQuaternion.clone() : BABYLON.Quaternion.Identity();
  const invRoot = rootQuat.clone();
  invRoot.conjugateInPlace();
  const invMatrix = BABYLON.Matrix.Identity();
  invRoot.toRotationMatrix(invMatrix);
  const rootScale = root.scaling || new BABYLON.Vector3(1, 1, 1);

  const applyTransform = ({ mesh, offset, baseQuat }) => {
    if (!mesh || mesh.isDisposed?.()) return;
    const worldOffset = offset;
    const localPos = BABYLON.Vector3.TransformCoordinates(worldOffset, invMatrix);
    mesh.position.copyFrom(localPos);
    const localQuat = invRoot.multiply(baseQuat);
    mesh.rotationQuaternion = localQuat;
  };

  for (const t of entry.transforms || []) applyTransform(t);
  if (entry.pickTransform) applyTransform(entry.pickTransform);
}

function updatePlaneEntry(entry) {
  if (!entry || entry.type !== 'plane') return;
  if (entry.enabled === false) return;
  const align = entry.worldAlign;
  if (!align || !Array.isArray(align.meshes) || !align.meshes.length) return;
  const baseQuat = align.baseQuat || BABYLON.Quaternion.Identity();
  const position = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
  const scaleVec = root.scaling || new BABYLON.Vector3(1, 1, 1);
  const uniform = Math.max(Math.abs(scaleVec.x || 0), Math.abs(scaleVec.y || 0), Math.abs(scaleVec.z || 0)) || 1;
  for (const mesh of align.meshes) {
    if (!mesh || mesh.isDisposed?.()) continue;
    mesh.position.copyFrom(position);
    mesh.scaling.set(uniform, uniform, uniform);
    mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
    mesh.rotationQuaternion.copyFrom(baseQuat);
  }
}

function updateRotationEntry(entry) {
  if (!entry || entry.type !== 'rotation') return;
  if (entry.enabled === false) return;
  const position = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
  const meshes = entry.meshes || [];
  const baseQuat = entry.baseQuat || BABYLON.Quaternion.Identity();
  const baseScale = entry.baseScale || new BABYLON.Vector3(1, 1, 1);
  const rootScale = root.scaling || new BABYLON.Vector3(1, 1, 1);
  const uniform = Math.max(Math.abs(rootScale.x || 0), Math.abs(rootScale.y || 0), Math.abs(rootScale.z || 0)) || 1;
  const targetScale = baseScale.clone();
  targetScale.scaleInPlace(uniform);
  for (const mesh of meshes) {
    if (!mesh || mesh.isDisposed?.()) continue;
    try { mesh.position.copyFrom(position); } catch {}
    try { mesh.scaling.copyFrom(targetScale); } catch {}
    mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
    try { mesh.rotationQuaternion.copyFrom(baseQuat); } catch {}
  }
  if (entry.pick && !meshes.includes(entry.pick)) {
    const mesh = entry.pick;
    if (mesh && !mesh.isDisposed?.()) {
      try { mesh.position.copyFrom(position); } catch {}
      try { mesh.scaling.copyFrom(targetScale); } catch {}
      mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
      try { mesh.rotationQuaternion.copyFrom(baseQuat); } catch {}
    }
  }
}

function applyTranslationDelta(totalDelta) {
  const handler = dragState.translationHandler;
  const context = dragState.translationContext;
  if (!handler || !context || typeof handler.apply !== 'function') return;
  const prev = dragState.appliedOffset || new BABYLON.Vector3(0, 0, 0);
  const deltaStep = totalDelta.clone();
  deltaStep.subtractInPlace(prev);
  if (deltaStep.lengthSquared() < 1e-6) return;
  try { handler.apply(context, totalDelta, deltaStep); }
  catch (e) { try { log('GIZMO_ERR', 'translate:apply', { error: String(e && e.message ? e.message : e) }); } catch {} }
  dragState.appliedOffset = totalDelta.clone();
}

  function makeAxis(axisKey) {
    const cfg = AXIS_CONFIG[axisKey];
    const mat = new BABYLON.StandardMaterial(`gizmo2:${axisKey}:mat`, scene);
    mat.diffuseColor = cfg.color.scale(0.22);
    mat.emissiveColor = cfg.color.clone();
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    materials.push(mat);

    const lengthScale = 0.5;
    const shaftLen = 2.0 * lengthScale;
    const tipLen = 0.6 * lengthScale;
    const grabLen = (shaftLen + tipLen + 0.2) * lengthScale;
    const shaft = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:shaft`, { height: shaftLen, diameter: 0.1 * lengthScale, tessellation: 32 }, scene);
    shaft.material = mat; shaft.parent = root; shaft.alwaysSelectAsActiveMesh = true;
    shaft.isPickable = true;
    shaft.rotationQuaternion = AXIS_BASE_QUAT[axisKey].clone();

    const tip = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:tip`, { height: tipLen, diameterTop: 0, diameterBottom: 0.34 * lengthScale, tessellation: 32 }, scene);
    tip.material = mat; tip.parent = root; tip.alwaysSelectAsActiveMesh = true;
    tip.isPickable = true;
    tip.rotationQuaternion = AXIS_BASE_QUAT[axisKey].clone();

    const grab = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:grab`, { height: grabLen, diameter: 0.6 * lengthScale, tessellation: 16 }, scene);
    grab.isVisible = false; grab.parent = root; grab.alwaysSelectAsActiveMesh = true;
    grab.isPickable = true;
    grab.rotationQuaternion = AXIS_BASE_QUAT[axisKey].clone();

    const halfShaft = shaftLen / 2;
    const tipOffset = shaftLen + tipLen / 2;
    const grabOffset = grabLen / 2;
    const axisDir = AXIS_OFFSETS[axisKey];
    const shaftOffset = axisDir.scale(halfShaft);
    const tipOffsetVec = axisDir.scale(tipOffset);
    const grabOffsetVec = axisDir.scale(grabOffset);

    const entry = {
      type: 'axis',
      axis: axisKey,
      dir: cfg.dir.clone(),
      planeNormal: cfg.planeNormal.clone(),
      meshes: [shaft, tip],
      pick: grab,
      baseMat: mat,
      baseColor: cfg.color.clone(),
      baseDiffuse: mat.diffuseColor.clone(),
      baseAlpha: mat.alpha,
      highlightScale: 2.4,
      group: `move:${axisKey}`,
      transforms: [
        { mesh: shaft, offset: shaftOffset, baseQuat: AXIS_BASE_QUAT[axisKey].clone() },
        { mesh: tip, offset: tipOffsetVec, baseQuat: AXIS_BASE_QUAT[axisKey].clone() }
      ],
      pickTransform: { mesh: grab, offset: grabOffsetVec, baseQuat: AXIS_BASE_QUAT[axisKey].clone() },
      lockWorldAxis: true
    };
    entry.observer = scene.onBeforeRenderObservable.add(() => updateAxisEntry(entry));
    handles.set(`axis:${axisKey}`, entry);
    applyHandleState(`axis:${axisKey}`);
    updateAxisEntry(entry);
  }

  Object.keys(AXIS_CONFIG).forEach(makeAxis);

  for (const cfg of PLANE_CONFIG) {
    if (cfg.visible === false) continue;
    let mat = null;
    const visuals = [];
    let worldMeshes = [];
    let updateObserver = null;
    let entryRef = null;
    let pickMesh = null;
    let baseQuat = null;

    if (cfg.visible !== false) {
      mat = new BABYLON.StandardMaterial(`gizmo2:${cfg.key}:mat`, scene);
      mat.diffuseColor = cfg.color.scale(0.2);
      mat.emissiveColor = cfg.color.clone();
      mat.alpha = 0.32;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      materials.push(mat);

      const fill = BABYLON.MeshBuilder.CreateDisc(`gizmo2:${cfg.key}:disc`, { radius: 0.65, tessellation: 72 }, scene);
      fill.material = mat; fill.parent = root; fill.alwaysSelectAsActiveMesh = true;
      fill.rotation.x = cfg.rotation.x; fill.rotation.y = cfg.rotation.y; fill.rotation.z = cfg.rotation.z;
      fill.renderingGroupId = 2;
      fill.isPickable = true;
      try { fill.sideOrientation = BABYLON.Mesh.DOUBLESIDE; } catch {}
      visuals.push(fill);
      pickMesh = fill;
    }

    let grab = null;
    if (!pickMesh) {
      grab = BABYLON.MeshBuilder.CreateDisc(`gizmo2:${cfg.key}:grab`, { radius: 0.72, tessellation: 72 }, scene);
      grab.isVisible = false; grab.parent = root; grab.alwaysSelectAsActiveMesh = true;
      grab.rotation.x = cfg.rotation.x; grab.rotation.y = cfg.rotation.y; grab.rotation.z = cfg.rotation.z;
      grab.isPickable = true;
      pickMesh = grab;
    }

    if (cfg.lockWorldNormal && cfg.visible !== false) {
      baseQuat = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI / 2);
      worldMeshes = [...visuals];
      if (pickMesh && !visuals.includes(pickMesh)) worldMeshes.push(pickMesh);
      for (const mesh of worldMeshes) {
        mesh.parent = null;
        mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
        mesh.rotationQuaternion.copyFrom(baseQuat);
      }
      updateObserver = scene.onBeforeRenderObservable.add(() => {
        updatePlaneEntry(entryRef);
      });
    }

    const entry = {
      type: 'plane',
      axis: cfg.axisLabel,
      normal: cfg.normal.clone(),
      meshes: visuals,
      pick: pickMesh,
      baseMat: mat,
      baseColor: mat ? cfg.color.clone() : null,
      baseDiffuse: mat ? mat.diffuseColor.clone() : null,
      baseAlpha: mat ? mat.alpha : null,
      highlightScale: cfg.visible === false ? 2.0 : 2.6,
      lockWorldNormal: !!cfg.lockWorldNormal,
      group: cfg.key === 'plane:xz' ? 'plane:ground' : `plane:${cfg.axisLabel.toLowerCase()}`,
      observer: updateObserver,
      worldAlign: cfg.lockWorldNormal && cfg.visible !== false ? { meshes: worldMeshes, baseQuat, pickMesh } : null
    };
    entryRef = entry;
    handles.set(cfg.key, entry);
    applyHandleState(cfg.key);
    if (entry.worldAlign) updatePlaneEntry(entry);
  }

  function makeRotation(axisKey) {
    const cfg = ROTATION_CONFIG[axisKey];
    const mat = new BABYLON.StandardMaterial(`gizmo2:rot:${axisKey}:mat`, scene);
    mat.diffuseColor = cfg.color.scale(0.12);
    mat.emissiveColor = cfg.color.clone();
    mat.alpha = 0.75;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    materials.push(mat);

    const ring = BABYLON.MeshBuilder.CreateTorus(`gizmo2:rot:${axisKey}:ring`, { diameter: 2.0, thickness: 0.06, tessellation: 128 }, scene);
    ring.material = mat;
    ring.parent = null;
    ring.alwaysSelectAsActiveMesh = true;
    ring.isPickable = true;
    ring.renderingGroupId = 3;
    const baseQuat = BABYLON.Quaternion.FromEulerAngles(cfg.rotation.x, cfg.rotation.y, cfg.rotation.z);
    ring.rotationQuaternion = baseQuat.clone();
    ring.rotation.set(0, 0, 0);

    const entry = {
      type: 'rotation',
      axis: axisKey,
      axisDir: cfg.axis.clone(),
      meshes: [ring],
      pick: ring,
      baseMat: mat,
      baseColor: cfg.color.clone(),
      baseDiffuse: mat.diffuseColor.clone(),
      baseAlpha: mat.alpha,
      highlightScale: 2.8,
      group: `rotate:${axisKey}`,
      baseQuat,
      baseScale: ring.scaling.clone(),
      lockWorldAxis: true
    };
    entry.observer = scene.onBeforeRenderObservable.add(() => updateRotationEntry(entry));
    handles.set(`rot:${axisKey}`, entry);
    applyHandleState(`rot:${axisKey}`);
    updateRotationEntry(entry);
  }

  Object.keys(ROTATION_CONFIG).forEach(makeRotation);

  function endDrag() {
    if (!dragState.active) return;
    dragState.active = false;
    const prevKind = dragState.kind;
    const prevAxis = dragState.axis;
    const prevAxisDir = dragState.axisDir ? dragState.axisDir.clone() : null;
    log('drag:end', { kind: prevKind, axis: prevAxis });
    try {
      const ptrInputs = camera?.inputs?.attached?.pointers;
      if (ptrInputs && canvas) ptrInputs.attachControl(canvas, true);
      if (canvas && dragState.pointerId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(dragState.pointerId);
    } catch {}
    dragState.kind = null;
    dragState.axis = null;
    dragState.axisDir = null;
    dragState.planeNormal = null;
    dragState.planePoint = null;
    dragState.startPick = null;
    dragState.startVector = null;
    dragState.startRotation = null;
    dragState.pointerId = null;
    if (dragState.rotationHandler && dragState.rotationContext) {
      const totalAngle = dragState.appliedRotation || 0;
      const hasRotation = Math.abs(totalAngle) > 1e-4;
      if (prevKind === 'rotation' && hasRotation && typeof dragState.rotationHandler.commit === 'function') {
        try { dragState.rotationHandler.commit(dragState.rotationContext, totalAngle, { axis: prevAxis, axisDir: prevAxisDir }); }
        catch (e) { try { log('GIZMO_ERR', 'rotate:commit', { error: String(e && e.message ? e.message : e) }); } catch {} }
      } else if (typeof dragState.rotationHandler.cancel === 'function') {
        try { dragState.rotationHandler.cancel(dragState.rotationContext); }
        catch (e) { try { log('GIZMO_ERR', 'rotate:cancel', { error: String(e && e.message ? e.message : e) }); } catch {} }
      }
    }
    if (dragState.translationHandler && typeof dragState.translationHandler.commit === 'function' && dragState.translationContext && dragState.appliedOffset.lengthSquared() > 1e-6) {
      try { dragState.translationHandler.commit(dragState.translationContext, dragState.appliedOffset.clone()); }
      catch (e) { try { log('GIZMO_ERR', 'translate:commit', { error: String(e && e.message ? e.message : e) }); } catch {} }
    } else if (dragState.translationHandler && typeof dragState.translationHandler.cancel === 'function' && dragState.translationContext) {
      try { dragState.translationHandler.cancel(dragState.translationContext); } catch {}
    }
    dragState.translationContext = null;
    dragState.appliedOffset = new BABYLON.Vector3(0, 0, 0);
    dragState.rotationContext = null;
    dragState.appliedRotation = 0;
    dragState.lastRotationAngle = 0;
  }

  function beginDrag(handleKey, pickedPoint, pointerId) {
    const entry = handles.get(handleKey);
    if (!entry || entry.enabled === false) return;
    dragState.active = true;
    dragState.pointerId = pointerId;
    dragState.startPick = pickedPoint ? pickedPoint.clone() : root.position.clone();
    dragState.startPosition = root.position.clone();
    dragState.startVector = null;
    dragState.startRotation = null;
    dragState.appliedOffset = new BABYLON.Vector3(0, 0, 0);
    dragState.translationContext = null;
    dragState.rotationContext = null;
    dragState.appliedRotation = 0;
    dragState.lastRotationAngle = 0;
    if (dragState.translationHandler && typeof dragState.translationHandler.begin === 'function' && (entry.type === 'axis' || entry.type === 'plane')) {
      try { dragState.translationContext = dragState.translationHandler.begin({ kind: entry.type }); }
      catch (e) { try { log('GIZMO_ERR', 'translate:begin', { error: String(e && e.message ? e.message : e) }); } catch {} }
    }

    const rotationMatrix = BABYLON.Matrix.Identity();
    if (root.rotationQuaternion) {
      root.rotationQuaternion.toRotationMatrix(rotationMatrix);
    }

    if (entry.type === 'axis') {
      dragState.kind = 'axis';
      dragState.axis = entry.axis;
      let dir = entry.dir.clone();
      let planeNormal = entry.planeNormal.clone();
      if (!entry.lockWorldAxis) {
        dir = BABYLON.Vector3.TransformNormal(dir, rotationMatrix);
        planeNormal = BABYLON.Vector3.TransformNormal(planeNormal, rotationMatrix);
      }
      dragState.axisDir = dir.normalize();
      dragState.planeNormal = planeNormal.normalize();
      dragState.planePoint = pickedPoint ? pickedPoint.clone() : root.position.clone();
    } else if (entry.type === 'plane') {
      dragState.kind = 'plane';
      dragState.axis = entry.axis;
      dragState.axisDir = null;
      const planeNormal = entry.lockWorldNormal ? entry.normal.clone() : BABYLON.Vector3.TransformNormal(entry.normal.clone(), rotationMatrix);
      dragState.planeNormal = planeNormal.normalize();
      if (entry.lockWorldNormal) {
        const pos = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
        dragState.planePoint = pos.clone();
      } else {
        dragState.planePoint = pickedPoint ? pickedPoint.clone() : root.position.clone();
      }
    } else if (entry.type === 'rotation') {
      dragState.kind = 'rotation';
      dragState.axis = entry.axis;
      let axisDir = entry.axisDir.clone();
      if (!entry.lockWorldAxis) {
        axisDir = BABYLON.Vector3.TransformNormal(axisDir, rotationMatrix);
      }
      axisDir.normalize();
      dragState.axisDir = axisDir;
      dragState.planeNormal = axisDir.clone();
      const pivot = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
      dragState.planePoint = pivot.clone();
      dragState.startRotation = BABYLON.Quaternion.Identity();
      const startPoint = pickedPoint || pickPointOnPlane({ scene, camera, normal: axisDir, point: pivot.clone() });
      if (startPoint) {
        const vec = startPoint.subtract(pivot);
        if (vec.lengthSquared() > 1e-6) {
          dragState.startVector = vec;
        }
      }
      if (dragState.rotationHandler && typeof dragState.rotationHandler.begin === 'function') {
        try { dragState.rotationContext = dragState.rotationHandler.begin({ axis: entry.axis, axisDir: axisDir.clone(), center: pivot.clone() }); }
        catch (e) { try { log('GIZMO_ERR', 'rotate:begin', { error: String(e && e.message ? e.message : e) }); } catch {} }
      }
    }

    log('drag:start', { kind: dragState.kind, axis: dragState.axis });
    try {
      const ptrInputs = camera?.inputs?.attached?.pointers;
      if (ptrInputs && canvas) ptrInputs.detachControl(canvas);
      if (canvas && pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pointerId);
    } catch {}
  }

  function updateDrag() {
    if (!dragState.active) return;
    const pick = pickPointOnPlane({ scene, camera, normal: dragState.planeNormal, point: dragState.planePoint });
    if (!pick) return;
    if (dragState.kind === 'axis' && dragState.axisDir) {
      const delta = pick.subtract(dragState.startPick);
      const scalar = BABYLON.Vector3.Dot(delta, dragState.axisDir);
      const newPos = dragState.startPosition.add(dragState.axisDir.scale(scalar));
      applyTranslationDelta(newPos.subtract(dragState.startPosition));
      root.position.copyFrom(newPos);
      log('drag:update', { kind: 'axis', axis: dragState.axis, value: scalar, position: { x: newPos.x, y: newPos.y, z: newPos.z } });
    } else if (dragState.kind === 'plane') {
      const delta = pick.subtract(dragState.startPick);
      const normal = dragState.planeNormal;
      const projection = delta.subtract(normal.scale(BABYLON.Vector3.Dot(delta, normal)));
      const newPos = dragState.startPosition.add(projection);
      applyTranslationDelta(newPos.subtract(dragState.startPosition));
      root.position.copyFrom(newPos);
      log('drag:update', { kind: 'plane', axis: dragState.axis, position: { x: newPos.x, y: newPos.y, z: newPos.z } });
    } else if (dragState.kind === 'rotation' && dragState.axisDir) {
      const center = dragState.planePoint || root.position;
      const currentVec = pick.subtract(center);
      if (!dragState.startRotation) return;
      if (currentVec.lengthSquared() < 1e-8) return;
      if (!dragState.startVector || dragState.startVector.lengthSquared() < 1e-8) {
        dragState.startVector = currentVec;
        return;
      }
      const from = dragState.startVector.clone().normalize();
      const to = currentVec.clone().normalize();
      let dot = BABYLON.Vector3.Dot(from, to);
      dot = Math.min(1, Math.max(-1, dot));
      const cross = BABYLON.Vector3.Cross(from, to);
      const det = BABYLON.Vector3.Dot(cross, dragState.axisDir);
      const angle = Math.atan2(det, dot);
      if (!isFinite(angle)) return;
      let deltaAngle = angle - dragState.lastRotationAngle;
      if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
      else if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
      dragState.lastRotationAngle = angle;
      if (Math.abs(deltaAngle) < 1e-5) return;
      dragState.appliedRotation += deltaAngle;
      if (dragState.rotationHandler && dragState.rotationContext && typeof dragState.rotationHandler.apply === 'function') {
        try { dragState.rotationHandler.apply(dragState.rotationContext, dragState.appliedRotation, deltaAngle, { axis: dragState.axis, axisDir: dragState.axisDir.clone() }); }
        catch (e) { try { log('GIZMO_ERR', 'rotate:apply', { error: String(e && e.message ? e.message : e) }); } catch {} }
      }
      const degrees = dragState.appliedRotation * (180 / Math.PI);
      log('drag:update', { kind: 'rotation', axis: dragState.axis, angle: dragState.appliedRotation, degrees });
    }
  }

  const pickPredicate = (m) => {
    if (!m || typeof m.name !== 'string') return false;
    const name = m.name;
    if (!name.startsWith('gizmo2:')) return false;
    if (name.includes('plane:xy')) return false; // block invisible XY plane disc from capture
    return true;
  };

  const planeGroundPredicate = (m) => {
    if (!m || typeof m.name !== 'string') return false;
    const name = m.name;
    if (!name.startsWith('gizmo2:plane:xz')) return false;
    if (!isGroupEnabled('plane:ground')) return false;
    return true;
  };

  function pickPriority(name) {
    if (!name) return -1;
    if (name.includes('plane:xz')) return 400;
    if (name.includes(':plane')) return 350;
    if (name.includes(':axis:')) return 300;
    if (name.includes(':rot:')) return 200;
    return 100;
  }

  function pickGizmo() {
    try {
      const candidates = [];
      const seenMeshes = new Set();
      const pushCandidate = (info) => {
        if (!info?.hit || !info.pickedMesh) return;
        const mesh = info.pickedMesh;
        if (seenMeshes.has(mesh)) return;
        seenMeshes.add(mesh);
        candidates.push(info);
      };

      if (isGroupEnabled('plane:ground')) {
        const planeGround = scene.pick(scene.pointerX, scene.pointerY, planeGroundPredicate);
        pushCandidate(planeGround);
      }

      const multi = scene.multiPick?.(scene.pointerX, scene.pointerY, pickPredicate) || [];
      if (Array.isArray(multi)) {
        for (const info of multi) pushCandidate(info);
      }

      if (!candidates.length) {
        const single = scene.pick(scene.pointerX, scene.pointerY, pickPredicate);
        pushCandidate(single);
      }

      if (!candidates.length) return null;

      const axisHits = new Set();
      for (const info of candidates) {
        const name = String(info?.pickedMesh?.name || '');
        if (name.includes(':axis:')) {
          const axisKey = name.split(':')[2];
          if (axisKey) axisHits.add(axisKey);
        }
      }

      const rootPos = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
      const scaleVec = root.scaling || new BABYLON.Vector3(1, 1, 1);
      const approxScale = Math.max(0.0001, Math.max(Math.abs(scaleVec.x || 0), Math.abs(scaleVec.y || 0), Math.abs(scaleVec.z || 0)));

      let best = null;
      let bestPriority = -Infinity;
      let bestDist = Infinity;

      for (const info of candidates) {
        if (!info?.hit) continue;
        const name = String(info.pickedMesh?.name || '');
        if (!name.startsWith('gizmo2:')) continue;

        let pri = pickPriority(name);
        if (pri < 0) continue;

        if (name.includes(':plane')) {
          const planeKey = name.includes('plane:xy') ? 'plane:xy' : name.includes('plane:yz') ? 'plane:yz' : name.includes('plane:xz') ? 'plane:xz' : null;
          if (planeKey) {
            const axisKey = PLANE_PRIMARY_AXIS[planeKey];
            if (axisKey && axisHits.has(axisKey) && info.pickedPoint && rootPos) {
              const relative = info.pickedPoint.subtract(rootPos);
              let radial = Infinity;
              if (planeKey === 'plane:xz') radial = Math.sqrt(relative.x * relative.x + relative.z * relative.z);
              else if (planeKey === 'plane:xy') radial = Math.sqrt(relative.x * relative.x + relative.y * relative.y);
              else if (planeKey === 'plane:yz') radial = Math.sqrt(relative.y * relative.y + relative.z * relative.z);
              const axisRadius = 0.025 * approxScale;
              const biasRadius = Math.max(0.18, axisRadius * 3 + 0.1);
              if (isFinite(radial) && radial <= biasRadius) pri -= 120;
            }
          }
        }

        if (pri > bestPriority || (pri === bestPriority && info.distance < bestDist)) {
          best = info;
          bestPriority = pri;
          bestDist = info.distance;
        }
      }

      return best;
    } catch (e) {
      try { log('GIZMO_ERR', 'pickGizmo', { error: String(e && e.message ? e.message : e) }); } catch {}
      return null;
    }
  }

  function handleMouseOver(ev) {
    if (!enabled) return false;
    if (dragState.active) {
      updateDrag();
      return true;
    }
    const planeEnabled = isGroupEnabled('plane:ground');
    if (!planeEnabled && hoverHandle === 'plane:xz') resetHighlight();
    const pick = pickGizmo();
    try {
      log('HOVER_DETAIL', {
        event: 'plane:hover:raw',
        hit: !!pick?.hit,
        mesh: pick?.pickedMesh?.name || null,
        activeHandle: hoverHandle,
        planeEnabled
      });
    } catch {}
    if (pick?.hit && pick.pickedMesh) {
      const name = String(pick.pickedMesh.name || '');
      if (name.includes(':axis:')) {
        const axis = name.split(':')[2];
        const key = `axis:${axis}`;
        const entry = handles.get(key);
        if (!entry || entry.enabled === false) { resetHighlight(); return false; }
        setHighlight(key);
        return true;
      }
      if (name.includes(':rot:')) {
        const axis = name.split(':')[2];
        const key = `rot:${axis}`;
        const entry = handles.get(key);
        if (!entry || entry.enabled === false) { resetHighlight(); return false; }
        setHighlight(key);
        return true;
      }
      if (name.includes(':plane')) {
        const planeKey = name.includes('plane:xy') ? 'plane:xy' : name.includes('plane:yz') ? 'plane:yz' : 'plane:xz';
        const entry = handles.get(planeKey);
        if (!entry || entry.enabled === false) {
          try {
            log('HOVER_DETAIL', {
              event: 'plane:hover:skip',
              handle: planeKey,
              enabled: !!entry?.enabled,
              hasEntry: !!entry,
              pickName: name
            });
          } catch {}
      resetHighlight();
      return false;
        }
        if (entry.worldAlign) updatePlaneEntry(entry);
        setHighlight(planeKey);
        try {
          const hoverEntry = handles.get(planeKey);
          log('HOVER_DETAIL', {
            event: 'plane:hover:setHighlight',
            handle: planeKey,
            worldAlign: !!entry.worldAlign,
            enabled: !!entry.enabled,
            hoverHandle
          });
        } catch {}
        return true;
      }
    }
    if (!planeEnabled) {
      try {
        log('HOVER_DETAIL', {
          event: 'plane:hover:skipDisabled',
          planeEnabled,
          mesh: pick?.pickedMesh?.name || null
        });
      } catch {}
      return false;
    }
    resetHighlight();
    try {
      log('HOVER_DETAIL', {
        event: 'plane:hover:miss',
        reason: pick?.hit ? 'non-plane-mesh' : 'no-hit',
        pickName: pick?.pickedMesh?.name || null
      });
    } catch {}
    return false;
  }

  function handleMouseDown(ev) {
    if (!enabled) return false;
    const pick = pickGizmo();
    if (!pick?.hit || !pick.pickedMesh) return false;
    const name = String(pick.pickedMesh.name || '');
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    ev?.stopImmediatePropagation?.();

    let handleKey = hoverHandle && handles.has(hoverHandle) ? hoverHandle : null;
    if (!handleKey) {
      if (name.includes(':axis:')) {
        handleKey = `axis:${name.split(':')[2]}`;
      } else if (name.includes(':rot:')) {
        handleKey = `rot:${name.split(':')[2]}`;
      } else if (name.includes(':plane')) {
        handleKey = name.includes('plane:xy') ? 'plane:xy' : name.includes('plane:yz') ? 'plane:yz' : 'plane:xz';
      }
    }

    const planeEnabled = isGroupEnabled('plane:ground');
    try {
      log('HOVER_DETAIL', {
        event: 'plane:down:raw',
        handleKey,
        hoverHandle,
        mesh: name,
        hit: !!pick?.hit,
        planeEnabled
      });
    } catch {}

    if (!planeEnabled && name.includes(':plane')) {
      try { log('plane:down:unresolved', { name }); } catch {}
      return false;
    }

    if (handleKey && handles.has(handleKey)) {
      const entry = handles.get(handleKey);
      if (!entry || entry.enabled === false) {
        try { log('HOVER_DETAIL', { event: 'plane:down:skip', handle: handleKey, enabled: !!entry?.enabled, hasEntry: !!entry }); } catch {}
        return false;
      }
      if (entry.type === 'plane' && entry.worldAlign) updatePlaneEntry(entry);
      beginDrag(handleKey, pick.pickedPoint, ev?.pointerId ?? null);
      if (entry.type === 'plane') {
        try {
          log('HOVER_DETAIL', {
            event: 'plane:down',
            handle: handleKey,
            worldAlign: !!entry.worldAlign,
            highlighted: hoverHandle === handleKey
          });
        } catch {}
      }
      return true;
    }
    return false;
  }

  function handleMouseUp() {
    if (!enabled) return false;
    if (dragState.active) {
      endDrag();
      return true;
    }
    resetHighlight();
    return false;
  }

  function setBounds(bounds) {
    if (!bounds || !bounds.min || !bounds.max) return;
    const min = bounds.min;
    const max = bounds.max;
    const width = Math.max(0.1, max.x - min.x);
    const height = Math.max(0.1, max.y - min.y);
    const depth = Math.max(0.1, max.z - min.z);
    const maxSpan = Math.max(width, height, depth);
    const scale = Math.max(0.5, maxSpan / 2);
    root.scaling.set(scale, scale, scale);
    const center = new BABYLON.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    root.position.copyFrom(center);
    log('bounds', { min, max, scale });
  }

  function setPosition(vec3) {
    if (!vec3) return;
    root.position.copyFrom(vec3);
  }

  function setActive(on) {
    enabled = !!on;
    if (!enabled) {
      endDrag();
      resetHighlight();
    }
    root.setEnabled(enabled);
    for (const key of handles.keys()) applyHandleState(key);
  }

  function dispose() {
    endDrag();
    resetHighlight();
    for (const entry of handles.values()) {
      if (entry?.observer) {
        try { scene.onBeforeRenderObservable.remove(entry.observer); } catch {}
      }
      const meshSet = new Set(entry?.meshes || []);
      for (const mesh of meshSet) {
        if (!mesh || mesh.isDisposed?.()) continue;
        try { mesh.dispose(); } catch {}
      }
      if (entry?.pick && !meshSet.has(entry.pick) && !entry.pick.isDisposed?.()) {
        try { entry.pick.dispose(); } catch {}
      }
    }
    handles.clear();
    try { root.dispose(); } catch {}
    for (const mat of materials) {
      try { mat.dispose?.(); } catch {}
    }
  }

  function isActive() {
    return !!enabled;
  }

  setActive(true);
  setBounds({
    min: { x: -1, y: -1, z: -1 },
    max: { x: 1, y: 1, z: 1 }
  });

  return {
    root,
    setBounds,
    setPosition,
    setActive,
    handleMouseOver,
    handleMouseDown,
    handleMouseUp,
    handlePointerMove: handleMouseOver,
    handlePointerDown: handleMouseDown,
    handlePointerUp: handleMouseUp,
    isActive,
    setGroupEnabled: (group, on) => setGroupEnabledInternal(group, on),
    isGroupEnabled: (group) => isGroupEnabled(group),
    isDragging: () => !!dragState.active,
    getDragState: () => ({
      active: !!dragState.active,
      kind: dragState.kind || null,
      axis: dragState.axis || null,
      pointerId: dragState.pointerId
    }),
    dispose
  };
}
