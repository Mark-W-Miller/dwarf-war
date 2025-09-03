import { World } from './ecs/world.js';
import { C, makeTransform, makeRenderable, makeUnitTag, makeAIOrder, makeCarddon } from './ecs/components.js';
import { MovementSystem, RenderSyncSystem } from './ecs/systems.js';

// Expect BABYLON global from CDN script in index.html

const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 14, new BABYLON.Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 6;
camera.upperRadiusLimit = 50;

// Lighting
const light = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
light.position = new BABYLON.Vector3(10, 20, 10);
light.intensity = 1.2;

// Simple PBR material for stone/cave
const caveMat = new BABYLON.PBRMetallicRoughnessMaterial('caveMat', scene);
caveMat.baseColor = new BABYLON.Color3(0.25, 0.26, 0.28);
caveMat.metallic = 0.0;
caveMat.roughness = 1.0;

// Create a "cave" as a backface sphere
const cave = BABYLON.MeshBuilder.CreateSphere('cave', { diameter: 60, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
cave.material = caveMat;

// Ground-ish hint inside the cave
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 100, height: 100, subdivisions: 1 }, scene);
ground.position.y = -2;
const groundMat = new BABYLON.PBRMetallicRoughnessMaterial('groundMat', scene);
groundMat.baseColor = new BABYLON.Color3(0.18, 0.18, 0.18);
groundMat.metallic = 0.0;
groundMat.roughness = 0.9;
ground.material = groundMat;

// Dwarf placeholder mesh (cube)
const dwarfMesh = BABYLON.MeshBuilder.CreateBox('dwarf', { size: 0.7 }, scene);
const dwarfMat = new BABYLON.PBRMetallicRoughnessMaterial('dwarfMat', scene);
dwarfMat.baseColor = new BABYLON.Color3(0.8, 0.7, 0.5);
dwarfMat.metallic = 0.2;
dwarfMat.roughness = 0.6;
dwarfMesh.material = dwarfMat;

// World (ECS)
const world = new World();
world.addSystem(MovementSystem);
world.addSystem(RenderSyncSystem);

// Cave entity (static)
{
  const e = world.createEntity();
  world.addComponent(e, C.Transform, makeTransform({ x: 0, y: 0, z: 0 }));
  world.addComponent(e, C.Renderable, makeRenderable({ mesh: cave }));
  world.addComponent(e, C.Carddon, makeCarddon('Honwee', 100, 5));
}

// Dwarf entity (moves along a simple path)
{
  const e = world.createEntity();
  world.addComponent(e, C.Transform, makeTransform({ x: -3, y: 0, z: -2 }));
  world.addComponent(e, C.Renderable, makeRenderable({ mesh: dwarfMesh }));
  world.addComponent(e, C.UnitTag, makeUnitTag('Dwarf'));
  const path = [
    { x: -3, y: 0, z: -2 },
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    { x: -3, y: 0, z: -2 },
  ];
  world.addComponent(e, C.AIOrder, makeAIOrder(path, 'Move', 2.0));
}

// Camera target near center
camera.target = new BABYLON.Vector3(0, 0.5, 0);

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  world.tick(dt);
  scene.render();
});

window.addEventListener('resize', () => engine.resize());

