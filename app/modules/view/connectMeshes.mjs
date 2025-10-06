// Shared helpers for proposed path (PP) meshes: line, nodes, and pickable segments.

function ensureVector3(p) {
  const x = Number(p?.x) || 0;
  const y = Number(p?.y) || 0;
  const z = Number(p?.z) || 0;
  return new BABYLON.Vector3(x, y, z);
}

function ensurePoint(p) {
  return { x: Number(p?.x) || 0, y: Number(p?.y) || 0, z: Number(p?.z) || 0 };
}

function segmentRadius(state) {
  const base = Number(state?.barrow?.meta?.voxelSize) || 0;
  if (base > 0) return Math.max(0.32, base * 0.22);
  return 0.35;
}

export function ensureConnectState(state) {
  if (!state) return null;
  const connect = (state._connect = state._connect || {});
  if (!Array.isArray(connect.props)) connect.props = [];
  if (!Array.isArray(connect.nodes)) connect.nodes = [];
  if (!Array.isArray(connect.segs)) connect.segs = [];
  if (!(connect.sel instanceof Set)) connect.sel = new Set();
  if (typeof connect.nodeSize !== 'number') {
    if (typeof connect.nodeDiameter === 'number' && Number.isFinite(connect.nodeDiameter)) {
      connect.nodeSize = Number(connect.nodeDiameter);
    } else {
      connect.nodeSize = (connect.nodeSize && Number.isFinite(connect.nodeSize)) ? Number(connect.nodeSize) : null;
    }
  }
  if (typeof connect.nodeDiameter !== 'undefined') delete connect.nodeDiameter;
  return connect;
}

export function disposeConnectMeshes(state) {
  const connect = ensureConnectState(state);
  if (!connect) return;
  for (const entry of connect.props || []) {
    entry?.mesh?.dispose?.();
  }
  for (const entry of connect.nodes || []) {
    entry?.mesh?.dispose?.();
  }
  for (const entry of connect.segs || []) {
    entry?.mesh?.dispose?.();
  }
  connect.props = [];
  connect.nodes = [];
  connect.segs = [];
}

export function rebuildConnectMeshes({ scene, state, path, nodeSize }) {
  if (!scene || !state) return null;
  const connect = ensureConnectState(state);
  if (Number.isFinite(nodeSize) && nodeSize > 0) {
    connect.nodeSize = Number(nodeSize);
  }
  const points = Array.isArray(path) ? path : connect?.path;
  if (!Array.isArray(points) || points.length < 2) {
    disposeConnectMeshes(state);
    connect.path = Array.isArray(points) ? points.map(ensurePoint) : null;
    return null;
  }

  const sanitized = points.map(ensurePoint);
  connect.path = sanitized;

  disposeConnectMeshes(state);

  const pts = sanitized.map(ensureVector3);
  const baseRes = Number(state?.barrow?.meta?.voxelSize) || 1;
  const defaultNodeSize = Math.max(baseRes, baseRes * 12);
  const cubeSize = (Number.isFinite(connect.nodeSize) && connect.nodeSize > 0) ? connect.nodeSize : defaultNodeSize;

  const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: true }, scene);
  line.color = new BABYLON.Color3(0.55, 0.9, 1.0);
  line.isPickable = false;
  line.renderingGroupId = 3;
  connect.props.push({ name: 'connect:proposal', mesh: line });

  for (let i = 0; i < pts.length; i++) {
    const cube = BABYLON.MeshBuilder.CreateBox(`connect:node:${i}`, { size: cubeSize }, scene);
    cube.position.copyFrom(pts[i]);
    cube.isPickable = true;
    cube.renderingGroupId = 3;
    cube.alwaysSelectAsActiveMesh = true;
    const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
    mat.emissiveColor = new BABYLON.Color3(0.6, 0.9, 1.0);
    mat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.35);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.zOffset = 8;
    cube.material = mat;
    connect.nodes.push({ i, mesh: cube });
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const start = pts[i];
    const end = pts[i + 1];
    const segVec = end.subtract(start);
    const length = segVec.length();
    const mid = start.add(end).scale(0.5);
    const mesh = BABYLON.MeshBuilder.CreateBox(`connect:seg:${i}`, { size: 1 }, scene);
    mesh.scaling.set(cubeSize, cubeSize, Math.max(length, 0.001));
    mesh.isPickable = true;
    mesh.renderingGroupId = 3;
    mesh.alwaysSelectAsActiveMesh = true;
    const mat = new BABYLON.StandardMaterial(`connect:seg:${i}:mat`, scene);
    mat.alpha = 0.35;
    mat.diffuseColor = new BABYLON.Color3(0.12, 0.36, 0.65);
    mat.emissiveColor = new BABYLON.Color3(0.18, 0.5, 0.85);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    mat.backFaceCulling = false;
    mat.disableLighting = false;
    mesh.material = mat;
    mesh.position.copyFrom(mid);
    const dir = segVec.normalize();
    const up = Math.abs(dir.y) < 0.999 ? BABYLON.Axis.Y : BABYLON.Axis.Z;
    const xAxis = BABYLON.Vector3.Cross(up, dir).normalize();
    const yAxis = BABYLON.Vector3.Cross(dir, xAxis).normalize();
    const rotationMatrix = BABYLON.Matrix.Identity();
    BABYLON.Matrix.FromXYZAxesToRef(xAxis, yAxis, dir, rotationMatrix);
    mesh.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(rotationMatrix);
    connect.segs.push({ i, mesh, size: cubeSize });
  }

  return { line, nodes: connect.nodes, segs: connect.segs };
}

