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

export function createGizmoBuilder({ scene, camera, log = defaultLog }) {
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
    'rotate:x': true,
    'rotate:y': true,
    'rotate:z': true,
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
    pointerId: null
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
  const uniformScale = Math.max(Math.abs(rootScale.x), Math.abs(rootScale.y), Math.abs(rootScale.z)) || 1;

  const applyTransform = ({ mesh, offset, baseQuat }) => {
    if (!mesh || mesh.isDisposed?.()) return;
    const worldOffset = offset.clone().scale(uniformScale);
    const localPos = BABYLON.Vector3.TransformCoordinates(worldOffset, invMatrix);
    mesh.position.copyFrom(localPos);
    const localQuat = invRoot.multiply(baseQuat);
    mesh.rotationQuaternion = localQuat;
  };

  for (const t of entry.transforms || []) applyTransform(t);
  if (entry.pickTransform) applyTransform(entry.pickTransform);
}

  function makeAxis(axisKey) {
    const cfg = AXIS_CONFIG[axisKey];
    const mat = new BABYLON.StandardMaterial(`gizmo2:${axisKey}:mat`, scene);
    mat.diffuseColor = cfg.color.scale(0.22);
    mat.emissiveColor = cfg.color.clone();
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    materials.push(mat);

    const shaftLen = 2.0;
    const tipLen = 0.6;
    const grabLen = shaftLen + tipLen + 0.2;
    const shaft = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:shaft`, { height: shaftLen, diameter: 0.1, tessellation: 32 }, scene);
    shaft.material = mat; shaft.parent = root; shaft.alwaysSelectAsActiveMesh = true;
    shaft.isPickable = true;
    shaft.rotationQuaternion = AXIS_BASE_QUAT[axisKey].clone();

    const tip = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:tip`, { height: tipLen, diameterTop: 0, diameterBottom: 0.34, tessellation: 32 }, scene);
    tip.material = mat; tip.parent = root; tip.alwaysSelectAsActiveMesh = true;
    tip.isPickable = true;
    tip.rotationQuaternion = AXIS_BASE_QUAT[axisKey].clone();

    const grab = BABYLON.MeshBuilder.CreateCylinder(`gizmo2:axis:${axisKey}:grab`, { height: grabLen, diameter: 0.6, tessellation: 16 }, scene);
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
    let mat = null;
    const visuals = [];
    let worldMeshes = [];
    let updateObserver = null;
    let entryRef = null;
    let pickMesh = null;

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
      const baseQuat = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI / 2);
      worldMeshes = [...visuals];
      if (pickMesh && !visuals.includes(pickMesh)) worldMeshes.push(pickMesh);
      for (const mesh of worldMeshes) {
        mesh.parent = null;
        mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
        mesh.rotationQuaternion.copyFrom(baseQuat);
      }
      updateObserver = scene.onBeforeRenderObservable.add(() => {
        if (!entryRef || entryRef.enabled === false) return;
        const pos = root.getAbsolutePosition ? root.getAbsolutePosition() : root.position;
        const scaleVec = root.scaling || new BABYLON.Vector3(1, 1, 1);
        const uniform = Math.max(Math.abs(scaleVec.x || 0), Math.abs(scaleVec.y || 0), Math.abs(scaleVec.z || 0)) || 1;
        for (const mesh of worldMeshes) {
          if (!mesh || mesh.isDisposed?.()) continue;
          mesh.position.copyFrom(pos);
          mesh.position.y = pos.y;
          mesh.scaling.set(uniform, uniform, uniform);
          mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
          mesh.rotationQuaternion.copyFrom(baseQuat);
        }
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
      worldMeshes
    };
    entryRef = entry;
    handles.set(cfg.key, entry);
    applyHandleState(cfg.key);
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
    ring.parent = root;
    ring.alwaysSelectAsActiveMesh = true;
    ring.isPickable = true;
    ring.renderingGroupId = 3;
    ring.rotation.x = cfg.rotation.x;
    ring.rotation.y = cfg.rotation.y;
    ring.rotation.z = cfg.rotation.z;

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
      group: `rotate:${axisKey}`
    };
    handles.set(`rot:${axisKey}`, entry);
    applyHandleState(`rot:${axisKey}`);
  }

  Object.keys(ROTATION_CONFIG).forEach(makeRotation);

  function endDrag() {
    if (!dragState.active) return;
    dragState.active = false;
    log('drag:end', { kind: dragState.kind, axis: dragState.axis });
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
      dragState.planePoint = pickedPoint ? pickedPoint.clone() : root.position.clone();
    } else if (entry.type === 'rotation') {
      dragState.kind = 'rotation';
      dragState.axis = entry.axis;
      const axisDir = BABYLON.Vector3.TransformNormal(entry.axisDir.clone(), rotationMatrix).normalize();
      dragState.axisDir = axisDir;
      dragState.planeNormal = axisDir.clone();
      dragState.planePoint = root.position.clone();
      dragState.startRotation = root.rotationQuaternion ? root.rotationQuaternion.clone() : BABYLON.Quaternion.Identity();
      const startPoint = pickedPoint || pickPointOnPlane({ scene, camera, normal: axisDir, point: root.position.clone() });
      if (startPoint) {
        const vec = startPoint.subtract(root.position);
        if (vec.lengthSquared() > 1e-6) {
          dragState.startVector = vec;
        }
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
      root.position.copyFrom(newPos);
      log('drag:update', { kind: 'axis', axis: dragState.axis, value: scalar, position: { x: newPos.x, y: newPos.y, z: newPos.z } });
    } else if (dragState.kind === 'plane') {
      const delta = pick.subtract(dragState.startPick);
      const normal = dragState.planeNormal;
      const projection = delta.subtract(normal.scale(BABYLON.Vector3.Dot(delta, normal)));
      const newPos = dragState.startPosition.add(projection);
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
      const deltaRot = BABYLON.Quaternion.RotationAxis(dragState.axisDir, angle);
      const startRot = dragState.startRotation.clone();
      const newRot = deltaRot.multiply(startRot);
      if (!root.rotationQuaternion) root.rotationQuaternion = BABYLON.Quaternion.Identity();
      root.rotationQuaternion.copyFrom(newRot);
      const degrees = angle * (180 / Math.PI);
      log('drag:update', { kind: 'rotation', axis: dragState.axis, angle, degrees });
    }
  }

  const pickPredicate = (m) => m && typeof m.name === 'string' && m.name.startsWith('gizmo2:');

  function pickGizmo() {
    try { return scene.pick(scene.pointerX, scene.pointerY, pickPredicate); }
    catch { return null; }
  }

  function handleMouseOver(ev) {
    if (!enabled) return false;
    if (dragState.active) {
      updateDrag();
      return true;
    }
    const pick = pickGizmo();
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
        if (!entry || entry.enabled === false) { resetHighlight(); return false; }
        setHighlight(planeKey);
        return true;
      }
    }
    resetHighlight();
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

    if (handleKey && handles.has(handleKey)) {
      const entry = handles.get(handleKey);
      if (!entry || entry.enabled === false) return false;
      beginDrag(handleKey, pick.pickedPoint, ev?.pointerId ?? null);
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
    dispose
  };
}
