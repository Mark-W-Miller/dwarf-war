import { aabbFromSpace, worldAabbFromSpace } from './schema.mjs';
import { VoxelType, decompressVox } from '../voxels/voxelize.mjs';
import { Log } from '../util/log.mjs';

function vLog(msg, data) { try { Log.log('VOXEL', msg, data); } catch {} }
function errLog(ctx, e) { try { Log.log('ERROR', ctx, { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {} }

// ——————————— Module-scope helpers so both sync and async paths can use them ———————————
function Vox_toLocal(s, wx, wy, wz) {
  const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
  const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
  const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
  const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
  try {
    if (typeof BABYLON !== 'undefined' && BABYLON.Matrix && BABYLON.Quaternion && BABYLON.Vector3) {
      const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      const world = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
      const inv = BABYLON.Matrix.Invert(world);
      const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx, wy, wz), inv);
      return { lx: v.x, ly: v.y, lz: v.z };
    }
  } catch {}
  // Fallback: manual inverse Euler (approximate)
  let dx = wx - cx, dy = wy - cy, dz = wz - cz;
  const cZ = Math.cos(-rz), sZ = Math.sin(-rz);
  let x1 = dx * cZ + dy * sZ;
  let y1 = -dx * sZ + dy * cZ;
  let z1 = dz;
  const cY = Math.cos(-ry), sY = Math.sin(-ry);
  let x2 = x1 * cY - z1 * sY;
  let y2 = y1;
  let z2 = x1 * sY + z1 * cY;
  const cX = Math.cos(-rx), sX = Math.sin(-rx);
  const lx = x2;
  const ly = y2 * cX + z2 * sX;
  const lz = -y2 * sX + z2 * cX;
  return { lx, ly, lz };
}
function Vox_insideBoxDetailed(s, wx, wy, wz) {
  const sr = s.res || 1;
  const hx = ((s.size?.x||0) * sr) / 2;
  const hy = ((s.size?.y||0) * sr) / 2;
  const hz = ((s.size?.z||0) * sr) / 2;
  const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
  try {
    if (typeof BABYLON !== 'undefined' && BABYLON.Quaternion && BABYLON.Matrix && BABYLON.Vector3) {
      const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
      const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
      const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
      const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      const rot = BABYLON.Matrix.FromQuaternion(q);
      const ux = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(1,0,0), rot).normalize();
      const uy = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,1,0), rot).normalize();
      const uz = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,0,1), rot).normalize();
      const d = new BABYLON.Vector3(wx - cx, wy - cy, wz - cz);
      const px = Math.abs(BABYLON.Vector3.Dot(d, ux));
      const py = Math.abs(BABYLON.Vector3.Dot(d, uy));
      const pz = Math.abs(BABYLON.Vector3.Dot(d, uz));
      return { inside: (px <= hx + 1e-6) && (py <= hy + 1e-6) && (pz <= hz + 1e-6), px, py, pz, hx, hy, hz };
    }
  } catch {}
  const { lx, ly, lz } = Vox_toLocal(s, wx, wy, wz);
  return { inside: (Math.abs(lx) <= hx + 1e-6) && (Math.abs(ly) <= hy + 1e-6) && (Math.abs(lz) <= hz + 1e-6), px: Math.abs(lx), py: Math.abs(ly), pz: Math.abs(lz), hx, hy, hz };
}
function Vox_insideBox(s, wx, wy, wz) { return !!Vox_insideBoxDetailed(s, wx, wy, wz).inside; }
function Vox_insideSphere(s, wx, wy, wz) {
  const sr = s.res || 1;
  const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
  const r = Math.min(w,h,d) / 2;
  const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
  const dx = wx - cx, dy = wy - cy, dz = wz - cz;
  return (dx*dx + dy*dy + dz*dz) <= (r+1e-6)*(r+1e-6);
}
function Vox_spaceContains(s, wx, wy, wz) { return (s.type === 'Cavern') ? Vox_insideSphere(s, wx, wy, wz) : Vox_insideBox(s, wx, wy, wz); }

