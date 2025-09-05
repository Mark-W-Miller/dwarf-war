import { makeWorld, spawnWithTransform } from './ecs/world.mjs';
import { Transform, AIOrder, ThinIndex, UnitTag, PathStore } from './ecs/components.mjs';
import { movementSystem, makeThinInstanceRenderer } from './ecs/systems.mjs';
import { addComponent } from './vendor/bitecs-lite.mjs';

// Babylon setup
const canvas = document.getElementById('renderCanvas');
const overlayEl = document.getElementById('overlay');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 18, new BABYLON.Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 80;
camera.minZ = 0.1; camera.maxZ = 600;

// 3D label indicating which sandbox this is
{
  const plane = BABYLON.MeshBuilder.CreatePlane('label', { size: 3 }, scene);
  plane.position = new BABYLON.Vector3(0, 3, 0);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  const dt = new BABYLON.DynamicTexture('labelTex', { width: 1024, height: 256 }, scene, false);
  const ctx = dt.getContext();
  dt.hasAlpha = true;
  ctx.clearRect(0, 0, 1024, 256);
  dt.drawText('Babylon + bitecs Sandbox', null, null, "bold 64px sans-serif", '#e0e6ed', 'transparent', true);
  const mat = new BABYLON.StandardMaterial('labelMat', scene);
  mat.diffuseTexture = dt;
  mat.emissiveTexture = dt;
  mat.backFaceCulling = false;
  plane.material = mat;
}

// Lighting
const light = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
light.position = new BABYLON.Vector3(10, 20, 10);
light.intensity = 1.2;
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.15;

// Materials
const caveMat = new BABYLON.PBRMetallicRoughnessMaterial('caveMat', scene);
caveMat.baseColor = new BABYLON.Color3(0.25, 0.26, 0.28); caveMat.metallic = 0.0; caveMat.roughness = 1.0;
const dwarfMat = new BABYLON.PBRMetallicRoughnessMaterial('dwarfMat', scene);
dwarfMat.baseColor = new BABYLON.Color3(0.8, 0.7, 0.5); dwarfMat.metallic = 0.2; dwarfMat.roughness = 0.6;

// Cave geometry
const cave = BABYLON.MeshBuilder.CreateSphere('cave', { diameter: 80, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
cave.material = caveMat;
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 200, height: 200, subdivisions: 1 }, scene);
ground.position.y = -2; const groundMat = new BABYLON.PBRMetallicRoughnessMaterial('groundMat', scene);
groundMat.baseColor = new BABYLON.Color3(0.18, 0.18, 0.18); groundMat.metallic = 0.0; groundMat.roughness = 0.9; ground.material = groundMat;
ground.isPickable = true;

// Base mesh for thin instances
const dwarfBase = BABYLON.MeshBuilder.CreateBox('dwarfBase', { size: 0.7 }, scene);
dwarfBase.material = dwarfMat;
// Hide the base mesh so only the moving thin instances are visible
dwarfBase.isVisible = false;

// ECS world
const world = makeWorld();
let debugFollowEid = null; // entity to mirror with a regular mesh for debugging

// Spawn a bunch of units as thin instances
const COUNT = 120; // tweak to 1000+ later to test scale

for (let i = 0; i < COUNT; i++) {
  const angle = (i / COUNT) * Math.PI * 2;
  const radius = 6 + (i % 10) * 0.15;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = ((i % 5) - 2) * 0.2;
  const eid = spawnWithTransform(world, x, y, z, 1);
  if (debugFollowEid === null) debugFollowEid = eid;
  addComponent(world, UnitTag, eid);
  addComponent(world, ThinIndex, eid); ThinIndex.i[eid] = i;
  addComponent(world, AIOrder, eid); AIOrder.speed[eid] = 3.0 + (i % 3) * 0.6; AIOrder.index[eid] = 0;
  // Give each unit a simple looped path
  const p = [
    { x: x, y: y, z: z },
    { x: x * 0.5, y: y, z: z * 0.5 },
    { x: -x, y: y, z: -z },
    { x: x * 0.7, y: y, z: -z * 0.7 },
  ];
  PathStore.set(eid, p);

  // Create the thin instance initially at its transform
  const m = new BABYLON.Matrix();
  BABYLON.Matrix.ComposeToRef(
    new BABYLON.Vector3(1,1,1),
    BABYLON.Quaternion.Identity(),
    new BABYLON.Vector3(x, y, z),
    m
  );
  const idx = dwarfBase.thinInstanceAdd(m);
  ThinIndex.i[eid] = idx;
}

// For feature parity with ECS: start the followed entity with an empty path
if (debugFollowEid != null) {
  PathStore.set(debugFollowEid, []);
  AIOrder.index[debugFollowEid] = 0;
}

