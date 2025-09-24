// Simple voxelization helpers for spaces
import { worldAabbFromSpace } from '../barrow/schema.mjs';

// Type ids:
// 0=Uninstantiated (U), 1=Empty (E), 2=Rock (R), 3=Wall (W)
export const VoxelType = { Uninstantiated: 0, Empty: 1, Rock: 2, Wall: 3 };

// Bake a hollow container: shell = Wall (thickness t voxels), interior = Empty
// Space size fields are in voxels already; res is voxel size in world units.
export function bakeHollowContainer(space, opts = {}) {
  // Optional ovoid bake when explicitly requested
  try { if (opts && opts.ovoid) return bakeCavernOvoid(space, opts); } catch {}
  // World-aligned voxelization of a rotated box: inside test uses inverse rotation.
  const t = Math.max(1, Math.floor(opts.wallThickness || 1));
  const sx = Math.max(1, Math.floor(space?.size?.x || 1));
  const sy = Math.max(1, Math.floor(space?.size?.y || 1));
  const sz = Math.max(1, Math.floor(space?.size?.z || 1));
  const res = space?.res || 1;
  // Space center in world units
  const cx = space?.origin?.x || 0, cy = space?.origin?.y || 0, cz = space?.origin?.z || 0;
  // Expand the voxel grid to the world-aligned AABB of the rotated space
  let bb = null; try { bb = worldAabbFromSpace(space, res); } catch {}
  const wxSpan = bb ? (bb.max.x - bb.min.x) : (sx * res);
  const wySpan = bb ? (bb.max.y - bb.min.y) : (sy * res);
  const wzSpan = bb ? (bb.max.z - bb.min.z) : (sz * res);
  const nx = Math.max(1, Math.ceil(wxSpan / res));
  const ny = Math.max(1, Math.ceil(wySpan / res));
  const nz = Math.max(1, Math.ceil(wzSpan / res));
  const nTot = nx * ny * nz;
  const idx = (x,y,z) => (x + nx*(y + ny*z));
  const hx = (sx * res) / 2, hy = (sy * res) / 2, hz = (sz * res) / 2;
  const inside = new Uint8Array(nTot);
  // Helper: world->local inverse rotation
  const toLocal = (wx, wy, wz) => {
    try {
      if (typeof BABYLON !== 'undefined' && BABYLON.Quaternion && BABYLON.Matrix && BABYLON.Vector3) {
        const rx = Number(space?.rotation?.x ?? 0) || 0;
        const ry = (space?.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space?.rotY || 0) || 0;
        const rz = Number(space?.rotation?.z ?? 0) || 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const inv = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), BABYLON.Quaternion.Inverse(q), BABYLON.Vector3.Zero());
        const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), inv);
        return { lx: v.x, ly: v.y, lz: v.z };
      }
    } catch {}
    // Fallback: manual inverse Euler (Z,Y,X)
    const rx = Number(space?.rotation?.x ?? 0) || 0;
    const ry = (space?.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space?.rotY || 0) || 0;
    const rz = Number(space?.rotation?.z ?? 0) || 0;
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
  };
  // Occupancy
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const wx = bb ? (bb.min.x + (x + 0.5) * res) : ((space?.origin?.x||0) + ((x + 0.5) - nx/2) * res);
        const wy = bb ? (bb.min.y + (y + 0.5) * res) : ((space?.origin?.y||0) + ((y + 0.5) - ny/2) * res);
        const wz = bb ? (bb.min.z + (z + 0.5) * res) : ((space?.origin?.z||0) + ((z + 0.5) - nz/2) * res);
        const { lx, ly, lz } = toLocal(wx, wy, wz);
        if (Math.abs(lx) <= hx + 1e-6 && Math.abs(ly) <= hy + 1e-6 && Math.abs(lz) <= hz + 1e-6) inside[idx(x,y,z)] = 1;
      }
    }
  }
  // Build wall shell of thickness t using BFS from boundary inside cells
  const INF = 1<<28;
  const dist = new Int32Array(nTot); for (let i = 0; i < nTot; i++) dist[i] = INF;
  const q = new Int32Array(nTot); let qh = 0, qt = 0;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = idx(x,y,z); if (!inside[i]) continue;
    let boundary = false;
    for (const [dx,dy,dz] of dirs) {
      const x2 = x+dx, y2 = y+dy, z2 = z+dz;
      if (x2 < 0 || y2 < 0 || z2 < 0 || x2 >= nx || y2 >= ny || z2 >= nz) { boundary = true; break; }
      if (!inside[idx(x2,y2,z2)]) { boundary = true; break; }
    }
    if (boundary) { dist[i] = 1; q[qt++] = i; }
  }
  while (qh < qt) {
    const i = q[qh++]; const d0 = dist[i]; if (d0 >= t) continue;
    const z = Math.floor(i / (nx*ny)); const rem = i - z*nx*ny; const y = Math.floor(rem / nx); const x = rem - y*nx;
    for (const [dx,dy,dz] of dirs) {
      const x2 = x+dx, y2 = y+dy, z2 = z+dz; if (x2 < 0 || y2 < 0 || z2 < 0 || x2 >= nx || y2 >= ny || z2 >= nz) continue;
      const j = idx(x2,y2,z2); if (!inside[j]) continue; if (dist[j] > d0 + 1) { dist[j] = d0 + 1; q[qt++] = j; }
    }
  }
  const data = new Array(nTot); for (let i = 0; i < nTot; i++) data[i] = VoxelType.Uninstantiated;
  for (let i = 0; i < nTot; i++) if (inside[i]) data[i] = (dist[i] >= 1 && dist[i] <= t) ? VoxelType.Wall : VoxelType.Empty;
  return {
    res,
    size: { x: nx, y: ny, z: nz },
    data,
    palette: VoxelType,
    bakedAt: Date.now(),
    source: space?.id || null,
    wallThickness: t,
    hasRock: false,
    worldAligned: true,
  };
}

