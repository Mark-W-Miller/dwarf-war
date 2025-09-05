import { registerInputHandlers } from './input.js';
import { createScene, createWorld } from './worldInit.js';
import { C, makeTransform, makeRenderable, makeUnitTag, makeAIOrder, makeCarddon, makeSpin, makeMass } from './ecs/components.js';

// Expect BABYLON global from CDN script in index.html

const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
// Scene, camera, and meshes are created in worldInit to keep main focused on ECS data wiring
const { scene, camera, meshes } = createScene(engine, canvas);
const { cave, ground, dwarfMesh } = meshes;

// ECS world with systems registered
const world = createWorld();

// Cave entity (static visual + lore)
{
  const e = world.createEntity();
  world.addComponent(e, C.Transform, makeTransform({ x: 0, y: 0, z: 0 }));
  world.addComponent(e, C.Renderable, makeRenderable({ mesh: cave }));
  world.addComponent(e, C.Carddon, makeCarddon('Honwee', 100, 5));
}

// Dwarf entity (unit with movement, spin, and mass)
let dwarfEid = null;
{
  const e = world.createEntity();
  dwarfEid = e;
  world.addComponent(e, C.Transform, makeTransform({ x: -3, y: 0, z: -2 }));
  world.addComponent(e, C.Renderable, makeRenderable({ mesh: dwarfMesh }));
  world.addComponent(e, C.UnitTag, makeUnitTag('Dwarf'));
  world.addComponent(e, C.Spin, makeSpin(0, 0, 0, 0.92));
  world.addComponent(e, C.Mass, makeMass(1.0, 0.25, 0));
  // Start with an empty patrol path; user clicks will append waypoints (see input.js)
  world.addComponent(e, C.AIOrder, makeAIOrder([], 'Move', 2.5));
}

// Centralized input handlers: pointer + window resize
registerInputHandlers({ scene, camera, engine, ground, dwarfMesh, world, dwarfEid });

// Camera target near center
camera.target = new BABYLON.Vector3(0, 0.5, 0);

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  world.tick(dt);
  scene.render();
});
// resize handler is registered in input.js
