// Router hover handling: gizmos, PP nodes, spaces, voxels
import { log } from '../util/log.mjs';
import { decompressVox, VoxelType } from '../voxels/voxelize.mjs';

// ————— Local logging gate —————
function routerLogsEnabled() {
  const v = localStorage.getItem('dw:dev:routerLogs');
  return (v ?? '1') === '1';
}

// ————— Pickers (exported so click router can reuse) —————
export function pickPPNode({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('connect:node:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
export function pickConnectGizmo({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('connectGizmo:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
export function pickRotGizmo({ scene, x, y }) {
  const r = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('rotGizmo:')
  );
  return r?.hit && r.pickedMesh ? r : null;
}
export function pickMoveGizmo({ scene, x, y }) {
  // Prefer arrow axes first; fall back to the blue disc
  const ma = scene.pick(x, y,
    (m) => {
      const n = m && m.name ? String(m.name) : '';
      return n.startsWith('moveGizmo:') && !n.startsWith('moveGizmo:disc:');
    }
  );
  if (ma?.hit && ma.pickedMesh) return ma;
  const md = scene.pick(x, y,
    (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:')
  );
  return md?.hit && md.pickedMesh ? md : null;
}
export function pickSpace({ scene, state, x, y }) {
  // Primary: triangle-accurate pick against base space meshes only `space:<id>`
  const r = scene.pick(x, y,
    (m) => {
      const n = m && m.name ? String(m.name) : '';
      if (!n.startsWith('space:')) return false;
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
  // Optional fallback (off by default)
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
      if (!best || info.distance < best.distance) best = { hit: true, pickedMesh: mesh, distance: info.distance };
    }
  }
  if (routerLogsEnabled()) {
    if (best) {
      const name = String(best.pickedMesh?.name || '');
      log('PICK', 'space:hit:fallback', { name, distance: best.distance ?? null, hits, x, y });
    } else {
      log('PICK', 'space:miss:both', { x, y, spaces: (state?.built?.spaces||[]).length });
    }
  }
  return best || null;
}

// ————— Hover helpers (PP nodes) —————
function ppNameFromMat(mat) {
  const nm = String(mat?.name || '');
  return nm.startsWith('connect:node:') ? nm.replace(/:mat$/i, '') : null;
}
function setPPNodeColorForSelection(routerState, mat) {
  const name = ppNameFromMat(mat);
  const sel = (routerState?.state?._connect?.sel instanceof Set) ? routerState.state._connect.sel : null;
  const isSelected = !!(name && sel && sel.has(name));
  const red = new BABYLON.Color3(0.95, 0.2, 0.2);
  const blue = new BABYLON.Color3(0.6, 0.9, 1.0);
  mat.emissiveColor = isSelected ? red : blue;
}
function setHoverPPNode(routerState, mesh) {
  const mat = mesh?.material || null;
  if (!mat) return clearPPHover(routerState);
  if (routerState.ppHover?.mat === mat) return;
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
  if (!prev.mat) { log('HOVER_DETAIL', 'pp:clear', { had: false }); return; }
  const name = prev.name || ppNameFromMat(prev.mat) || null;
  const sel = (routerState?.state?._connect?.sel instanceof Set) ? routerState.state._connect.sel : null;
  const selected = !!(name && sel && sel.has(name));
  setPPNodeColorForSelection(routerState, prev.mat);
  routerState.ppHover = { mat: null, name: null };
  log('HOVER_DETAIL', 'pp:clear', { had: true, name, selected });
}

// ————— Hover helpers (spaces) —————
function setHoverSpaceOutline(routerState, id) {
  const { scene, state } = routerState;
  if (routerState.hoverSpace?.id === id && routerState.hoverSpace.mesh && !routerState.hoverSpace.mesh.isDisposed?.()) return; // unchanged
  clearSpaceHover(routerState);
  const s = (state?.barrow?.spaces || []).find((x) => x && String(x.id) === String(id));
  if (!s) return;
  const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
  const w = (s.size?.x || 0) * sr, h = (s.size?.y || 0) * sr, d = (s.size?.z || 0) * sr;
  const hx = w/2, hy = h/2, hz = d/2;
  const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
  const rx = Number(s.rotation?.x ?? 0) || 0;
  const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
  const rz = Number(s.rotation?.z ?? 0) || 0;
  const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
  const mtx = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
  const locals = [
    new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz),
    new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz),
    new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz),
    new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz)
  ];
  const cs = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, mtx));
  const edges = [
    [cs[0], cs[1]], [cs[1], cs[3]], [cs[3], cs[2]], [cs[2], cs[0]],
    [cs[4], cs[5]], [cs[5], cs[7]], [cs[7], cs[6]], [cs[6], cs[4]],
    [cs[0], cs[4]], [cs[1], cs[5]], [cs[2], cs[6]], [cs[3], cs[7]]
  ];
  const lines = BABYLON.MeshBuilder.CreateLineSystem(`hover:obb:${id}`, { lines: edges }, scene);
  lines.isPickable = false; lines.renderingGroupId = 3; lines.color = new BABYLON.Color3(0.28, 0.62, 0.95);
  routerState.hoverSpace = { id, mesh: lines };
  log('HOVER', 'space:hover', { id });
}
export function clearSpaceHover(routerState) {
  const prev = routerState?.hoverSpace || { id: null, mesh: null };
  const had = !!(prev.mesh && !prev.mesh.isDisposed?.());
  if (had) prev.mesh.dispose();
  routerState.hoverSpace = { id: null, mesh: null };
  log('HOVER', 'space:clear', { had, prevId: prev.id || null });
}

