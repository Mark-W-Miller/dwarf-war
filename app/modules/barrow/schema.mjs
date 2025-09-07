// Barrow schema and helpers

export const directions = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
  NE: { x: 1, z: -1 }, NW: { x: -1, z: -1 }, SE: { x: 1, z: 1 }, SW: { x: -1, z: 1 },
  UP: { y: 1 }, DOWN: { y: -1 },
};

export function makeDefaultBarrow() {
  return {
    id: 'Your Barrow',
    caverns: [],
    carddons: [],
    links: [],
    meta: { version: 1, createdAt: Date.now(), updatedAt: Date.now() },
  };
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
  const center = barrow.caverns.find(c => c.role === 'central') || barrow.caverns[0];
  if (!center.pos) center.pos = { x: 0, y: 0, z: 0 };
  const scale = 6; // spacing units
  const byId = new Map(barrow.caverns.map(c => [c.id, c]));
  for (const link of barrow.links) {
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
