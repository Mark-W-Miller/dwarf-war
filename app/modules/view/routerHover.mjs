// Router hover handling: gizmos, PP nodes, spaces, voxels
import { log } from '../util/log.mjs';
import { decompressVox } from '../voxels/voxelize.mjs';

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
  log('HOVER', 'gizmo:moveDisc', { name: String(mesh?.name || '') });
}
function resetDiscMat(mat) {
  if (!mat) return; const base = mat.metadata?.baseColor || null; if (base) mat.emissiveColor = base.clone(); if ('baseAlpha' in (mat.metadata || {})) mat.alpha = mat.metadata.baseAlpha;
}

// ————— Voxels —————
function voxelHoverForSpace(routerState, space) {
  const { scene, camera, state } = routerState;
  const x = scene.pointerX, y = scene.pointerY;
  // Default ON: only a stored '0' disables
  let lv = null; try { lv = localStorage.getItem('dw:ui:hoverVoxel'); } catch {}
  const enabled = (lv == null || lv === '' || lv === '1');
  if (!enabled) { if (routerLogsEnabled()) log('HOVER_VOXEL', 'off', { id: space?.id || null, x, y, pref: lv }); return false; }
  if (!space || !space.vox || !space.vox.size) { if (routerLogsEnabled()) log('HOVER_VOXEL', 'noSpaceOrVox', { id: space?.id || null, x, y }); return false; }
  const worldAligned = !!(space.vox && space.vox.worldAligned);
  if (routerLogsEnabled()) log('HOVER_VOXEL', 'start', { id: space.id, hasVox: true, worldAligned, x, y });
  // Do not highlight voxels for selected spaces (requested behavior)
  const isSelected = !!(state?.selection && state.selection.has(space.id));
  if (isSelected) {
    if (routerLogsEnabled()) log('HOVER_VOXEL', 'selectedSkip', { id: space.id });
    return false;
  }
  if (state.lockedVoxPick && state.lockedVoxPick.id === space.id) { if (routerLogsEnabled()) log('HOVER_VOXEL', 'locked', { id: space.id, x, y }); return false; }
  routerState._voxHoverLast = routerState._voxHoverLast || 0;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - routerState._voxHoverLast < 25) { if (routerLogsEnabled()) log('HOVER_VOXEL', 'throttleSkip', { id: space.id, dt: now - routerState._voxHoverLast }); return true; }
  routerState._voxHoverLast = now;

  const vox = decompressVox(space.vox);
  const nx = Math.max(1, vox.size?.x || 1);
  const ny = Math.max(1, vox.size?.y || 1);
  const nz = Math.max(1, vox.size?.z || 1);
  const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);
  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
  const roW = ray.origin, rdW = ray.direction;
  const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
  let q = BABYLON.Quaternion.Identity();
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
  if (!(tmax >= Math.max(0, tmin))) { if (routerLogsEnabled()) log('HOVER_VOXEL', 'aabbMiss', { id: space.id, x, y }); return false; }
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
  let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(space.voxExposeTop || 0) || 0))); } catch {}
  const yCut = ny - hideTop; const data = Array.isArray(vox.data) ? vox.data : [];
  let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
  while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
    if (iy < yCut) {
      const flat = ix + nx * (iy + ny * iz);
      const v = data[flat] ?? 0;
      if (v !== 0) {
        const prev = space.voxPick || null;
        if (!prev || prev.x !== ix || prev.y !== iy || prev.z !== iz) {
          space.voxPick = { x: ix, y: iy, z: iz, v };
          try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: space.id, i: ix, j: iy, k: iz, v } })); } catch {}
          // Compute world-space center of the hovered voxel for diagnostics
          const lx = minX + (ix + 0.5) * res;
          const ly = minY + (iy + 0.5) * res;
          const lz = minZ + (iz + 0.5) * res;
          const localCenter = new BABYLON.Vector3(lx, ly, lz);
          let worldCenter = localCenter.clone();
          if (!worldAligned) {
            const rotM = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero());
            worldCenter = BABYLON.Vector3.TransformCoordinates(localCenter, rotM);
          }
          worldCenter.x += cx; worldCenter.y += cy; worldCenter.z += cz;
          log('HOVER_VOXEL', 'hover', {
            id: space.id,
            i: ix, j: iy, k: iz, v,
            x: scene.pointerX, y: scene.pointerY,
            world: { x: worldCenter.x, y: worldCenter.y, z: worldCenter.z },
            res
          });

          // Draw a transient hover voxel box for unselected spaces
          try {
            const isSelected = !!(state?.selection && state.selection.has(space.id));
            if (!isSelected) {
              ensureVoxelHoverBox(routerState, space, new BABYLON.Vector3(lx, ly, lz), q, res);
            }
          } catch {}
        }
        return true;
      }
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
    else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
    else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
  }
  if (routerLogsEnabled()) log('HOVER_VOXEL', 'noVoxelHit', { id: space.id, x, y });
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

  // 1) PP node hover (highest priority)
  const ppHit = pickPPNode({ scene, x, y });
  if (ppHit && ppHit.pickedMesh) {
    clearSpaceHover(routerState);
    clearVoxelHover(routerState);
    setHoverPPNode(routerState, ppHit.pickedMesh);
    return;
  }

  // 2) Gizmo hover (move axes/disc, then rotation rings)
  const moveHit = pickMoveGizmo({ scene, x, y });
  if (moveHit && moveHit.pickedMesh) {
    const name = String(moveHit.pickedMesh.name || '');
    clearPPHover(routerState);
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
      clearSpaceHover(routerState);
      clearVoxelHover(routerState);
      setHoverRotAxis(routerState, axis);
      return;
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
