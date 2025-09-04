// Data-only component helpers

export const C = {
  Transform: 'Transform',
  Renderable: 'Renderable',
  UnitTag: 'UnitTag',
  AIOrder: 'AIOrder',
  TunnelSegment: 'TunnelSegment',
  Carddon: 'Carddon',
  WarRoom: 'WarRoom',
  Spin: 'Spin',
  Mass: 'Mass'
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

export function makeSpin(ax = 0, ay = 0, az = 0, damping = 0.9) {
  // angVel in radians/sec; damping is multiplicative per second (0.0=no damping, 1.0=full stop)
  return { angVel: { x: ax, y: ay, z: az }, damping };
}

export function makeMass(baseInertia = 1.0, perDotInertia = 0.25, dots = 0) {
  // Simple scalar moment of inertia model: I = baseInertia + perDotInertia * dots
  return { baseInertia, perDotInertia, dots };
}
