// Grid planes setup and extent updates

export function initGrids(scene) {
  // Ground (XZ)
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 800, height: 800 }, scene);
  ground.position.y = 0;
  const grid = new BABYLON.GridMaterial('grid', scene);
  const baseMainXZ = new BABYLON.Color3(0.10, 0.06, 0.06);
  const baseLineXZ = new BABYLON.Color3(0.75, 0.25, 0.25);
  grid.mainColor = baseMainXZ.clone();
  grid.lineColor = baseLineXZ.clone();
  grid.gridRatio = 2; grid.opacity = 0.95; ground.material = grid;

  // XY at Z=0
  const vGrid = BABYLON.MeshBuilder.CreatePlane('gridYX', { width: 800, height: 800 }, scene);
  vGrid.position = new BABYLON.Vector3(0, 0, 0);
  const gridVMat = new BABYLON.GridMaterial('gridV', scene);
  const baseMainXY = new BABYLON.Color3(0.06, 0.10, 0.06);
  const baseLineXY = new BABYLON.Color3(0.25, 0.85, 0.25);
  gridVMat.mainColor = baseMainXY.clone();
  gridVMat.lineColor = baseLineXY.clone();
  gridVMat.gridRatio = 2; gridVMat.opacity = 0.6; gridVMat.backFaceCulling = false; vGrid.material = gridVMat;

  // YZ at X=0
  const wGrid = BABYLON.MeshBuilder.CreatePlane('gridYZ', { width: 800, height: 800 }, scene);
  wGrid.position = new BABYLON.Vector3(0, 0, 0); wGrid.rotation.y = Math.PI / 2;
  const gridWMat = new BABYLON.GridMaterial('gridW', scene);
  const baseMainYZ = new BABYLON.Color3(0.06, 0.08, 0.12);
  const baseLineYZ = new BABYLON.Color3(0.25, 0.35, 0.85);
  gridWMat.mainColor = baseMainYZ.clone();
  gridWMat.lineColor = baseLineYZ.clone();
  gridWMat.gridRatio = 2; gridWMat.opacity = 0.6; gridWMat.backFaceCulling = false; wGrid.material = gridWMat;

  // Axis arrows along +X, +Y, +Z for orientation
  const arrows = (() => {
    const group = new BABYLON.TransformNode('axisArrows', scene);
    function quatFromTo(vFrom, vTo) {
      const a = vFrom.clone(); a.normalize();
      const b = vTo.clone(); b.normalize();
      const dot = BABYLON.Vector3.Dot(a, b);
      if (dot > 0.999999) return BABYLON.Quaternion.Identity();
      if (dot < -0.999999) {
        // 180° rotation around any axis perpendicular to a
        let axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(1,0,0));
        if (axis.lengthSquared() < 1e-6) axis = BABYLON.Vector3.Cross(a, new BABYLON.Vector3(0,0,1));
        axis.normalize();
        return BABYLON.Quaternion.RotationAxis(axis, Math.PI);
      }
      let axis = BABYLON.Vector3.Cross(a, b); axis.normalize();
      const angle = Math.acos(dot);
      return BABYLON.Quaternion.RotationAxis(axis, angle);
    }
    function makeArrow(name, axis, color) {
      // Normalized primitives (height=1). We'll scale/position per extent later.
      const shaft = BABYLON.MeshBuilder.CreateCylinder(name+':shaft', { height: 1, diameter: 1, tessellation: 16 }, scene);
      const tip = BABYLON.MeshBuilder.CreateCylinder(name+':head', { height: 1, diameterTop: 0.0, diameterBottom: 3, tessellation: 16 }, scene);

      // Material
      const mat = new BABYLON.StandardMaterial(name+':mat', scene);
      mat.diffuseColor = color.scale(0.2); mat.emissiveColor = color; mat.specularColor = new BABYLON.Color3(0,0,0);
      try { mat.metadata = { baseColor: color.clone() }; } catch {}
      shaft.material = mat; tip.material = mat;
      shaft.isPickable = false; tip.isPickable = false;

      // Orientation from +Y to desired axis
      const dir = axis.clone(); dir.normalize();
      const q = quatFromTo(new BABYLON.Vector3(0,1,0), dir);
      shaft.rotationQuaternion = q.clone(); tip.rotationQuaternion = q.clone();
      shaft.parent = group; tip.parent = group;

      function setLength(totalLen) {
        // Head length proportionate and clamped for visibility
        const headLen = Math.min(Math.max(totalLen * 0.1, 8), Math.max(30, totalLen * 0.3));
        const shaftLen = Math.max(0, totalLen - headLen);
        // Thickness scales with length but clamped
        const t = Math.min(Math.max(totalLen * 0.02, 0.6), 20);
        // Scale
        shaft.scaling.set(t, shaftLen, t);
        tip.scaling.set(t, headLen, t);
        // Position so base starts at origin
        const shaftCenter = dir.scale(shaftLen / 2);
        shaft.position.copyFrom(shaftCenter);
        const tipCenter = dir.scale(shaftLen + headLen / 2);
        tip.position.copyFrom(tipCenter);
      }

      return { shaft, tip, setLength };
    }
    const axX = makeArrow('axisX', new BABYLON.Vector3(1,0,0), new BABYLON.Color3(1.0, 0.0, 0.0));
    const axY = makeArrow('axisY', new BABYLON.Vector3(0,1,0), new BABYLON.Color3(0.0, 1.0, 0.0));
    const axZ = makeArrow('axisZ', new BABYLON.Vector3(0,0,1), new BABYLON.Color3(0.0, 0.0, 1.0));

    function set(Lx, Ly, Lz) {
      try { axX.setLength(Math.max(1, Lx)); } catch {}
      try { axY.setLength(Math.max(1, Ly)); } catch {}
      try { axZ.setLength(Math.max(1, Lz)); } catch {}
    }

    return { group, x: axX, y: axY, z: axZ, set };
  })();

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
      ground.scaling.x = s; ground.scaling.z = s; vGrid.scaling.x = s; vGrid.scaling.y = s; wGrid.scaling.x = s; wGrid.scaling.y = s;
      // Default arrows to half of minSize minus margin
      const half = minSize / 2; const margin = 10;
      try { arrows.set(half - margin, half - margin, half - margin); } catch {}
      return;
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

    // Update axis arrows to reach near the grid edges
    const halfXZ = sizeXZ / 2;
    const halfYFromXY = sizeXY / 2;
    const halfYFromYZ = sizeYZ / 2;
    const halfY = Math.max(halfYFromXY, halfYFromYZ);
    const margin = Math.max(10, sizeXZ * 0.02);
    try { arrows.set(Math.max(1, halfXZ - margin), Math.max(1, halfY - margin), Math.max(1, halfXZ - margin)); } catch {}
  }

  // Visual strength controls for grid and arrows
  function applyVisualStrengths(gridStrength = 80, arrowStrength = 40) {
    const gs = Math.max(0, Math.min(100, Number(gridStrength) || 0)) / 100; // 0..1
    const as = Math.max(0, Math.min(100, Number(arrowStrength) || 0)) / 100; // 0..1
    try {
      const k = 0.25 + 0.85 * gs; // line brightness multiplier
      grid.lineColor = new BABYLON.Color3(baseLineXZ.r * k, baseLineXZ.g * k, baseLineXZ.b * k);
      grid.opacity = 0.4 + 0.6 * gs; // ground more opaque
      gridVMat.lineColor = new BABYLON.Color3(baseLineXY.r * k, baseLineXY.g * k, baseLineXY.b * k);
      gridVMat.opacity = 0.15 + 0.85 * gs;
      gridWMat.lineColor = new BABYLON.Color3(baseLineYZ.r * k, baseLineYZ.g * k, baseLineYZ.b * k);
      gridWMat.opacity = 0.15 + 0.85 * gs;
    } catch {}
    try {
      // Adjust arrow emissive/diffuse based on base color
      const setMat = (m) => {
        const base = m?.metadata?.baseColor || m?.emissiveColor || new BABYLON.Color3(1,1,1);
        m.emissiveColor = base.scale(Math.max(0, as));
        m.diffuseColor = base.scale(0.05 + 0.25 * as);
      };
      [arrows.x.shaft, arrows.x.tip, arrows.y.shaft, arrows.y.tip, arrows.z.shaft, arrows.z.tip]
        .forEach(mesh => { try { setMat(mesh.material); } catch {} });
    } catch {}
  }

  let gridTimer = null;
  function scheduleGridUpdate(built){
    if (gridTimer) clearTimeout(gridTimer);
    gridTimer = setTimeout(() => updateGridExtent(built), 2000);
  }

  return { ground, vGrid, wGrid, arrows, updateUnitGrids, updateGridExtent, scheduleGridUpdate, applyVisualStrengths };
}