// ————— Hover helpers (gizmo visuals) —————
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
  if (!metaMat.metadata.baseColor && metaMat.emissiveColor) metaMat.metadata.baseColor = metaMat.emissiveColor.clone();
}
function dimRotRings(scene) {
  const mats = findRotRingMats(scene);
  const kDim = 0.35;
  for (const key of ['x','y','z']) {
    const m = mats[key]; if (!m) continue; ensureBaseColor(m);
    const base = m.metadata?.baseColor || m.emissiveColor || new BABYLON.Color3(1,1,1);
    m.emissiveColor = base.scale(kDim);
    m.diffuseColor = base.scale(0.05 + 0.15 * kDim);
  }
}
function setRotRingActive(scene, axis) {
  const mats = findRotRingMats(scene);
  const kActive = 1.1, kDim = 0.35;
  for (const key of ['x','y','z']) {
    const m = mats[key]; if (!m) continue; ensureBaseColor(m);
    const base = m.metadata?.baseColor || m.emissiveColor || new BABYLON.Color3(1,1,1);
    const k = (key === axis) ? kActive : kDim;
    m.emissiveColor = base.scale(k);
    m.diffuseColor = base.scale(0.05 + 0.15 * k);
  }
}
function setHoverRotAxis(routerState, axis) {
  const { scene } = routerState;
  dimRotRings(scene);
  setRotRingActive(scene, axis);
  routerState.hover = { kind: 'rotAxis', axis, mat: null };
  log('HOVER', 'gizmo:rot', { axis });
}
function setHoverMoveAxis(routerState, mesh) {
  const mat = mesh?.material || null;
  if (!mat) return;
  const base = mat.metadata?.baseColor || mat.emissiveColor || new BABYLON.Color3(1,1,1);
  const k = 1.35; ensureBaseColor(mat);
  mat.emissiveColor = base.scale(k);
  mat.diffuseColor = base.scale(0.25);
  let axis = null; const nm = String(mesh?.name || '');
  if (nm.startsWith('moveGizmo:x:') || nm.startsWith('moveGizmo:X:')) axis = 'x';
  else if (nm.startsWith('moveGizmo:y:') || nm.startsWith('moveGizmo:Y:')) axis = 'y';
  else if (nm.startsWith('moveGizmo:z:') || nm.startsWith('moveGizmo:Z:')) axis = 'z';
  routerState.hover = { kind: 'moveAxis', axis, mat };
  log('HOVER', 'gizmo:moveAxis', { name: nm, axis });
}
function resetMoveMat(mat) {
  if (!mat) return; const base = mat.metadata?.baseColor || null; if (base) { mat.emissiveColor = base.clone(); mat.diffuseColor = base.scale(0.25); }
}
function setHoverMoveDisc(routerState, mesh) {
  const mat = mesh?.material || null;
  if (!mat) return;
  mat.metadata = mat.metadata || {};
  if (mat.emissiveColor && !mat.metadata.baseColor) mat.metadata.baseColor = mat.emissiveColor.clone();
  if (typeof mat.alpha === 'number' && !('baseAlpha' in mat.metadata)) mat.metadata.baseAlpha = mat.alpha;
  const base = mat.metadata?.baseColor || mat.emissiveColor || new BABYLON.Color3(0.12,0.42,0.85);
  mat.emissiveColor = base.scale(1.35);
  if (typeof mat.alpha === 'number') mat.alpha = Math.min(0.5, (mat.metadata.baseAlpha ?? mat.alpha) * 1.6);
  routerState.hover = { kind: 'moveDisc', axis: null, mat };
  log('HOVER', 'gizmo:moveDisc', { name: String(mesh?.name || '') });
}
function resetDiscMat(mat) {
  if (!mat) return; const base = mat.metadata?.baseColor || null; if (base) mat.emissiveColor = base.clone(); if ('baseAlpha' in (mat.metadata || {})) mat.alpha = mat.metadata.baseAlpha;
}

