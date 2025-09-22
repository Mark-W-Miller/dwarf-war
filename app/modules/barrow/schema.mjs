// Barrow schema and helpers

export const directions = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
  NE: { x: 1, z: -1 }, NW: { x: -1, z: -1 }, SE: { x: 1, z: 1 }, SW: { x: -1, z: 1 },
  UP: { y: 1 }, DOWN: { y: -1 },
};

export function makeDefaultBarrow() {
  return {
    id: 'Your Barrow',
    caverns: [], // legacy
    carddons: [], // legacy
    links: [], // legacy
    spaces: [], // new model
    meta: { version: 1, createdAt: Date.now(), updatedAt: Date.now(), units: 'yard', voxelSize: 1 },
  };
}

// Default size halved for dims > 10 (200,100,200 -> 100,50,100)
export function makeSpace(id, type = 'Space', origin = { x:0, y:0, z:0 }, size = { x:100, y:50, z:100 }, res = 10) {
  return { id, type, origin, size, res, chunks: {}, attrs: {} };
}

export function aabbFromSpace(space) {
  const w = (space.size?.x || 0) * (space.res || 1);
  const h = (space.size?.y || 0) * (space.res || 1);
  const d = (space.size?.z || 0) * (space.res || 1);
  const cx = space.origin?.x || 0, cy = space.origin?.y || 0, cz = space.origin?.z || 0;
  // Space origin is interpreted as center
  return { min:{x:cx - w/2, y:cy - h/2, z:cz - d/2}, max:{x:cx + w/2, y:cy + h/2, z:cz + d/2} };
}

export function aabbIntersects(a, b) {
  return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z);
}

export function mergeInstructions(base, instr) {
  const out = structuredClone(base);
  if (instr.id) out.id = instr.id;
  if (Array.isArray(instr.caverns)) {
    const byId = new Map(out.caverns.map(c => [c.id, c]));
    for (const c of instr.caverns) {
      if (!c?.id) continue;
      const existing = byId.get(c.id);
      if (existing) Object.assign(existing, c);
      else out.caverns.push({ ...c });
    }
  }
  if (Array.isArray(instr.links)) {
    out.links = out.links.concat(instr.links.filter(l => l && l.from && l.to));
  }
  out.meta.updatedAt = Date.now();
  return out;
}

// Simple layout pass: place caverns around central based on link directions if missing positions
export function layoutBarrow(barrow) {
  if (!barrow || !Array.isArray(barrow.caverns) || barrow.caverns.length === 0) return barrow;
  const center = barrow.caverns.find(c => c.role === 'central') || barrow.caverns[0];
  if (center && !center.pos) center.pos = { x: 0, y: 0, z: 0 };
  const scale = 6; // spacing units
  const byId = new Map(barrow.caverns.map(c => [c.id, c]));
  const links = Array.isArray(barrow.links) ? barrow.links : [];
  for (const link of links) {
    const from = byId.get(link.from); const to = byId.get(link.to);
    if (!from || !to) continue;
    if (!to.pos) {
      const dir = directions[(link.direction || '').toUpperCase()] || { x: 1, z: 0 };
      const fx = from.pos?.x || 0, fy = from.pos?.y || 0, fz = from.pos?.z || 0;
      const dx = (dir.x || 0) * scale, dz = (dir.z || 0) * scale, dy = (dir.y || 0) * scale;
      to.pos = { x: fx + dx, y: fy + dy, z: fz + dz };
    }
  }
  return barrow;
}

// World-aligned AABB of a possibly rotated box/sphere space
export function worldAabbFromSpace(space, voxelSize = 1) {
  const sr = space.res || voxelSize || 1;
  if (space.type === 'Cavern') {
    const w = (space.size?.x||0) * sr, h = (space.size?.y||0) * sr, d = (space.size?.z||0) * sr;
    const r = Math.min(w,h,d) / 2;
    const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
    return { min:{x:cx-r,y:cy-r,z:cz-r}, max:{x:cx+r,y:cy+r,z:cz+r} };
  }
  const w = (space.size?.x||0) * sr, h = (space.size?.y||0) * sr, d = (space.size?.z||0) * sr;
  const hx = w/2, hy = h/2, hz = d/2;
  const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
  const rx = (space.rotation && typeof space.rotation.x === 'number') ? space.rotation.x : 0;
  const ry = (space.rotation && typeof space.rotation.y === 'number') ? space.rotation.y : (typeof space.rotY === 'number' ? space.rotY : 0);
  const rz = (space.rotation && typeof space.rotation.z === 'number') ? space.rotation.z : 0;
  const cX = Math.cos(rx), sX = Math.sin(rx);
  const cY = Math.cos(ry), sY = Math.sin(ry);
  const cZ = Math.cos(rz), sZ = Math.sin(rz);
  // Build rotation matrix R = Rz * Ry * Rx (Babylon default)
  function rot(p){
    // Rx
    let x=p.x, y=p.y*cX - p.z*sX, z=p.y*sX + p.z*cX;
    // Ry
    let x2 = x*cY + z*sY, y2 = y, z2 = -x*sY + z*cY;
    // Rz
    let x3 = x2*cZ - y2*sZ, y3 = x2*sZ + y2*cZ, z3 = z2;
    return { x:x3+cx, y:y3+cy, z:z3+cz };
  }
  const corners = [
    {x:-hx,y:-hy,z:-hz}, {x:+hx,y:-hy,z:-hz}, {x:-hx,y:+hy,z:-hz}, {x:+hx,y:+hy,z:-hz},
    {x:-hx,y:-hy,z:+hz}, {x:+hx,y:-hy,z:+hz}, {x:-hx,y:+hy,z:+hz}, {x:+hx,y:+hy,z:+hz},
  ].map(rot);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const p of corners){ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); minZ=Math.min(minZ,p.z); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); maxZ=Math.max(maxZ,p.z); }
  return { min:{x:minX,y:minY,z:minZ}, max:{x:maxX,y:maxY,z:maxZ} };
}