// Systems pipeline
const renderSyncThin = makeThinInstanceRenderer(dwarfBase);
// Initialize instance matrices once before the first render
renderSyncThin(world);

// Visible debug cube that mirrors the first entity's Transform
const debugMat = new BABYLON.PBRMetallicRoughnessMaterial('debugMat', scene);
debugMat.baseColor = new BABYLON.Color3(1.0, 0.2, 0.2);
debugMat.metallic = 0.0; debugMat.roughness = 0.4;
const debugCube = BABYLON.MeshBuilder.CreateBox('debugCube', { size: 0.9 }, scene);
debugCube.material = debugMat;

// Small blue reference dot on the debug cube
{
  const blueMat = new BABYLON.PBRMetallicRoughnessMaterial('blueDotMat', scene);
  blueMat.baseColor = new BABYLON.Color3(0.2, 0.5, 1.0);
  blueMat.metallic = 0.0; blueMat.roughness = 0.3;
  const blueDot = BABYLON.MeshBuilder.CreateSphere('blueDot', { diameter: 0.15, segments: 8 }, scene);
  blueDot.material = blueMat; blueDot.parent = debugCube; blueDot.position = new BABYLON.Vector3(0, 0, 0.45);
  blueDot.isPickable = false;
}

// Flashlight spotlight that follows the camera and aims at the debug cube
{
  const flashlight = new BABYLON.SpotLight(
    'flashlight',
    camera.position.clone(),
    new BABYLON.Vector3(0, 0, 1),
    Math.PI / 24, // laser-like narrow cone
    32,           // sharper falloff
    scene
  );
  flashlight.intensity = 2.0;
  flashlight.range = 100;
  const tmp = new BABYLON.Vector3();
  scene.onBeforeRenderObservable.add(() => {
    flashlight.position.copyFrom(camera.position);
    tmp.copyFrom(debugCube.getAbsolutePosition());
    tmp.subtractInPlace(flashlight.position);
    const lenSq = tmp.lengthSquared();
    if (lenSq > 1e-6) {
      tmp.scaleInPlace(1 / Math.sqrt(lenSq));
      flashlight.direction.copyFrom(tmp);
    } else {
      const fwd = camera.getForwardRay(1).direction;
      flashlight.direction.copyFrom(fwd);
    }
  });

  // Shadows: debug cube and thin instances cast; ground/cave receive
  const shadowGen = new BABYLON.ShadowGenerator(1024, flashlight);
  shadowGen.usePoissonSampling = true;
  shadowGen.bias = 0.0015;
  shadowGen.addShadowCaster(debugCube);
  shadowGen.addShadowCaster(dwarfBase); // include thin instances
  ground.receiveShadows = true;
  cave.receiveShadows = true;
}

// Input + interactions parity with ECS sandbox
const markerMat = new BABYLON.PBRMetallicRoughnessMaterial('markerMat', scene);
markerMat.baseColor = new BABYLON.Color3(1, 0.2, 0.2); markerMat.metallic = 0.0; markerMat.roughness = 0.4;
const hitDotMat = new BABYLON.PBRMetallicRoughnessMaterial('hitDotMat', scene);
hitDotMat.baseColor = new BABYLON.Color3(0.2, 0.6, 1.0); hitDotMat.metallic = 0.0; hitDotMat.roughness = 0.3;
const tubeMat = new BABYLON.PBRMetallicRoughnessMaterial('patrolTubeMat', scene);
tubeMat.baseColor = new BABYLON.Color3(0.95, 0.75, 0.2); tubeMat.metallic = 0.0; tubeMat.roughness = 0.5;

let clickCount = 0;
let patrolTube = null; // Mesh
const pathPoints = []; // Vector3 at ground height

// Spin state for the debug cube to mirror ECS hit physics-lite
const angVel = new BABYLON.Vector3(0, 0, 0);
let massDots = 0;
const baseInertia = 1.0;
const perDotInertia = 0.25;
const impulseGain = 0.4;
const dampingPerSecond = 0.92;

function updatePatrolTube() {
  if (pathPoints.length < 2) {
    if (patrolTube) { patrolTube.dispose(); patrolTube = null; }
    return;
  }
  const closed = pathPoints.concat([pathPoints[0]]);
  if (patrolTube) { patrolTube.dispose(); patrolTube = null; }
  patrolTube = BABYLON.MeshBuilder.CreateTube('patrolTube', { path: closed, radius: 0.035 }, scene);
  patrolTube.material = tubeMat;
  patrolTube.isPickable = false;
}