// ————— Voxels —————
function isVoxelHoverEnabled(space, x, y) {
  let pref = null;
  try { pref = localStorage.getItem('dw:ui:hoverVoxel'); }
  catch {}
  const enabled = pref == null || pref === '' || pref === '1';
  if (!enabled && routerLogsEnabled()) {
    log('HOVER_VOXEL', 'off', { id: space?.id || null, x, y, pref });
  }
  return enabled;
}

function isSpaceBlockedFromHover(state, space, x, y) {
  if (!space || !space.vox || !space.vox.size) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'noSpaceOrVox', { id: space?.id || null, x, y });
    return true;
  }
  if (state?.selection && state.selection.has(space.id)) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'selectedSkip', { id: space.id });
    return true;
  }
  if (state.lockedVoxPick && state.lockedVoxPick.id === space.id) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'locked', { id: space.id, x, y });
    return true;
  }
  return false;
}

function isHoverThrottled(routerState) {
  routerState._voxHoverLast = routerState._voxHoverLast || 0;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const elapsed = now - routerState._voxHoverLast;
  if (elapsed < 25) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'throttleSkip', { dt: elapsed });
    return true;
  }
  routerState._voxHoverLast = now;
  return false;
}

function buildVoxelHoverContext({ scene, camera, state, space }) {
  const vox = decompressVox(space.vox);
  const nx = Math.max(1, vox.size?.x || 1);
  const ny = Math.max(1, vox.size?.y || 1);
  const nz = Math.max(1, vox.size?.z || 1);
  const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);

  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
  const originWorld = ray.origin;
  const dirWorld = ray.direction;

  const cx = space.origin?.x || 0;
  const cy = space.origin?.y || 0;
  const cz = space.origin?.z || 0;

  const worldAligned = !!(space.vox && space.vox.worldAligned);
  let rotation = BABYLON.Quaternion.Identity();
  if (!worldAligned) {
    const rx = Number(space.rotation?.x ?? 0) || 0;
    const ry = (space.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0;
    const rz = Number(space.rotation?.z ?? 0) || 0;
    rotation = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
  }

  const inverseRotation = BABYLON.Matrix.Compose(
    new BABYLON.Vector3(1, 1, 1),
    BABYLON.Quaternion.Inverse(rotation),
    BABYLON.Vector3.Zero()
  );

  const originLocal = BABYLON.Vector3.TransformCoordinates(
    originWorld.subtract(new BABYLON.Vector3(cx, cy, cz)),
    inverseRotation
  );
  const directionLocal = BABYLON.Vector3.TransformNormal(dirWorld, inverseRotation);

  const minX = -(nx * res) / 2;
  const minY = -(ny * res) / 2;
  const minZ = -(nz * res) / 2;
  const maxX = -minX;
  const maxY = -minY;
  const maxZ = -minZ;

  const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
  const tx1 = (minX - originLocal.x) * inv(directionLocal.x);
  const tx2 = (maxX - originLocal.x) * inv(directionLocal.x);
  const ty1 = (minY - originLocal.y) * inv(directionLocal.y);
  const ty2 = (maxY - originLocal.y) * inv(directionLocal.y);
  const tz1 = (minZ - originLocal.z) * inv(directionLocal.z);
  const tz2 = (maxZ - originLocal.z) * inv(directionLocal.z);

  const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
  const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
  if (!(tmax >= Math.max(0, tmin))) return null;

  const EPS = 1e-6;
  let t = Math.max(tmin, 0) + EPS;

  const firstPoint = new BABYLON.Vector3(
    originLocal.x + directionLocal.x * t,
    originLocal.y + directionLocal.y * t,
    originLocal.z + directionLocal.z * t
  );

  const toIndex = (lx, ly, lz) => ({
    ix: Math.min(nx - 1, Math.max(0, Math.floor((lx - minX) / res))),
    iy: Math.min(ny - 1, Math.max(0, Math.floor((ly - minY) / res))),
    iz: Math.min(nz - 1, Math.max(0, Math.floor((lz - minZ) / res)))
  });

  const cell = toIndex(firstPoint.x, firstPoint.y, firstPoint.z);
  const stepX = directionLocal.x > 0 ? 1 : directionLocal.x < 0 ? -1 : 0;
  const stepY = directionLocal.y > 0 ? 1 : directionLocal.y < 0 ? -1 : 0;
  const stepZ = directionLocal.z > 0 ? 1 : directionLocal.z < 0 ? -1 : 0;
  const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;

  let tMaxX = stepX !== 0 ? (nextBound(cell.ix, stepX, minX) - originLocal.x) / directionLocal.x : Infinity;
  let tMaxY = stepY !== 0 ? (nextBound(cell.iy, stepY, minY) - originLocal.y) / directionLocal.y : Infinity;
  let tMaxZ = stepZ !== 0 ? (nextBound(cell.iz, stepZ, minZ) - originLocal.z) / directionLocal.z : Infinity;
  const tDeltaX = stepX !== 0 ? Math.abs(res / directionLocal.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(res / directionLocal.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(res / directionLocal.z) : Infinity;

  let hideTop = 0;
  try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(space.voxExposeTop || 0) || 0))); }
  catch {}
  const yCut = ny - hideTop;
  const data = Array.isArray(vox.data) ? vox.data : [];

  if (routerLogsEnabled()) {
    log('HOVER_VOXEL', 'start', {
      id: space.id,
      hasVox: true,
      worldAligned,
      x: scene.pointerX,
      y: scene.pointerY
    });
  }

  return {
    dims: { x: nx, y: ny, z: nz },
    res,
    boundsMin: { x: minX, y: minY, z: minZ },
    data,
    yCut,
    world: {
      aligned: worldAligned,
      quaternion: rotation,
      origin: { x: cx, y: cy, z: cz }
    },
    ray: {
      cell,
      step: { x: stepX, y: stepY, z: stepZ },
      tMax: { x: tMaxX, y: tMaxY, z: tMaxZ },
      tDelta: { x: tDeltaX, y: tDeltaY, z: tDeltaZ },
      t,
      limit: tmax,
      EPS
    },
    pointer: { x: scene.pointerX, y: scene.pointerY }
  };
}

