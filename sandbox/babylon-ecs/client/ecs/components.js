// Data-only component helpers

export const C = {
  Transform: 'Transform',
  Renderable: 'Renderable',
  UnitTag: 'UnitTag',
  AIOrder: 'AIOrder',
  TunnelSegment: 'TunnelSegment',
  Carddon: 'Carddon',
  WarRoom: 'WarRoom'
};

export function makeTransform({ x = 0, y = 0, z = 0 } = {}, { rx = 0, ry = 0, rz = 0 } = {}, { sx = 1, sy = 1, sz = 1 } = {}) {
  return {
    position: { x, y, z },
    rotation: { x: rx, y: ry, z: rz },
    scale: { x: sx, y: sy, z: sz },
  };
}

export function makeRenderable({ mesh = null, material = null } = {}) {
  return { mesh, material };
}

export function makeUnitTag(kind = 'Dwarf') {
  return { kind };
}

export function makeAIOrder(path = [], mode = 'Move', speed = 2) {
  return { path, mode, speed, index: 0 };
}

export function makeTunnelSegment(cls = 'M_Pass', integrity = 100, beauty = 0) {
  return { class: cls, integrity, beauty };
}

export function makeCarddon(name = 'Honwee', integrity = 100, beauty = 0) {
  return { name, integrity, beauty };
}

