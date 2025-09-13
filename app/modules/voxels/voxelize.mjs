// Simple voxelization helpers for spaces

// Type ids:
// 0=Uninstantiated (U), 1=Empty (E), 2=Rock (R), 3=Wall (W)
export const VoxelType = { Uninstantiated: 0, Empty: 1, Rock: 2, Wall: 3 };

// Bake a hollow container: shell = Wall (thickness t voxels), interior = Empty
// Space size fields are in voxels already; res is voxel size in world units.
export function bakeHollowContainer(space, opts = {}) {
  const t = Math.max(1, Math.floor(opts.wallThickness || 1));
  const sx = Math.max(1, Math.floor(space?.size?.x || 1));
  const sy = Math.max(1, Math.floor(space?.size?.y || 1));
  const sz = Math.max(1, Math.floor(space?.size?.z || 1));
  const nx = sx, ny = sy, nz = sz;
  const len = nx * ny * nz;
  const grid = new Array(len);
  const idx = (x,y,z) => (x + nx*(y + ny*z));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const onX = (x < t) || (x >= nx - t);
        const onY = (y < t) || (y >= ny - t);
        const onZ = (z < t) || (z >= nz - t);
        const isShell = onX || onY || onZ;
        grid[idx(x,y,z)] = isShell ? VoxelType.Wall : VoxelType.Empty;
      }
    }
  }
  return {
    res: (space?.res || 1),
    size: { x: nx, y: ny, z: nz },
    data: grid,
    palette: VoxelType,
    bakedAt: Date.now(),
    source: space?.id || null,
    wallThickness: t,
    hasRock: false,
  };
}

// Overwrite all voxels to a value (bulk op)
export function fillAllVoxels(vox, value) {
  if (!vox || !Array.isArray(vox.data)) return vox;
  for (let i = 0; i < vox.data.length; i++) vox.data[i] = value;
  try { if (value === VoxelType.Rock) vox.hasRock = true; } catch {}
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
