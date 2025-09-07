// Build Babylon meshes from Barrow data

export function buildSceneFromBarrow(scene, barrow) {
  const built = { caverns: [], links: [], carddons: [], cavernLabels: [] };

  // Materials
  const cavernMat = new BABYLON.PBRMetallicRoughnessMaterial('cavernMat', scene);
  cavernMat.baseColor = new BABYLON.Color3(0.8, 0.75, 0.65); cavernMat.metallic = 0.0; cavernMat.roughness = 0.7; cavernMat.alpha = 0.55;
  const centralMat = new BABYLON.PBRMetallicRoughnessMaterial('centralMat', scene);
  centralMat.baseColor = new BABYLON.Color3(0.95, 0.85, 0.2); centralMat.metallic = 0.1; centralMat.roughness = 0.5; centralMat.alpha = 0.5;
  const linkMat = new BABYLON.PBRMetallicRoughnessMaterial('linkMat', scene);
  linkMat.baseColor = new BABYLON.Color3(0.5, 0.65, 0.8); linkMat.metallic = 0.0; linkMat.roughness = 0.4;

  // Caverns
  for (const c of barrow.caverns) {
    const size = c.size === 'large' ? 2.2 : c.size === 'small' ? 1.2 : 1.7;
    const sphere = BABYLON.MeshBuilder.CreateSphere(`cavern:${c.id}`, { diameter: size }, scene);
    sphere.position.set(c.pos?.x || 0, c.pos?.y || 0, c.pos?.z || 0);
    sphere.material = c.role === 'central' ? centralMat : cavernMat;
    sphere.isPickable = false;
    built.caverns.push({ id: c.id, mesh: sphere });

    // Cavern label above the sphere — label = object name (id)
    const labelPlane = BABYLON.MeshBuilder.CreatePlane(`cavern:${c.id}:label`, { width: 1.8, height: 0.6 }, scene);
    labelPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const yOffset = (size * 0.5) + 0.6;
    labelPlane.position = new BABYLON.Vector3(sphere.position.x, sphere.position.y + yOffset, sphere.position.z);
    labelPlane.isPickable = false;
    const dt = new BABYLON.DynamicTexture(`cavern:${c.id}:dt`, { width: 512, height: 192 }, scene, false);
    dt.hasAlpha = true;
    const ctx = dt.getContext(); ctx.clearRect(0,0,512,192);
    const title = c.id || sphere.name || 'cavern';
    dt.drawText(title, null, 98, 'bold 56px system-ui, sans-serif', '#e9f1f7', 'transparent', true);
    const cx = Math.round(sphere.position.x), cy = Math.round(sphere.position.y), cz = Math.round(sphere.position.z);
    const coords = `i=${cx}  j=${cy}  k=${cz}`;
    dt.drawText(coords, null, 160, 'normal 30px system-ui, sans-serif', '#9fb2bb', 'transparent', true);
    const lmat = new BABYLON.StandardMaterial(`cavern:${c.id}:mat`, scene);
    lmat.diffuseTexture = dt; lmat.emissiveTexture = dt; lmat.backFaceCulling = false; lmat.specularColor = new BABYLON.Color3(0,0,0);
    labelPlane.material = lmat;
    built.cavernLabels.push({ id: c.id, mesh: labelPlane, dt, mat: lmat });
  }

  // Links (as tubes)
  const byId = new Map(built.caverns.map(x => [x.id, x.mesh]));
  const nameById = new Map((barrow.caverns||[]).map(c => [c.id, c.name || c.id]));
  for (const l of barrow.links) {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) continue;
    const path = [a.position, b.position];
    const tube = BABYLON.MeshBuilder.CreateTube(`link:${l.from}->${l.to}`, { path, radius: 0.12 }, scene);
    tube.material = linkMat; tube.isPickable = false;
    built.links.push({ link: l, mesh: tube });
  }

  // Carddon cubes + nameplates above their caverns
  if (Array.isArray(barrow.carddons) && barrow.carddons.length) {
    // Track how many labels per cavern to stack them
    const stackCount = new Map();
    for (const cd of barrow.carddons) {
      const cavId = cd.cavernId || null;
      const anchor = cavId ? byId.get(cavId) : null;
      const basePos = anchor ? anchor.position : new BABYLON.Vector3(0, 0, 0);
      const idx = (stackCount.get(cavId) || 0);
      stackCount.set(cavId, idx + 1);

      // Cube for the carddon (object)
      const cube = BABYLON.MeshBuilder.CreateBox(`carddon:${cd.id}:cube`, { size: 0.7 }, scene);
      cube.position = new BABYLON.Vector3(basePos.x + idx * 0.05, basePos.y + 1.2 + idx * 0.9, basePos.z);
      const cubeMat = new BABYLON.PBRMetallicRoughnessMaterial(`carddon:${cd.id}:cubeMat`, scene);
      cubeMat.baseColor = new BABYLON.Color3(0.85, 0.35, 0.25); cubeMat.metallic = 0.0; cubeMat.roughness = 0.5;
      cube.material = cubeMat; cube.isPickable = false;

      // Label plane above the cube
      const plane = BABYLON.MeshBuilder.CreatePlane(`carddon:${cd.id}:label`, { width: 1.9, height: 0.8 }, scene);
      plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      plane.position = new BABYLON.Vector3(cube.position.x, cube.position.y + 0.6, cube.position.z);
      plane.isPickable = false;

      const dt = new BABYLON.DynamicTexture(`carddon:${cd.id}:dt`, { width: 512, height: 192 }, scene, false);
      dt.hasAlpha = true;
      const ctx = dt.getContext();
      ctx.clearRect(0, 0, 512, 192);
      const title = cd.name || cd.id;
      const sub = cavId ? `@ ${nameById.get(cavId) || cavId}` : '(unassigned)';
      dt.drawText(title, null, 96, 'bold 48px system-ui, sans-serif', '#e9f1f7', 'transparent', true);
      dt.drawText(sub, null, 160, 'normal 32px system-ui, sans-serif', '#9fb2bb', 'transparent', true);

      const mat = new BABYLON.StandardMaterial(`carddon:${cd.id}:mat`, scene);
      mat.diffuseTexture = dt; mat.emissiveTexture = dt; mat.backFaceCulling = false;
      mat.specularColor = new BABYLON.Color3(0,0,0);
      plane.material = mat;
      built.carddons.push({ id: cd.id, mesh: plane, dt, mat });
      built.carddons.push({ id: cd.id, mesh: cube, mat: cubeMat });
    }
  }

  // Label
  const plane = BABYLON.MeshBuilder.CreatePlane('barrowLabel', { size: 3 }, scene);
  plane.position = new BABYLON.Vector3(0, 3, 0);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  const dt = new BABYLON.DynamicTexture('barrowLabelTex', { width: 1024, height: 256 }, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext(); ctx.clearRect(0,0,1024,256);
  dt.drawText(barrow.id || 'Barrow', null, null, 'bold 64px sans-serif', '#e0e6ed', 'transparent', true);
  const mat = new BABYLON.StandardMaterial('barrowLabelMat', scene);
  mat.diffuseTexture = dt; mat.emissiveTexture = dt; mat.backFaceCulling = false;
  plane.material = mat;
  built.label = plane;

  return built;
}

export function disposeBuilt(built) {
  if (!built) return;
  for (const x of built.caverns || []) x.mesh?.dispose();
  for (const x of built.links || []) x.mesh?.dispose();
  for (const x of built.cavernLabels || []) { x.mesh?.dispose(); x.dt?.dispose(); }
  for (const x of built.carddons || []) { x.mesh?.dispose(); x.dt?.dispose(); }
  built.label?.dispose();
}