function renderVoxelHover(routerState, state, space, voxelInfo, voxelValue) {
  const { ix, iy, iz, res, minX, minY, minZ, world } = voxelInfo;
  const localCenter = new BABYLON.Vector3(
    minX + (ix + 0.5) * res,
    minY + (iy + 0.5) * res,
    minZ + (iz + 0.5) * res
  );

  let worldCenter = localCenter.clone();
  if (!world.aligned) {
    const rotationMatrix = BABYLON.Matrix.Compose(
      new BABYLON.Vector3(1, 1, 1),
      world.quaternion,
      BABYLON.Vector3.Zero()
    );
    worldCenter = BABYLON.Vector3.TransformCoordinates(localCenter, rotationMatrix);
  }
  worldCenter.x += world.origin.x;
  worldCenter.y += world.origin.y;
  worldCenter.z += world.origin.z;

  const lastHit = routerState._voxHoverLastHit || { id: null, i: -1, j: -1, k: -1 };
  const changed = !(lastHit.id === space.id && lastHit.i === ix && lastHit.j === iy && lastHit.k === iz);
  if (changed && routerLogsEnabled()) {
    log('HOVER_VOXEL', 'hover', {
      id: space.id,
      i: ix,
      j: iy,
      k: iz,
      v: voxelValue,
      pointer: { x: routerState.scene.pointerX, y: routerState.scene.pointerY },
      world: { x: worldCenter.x, y: worldCenter.y, z: worldCenter.z },
      res
    });
  }

  try {
    const isSelected = !!(state?.selection && state.selection.has(space.id));
    if (!isSelected) {
      ensureVoxelHoverBox(routerState, space, localCenter, world.quaternion, res);
    }
  } catch {}

  routerState._voxHoverLastHit = { id: space.id, i: ix, j: iy, k: iz };
}