// ——————————— Cavern baker: ovoid with rough walls ———————————
function seedFromId(id) {
  const s = String(id || 'seed');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function lerp(a,b,t){ return a + (b-a) * t; }
function smoothstep(t){ return t*t*(3-2*t); }
function hash3(x,y,z,seed){
  // Float hash in [0,1)
  const n = (x*127.1 + y*311.7 + z*74.7 + (seed>>>0)*0.01);
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x,y,z,seed){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smoothstep(Math.max(0, Math.min(1, xf)));
  const v = smoothstep(Math.max(0, Math.min(1, yf)));
  const w = smoothstep(Math.max(0, Math.min(1, zf)));
  function n(ix,iy,iz){ return hash3(ix,iy,iz,seed); }
  const c000 = n(xi, yi, zi),     c100 = n(xi+1, yi, zi),     c010 = n(xi, yi+1, zi),     c110 = n(xi+1, yi+1, zi);
  const c001 = n(xi, yi, zi+1),   c101 = n(xi+1, yi, zi+1),   c011 = n(xi, yi+1, zi+1),   c111 = n(xi+1, yi+1, zi+1);
  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u), x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  const y0 = lerp(x00, x10, v),   y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w);
}
export function bakeCavernOvoid(space, opts = {}) {
  const t = Math.max(1, Math.floor(opts.wallThickness || 1));
  const sx = Math.max(3, Math.floor(space?.size?.x || 3));
  const sy = Math.max(3, Math.floor(space?.size?.y || 3));
  const sz = Math.max(3, Math.floor(space?.size?.z || 3));
  const nx = sx, ny = sy, nz = sz;
  const nTot = nx*ny*nz; const idx = (x,y,z) => (x + nx*(y + ny*z));
  const res = space?.res || 1;
  // Ellipsoid radii (in world units). Keep a small margin to keep walls inside bounds.
  const rx = ((nx - 2*Math.max(1,t)) * res) / 2;
  const ry = ((ny - 2*Math.max(1,t)) * res) / 2;
  const rz = ((nz - 2*Math.max(1,t)) * res) / 2;
  const cx = space?.origin?.x || 0, cy = space?.origin?.y || 0, cz = space?.origin?.z || 0;
  // Roughness control: lower when plan is square (mostly circular)
  const planAsym = Math.abs(nx - nz) / Math.max(1, Math.max(nx, nz));
  const baseRough = (typeof opts.roughness === 'number') ? Math.max(0, Math.min(1, opts.roughness)) : 0.12;
  const rough = lerp(0.035, baseRough, Math.max(0, Math.min(1, planAsym * 3))); // ~0.035 for near-square
  const seed = seedFromId(space?.id || 'cavern');
  const freq = 0.18; // low-frequency noise
  const freq2 = 0.41, amp2 = 0.5; // add some finer details
  // world->local inverse rotation helper (local axes are ellipsoid axes)
  const toLocal = (wx, wy, wz) => {
    try {
      if (typeof BABYLON !== 'undefined' && BABYLON.Quaternion && BABYLON.Matrix && BABYLON.Vector3) {
        const rxE = Number(space?.rotation?.x ?? 0) || 0;
        const ryE = (space?.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space?.rotY || 0) || 0;
        const rzE = Number(space?.rotation?.z ?? 0) || 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rxE, ryE, rzE);
        const inv = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), BABYLON.Quaternion.Inverse(q), BABYLON.Vector3.Zero());
        const v = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), inv);
        return { lx: v.x, ly: v.y, lz: v.z };
      }
    } catch {}
    const rxE = Number(space?.rotation?.x ?? 0) || 0;
    const ryE = (space?.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space?.rotY || 0) || 0;
    const rzE = Number(space?.rotation?.z ?? 0) || 0;
    let dx = wx - cx, dy = wy - cy, dz = wz - cz;
    const cZ = Math.cos(-rzE), sZ = Math.sin(-rzE);
    let x1 = dx * cZ + dy * sZ;
    let y1 = -dx * sZ + dy * cZ;
    let z1 = dz;
    const cY = Math.cos(-ryE), sY = Math.sin(-ryE);
    let x2 = x1 * cY - z1 * sY;
    let y2 = y1;
    let z2 = x1 * sY + z1 * cY;
    const cX = Math.cos(-rxE), sX = Math.sin(-rxE);
    const lx = x2;
    const ly = y2 * cX + z2 * sX;
    const lz = -y2 * sX + z2 * cX;
    return { lx, ly, lz };
  };
  const inside = new Uint8Array(nTot); // 0=outside, 1=inside
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const wx = cx + ((x + 0.5) - nx/2) * res;
        const wy = cy + ((y + 0.5) - ny/2) * res;
        const wz = cz + ((z + 5.0e-1) - nz/2) * res;
        const { lx, ly, lz } = toLocal(wx, wy, wz);
        const nxn = lx / Math.max(1e-6, rx);
        const nyn = ly / Math.max(1e-6, ry);
        const nzn = lz / Math.max(1e-6, rz);
        const d = Math.sqrt(nxn*nxn + nyn*nyn + nzn*nzn); // ~0 at center, ~1 at ellipsoid surface
        // Noise to push/pull surface: positive expands cavity, negative shrinks
        const p = noise3(x*freq, y*freq, z*freq, seed);
        const qn = noise3(x*freq2, y*freq2, z*freq2, seed ^ 0x9e3779b9);
        const nval = (p*0.8 + qn*amp2*0.2) - 0.5; // -0.5..0.5 mostly
        const allowance = 1 + rough * nval * 2.0;
        if (d <= allowance) inside[idx(x,y,z)] = 1;
      }
    }
  }
  // Build wall shell up to thickness t (6-neighborhood distance from outside)
  const INF = 1<<28;
  const dist = new Int32Array(nTot); for (let i = 0; i < nTot; i++) dist[i] = INF;
  const q = new Int32Array(nTot);
  let qh = 0, qt = 0;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  // Seed boundary inside cells with distance=1
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x,y,z); if (!inside[i]) continue;
        let boundary = false;
        for (const [dx,dy,dz] of dirs) {
          const x2 = x+dx, y2 = y+dy, z2 = z+dz;
          if (x2 < 0 || y2 < 0 || z2 < 0 || x2 >= nx || y2 >= ny || z2 >= nz) { boundary = true; break; }
          if (!inside[idx(x2,y2,z2)]) { boundary = true; break; }
        }
        if (boundary) { dist[i] = 1; q[qt++] = i; }
      }
    }
  }
  // BFS into interior to depth t
  while (qh < qt) {
    const i = q[qh++];
    const d0 = dist[i];
    if (d0 >= t) continue;
    // Compute x,y,z from i
    const z = Math.floor(i / (nx*ny));
    const rem = i - z*nx*ny;
    const y = Math.floor(rem / nx);
    const x = rem - y*nx;
    for (const [dx,dy,dz] of dirs) {
      const x2 = x+dx, y2 = y+dy, z2 = z+dz;
      if (x2 < 0 || y2 < 0 || z2 < 0 || x2 >= nx || y2 >= ny || z2 >= nz) continue;
      const j = idx(x2,y2,z2);
      if (!inside[j]) continue; // only propagate inside
      if (dist[j] > d0 + 1) { dist[j] = d0 + 1; q[qt++] = j; }
    }
  }
  // Compose final voxel map: outside = U, interior = Empty, shell(<=t) = Wall
  const data = new Array(nTot);
  for (let i = 0; i < nTot; i++) data[i] = VoxelType.Uninstantiated;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x,y,z);
        if (!inside[i]) continue;
        data[i] = (dist[i] >= 1 && dist[i] <= t) ? VoxelType.Wall : VoxelType.Empty;
      }
    }
  }
  return {
    res,
    size: { x: nx, y: ny, z: nz },
    data,
    palette: VoxelType,
    bakedAt: Date.now(),
    source: space?.id || null,
    wallThickness: t,
    hasRock: false,
    shape: 'box-hollow',
    worldAligned: true,
  };
}

