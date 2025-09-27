// Voxel helpers and hover handling extracted from eventHandler.mjs
import { VoxelType, decompressVox } from '../../voxels/voxelize.mjs';
import { Log } from '../../util/log.mjs';

export function initVoxelHandlers({ scene, engine, camera, state }) {
  function voxelValueAtWorld(space, wx, wy, wz) {
    try {
      if (!space || !space.vox) return VoxelType.Uninstantiated;
      const vox = decompressVox(space.vox);
      const nx = Math.max(1, vox.size?.x || 1);
      const ny = Math.max(1, vox.size?.y || 1);
      const nz = Math.max(1, vox.size?.z || 1);
      const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);
      const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
      let q = BABYLON.Quaternion.Identity();
      const worldAligned = !!(space.vox && space.vox.worldAligned);
      try { if (!worldAligned) { const rx = Number(space.rotation?.x ?? 0) || 0; const ry = (space.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0; const rz = Number(space.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
      const qInv = BABYLON.Quaternion.Inverse(q);
      const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
      const vLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), rotInv);
      const minX = -(nx * res) / 2, minY = -(ny * res) / 2, minZ = -(nz * res) / 2;
      const ix = Math.floor((vLocal.x - minX) / res);
      const iy = Math.floor((vLocal.y - minY) / res);
      const iz = Math.floor((vLocal.z - minZ) / res);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return VoxelType.Uninstantiated;
      const flat = ix + nx * (iy + ny * iz);
      const data = Array.isArray(vox.data) ? vox.data : [];
      return data[flat] ?? VoxelType.Uninstantiated;
    } catch { return VoxelType.Uninstantiated; }
  }

  function doVoxelPickAtPointer(s) {
    try {
      if (!s || !s.vox || !s.vox.size) return;
      const vox = decompressVox(s.vox);
      const nx = Math.max(1, vox.size?.x || 1);
      const ny = Math.max(1, vox.size?.y || 1);
      const nz = Math.max(1, vox.size?.z || 1);
      const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const roW = ray.origin.clone(), rdW = ray.direction.clone();
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      let q = BABYLON.Quaternion.Identity();
      const worldAligned = !!(s.vox && s.vox.worldAligned);
      try { if (!worldAligned) { const rx = Number(s.rotation?.x ?? 0) || 0; const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0; const rz = Number(s.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
      const qInv = BABYLON.Quaternion.Inverse(q);
      const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
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
      if (!(tmax >= Math.max(0, tmin))) return;
      const EPS = 1e-6; let t = Math.max(tmin, 0) + EPS;
      const pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
      const toIdx = (x, y, z) => ({ ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))), iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))), iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))) });
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
      let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
      const yCut = ny - hideTop;
      const data = Array.isArray(vox.data) ? vox.data : [];
      let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
      while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
        if (iy < yCut) {
          const flat = ix + nx * (iy + ny * iz);
          const v = data[flat] ?? VoxelType.Uninstantiated;
          if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
            try { s.voxPick = { x: ix, y: iy, z: iz, v }; } catch {}
            try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: ix, j: iy, k: iz, v } })); } catch {}
            return;
          }
        }
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
        else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
        else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
      }
    } catch (e) { try { Log.log('ERROR', 'VXL:doPick', { error: String(e?.message||e) }); } catch {} }
  }

  function voxelHitAtPointerForSpace(s) {
    try {
      if (!s || !s.vox || !s.vox.size) return null;
      const vox = decompressVox(s.vox);
      const nx = Math.max(1, vox.size?.x || 1);
      const ny = Math.max(1, vox.size?.y || 1);
      const nz = Math.max(1, vox.size?.z || 1);
      const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const roW = ray.origin.clone(), rdW = ray.direction.clone();
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      let q = BABYLON.Quaternion.Identity();
      const worldAligned = !!(s.vox && s.vox.worldAligned);
      try { if (!worldAligned) { const rx = Number(s.rotation?.x ?? 0) || 0; const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0; const rz = Number(s.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
      const qInv = BABYLON.Quaternion.Inverse(q);
      const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
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
      let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
      const yCut = ny - hideTop;
      const data = Array.isArray(vox.data) ? vox.data : [];
      let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
      while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
        if (iy < yCut) {
          const flat = ix + nx * (iy + ny * iz);
          const v = data[flat] ?? VoxelType.Uninstantiated;
          if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) return { hit: true, t, ix, iy, iz, v };
        }
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
        else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
        else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
      }
      return null;
    } catch { return null; }
  }

  function initVoxelHover({ isGizmoBusy } = {}) {
    let _lastMoveAt = 0;
    scene.onPointerObservable.add((pi) => {
      try {
        if (pi.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;
        try { if (localStorage.getItem('dw:ui:hoverVoxel') !== '1') return; } catch {}
        try { if (isGizmoBusy && isGizmoBusy()) return; } catch {}
        let s = null;
        const sel = Array.from(state.selection || []);
        if (sel.length === 1) { s = (state?.barrow?.spaces || []).find(x => x && x.id === sel[0]); }
        if (!s) {
          try { const sp = scene.pick(scene.pointerX, scene.pointerY, (m) => m && typeof m.name === 'string' && m.name.startsWith('space:')); if (sp?.hit && sp.pickedMesh) { const pickedName = String(sp.pickedMesh.name||''); const id = pickedName.slice('space:'.length).split(':')[0]; s = (state?.barrow?.spaces || []).find(x => x && x.id === id) || null; } } catch {}
        }
        if (!s && state.mode === 'cavern' && state._scry?.spaceId) { s = (state?.barrow?.spaces || []).find(x => x && x.id === state._scry.spaceId) || null; }
        if (!s || !s.vox || !s.vox.size) return;
        if (state.lockedVoxPick && state.lockedVoxPick.id === s.id) return;
        const now = performance.now ? performance.now() : Date.now(); if (now - _lastMoveAt < 25) return; _lastMoveAt = now;
        // DDA identical to click path
        const vox = decompressVox(s.vox);
        const nx = Math.max(1, vox.size?.x || 1), ny = Math.max(1, vox.size?.y || 1), nz = Math.max(1, vox.size?.z || 1);
        const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
        const roW = ray.origin.clone(), rdW = ray.direction.clone();
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        let q = BABYLON.Quaternion.Identity(); const worldAligned = !!(s.vox && s.vox.worldAligned);
        try { if (!worldAligned) { const rx = Number(s.rotation?.x ?? 0) || 0; const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0; const rz = Number(s.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
        const qInv = BABYLON.Quaternion.Inverse(q);
        const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
        const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
        const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
        const minX = -(nx * res) / 2, maxX = +(nx * res) / 2; const minY = -(ny * res) / 2, maxY = +(ny * res) / 2; const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
        const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
        const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
        const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
        const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
        const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
        const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
        if (!(tmax >= Math.max(0, tmin))) return;
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
        let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
        const yCut = ny - hideTop; const data = Array.isArray(vox.data) ? vox.data : [];
        let guard = 0, guardMax = (nx + ny + nz) * 3 + 10; let changed = false;
        while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
          if (iy < yCut) {
            const flat = ix + nx * (iy + ny * iz);
            const v = data[flat] ?? VoxelType.Uninstantiated;
            if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
              const prev = s.voxPick; if (!prev || prev.x !== ix || prev.y !== iy || prev.z !== iz) changed = true;
              s.voxPick = { x: ix, y: iy, z: iz, v }; break;
            }
          }
          if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
          else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
          else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
        }
        if (changed) { try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: s.voxPick.x, j: s.voxPick.y, k: s.voxPick.z, v: s.voxPick.v } })); } catch {} }
      } catch {}
    });
  }

  return { voxelValueAtWorld, doVoxelPickAtPointer, voxelHitAtPointerForSpace, initVoxelHover };
}

