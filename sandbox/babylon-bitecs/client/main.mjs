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
  updateDebugOverlay(dt);
  scene.render();
});

window.addEventListener('resize', () => engine.resize());
