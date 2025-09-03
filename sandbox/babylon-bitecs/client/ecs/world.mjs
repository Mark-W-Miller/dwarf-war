// Minimal world bootstrapping utilities for bitecs
import { createWorld, addEntity, addComponent } from 'https://cdn.skypack.dev/bitecs@0.3.40';
import { Transform } from './components.mjs';

export function makeWorld() {
  const world = createWorld();
  world.time = { now: 0, dt: 0 };
  return world;
}

export function spawnWithTransform(world, x = 0, y = 0, z = 0, s = 1) {
  const eid = addEntity(world);
  addComponent(world, Transform, eid);
  Transform.x[eid] = x; Transform.y[eid] = y; Transform.z[eid] = z; Transform.s[eid] = s;
  return eid;
}

