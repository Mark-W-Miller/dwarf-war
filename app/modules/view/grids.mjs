// Grid planes setup and extent updates

export function initGrids(scene) {
  // Ground (XZ)
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 800, height: 800 }, scene);
  ground.position.y = 0;
  const grid = new BABYLON.GridMaterial('grid', scene);
  grid.mainColor = new BABYLON.Color3(0.10, 0.06, 0.06);
  grid.lineColor = new BABYLON.Color3(0.75, 0.25, 0.25);
  grid.gridRatio = 2; grid.opacity = 0.95; ground.material = grid;

  // XY at Z=0
  const vGrid = BABYLON.MeshBuilder.CreatePlane('gridYX', { width: 800, height: 800 }, scene);
  vGrid.position = new BABYLON.Vector3(0, 0, 0);
  const gridVMat = new BABYLON.GridMaterial('gridV', scene);
  gridVMat.mainColor = new BABYLON.Color3(0.06, 0.10, 0.06);
  gridVMat.lineColor = new BABYLON.Color3(0.25, 0.85, 0.25);
  gridVMat.gridRatio = 2; gridVMat.opacity = 0.6; gridVMat.backFaceCulling = false; vGrid.material = gridVMat;

  // YZ at X=0
  const wGrid = BABYLON.MeshBuilder.CreatePlane('gridYZ', { width: 800, height: 800 }, scene);
  wGrid.position = new BABYLON.Vector3(0, 0, 0); wGrid.rotation.y = Math.PI / 2;
  const gridWMat = new BABYLON.GridMaterial('gridW', scene);
  gridWMat.mainColor = new BABYLON.Color3(0.06, 0.08, 0.12);
  gridWMat.lineColor = new BABYLON.Color3(0.25, 0.35, 0.85);
  gridWMat.gridRatio = 2; gridWMat.opacity = 0.6; gridWMat.backFaceCulling = false; wGrid.material = gridWMat;

  function updateUnitGrids(voxelSize = 1) {
    grid.gridRatio = voxelSize;
    gridVMat.gridRatio = voxelSize;
    gridWMat.gridRatio = voxelSize;
  }

  function updateGridExtent(built) {
    const meshes = [];
    if (built?.spaces) for (const s of built.spaces) if (s.mesh) meshes.push(s.mesh);
    if (built?.caverns) for (const c of built.caverns) if (c.mesh) meshes.push(c.mesh);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of meshes) {
      const bb = m.getBoundingInfo()?.boundingBox; if (!bb) continue;
      const vmin = bb.minimumWorld, vmax = bb.maximumWorld; if (!vmin || !vmax) continue;
      minX = Math.min(minX, vmin.x); maxX = Math.max(maxX, vmax.x);
      minY = Math.min(minY, vmin.y); maxY = Math.max(maxY, vmax.y);
      minZ = Math.min(minZ, vmin.z); maxZ = Math.max(maxZ, vmax.z);
    }
    if (meshes.length === 0 || !isFinite(minX)) {
      const minSize = 1000; const s = minSize / 800;
      ground.scaling.x = s; ground.scaling.z = s; vGrid.scaling.x = s; vGrid.scaling.y = s; wGrid.scaling.x = s; wGrid.scaling.y = s; return;
    }
    const pad = 100;
    const maxAbsX = Math.max(Math.abs(minX), Math.abs(maxX));
    const maxAbsY = Math.max(Math.abs(minY), Math.abs(maxY));
    const maxAbsZ = Math.max(Math.abs(minZ), Math.abs(maxZ));
    const sizeXZ = Math.max(1000, 2 * Math.max(maxAbsX, maxAbsZ) + pad);
    const sizeXY = Math.max(1000, 2 * Math.max(maxAbsX, maxAbsY) + pad);
    const sizeYZ = Math.max(1000, 2 * Math.max(maxAbsY, maxAbsZ) + pad);
    ground.scaling.x = sizeXZ / 800; ground.scaling.z = sizeXZ / 800;
    vGrid.scaling.x = sizeXY / 800; vGrid.scaling.y = sizeXY / 800;
    wGrid.scaling.x = sizeYZ / 800; wGrid.scaling.y = sizeYZ / 800;
  }

  let gridTimer = null;
  function scheduleGridUpdate(built){
    if (gridTimer) clearTimeout(gridTimer);
    gridTimer = setTimeout(() => updateGridExtent(built), 2000);
  }

  return { ground, vGrid, wGrid, updateUnitGrids, updateGridExtent, scheduleGridUpdate };
}

