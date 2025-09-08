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

export function makeSpace(id, type = 'Space', origin = { x:0, y:0, z:0 }, size = { x:200, y:100, z:200 }, res = 10) {
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