// Overwrite all voxels to a value (bulk op)
export function fillAllVoxels(vox, value) {
  if (!vox) return vox;
  // Ensure raw array data
  const dv = decompressVox(vox);
  if (!Array.isArray(dv.data)) return vox;
  for (let i = 0; i < dv.data.length; i++) dv.data[i] = value;
  try { if (value === VoxelType.Rock) dv.hasRock = true; } catch {}
  // If decompressVox returned a clone, propagate fields back
  if (dv !== vox) {
    try { vox.data = dv.data; vox.hasRock = dv.hasRock; } catch {}
  }
  return vox;
}

// Overwrite only instantiated voxels (leave Uninstantiated outside region intact)
export function fillInstantiatedVoxels(vox, value) {
  if (!vox) return vox;
  const dv = decompressVox(vox);
  if (!Array.isArray(dv.data)) return vox;
  for (let i = 0; i < dv.data.length; i++) {
    if (dv.data[i] !== VoxelType.Uninstantiated) dv.data[i] = value;
  }
  try { if (value === VoxelType.Rock) dv.hasRock = true; } catch {}
  if (dv !== vox) {
    try { vox.data = dv.data; vox.hasRock = dv.hasRock; } catch {}
  }
  return vox;
}

// ——————————— Simple RLE compression for voxel arrays ———————————
// Encodes an array of small integers as [value, runLength, ...]
export function encodeVoxRLE(arr) {
  const out = [];
  if (!Array.isArray(arr) || arr.length === 0) return out;
  let cur = arr[0]; let run = 1;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v === cur && run < 0x7fffffff) run++;
    else { out.push(cur, run); cur = v; run = 1; }
  }
  out.push(cur, run);
  return out;
}