// Cast a ray through the space's voxel grid and highlight the first solid voxel hit.
// Empty voxels are always skipped (even when the pointer starts inside air),
// mirroring the click behaviour that only tunnels through empties until a solid.
function voxelHoverForSpace(routerState, space) {
  const { scene, camera, state } = routerState;
  const pointerX = scene.pointerX;
  const pointerY = scene.pointerY;

  if (!isVoxelHoverEnabled(space, pointerX, pointerY)) return false;
  if (isSpaceBlockedFromHover(state, space, pointerX, pointerY)) return false;
  if (isHoverThrottled(routerState)) return true;

  const context = buildVoxelHoverContext({ scene, camera, state, space });
  if (!context) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'aabbMiss', { id: space.id, x: pointerX, y: pointerY });
    return false;
  }

  const {
    dims, res, boundsMin, data, yCut,
    world, ray
  } = context;

  let { ix, iy, iz } = ray.cell;
  let { t } = ray;
  const { limit: tLimit, EPS } = ray;
  let { x: tMaxX, y: tMaxY, z: tMaxZ } = ray.tMax;
  const { x: tDeltaX, y: tDeltaY, z: tDeltaZ } = ray.tDelta;
  const { x: stepX, y: stepY, z: stepZ } = ray.step;

  const nx = dims.x, ny = dims.y, nz = dims.z;
  const minX = boundsMin.x, minY = boundsMin.y, minZ = boundsMin.z;
  let guard = 0;
  const guardMax = (nx + ny + nz) * 3 + 10;
  let firstSampleLogged = false;

  while (t <= tLimit + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
    if (iy < yCut) {
      const flatIndex = ix + nx * (iy + ny * iz);
      const rawValue = Number(data[flatIndex] ?? 0);
      const voxelValue = Number.isFinite(rawValue) ? rawValue : 0;

      if (!firstSampleLogged && routerLogsEnabled()) {
        log('HOVER_VOXEL', 'firstSample', {
          id: space.id,
          i: ix,
          j: iy,
          k: iz,
          v: voxelValue,
          pointer: { x: pointerX, y: pointerY }
        });
        firstSampleLogged = true;
      }

      const isSolid = voxelValue === VoxelType.Rock || voxelValue === VoxelType.Wall;
      if (isSolid) {
        if (routerLogsEnabled()) {
          log('HOVER_VOXEL', 'hitSolid', {
            id: space.id,
            i: ix,
            j: iy,
            k: iz,
            v: voxelValue,
            pointer: { x: pointerX, y: pointerY }
          });
        }
        renderVoxelHover(routerState, state, space, {
          ix, iy, iz,
          res,
          minX, minY, minZ,
          world
        }, voxelValue);
        return true;
      }
    }

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) {
      iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY;
    } else {
      iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ;
    }
  }

  if (routerLogsEnabled()) log('HOVER_VOXEL', 'noVoxelHit', { id: space.id, x: pointerX, y: pointerY });
  routerState._voxHoverLastHit = null;
  clearVoxelHover(routerState);
  return false;
}

