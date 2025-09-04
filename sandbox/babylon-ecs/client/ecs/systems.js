import { C } from './components.js';

function dist(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function stepToward(pos, target, maxStep) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  const s = Math.min(1, maxStep / len);
  return { x: pos.x + dx * s, y: pos.y + dy * s, z: pos.z + dz * s };
}

export function MovementSystem(world, dt) {
  for (const id of world.query(C.Transform, C.AIOrder)) {
    const t = world.getComponent(id, C.Transform);
    const order = world.getComponent(id, C.AIOrder);
    if (order.mode !== 'Move' || !order.path?.length) continue;
    const target = order.path[Math.min(order.index, order.path.length - 1)];
    const speed = order.speed || 1;
    const nextPos = stepToward(t.position, target, speed * dt);
    t.position = nextPos;
    if (dist(nextPos, target) < 0.05) {
      order.index = Math.min(order.index + 1, order.path.length - 1);
    }
  }
}

export function RenderSyncSystem(world, _dt) {
  for (const id of world.query(C.Transform, C.Renderable)) {
    const t = world.getComponent(id, C.Transform);
    const r = world.getComponent(id, C.Renderable);
    const m = r.mesh;
    if (!m) continue;
    m.position.set(t.position.x, t.position.y, t.position.z);
    m.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
    m.scaling.set(t.scale.x, t.scale.y, t.scale.z);
  }
}

export function SpinSystem(world, dt) {
  for (const id of world.query(C.Transform, C.Spin)) {
    const t = world.getComponent(id, C.Transform);
    const s = world.getComponent(id, C.Spin);
    // Integrate angular velocity into rotation
    t.rotation.x += (s.angVel.x || 0) * dt;
    t.rotation.y += (s.angVel.y || 0) * dt;
    t.rotation.z += (s.angVel.z || 0) * dt;
    // Exponential damping per second
    const d = Math.max(0, Math.min(1, s.damping ?? 0.9));
    const factor = Math.pow(d, dt * 60 / 60); // approximately per-second damping
    s.angVel.x *= factor;
    s.angVel.y *= factor;
    s.angVel.z *= factor;
  }
}