function stripNumericSuffix(id) {
  if (!id) return '';
  const m = String(id).match(/^(.*?)(-\d+)?$/);
  return m ? (m[1] || id) : id;
}

export function mergeOverlappingSpaces(barrow, seedId) {
  if (!barrow || !Array.isArray(barrow.spaces)) return null;
  const spaces = barrow.spaces;
  const byId = new Map(spaces.map(s => [s.id, s]));
  const seed = byId.get(seedId); if (!seed) return null;
  // Gather overlapping candidates (transitive closure over overlaps with the evolving union AABB)
  const picked = new Set([seedId]);
  let changed = true;
  let union = worldAabbFromSpace(seed, barrow.meta?.voxelSize || 1);
  while (changed) {
    changed = false;
    for (const s of spaces) {
      if (picked.has(s.id)) continue;
      const bb = worldAabbFromSpace(s, barrow.meta?.voxelSize || 1);
      const doesOverlap = !(union.max.x < bb.min.x || union.min.x > bb.max.x || union.max.y < bb.min.y || union.min.y > bb.max.y || union.max.z < bb.min.z || union.min.z > bb.max.z);
      if (doesOverlap) {
        picked.add(s.id);
        // expand union AABB
        union = {
          min: { x: Math.min(union.min.x, bb.min.x), y: Math.min(union.min.y, bb.min.y), z: Math.min(union.min.z, bb.min.z) },
          max: { x: Math.max(union.max.x, bb.max.x), y: Math.max(union.max.y, bb.max.y), z: Math.max(union.max.z, bb.max.z) },
        };
        changed = true;
      }
    }
  }
  // Do not early-return yet; we will at least run debug prefill below for the single-seed case.

  // Choose name: prefer first id without -NN; else fallback to seed
  let keepId = seedId;
  for (const id of picked) {
    if (!/-\d+$/.test(id)) { keepId = id; break; }
  }
  const keep = byId.get(keepId) || seed;
  // Choose resolution = min voxel size among participating spaces (fallback to barrow meta or keep.res)
  let res = keep.res || (barrow.meta?.voxelSize || 1);
  for (const id of picked) {
    const s = byId.get(id);
    if (!s) continue;
    const sres = (s.vox && s.vox.res) ? s.vox.res : (s.res || (barrow.meta?.voxelSize || 1));
    if (sres > 0 && sres < res) res = sres;
  }
  // Build union voxel mask in a new grid covering the union AABB
  const min = union.min, max = union.max;
  const nx = Math.max(1, Math.ceil((max.x - min.x) / res));
  const ny = Math.max(1, Math.ceil((max.y - min.y) / res));
  const nz = Math.max(1, Math.ceil((max.z - min.z) / res));
  const nTot = nx * ny * nz;
  const occ = new Uint8Array(nTot); // 0=empty, 1=inside
  const idx = (x,y,z) => (x + nx * (y + ny * z));
  function markInsideWorldPoint(wx, wy, wz) {
    // Mark union grid cell containing world point as inside
    const ix = Math.floor((wx - min.x) / res);
    const iy = Math.floor((wy - min.y) / res);
    const iz = Math.floor((wz - min.z) / res);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    occ[idx(ix,iy,iz)] = 1;
  }
  // Transform world point to space-local coordinates.
  // Prefer full inverse world matrix (translation + rotation), matching Babylon's compose.
  function toLocal(s, wx, wy, wz) {
    const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
    const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
    const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
    const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
    try {
      if (typeof BABYLON !== 'undefined' && BABYLON.Matrix && BABYLON.Quaternion && BABYLON.Vector3) {
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const world = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
        const inv = BABYLON.Matrix.Invert(world);
        const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx, wy, wz), inv);
        return { lx: v.x, ly: v.y, lz: v.z };
      }
    } catch {}
    // Fallback: manual inverse Euler (approximate)
    let dx = wx - cx, dy = wy - cy, dz = wz - cz;
    const cZ = Math.cos(-rz), sZ = Math.sin(-rz);
    let x1 = dx * cZ + dy * sZ;
    let y1 = -dx * sZ + dy * cZ;
    let z1 = dz;
    const cY = Math.cos(-ry), sY = Math.sin(-ry);
    let x2 = x1 * cY - z1 * sY;
    let y2 = y1;
    let z2 = x1 * sY + z1 * cY;
    const cX = Math.cos(-rx), sX = Math.sin(-rx);
    const lx = x2;
    const ly = y2 * cX + z2 * sX;
    const lz = -y2 * sX + z2 * cX;
    return { lx, ly, lz };
  }
  function insideBoxDetailed(s, wx, wy, wz) {
    const sr = s.res || (barrow.meta?.voxelSize || 1);
    const hx = ((s.size?.x||0) * sr) / 2;
    const hy = ((s.size?.y||0) * sr) / 2;
    const hz = ((s.size?.z||0) * sr) / 2;
    const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
    // Prefer OBB projection using Babylon math when available
    try {
      if (typeof BABYLON !== 'undefined' && BABYLON.Quaternion && BABYLON.Matrix && BABYLON.Vector3) {
        const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
        const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const rot = BABYLON.Matrix.FromQuaternion(q);
        const ux = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(1,0,0), rot).normalize();
        const uy = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,1,0), rot).normalize();
        const uz = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0,0,1), rot).normalize();
        const d = new BABYLON.Vector3(wx - cx, wy - cy, wz - cz);
        const px = Math.abs(BABYLON.Vector3.Dot(d, ux));
        const py = Math.abs(BABYLON.Vector3.Dot(d, uy));
        const pz = Math.abs(BABYLON.Vector3.Dot(d, uz));
        return { inside: (px <= hx + 1e-6) && (py <= hy + 1e-6) && (pz <= hz + 1e-6), px, py, pz, hx, hy, hz, d: { dx: d.x, dy: d.y, dz: d.z } };
      }
    } catch {}
    // Fallback to local transform + AABB check in local space
    const { lx, ly, lz } = toLocal(s, wx, wy, wz);
    return { inside: (Math.abs(lx) <= hx + 1e-6) && (Math.abs(ly) <= hy + 1e-6) && (Math.abs(lz) <= hz + 1e-6), px: Math.abs(lx), py: Math.abs(ly), pz: Math.abs(lz), hx, hy, hz, d: { dx: wx - cx, dy: wy - cy, dz: wz - cz } };
  }
  function insideBox(s, wx, wy, wz) {
    return !!insideBoxDetailed(s, wx, wy, wz).inside;
  }
  function insideSphere(s, wx, wy, wz) {
    const sr = s.res || (barrow.meta?.voxelSize || 1);
    const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
    const r = Math.min(w,h,d) / 2;
    const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
    const dx = wx - cx, dy = wy - cy, dz = wz - cz;
    return (dx*dx + dy*dy + dz*dz) <= (r+1e-6)*(r+1e-6);
  }
  function spaceContains(s, wx, wy, wz) {
    if (s.type === 'Cavern') return insideSphere(s, wx, wy, wz);
    return insideBox(s, wx, wy, wz);
  }
  // Populate occupancy by scanning world-aligned union grid and testing membership per space
  const fillOcc = (useYawOnly = false) => {
    // helper toLocalYaw
    const toLocalYaw = (s, wx, wy, wz) => {
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      const dx = wx - cx, dy = wy - cy, dz = wz - cz;
      const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
      const c = Math.cos(-ry), sn = Math.sin(-ry);
      const lx = dx * c + dz * -sn;
      const lz = dx * sn + dz * c;
      const ly = dy;
      return { lx, ly, lz };
    };
    const toLoc = (s, wx, wy, wz) => useYawOnly ? toLocalYaw(s, wx, wy, wz) : toLocal(s, wx, wy, wz);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const wx = min.x + (x + 0.5) * res;
          const wy = min.y + (y + 0.5) * res;
          const wz = min.z + (z + 0.5) * res;
          let inside = false;
          for (const id of picked) {
            const s = byId.get(id); if (!s) continue;
            if (s.vox && s.vox.size && s.vox.data) {
              const vox = decompressVox(s.vox);
              const sx = vox.size?.x||0, sy = vox.size?.y||0, sz = vox.size?.z||0;
              const sres = vox.res || s.res || res;
              const halfX = (sx * sres) / 2, halfY = (sy * sres) / 2, halfZ = (sz * sres) / 2;
              const { lx, ly, lz } = toLoc(s, wx, wy, wz);
              const ix = Math.floor((lx + halfX) / sres);
              const iy = Math.floor((ly + halfY) / sres);
              const iz = Math.floor((lz + halfZ) / sres);
              if (ix >= 0 && iy >= 0 && iz >= 0 && ix < sx && iy < sy && iz < sz) {
                const v = vox.data[ix + sx*(iy + sy*iz)];
                if (v === VoxelType.Wall || v === VoxelType.Rock) { inside = true; break; }
              }
            } else {
              // Test with box/sphere membership using the same transform choice
              let loc;
              if (s.type === 'Cavern') {
                // Cavern uses sphere around origin; independent of rotation
                inside = insideSphere(s, wx, wy, wz);
              } else {
                loc = toLoc(s, wx, wy, wz);
                const sr = s.res || (barrow.meta?.voxelSize || 1);
                const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
                if (Math.abs(loc.lx) <= w/2 + 1e-6 && Math.abs(loc.ly) <= h/2 + 1e-6 && Math.abs(loc.lz) <= d/2 + 1e-6) inside = true;
              }
              if (inside) break;
            }
          }
          if (inside) occ[idx(x,y,z)] = 1;
        }
      }
    }
  };
  fillOcc(false);
  // Fallback: if nothing marked (possible due to rotation order mismatch), retry yaw-only
  let occCount = 0; for (let i = 0; i < nTot; i++) if (occ[i]) { occCount++; break; }
  if (occCount === 0) {
    for (let i = 0; i < nTot; i++) occ[i] = 0;
    fillOcc(true);
  }
  // Build voxel data with walls on the surface (6-neighborhood)
  const data = new Array(nTot);
  for (let i = 0; i < nTot; i++) data[i] = VoxelType.Empty;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (!occ[idx(x,y,z)]) continue;
        data[idx(x,y,z)] = VoxelType.Rock;
      }
    }
  }
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (data[idx(x,y,z)] !== VoxelType.Rock) continue;
        let surface = false;
        for (const [dx,dy,dz] of dirs) {
          const nx1 = x + dx, ny1 = y + dy, nz1 = z + dz;
          if (nx1 < 0 || ny1 < 0 || nz1 < 0 || nx1 >= nx || ny1 >= ny || nz1 >= nz) { surface = true; break; }
          if (!occ[idx(nx1,ny1,nz1)]) { surface = true; break; }
        }
        if (surface) data[idx(x,y,z)] = VoxelType.Wall;
      }
    }
  }
  // Update keeper as Carddon, reset rotation, use voxel grid size and res
  keep.type = 'Carddon';
  keep.rotation = { x: 0, y: 0, z: 0 }; delete keep.rotY;
  keep.size = { x: nx, y: ny, z: nz };
  keep.res = res;
  keep.origin = { x: min.x + nx*res/2, y: min.y + ny*res/2, z: min.z + nz*res/2 };
  keep.vox = { res, size: { x: nx, y: ny, z: nz }, data, palette: VoxelType, bakedAt: Date.now(), source: keep.id };
  keep.voxelized = 1;

  // Remove the rest from barrow.spaces
  barrow.spaces = spaces.filter(s => !picked.has(s.id) || s.id === keepId);
  return keepId;
}

