// worldInit.js
// Responsibilities:
// - Create Babylon scene objects (scene, camera, lights, materials, meshes)
// - Create and return an empty ECS world with systems registered
// Notes:
// - This file does NOT attach gameplay components to entities. main.js owns that.
// - Input handlers live in input.js.

import { World } from './ecs/world.js';
import { MovementSystem, RenderSyncSystem, SpinSystem } from './ecs/systems.js';

// Create Babylon scene, camera, lights, and meshes.
// Returns { scene, camera, meshes: { cave, ground, dwarfMesh } }
export function createScene(engine, canvas) {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

  // Camera: ArcRotate (orbit)
  const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 14, new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6;
  camera.upperRadiusLimit = 50;

  // Directional light
  const light = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
  light.position = new BABYLON.Vector3(10, 20, 10);
  light.intensity = 1.2;

  // Materials
  const caveMat = new BABYLON.PBRMetallicRoughnessMaterial('caveMat', scene);
  caveMat.baseColor = new BABYLON.Color3(0.25, 0.26, 0.28);
  caveMat.metallic = 0.0;
  caveMat.roughness = 1.0;

  const groundMat = new BABYLON.PBRMetallicRoughnessMaterial('groundMat', scene);
  groundMat.baseColor = new BABYLON.Color3(0.18, 0.18, 0.18);
  groundMat.metallic = 0.0;
  groundMat.roughness = 0.9;

  const dwarfMat = new BABYLON.PBRMetallicRoughnessMaterial('dwarfMat', scene);
  dwarfMat.baseColor = new BABYLON.Color3(0.8, 0.7, 0.5);
  dwarfMat.metallic = 0.2;
  dwarfMat.roughness = 0.6;

  // Geometry: cave sphere (backside), ground plane, dwarf cube
  const cave = BABYLON.MeshBuilder.CreateSphere('cave', { diameter: 60, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  cave.material = caveMat;
  cave.isPickable = false; // ensure ground gets pointer picks

  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 100, height: 100, subdivisions: 1 }, scene);
  ground.position.y = -2;
  ground.material = groundMat;
  ground.isPickable = true;

  const dwarfMesh = BABYLON.MeshBuilder.CreateBox('dwarf', { size: 0.7 }, scene);
  dwarfMesh.material = dwarfMat;

  // Visual label to identify this sandbox
  {
    const plane = BABYLON.MeshBuilder.CreatePlane('label', { size: 3 }, scene);
    plane.position = new BABYLON.Vector3(0, 3, 0);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const dt = new BABYLON.DynamicTexture('labelTex', { width: 1024, height: 256 }, scene, false);
    dt.hasAlpha = true;
    const ctx = dt.getContext();
    ctx.clearRect(0, 0, 1024, 256);
    dt.drawText('Babylon + Custom ECS Sandbox', null, null, 'bold 64px sans-serif', '#e0e6ed', 'transparent', true);
    const mat = new BABYLON.StandardMaterial('labelMat', scene);
    mat.diffuseTexture = dt;
    mat.emissiveTexture = dt;
    mat.backFaceCulling = false;
    plane.material = mat;
  }

  // A small blue dot parented to the dwarf (static reference point)
  {
    const blueMat = new BABYLON.PBRMetallicRoughnessMaterial('blueDotMat', scene);
    blueMat.baseColor = new BABYLON.Color3(0.2, 0.5, 1.0);
    blueMat.metallic = 0.0;
    blueMat.roughness = 0.3;
    const blueDot = BABYLON.MeshBuilder.CreateSphere('blueDot', { diameter: 0.15, segments: 8 }, scene);
    blueDot.material = blueMat;
    blueDot.parent = dwarfMesh; // inherits position + rotation
    blueDot.position = new BABYLON.Vector3(0, 0, 0.45); // slightly in front of +Z face
    blueDot.isPickable = false;
  }

  return { scene, camera, meshes: { cave, ground, dwarfMesh } };
}

// Create an empty ECS world and register systems in recommended order.
// Returns the world. main.js will create entities and attach components.
export function createWorld() {
  const world = new World();
  // Order matters: movement → spin → render sync
  world.addSystem(MovementSystem);
  world.addSystem(SpinSystem);
  world.addSystem(RenderSyncSystem);
  return world;
}

