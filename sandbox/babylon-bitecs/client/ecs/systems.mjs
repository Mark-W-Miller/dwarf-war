import { defineQuery } from '../vendor/bitecs-lite.mjs';
import { Transform, AIOrder, ThinIndex, PathStore } from './components.mjs';

function dist(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.hypot(dx, dy, dz);
}

function stepToward(pos, target, maxStep) {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const s = Math.min(1, maxStep / len);
  return { x: pos.x + dx * s, y: pos.y + dy * s, z: pos.z + dz * s };
}

// Query entities that can move along a path
const qMove = defineQuery([Transform, AIOrder]);

export function movementSystem(world, dt) {
  const ents = qMove(world);
  for (let k = 0; k < ents.length; k++) {
    const eid = ents[k];
    const path = PathStore.get(eid);
    if (!path || path.length === 0) continue;
    const idx = AIOrder.index[eid] | 0;
    const target = path[Math.min(idx, path.length - 1)];
    const speed = AIOrder.speed[eid] || 1;
    const next = stepToward({ x: Transform.x[eid], y: Transform.y[eid], z: Transform.z[eid] }, target, speed * dt);
    Transform.x[eid] = next.x;
    Transform.y[eid] = next.y;
    Transform.z[eid] = next.z;
    if (dist(next, target) < 0.05) {
      AIOrder.index[eid] = Math.min(idx + 1, path.length - 1);
    }
  }
  return world;
}

// Render sync for thin instances on a single shared mesh
const qThin = defineQuery([Transform, ThinIndex]);

export function makeThinInstanceRenderer(sharedMesh) {
  // Create a reusable matrix to avoid allocations per entity
  const m = new BABYLON.Matrix();
  const v = new BABYLON.Vector3();
  const s = new BABYLON.Vector3();
  return function renderSyncThinInstances(world) {
    const ents = qThin(world);
    for (let k = 0; k < ents.length; k++) {
      const eid = ents[k];
      const i = ThinIndex.i[eid] | 0;
      v.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
      s.set(Transform.s[eid] || 1, Transform.s[eid] || 1, Transform.s[eid] || 1);
      BABYLON.Matrix.ComposeToRef(s, BABYLON.Quaternion.Identity(), v, m);
      sharedMesh.thinInstanceSetMatrixAt(i, m);
    }
    sharedMesh.thinInstanceBufferUpdated("matrix");
    // Ensure bounding info matches instances so frustum culling doesn't hide them
    if (typeof sharedMesh.thinInstanceRefreshBoundingInfo === 'function') {
      sharedMesh.thinInstanceRefreshBoundingInfo(true);
    }
    return world;
  };
}
