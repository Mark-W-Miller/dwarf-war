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

export function rebuildConnectMeshes({ scene, state, path }) {
  if (!scene || !state) return null;
  const connect = ensureConnectState(state);
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

  const line = BABYLON.MeshBuilder.CreateLines('connect:proposal', { points: pts, updatable: true }, scene);
  line.color = new BABYLON.Color3(0.55, 0.9, 1.0);
  line.isPickable = false;
  line.renderingGroupId = 3;
  connect.props.push({ name: 'connect:proposal', mesh: line });

  for (let i = 0; i < pts.length; i++) {
    const sphere = BABYLON.MeshBuilder.CreateSphere(`connect:node:${i}`, { diameter: 1.2 }, scene);
    sphere.position.copyFrom(pts[i]);
    sphere.isPickable = true;
    sphere.renderingGroupId = 3;
    sphere.alwaysSelectAsActiveMesh = true;
    const mat = new BABYLON.StandardMaterial(`connect:node:${i}:mat`, scene);
    mat.emissiveColor = new BABYLON.Color3(0.6, 0.9, 1.0);
    mat.diffuseColor = new BABYLON.Color3(0.15, 0.25, 0.35);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.zOffset = 8;
    sphere.material = mat;
    connect.nodes.push({ i, mesh: sphere });
  }

  const radius = segmentRadius(state);
  const tessellation = 12;
  for (let i = 0; i < pts.length - 1; i++) {
    const mesh = BABYLON.MeshBuilder.CreateTube(`connect:seg:${i}`, {
      path: [pts[i], pts[i + 1]],
      radius,
      tessellation,
      updatable: true
 }, scene);
    mesh.isPickable = true;
    mesh.renderingGroupId = 3;
    mesh.visibility = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    const mat = new BABYLON.StandardMaterial(`connect:seg:${i}:mat`, scene);
    mat.alpha = 0;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mesh.material = mat;
    connect.segs.push({ i, mesh, radius, tessellation });
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
    rebuildConnectMeshes({ scene, state, path });
    return;
  }

  for (const node of connect.nodes || []) {
    const idx = Number(node?.i);
    const mesh = node?.mesh;
    if (!Number.isFinite(idx) || !mesh || !pts[idx]) continue;
    mesh.position.copyFrom(pts[idx]);
  }

  if (!Array.isArray(connect.segs) || connect.segs.length !== pts.length - 1) {
    rebuildConnectMeshes({ scene, state, path });
    return;
  }

  for (const seg of connect.segs || []) {
    const idx = Number(seg?.i);
    const mesh = seg?.mesh;
    if (!Number.isFinite(idx) || !mesh || !pts[idx] || !pts[idx + 1]) continue;
    const radius = Number(seg?.radius) || segmentRadius(state);
    const tessellation = Number(seg?.tessellation) || 12;
    seg.radius = radius;
    seg.tessellation = tessellation;
    BABYLON.MeshBuilder.CreateTube(mesh.name, {
      path: [pts[idx], pts[idx + 1]],
      radius,
      tessellation,
      updatable: true,
      instance: mesh
 }, scene);
    mesh.visibility = 0;

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
  state.barrow.connect = { path: path.map(ensurePoint) };

}
