import { makeWorld, spawnWithTransform } from './ecs/world.mjs';
import { Transform, AIOrder, ThinIndex, UnitTag, PathStore } from './ecs/components.mjs';
import { movementSystem, makeThinInstanceRenderer } from './ecs/systems.mjs';
import { addComponent } from './vendor/bitecs-lite.mjs';

// Babylon setup
const canvas = document.getElementById('renderCanvas');
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

// Spawn a bunch of units as thin instances
const COUNT = 120; // tweak to 1000+ later to test scale
dwarfBase.thinInstanceSetMatrixAt(0, BABYLON.Matrix.Identity()); // initialize buffer
dwarfBase.thinInstanceCount = COUNT;

for (let i = 0; i < COUNT; i++) {
  const angle = (i / COUNT) * Math.PI * 2;
  const radius = 6 + (i % 10) * 0.15;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = ((i % 5) - 2) * 0.2;
  const eid = spawnWithTransform(world, x, y, z, 1);
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
}

// Systems pipeline
const renderSyncThin = makeThinInstanceRenderer(dwarfBase);
// Initialize instance matrices once before the first render
renderSyncThin(world);

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000; // seconds
  // Update loop (variable timestep for demo)
  movementSystem(world, dt);
  renderSyncThin(world, dt);
  scene.render();
});

window.addEventListener('resize', () => engine.resize());