export function updateConnectMeshesGeometry({ scene, state }) {
  if (!scene || !state) return;
  const connect = ensureConnectState(state);
  const path = Array.isArray(connect?.path) ? connect.path : null;
  if (!path || path.length < 2) {
    disposeConnectMeshes(state);
    return;
  }

  const pts = path.map(ensureVector3);

  const lineEntry = (connect.props || []).find((p) => p && p.name === 'connect:proposal');
  if (lineEntry?.mesh) {
    BABYLON.MeshBuilder.CreateLines('connect:proposal', {
      points: pts,
      updatable: true,
      instance: lineEntry.mesh
 }, scene);

  }

  if (!Array.isArray(connect.nodes) || connect.nodes.length !== pts.length) {
    rebuildConnectMeshes({ scene, state, path, nodeSize: connect.nodeSize });
    return;
  }

  for (const node of connect.nodes || []) {
    const idx = Number(node?.i);
    const mesh = node?.mesh;
    if (!Number.isFinite(idx) || !mesh || !pts[idx]) continue;
    mesh.position.copyFrom(pts[idx]);
  }

  if (!Array.isArray(connect.segs) || connect.segs.length !== pts.length - 1) {
    rebuildConnectMeshes({ scene, state, path, nodeSize: connect.nodeSize });
    return;
  }

  for (const seg of connect.segs || []) {
    const idx = Number(seg?.i);
    const mesh = seg?.mesh;
    if (!Number.isFinite(idx) || !mesh || !pts[idx] || !pts[idx + 1]) continue;
    const start = pts[idx];
    const end = pts[idx + 1];
    const segVec = end.subtract(start);
    const length = segVec.length();
    const mid = start.add(end).scale(0.5);
    const size = Number(seg?.size) || connect.nodeSize || Math.max(Number(state?.barrow?.meta?.voxelSize) || 1, (Number(state?.barrow?.meta?.voxelSize) || 1) * 12);
    mesh.scaling.set(size, size, Math.max(length, 0.001));
    mesh.position.copyFrom(mid);
    const dir = segVec.normalize();
    const up = Math.abs(dir.y) < 0.999 ? BABYLON.Axis.Y : BABYLON.Axis.Z;
    const xAxis = BABYLON.Vector3.Cross(up, dir).normalize();
    const yAxis = BABYLON.Vector3.Cross(dir, xAxis).normalize();
    const rotationMatrix = BABYLON.Matrix.Identity();
    BABYLON.Matrix.FromXYZAxesToRef(xAxis, yAxis, dir, rotationMatrix);
    mesh.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(rotationMatrix);
    seg.size = size;
  }
}

export function syncConnectPathToDb(state) {
  if (!state) return;
  const path = Array.isArray(state?._connect?.path) ? state._connect.path : null;
  if (!path || path.length < 2) {
    if (state?.barrow) state.barrow.connect = null;
    return;
  }
  state.barrow = state.barrow || {};
  const nodeSize = Number(state?._connect?.nodeSize);
  state.barrow.connect = {
    path: path.map(ensurePoint),
    nodeSize: Number.isFinite(nodeSize) && nodeSize > 0 ? nodeSize : undefined,
  };

}