// Async variant with debug callbacks to visualize scanning progress
// opts.debug?: {
//   onStart?: ({ min, max, res, nx, ny, nz }) => void,
//   onTest?: (wx, wy, wz, i) => void,
//   flush?: () => void,
//   onEnd?: () => void,
//   chunk?: number
// }
export async function mergeOverlappingSpacesAsync(barrow, seedId, opts = {}) {
  const debug = opts.debug || null;
  const chunk = (debug && debug.chunk) ? Math.max(1, Number(debug.chunk)||1) : 256;
  vLog('mergeAsync:begin', { seedId });
  try {
    const s = barrow.spaces.find(x => x.id === seedId);
    if (s) vLog('mergeAsync:seedState', { id: s.id, origin: s.origin, size: s.size, res: s.res || (barrow.meta?.voxelSize||1), rotation: s.rotation || { y: s.rotY||0 } });
  } catch (e) { errLog('mergeAsync:seedState', e); }
  // Reuse logic by duplicating the core and making the occupancy build async with callbacks
  if (!barrow || !Array.isArray(barrow.spaces)) return null;
  const spaces = barrow.spaces;
  const byId = new Map(spaces.map(s => [s.id, s]));
  const seed = byId.get(seedId); if (!seed) return null;
  const picked = new Set([seedId]);
  let changed = true;
  let union = worldAabbFromSpace(seed, barrow.meta?.voxelSize || 1);
  while (changed) {
    changed = false;
    for (const s of spaces) {
      if (picked.has(s.id)) continue;
      const bb = worldAabbFromSpace(s, barrow.meta?.voxelSize || 1);
      const doesOverlap = !(union.max.x < bb.min.x || union.min.x > bb.max.x || union.max.y < bb.min.y || union.min.y > bb.max.y || union.max.z < bb.min.z || union.min.z > bb.max.z);
      if (doesOverlap) {
        picked.add(s.id);
        union = { min: { x: Math.min(union.min.x, bb.min.x), y: Math.min(union.min.y, bb.min.y), z: Math.min(union.min.z, bb.min.z) }, max: { x: Math.max(union.max.x, bb.max.x), y: Math.max(union.max.y, bb.max.y), z: Math.max(union.max.z, bb.max.z) } };
        changed = true;
      }
    }
  }
  vLog('mergeAsync:overlapPicked', { count: picked.size, ids: Array.from(picked) });
  // Do not early-return yet; allow debug prefill to run for single-space case
  let keepId = seedId; for (const id of picked) { if (!/-\d+$/.test(id)) { keepId = id; break; } }
  const keep = byId.get(keepId) || seed;
  let res = keep.res || (barrow.meta?.voxelSize || 1);
  for (const id of picked) { const s = byId.get(id); if (!s) continue; const sres = (s.vox && s.vox.res) ? s.vox.res : (s.res || (barrow.meta?.voxelSize || 1)); if (sres > 0 && sres < res) res = sres; }
  const min = union.min, max = union.max;
  const nx = Math.max(1, Math.ceil((max.x - min.x) / res));
  const ny = Math.max(1, Math.ceil((max.y - min.y) / res));
  const nz = Math.max(1, Math.ceil((max.z - min.z) / res));
  const nTot = nx * ny * nz;
  vLog('mergeAsync:AABB', { min, max, res, nx, ny, nz, nTot });
  const occ = new Uint8Array(nTot);
  const idx = (x,y,z) => (x + nx * (y + ny * z));
  if (debug && debug.onStart) { try { debug.onStart({ min, max, res, nx, ny, nz }); } catch (e) { errLog('mergeAsync:onStart', e); } }
  // Quick sanity: classify the seed center
  try {
    const s = byId.get(seedId);
    if (s && debug) {
      const wx = s.origin?.x||0, wy = s.origin?.y||0, wz = s.origin?.z||0;
      let insideCenter = Vox_spaceContains(s, wx, wy, wz);
      const detail = (s.type === 'Cavern') ? { px:0,py:0,pz:0,hx:0,hy:0,hz:0 } : Vox_insideBoxDetailed(s, wx, wy, wz);
      vLog('mergeAsync:sampleCenter', { world:{x:wx,y:wy,z:wz}, proj: { px: detail.px, py: detail.py, pz: detail.pz }, half: { hx: detail.hx, hy: detail.hy, hz: detail.hz }, insideCenter });
      try {
        if (debug.onTestInside && insideCenter) debug.onTestInside(wx, wy, wz, -1);
        if (debug.onTestOutside && !insideCenter) debug.onTestOutside(wx, wy, wz, -1);
        if (debug.flush) debug.flush();
      } catch (e) { errLog('mergeAsync:sampleCenter:dots', e); }
    }
  } catch (e) { errLog('mergeAsync:sampleCenter', e); }
  // Draw oriented bounding box of the seed using the same rotation as membership
  try {
    if (debug && debug.showObb && typeof BABYLON !== 'undefined') {
      const sr = seed.res || (barrow.meta?.voxelSize || 1);
      const w = (seed.size?.x||0) * sr, h = (seed.size?.y||0) * sr, d = (seed.size?.z||0) * sr;
      const hx = w/2, hy = h/2, hz = d/2;
      const cx = seed.origin?.x||0, cy = seed.origin?.y||0, cz = seed.origin?.z||0;
      const rx = (seed.rotation && typeof seed.rotation.x === 'number') ? seed.rotation.x : 0;
      const ry = (seed.rotation && typeof seed.rotation.y === 'number') ? seed.rotation.y : (typeof seed.rotY === 'number' ? seed.rotY : 0);
      const rz = (seed.rotation && typeof seed.rotation.z === 'number') ? seed.rotation.z : 0;
      const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
      const locals = [
        new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz),
        new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz),
        new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz),
        new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz)
      ];
      const world = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, m)).map(v => ({ x: v.x, y: v.y, z: v.z }));
      try { debug.showObb(world); } catch (e3) { errLog('mergeAsync:showObb', e3); }
    }
  } catch (e2) { errLog('mergeAsync:obb', e2); }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const toLocalYaw = (s, wx, wy, wz) => {
    const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
    const dx = wx - cx, dy = wy - cy, dz = wz - cz;
    const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
    const c = Math.cos(-ry), sn = Math.sin(-ry);
    const lx = dx * c + dz * -sn; const lz = dx * sn + dz * c; const ly = dy; return { lx, ly, lz };
  };
  const toLoc = (s, wx, wy, wz) => Vox_toLocal(s, wx, wy, wz);
  // Prefill: classify every center vs the seed's rotated shape; green=inside, red=outside
  let count = 0;
  if (debug && (debug.onTestInside || debug.onTestOutside)) {
    vLog('mergeAsync:prefill:start', {});
    const yMid = Math.floor(ny / 2), zMid = Math.floor(nz / 2);
    for (let y = 0; y < ny; y++) {
      let insideCnt = 0, outsideCnt = 0;
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const wx = min.x + (x + 0.5) * res;
          const wy = min.y + (y + 0.5) * res;
          const wz = min.z + (z + 0.5) * res;
          let insideSeed = false;
          try { insideSeed = Vox_spaceContains(seed, wx, wy, wz); } catch {}
          if (insideSeed) { insideCnt++; try { debug.onTestInside(wx, wy, wz, count); } catch {} }
          else { outsideCnt++; try { debug.onTestOutside(wx, wy, wz, count); } catch {} }
          count++;
          if (count % chunk === 0) { if (debug.flush) try { debug.flush(); } catch {}; await nextFrame(); }
        }
      }
      try {
        if (debug.onLayer) debug.onLayer(y, { inside: insideCnt, outside: outsideCnt });
        vLog('mergeAsync:prefill:layer', { y, inside: insideCnt, outside: outsideCnt });
        if (y === yMid) {
          // Emit a few sample membership debug points along X at mid Y/Z
          const samples = [];
          for (let xi = 0; xi < nx; xi += Math.max(1, Math.floor(nx/4))) {
            const wxs = min.x + (xi + 0.5) * res;
            const wys = min.y + (yMid + 0.5) * res;
            const wzs = min.z + (zMid + 0.5) * res;
          const detail = Vox_insideBoxDetailed(seed, wxs, wys, wzs);
          const inB = Vox_spaceContains(seed, wxs, wys, wzs);
          samples.push({ wx: wxs, wy: wys, wz: wzs, px: detail.px, py: detail.py, pz: detail.pz, hx: detail.hx, hy: detail.hy, hz: detail.hz, inside: inB });
          }
          vLog('mergeAsync:prefill:samples', { y: yMid, z: zMid, samples });
        }
      } catch (e) { errLog('mergeAsync:prefill:layer', e); }
    }
    try { if (debug.flush) debug.flush(); } catch (e) { errLog('mergeAsync:prefill:flush', e); }
    vLog('mergeAsync:prefill:end', {});
  }

  // Occupancy: test membership for each center (no extra onTest here — dots already placed)
  count = 0;
  vLog('mergeAsync:occupancy:start', {});
  for (let y = 0; y < ny; y++) {
    let occY = 0;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const wx = min.x + (x + 0.5) * res;
        const wy = min.y + (y + 0.5) * res;
        const wz = min.z + (z + 0.5) * res;
        let inside = false;
        for (const id of picked) {
          const s = byId.get(id); if (!s) continue;
          if (s.vox && s.vox.size && s.vox.data) {
            const vox = decompressVox(s.vox);
            const sx = vox.size?.x||0, sy = vox.size?.y||0, sz = vox.size?.z||0;
            const sres = vox.res || s.res || res;
            const halfX = (sx * sres) / 2, halfY = (sy * sres) / 2, halfZ = (sz * sres) / 2;
            const { lx, ly, lz } = toLoc(s, wx, wy, wz);
            const ix = Math.floor((lx + halfX) / sres);
            const iy = Math.floor((ly + halfY) / sres);
            const iz = Math.floor((lz + halfZ) / sres);
            if (ix >= 0 && iy >= 0 && iz >= 0 && ix < sx && iy < sy && iz < sz) {
              const v = vox.data[ix + sx*(iy + sy*iz)];
              if (v === VoxelType.Wall || v === VoxelType.Rock) { inside = true; break; }
            }
          } else {
            if (Vox_spaceContains(s, wx, wy, wz)) { inside = true; break; }
          }
        }
        if (inside) { occ[idx(x,y,z)] = 1; occY++; }
        count++;
        if (debug && count % chunk === 0) { if (debug.flush) try { debug.flush(); } catch {}; await nextFrame(); }
      }
    }
    vLog('mergeAsync:occupancy:layer', { y, inside: occY });
  }
  try { if (debug && debug.flush) debug.flush(); } catch (e) { errLog('mergeAsync:occupancy:flush', e); }
  try { if (debug && debug.onEnd) debug.onEnd(); } catch (e) { errLog('mergeAsync:occupancy:onEnd', e); }
  vLog('mergeAsync:occupancy:end', {});

  // Proceed to build voxel map even for single-seed case

  // Build data maps
  const data = new Array(nTot); for (let i = 0; i < nTot; i++) data[i] = VoxelType.Empty;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (occ[idx(x,y,z)]) data[idx(x,y,z)] = VoxelType.Rock;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (data[idx(x,y,z)] !== VoxelType.Rock) continue;
        let surface = false;
        for (const [dx,dy,dz] of dirs) {
          const nx1 = x + dx, ny1 = y + dy, nz1 = z + dz;
          if (nx1 < 0 || ny1 < 0 || nz1 < 0 || nx1 >= nx || ny1 >= ny || nz1 >= nz) { surface = true; break; }
          if (!occ[idx(nx1,ny1,nz1)]) { surface = true; break; }
        }
        if (surface) data[idx(x,y,z)] = VoxelType.Wall;
      }
    }
  }
  keep.type = 'Carddon'; keep.rotation = { x: 0, y: 0, z: 0 }; delete keep.rotY;
  keep.size = { x: nx, y: ny, z: nz }; keep.res = res; keep.origin = { x: min.x + nx*res/2, y: min.y + ny*res/2, z: min.z + nz*res/2 };
  keep.vox = { res, size: { x: nx, y: ny, z: nz }, data, palette: VoxelType, bakedAt: Date.now(), source: keep.id };
  keep.voxelized = 1;
  barrow.spaces = spaces.filter(s => !picked.has(s.id) || s.id === keepId);
  vLog('mergeAsync:done', { keepId, size: keep.size, res });
  return keepId;
}