function ensureVoxelHoverBox(routerState, space, localCenter, q, res) {
  const { scene, state } = routerState;
  // Find parent mesh for this space to place the box in local coordinates
  const parent = (state?.built?.spaces || []).find(x => x && x.id === space.id)?.mesh || null;
  if (!parent) return;
  const size = Math.max(0.001, res * 1.06);
  // Create or reuse
  let hv = routerState._voxHoverBox || null;
  let sameParent = !!(hv && hv.parent === parent);
  if (!hv || hv.isDisposed?.() || !sameParent) {
    try { if (hv) hv.dispose(); } catch {}
    const box = BABYLON.MeshBuilder.CreateBox('hover:voxel', { size }, scene);
    const mat = new BABYLON.StandardMaterial('hover:voxel:mat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.05, 0.2, 0.35);
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.8, 1.0);
    mat.alpha = 0.30; mat.specularColor = new BABYLON.Color3(0,0,0);
    try { mat.disableDepthWrite = true; } catch {}
    box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
    try { box.parent = parent; } catch {}
    try { box.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch {}
    routerState._voxHoverBox = box;
    hv = box;
  }
  // Place box in parent's local space: rotate localCenter into parent space
  const rotM = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero());
  const afterLocal = BABYLON.Vector3.TransformCoordinates(localCenter, rotM);
  hv.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
}

function clearVoxelHover(routerState) {
  try { if (routerState._voxHoverBox && !routerState._voxHoverBox.isDisposed?.()) routerState._voxHoverBox.dispose(); } catch {}
  routerState._voxHoverBox = null;
}