export function decodeVoxRLE(packed) {
  const out = [];
  if (!Array.isArray(packed) || packed.length === 0) return out;
  for (let i = 0; i < packed.length; i += 2) {
    const v = packed[i]; const n = packed[i+1] || 0;
    for (let k = 0; k < n; k++) out.push(v);
  }
  return out;
}

export function compressVox(vox) {
  if (!vox || !Array.isArray(vox.data)) return vox;
  const rle = encodeVoxRLE(vox.data);
  const clone = { ...vox };
  clone.data = { codec: 'rle', rle };
  return clone;
}

export function decompressVox(vox) {
  if (!vox || !vox.data) return vox;
  if (Array.isArray(vox.data)) return vox; // already raw
  const d = vox.data;
  if (d && d.codec === 'rle' && Array.isArray(d.rle)) {
    const clone = { ...vox };
    clone.data = decodeVoxRLE(d.rle);
    return clone;
  }
  return vox;
}

// ——————————— Merge helpers ———————————
// Merge two voxel values according to rules:
// U+U=U; U+Any=Any; E+Any=E (both ways); R+R=R; W+W=W; R+W=W (either order)
export function mergeVoxelValues(a, b) {
  const U = VoxelType.Uninstantiated, E = VoxelType.Empty, R = VoxelType.Rock, W = VoxelType.Wall;
  if (a === U && b === U) return U;
  if (a === U) return b;
  if (b === U) return a;
  if (a === E || b === E) return E;
  if (a === W && b === W) return W;
  if (a === R && b === R) return R;
  if ((a === R && b === W) || (a === W && b === R)) return W;
  // Fallback: prefer first (primary)
  return a;
}

// Merge two voxel maps with same shape (size/res) into a new map, cell-by-cell
export function mergeVoxSameShape(primary, secondary) {
  if (!primary || !secondary) return primary || secondary || null;
  const A = decompressVox(primary);
  const B = decompressVox(secondary);
  const ax = A?.size?.x|0, ay = A?.size?.y|0, az = A?.size?.z|0;
  const bx = B?.size?.x|0, by = B?.size?.y|0, bz = B?.size?.z|0;
  const ar = A?.res||1, br = B?.res||1;
  if (ax !== bx || ay !== by || az !== bz || ar !== br) {
    throw new Error('mergeVoxSameShape requires matching size and res');
  }
  const n = (Array.isArray(A.data) ? A.data.length : 0);
  const outData = new Array(n);
  let hasRock = false;
  for (let i = 0; i < n; i++) {
    const v = mergeVoxelValues(A.data[i] ?? VoxelType.Uninstantiated, B.data[i] ?? VoxelType.Uninstantiated);
    outData[i] = v;
    if (v === VoxelType.Rock) hasRock = true;
  }
  return {
    res: ar,
    size: { x: ax, y: ay, z: az },
    data: outData,
    palette: VoxelType,
    bakedAt: Date.now(),
    source: A?.source ?? null,
    hasRock,
  };
}