scene.onPointerObservable.add((pi) => {
  if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;

  // Try debug cube first
  const hitCube = scene.pick(scene.pointerX, scene.pointerY, (m) => m === debugCube);
  if (hitCube?.hit && hitCube.pickedPoint) {
    // Compute angular impulse L = r x J
    const center = debugCube.position.clone();
    const r = hitCube.pickedPoint.subtract(center);
    const dir = hitCube.pickedPoint.subtract(camera.position).normalize();
    const J = dir.scale(4.0);
    const L = BABYLON.Vector3.Cross(r, J);
    // Adjust for inertia if we add mass via dots
    const oldI = baseInertia + perDotInertia * massDots;
    massDots += 1;
    const newI = baseInertia + perDotInertia * massDots;
    const scale = oldI / newI;
    angVel.scaleInPlace(scale);
    angVel.x += (L.x * impulseGain) / newI;
    angVel.y += (L.y * impulseGain) / newI;
    angVel.z += (L.z * impulseGain) / newI;

    // Spawn a blue dot at the local-space hit point, offset along normal
    const invWorld = debugCube.getWorldMatrix().clone(); invWorld.invert();
    const localPoint = BABYLON.Vector3.TransformCoordinates(hitCube.pickedPoint, invWorld);
    let nLocal;
    if (typeof hitCube.getNormal === 'function') {
      nLocal = BABYLON.Vector3.TransformNormal(hitCube.getNormal(true, true), invWorld).normalize();
    } else {
      const ax = Math.abs(localPoint.x), ay = Math.abs(localPoint.y), az = Math.abs(localPoint.z);
      if (ax >= ay && ax >= az) nLocal = new BABYLON.Vector3(Math.sign(localPoint.x) || 1, 0, 0);
      else if (ay >= ax && ay >= az) nLocal = new BABYLON.Vector3(0, Math.sign(localPoint.y) || 1, 0);
      else nLocal = new BABYLON.Vector3(0, 0, Math.sign(localPoint.z) || 1);
    }
    const dot = BABYLON.MeshBuilder.CreateSphere('hitDot', { diameter: 0.12, segments: 8 }, scene);
    dot.material = hitDotMat; dot.isPickable = false; dot.parent = debugCube; dot.position = localPoint.add(nLocal.scale(0.02));
    return;
  }

  // Otherwise, ground
  const hitGround = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ground);
  if (hitGround?.hit && hitGround.pickedPoint && debugFollowEid != null) {
    clickCount += 1;
    const flat = new BABYLON.Vector3(hitGround.pickedPoint.x, ground.position.y + 0.02, hitGround.pickedPoint.z);
    pathPoints.push(flat);
    // Visual marker
    const dot = BABYLON.MeshBuilder.CreateSphere('clickDot', { diameter: 0.24, segments: 12 }, scene);
    dot.material = markerMat; dot.isPickable = false; dot.position.copyFrom(flat);
    updatePatrolTube();
    // Update the path for the followed entity
    const p = (PathStore.get(debugFollowEid) || []).slice();
    p.push({ x: flat.x, y: Transform.y[debugFollowEid] || 0, z: flat.z });
    PathStore.set(debugFollowEid, p);
    AIOrder.index[debugFollowEid] = 0;
  }
});

function updateDebugOverlay(dt) {
  const posText = debugFollowEid != null
    ? `x=${Transform.x[debugFollowEid]?.toFixed(2)} y=${Transform.y[debugFollowEid]?.toFixed(2)} z=${Transform.z[debugFollowEid]?.toFixed(2)}`
    : 'n/a';
  const lines = [
    'Babylon + bitecs Sandbox',
    `dt=${dt.toFixed(3)}s`,
    `entities=${world.__entities.size || 0}`,
    `instances=${dwarfBase.thinInstanceCount ?? 'n/a'}`,
    `followEid=${debugFollowEid ?? 'n/a'} ${posText}`,
  ];
  if (overlayEl) overlayEl.textContent = lines.join(' • ');
}

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000; // seconds
  // Update loop (variable timestep for demo)
  movementSystem(world, dt);
  renderSyncThin(world, dt);
  // Mirror one entity with a real mesh so you always see movement
  if (debugFollowEid != null) {
    debugCube.position.set(
      Transform.x[debugFollowEid] || 0,
      Transform.y[debugFollowEid] || 0,
      Transform.z[debugFollowEid] || 0
    );
  }
  // Apply spin to the debug cube with damping
  if (!isNaN(dt) && dt > 0) {
    debugCube.rotation.x += angVel.x * dt;
    debugCube.rotation.y += angVel.y * dt;
    debugCube.rotation.z += angVel.z * dt;
    const damp = Math.pow(dampingPerSecond, dt * 60 / 60);
    angVel.scaleInPlace(damp);
  }
  updateDebugOverlay(dt);
  scene.render();
});

window.addEventListener('resize', () => engine.resize());