// ————— Main hover entry —————
export function routerHandleHover(routerState) {
  const { scene, state, gesture } = routerState;

  // Clear while camera gesture is active
  if (gesture?.decision) {
    clearPPHover(routerState);
    clearGizmoHover(routerState);
    clearSpaceHover(routerState);
    return;
  }

  // Pointer position (screen)
  const x = scene.pointerX;
  const y = scene.pointerY;
  let rawPick = null;
  try { rawPick = scene.pick(x, y, null); }
  catch (e) {
    try { log('HOVER_DETAIL', 'rawPick:error', { error: String(e && e.message ? e.message : e) }); } catch {}
  }
  if (typeof window !== 'undefined') {
    try {
      window.dwHoverDebug = rawPick?.hit && rawPick.pickedMesh ? {
        name: rawPick.pickedMesh.name || null,
        id: rawPick.pickedMesh.id || null,
        renderGroup: typeof rawPick.pickedMesh.renderingGroupId === 'number' ? rawPick.pickedMesh.renderingGroupId : null,
        parent: rawPick.pickedMesh.parent ? (rawPick.pickedMesh.parent.name || rawPick.pickedMesh.parent.id || null) : null,
        pointer: { x, y }
      } : null;
    } catch {}
  }
  const gizmo2Active = !!((state?._selectionGizmo || state?._testGizmo)?.isActive?.());
  if (gizmo2Active) {
    clearGizmoHover(routerState);
  }

  // 1) PP node hover (highest priority)
  const ppHit = pickPPNode({ scene, x, y });
  if (ppHit && ppHit.pickedMesh) {
    clearSpaceHover(routerState);
    clearVoxelHover(routerState);
    setHoverPPNode(routerState, ppHit.pickedMesh);
    return;
  }

  if (!gizmo2Active) {
    // 2) Gizmo hover (move axes/disc, then rotation rings)
    const moveHit = pickMoveGizmo({ scene, x, y });
    if (moveHit && moveHit.pickedMesh) {
      const name = String(moveHit.pickedMesh.name || '');
      clearPPHover(routerState);
      clearGizmoHover(routerState);
      clearSpaceHover(routerState);
      clearVoxelHover(routerState);
      if (name.startsWith('moveGizmo:disc:')) setHoverMoveDisc(routerState, moveHit.pickedMesh);
      else setHoverMoveAxis(routerState, moveHit.pickedMesh);
      return;
    }

    const rotHit = pickRotGizmo({ scene, x, y });
    if (rotHit && rotHit.pickedMesh) {
      const name = String(rotHit.pickedMesh.name || '');
      const axis = name.startsWith('rotGizmo:Y:') ? 'y'
                 : name.startsWith('rotGizmo:X:') ? 'x'
                 : name.startsWith('rotGizmo:Z:') ? 'z' : null;
      if (axis) {
        clearPPHover(routerState);
        clearGizmoHover(routerState);
        clearSpaceHover(routerState);
        clearVoxelHover(routerState);
        setHoverRotAxis(routerState, axis);
        return;
      }
    }
  }

  // 3) Spaces: prefer voxel hover over OBB when voxel-backed
  const spacePick = pickSpace({ scene, state, x, y });
  if (spacePick && spacePick.pickedMesh) {
    const pickedName = String(spacePick.pickedMesh.name || '');
    const id = pickedName.slice('space:'.length).split(':')[0];
    const isSelected = !!(routerState?.state?.selection && routerState.state.selection.has(id));
    const space = (state?.barrow?.spaces || []).find(s => s && String(s.id) === String(id)) || null;
    const hasVox = !!(space && space.vox && space.vox.size);
    if (hasVox) {
      clearPPHover(routerState);
      // Ensure OBB outline does not linger when voxel hover takes over
      clearSpaceHover(routerState);
      if (voxelHoverForSpace(routerState, space)) return;
      // No voxel hit -> clear any transient box
      clearVoxelHover(routerState);
    }
    if (!isSelected) {
      clearPPHover(routerState);
      setHoverSpaceOutline(routerState, id);
      return;
    }
  }

  // 4) Miss — clear all hover visuals
  const prevSpaceId = routerState?.hoverSpace?.id || null;
  log('HOVER', 'miss:all', { x, y, prevSpaceId, prevHoverKind: routerState?.hover?.kind || null });
  if (routerLogsEnabled()) {
    try {
      if (rawPick?.hit && rawPick.pickedMesh) {
        const mesh = rawPick.pickedMesh;
        log('HOVER_DETAIL', 'miss:raw', {
          mesh: mesh.name || null,
          id: mesh.id || null,
          hasParent: !!mesh.parent,
          renderGroup: typeof mesh.renderingGroupId === 'number' ? mesh.renderingGroupId : null
        });
      } else {
        log('HOVER_DETAIL', 'miss:raw:none', { x, y });
      }
    } catch (e) {
      log('HOVER_DETAIL', 'miss:raw:error', { error: String(e && e.message ? e.message : e) });
    }
  }
  clearPPHover(routerState);
  clearGizmoHover(routerState);
  clearSpaceHover(routerState);
  clearVoxelHover(routerState);
}

// ————— Utilities —————
function clearGizmoHover(routerState) {
  const { scene, hover } = routerState;
  if (!hover || !hover.kind) return;
  if (hover.kind === 'rotAxis') dimRotRings(scene);
  else if (hover.kind === 'moveAxis') resetMoveMat(hover.mat);
  else if (hover.kind === 'moveDisc') resetDiscMat(hover.mat);
  routerState.hover = { kind: null, axis: null, mat: null };
}
