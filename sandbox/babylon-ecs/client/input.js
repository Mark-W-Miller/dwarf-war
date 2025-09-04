// Centralized input/event handlers for the Babylon + custom ECS sandbox
import { C } from './ecs/components.js';

// ————————————— Handlers —————————————
export function handleDwarfHit({ scene, camera, dwarfMesh, world, dwarfEid, pickedPoint, hitNormal, hitDotMat }) {
  const t = world.getComponent(dwarfEid, C.Transform);
  const spin = world.getComponent(dwarfEid, C.Spin);
  const mass = world.getComponent(dwarfEid, C.Mass);
  if (!t || !spin) return;

  // Angular impulse from lever arm and ray direction
  const center = new BABYLON.Vector3(t.position.x, t.position.y, t.position.z);
  const r = pickedPoint.subtract(center);
  const dir = pickedPoint.subtract(camera.position).normalize();
  const J = dir.scale(4.0);
  const L = BABYLON.Vector3.Cross(r, J);

  // Treat each attached dot as additional inertia. Conserve angular momentum when mass increases.
  let oldI = 1.0, newI = 1.0;
  if (mass) {
    oldI = mass.baseInertia + mass.perDotInertia * (mass.dots || 0);
    mass.dots = (mass.dots || 0) + 1;
    newI = mass.baseInertia + mass.perDotInertia * mass.dots;
    const scale = oldI / newI;
    spin.angVel.x *= scale;
    spin.angVel.y *= scale;
    spin.angVel.z *= scale;
  }
  const I = newI; // current inertia
  const impulseGain = 0.4;
  spin.angVel.x += (L.x * impulseGain) / I;
  spin.angVel.y += (L.y * impulseGain) / I;
  spin.angVel.z += (L.z * impulseGain) / I;

  console.groupCollapsed('%cHit dwarf — angular impulse','color:#FFD54F;font-weight:bold');
  console.log('contact', { x: +pickedPoint.x.toFixed(3), y: +pickedPoint.y.toFixed(3), z: +pickedPoint.z.toFixed(3) });
  console.log('r', { x: +r.x.toFixed(3), y: +r.y.toFixed(3), z: +r.z.toFixed(3) });
  console.log('L = r x J', { x: +L.x.toFixed(3), y: +L.y.toFixed(3), z: +L.z.toFixed(3) });
  if (mass) {
    console.log('mass', { dots: mass.dots, baseI: +mass.baseInertia.toFixed(2), perDot: +mass.perDotInertia.toFixed(2), I: +I.toFixed(2) });
  }
  console.groupEnd();

  // Spawn a blue dot at the exact hit point in local space, slightly offset along the face normal.
  const invWorld = dwarfMesh.getWorldMatrix().clone();
  invWorld.invert();
  const localPoint = BABYLON.Vector3.TransformCoordinates(pickedPoint, invWorld);
  let nLocal;
  if (hitNormal) {
    nLocal = BABYLON.Vector3.TransformNormal(hitNormal, invWorld).normalize();
  } else {
    const ax = Math.abs(localPoint.x), ay = Math.abs(localPoint.y), az = Math.abs(localPoint.z);
    if (ax >= ay && ax >= az) nLocal = new BABYLON.Vector3(Math.sign(localPoint.x) || 1, 0, 0);
    else if (ay >= ax && ay >= az) nLocal = new BABYLON.Vector3(0, Math.sign(localPoint.y) || 1, 0);
    else nLocal = new BABYLON.Vector3(0, 0, Math.sign(localPoint.z) || 1);
  }
  const dot = BABYLON.MeshBuilder.CreateSphere('hitDot', { diameter: 0.12, segments: 8 }, scene);
  dot.material = hitDotMat;
  dot.isPickable = false;
  dot.parent = dwarfMesh;
  dot.position = localPoint.add(nLocal.scale(0.02));
  // Log new dot position in both local (relative to dwarf) and world space
  const worldPos = dot.getAbsolutePosition();
  console.log('hit dot', {
    local: { x: +dot.position.x.toFixed(3), y: +dot.position.y.toFixed(3), z: +dot.position.z.toFixed(3) },
    world: { x: +worldPos.x.toFixed(3), y: +worldPos.y.toFixed(3), z: +worldPos.z.toFixed(3) },
  });
}

export function handleGroundHit({ scene, ground, world, dwarfEid, pickedPoint, markerMat, clickIndex }) {
  // Create a persistent red dot at the clicked ground position
  const dot = BABYLON.MeshBuilder.CreateSphere('clickDot', { diameter: 0.24, segments: 12 }, scene);
  dot.material = markerMat;
  dot.isPickable = false;
  dot.position.copyFrom(pickedPoint);
  dot.position.y = ground.position.y + 0.02;

  const picked = { x: +pickedPoint.x.toFixed(3), y: +pickedPoint.y.toFixed(3), z: +pickedPoint.z.toFixed(3) };
  const markerPos = { x: +dot.position.x.toFixed(3), y: +dot.position.y.toFixed(3), z: +dot.position.z.toFixed(3) };
  console.groupCollapsed(`%cGround Click #${clickIndex}`,'color:#4FC3F7;font-weight:bold');
  console.log('picked (world)', picked);
  console.log('marker (red dot)', markerPos);
  console.groupEnd();

  // Retarget dwarf to the clicked x/z at its current height
  if (dwarfEid != null) {
    const t = world.getComponent(dwarfEid, C.Transform);
    const order = world.getComponent(dwarfEid, C.AIOrder);
    if (t && order) {
      order.path = [
        { x: t.position.x, y: t.position.y, z: t.position.z },
        { x: pickedPoint.x, y: t.position.y, z: pickedPoint.z },
      ];
      order.index = 0;
      order.mode = 'Move';
    }
  }
}

// ————————————— Registration —————————————
export function registerInputHandlers({ scene, camera, engine, ground, dwarfMesh, world, dwarfEid }) {
  // Materials created once and shared by handlers
  const markerMat = new BABYLON.PBRMetallicRoughnessMaterial('markerMat', scene);
  markerMat.baseColor = new BABYLON.Color3(1, 0.2, 0.2);
  markerMat.metallic = 0.0;
  markerMat.roughness = 0.4;

  const hitDotMat = new BABYLON.PBRMetallicRoughnessMaterial('hitDotMat', scene);
  hitDotMat.baseColor = new BABYLON.Color3(0.2, 0.6, 1.0);
  hitDotMat.metallic = 0.0;
  hitDotMat.roughness = 0.3;

  let clickCount = 0;

  scene.onPointerObservable.add((pi) => {
    if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;

    // Try dwarf first
    const hitCube = scene.pick(scene.pointerX, scene.pointerY, (m) => m === dwarfMesh);
    if (hitCube?.hit && hitCube.pickedPoint && dwarfEid != null) {
      const hitNormal = typeof hitCube.getNormal === 'function' ? hitCube.getNormal(true, true) : null;
      handleDwarfHit({ scene, camera, dwarfMesh, world, dwarfEid, pickedPoint: hitCube.pickedPoint, hitNormal, hitDotMat });
      return;
    }

    // Otherwise, ground
    const hitGround = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ground);
    if (hitGround?.hit && hitGround.pickedPoint) {
      clickCount += 1;
      handleGroundHit({ scene, ground, world, dwarfEid, pickedPoint: hitGround.pickedPoint, markerMat, clickIndex: clickCount });
    }
  });

  // Window resize handler centralized here
  window.addEventListener('resize', () => engine.resize());
}
