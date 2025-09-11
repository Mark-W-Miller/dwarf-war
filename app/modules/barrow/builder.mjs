// Build Babylon meshes from Barrow data

export function buildSceneFromBarrow(scene, barrow) {
  const built = { caverns: [], links: [], carddons: [], cavernLabels: [], spaces: [], spaceLabels: [], intersections: [] };

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

  // Remove 3D barrow label; name shown in HUD overlay instead

  // Render new-model spaces as translucent boxes with labels
  if (Array.isArray(barrow.spaces)) {
    for (const s of barrow.spaces) {
      const res = s.res || (barrow.meta?.voxelSize || 1);
      const w = Math.max(0.001, (s.size?.x || 0) * res);
      const h = Math.max(0.001, (s.size?.y || 0) * res);
      const d = Math.max(0.001, (s.size?.z || 0) * res);

      // Material by type
      const mat = new BABYLON.StandardMaterial(`space:${s.id}:mat`, scene);
      const color = s.type === 'Carddon' ? new BABYLON.Color3(0.85, 0.35, 0.25)
        : s.type === 'Cavern' ? new BABYLON.Color3(0.95, 0.85, 0.2)
        : s.type === 'Tunnel' ? new BABYLON.Color3(0.4, 0.8, 0.9)
        : s.type === 'Room' ? new BABYLON.Color3(0.7, 0.6, 0.9)
        : new BABYLON.Color3(0.6, 0.8, 0.6);
      mat.diffuseColor = color.scale(0.25); mat.emissiveColor = color.scale(0.35); mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
      mat.backFaceCulling = false; // ensure click/pick works from both sides

      let mesh;
      if (s.type === 'Cavern') {
        const dia = Math.min(w, h, d);
        mesh = BABYLON.MeshBuilder.CreateSphere(`space:${s.id}`, { diameter: dia, segments: 24 }, scene);
      } else if (s.type === 'Carddon') {
        mesh = BABYLON.MeshBuilder.CreateBox(`space:${s.id}`, { width: w, height: h, depth: d }, scene);
      } else {
        mesh = BABYLON.MeshBuilder.CreateBox(`space:${s.id}`, { width: w, height: h, depth: d }, scene);
      }
      mesh.position.set(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
      try {
        const rx = Number(s.rotation?.x ?? 0) || 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
        const rz = Number(s.rotation?.z ?? 0) || 0;
        // Prefer quaternion for consistent local-space rotations
        try { mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); mesh.rotation.set(0,0,0); }
        catch { mesh.rotation.set(rx, ry, rz); }
      } catch {}
      mesh.material = mat; mesh.isPickable = true; mesh.alwaysSelectAsActiveMesh = true;
      built.spaces.push({ id: s.id, mesh, mat });

      const label = BABYLON.MeshBuilder.CreatePlane(`space:${s.id}:label`, { width: 3.0, height: 1.1 }, scene);
      label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      const topY = mesh.position.y + (s.type === 'Cavern' ? Math.min(w,h,d)/2 : h/2);
      label.position = new BABYLON.Vector3(mesh.position.x, topY + 1.0, mesh.position.z);
      label.isPickable = false;
      const dt = new BABYLON.DynamicTexture(`space:${s.id}:dt`, { width: 768, height: 288 }, scene, false);
      dt.hasAlpha = true; const ctx2 = dt.getContext(); ctx2.clearRect(0,0,768,288);
      const title = `${s.id} (${s.type})`;
      const dims = `${s.size?.x||0}×${s.size?.y||0}×${s.size?.z||0} @${res}`;
      dt.drawText(title, null, 132, 'bold 64px system-ui, sans-serif', '#e9f1f7', 'transparent', true);
      dt.drawText(dims, null, 220, 'normal 34px system-ui, sans-serif', '#9fb2bb', 'transparent', true);
      const lmat2 = new BABYLON.StandardMaterial(`space:${s.id}:mat2`, scene);
      lmat2.diffuseTexture = dt; lmat2.emissiveTexture = dt; lmat2.backFaceCulling = false; lmat2.specularColor = new BABYLON.Color3(0,0,0);
      label.material = lmat2;
      built.spaceLabels.push({ id: s.id, mesh: label, dt, mat: lmat2 });
    }
  }

  // Intersections between world AABBs of built meshes (aligns with visible shapes)
  try {
    const arr = Array.isArray(built.spaces) ? built.spaces : [];
    for (let i = 0; i < arr.length; i++) {
      const A = arr[i]; if (!A?.mesh) continue;
      try { A.mesh.computeWorldMatrix(true); A.mesh.refreshBoundingInfo(); } catch {}
      const bba = A.mesh.getBoundingInfo()?.boundingBox; if (!bba) continue;
      const amin = bba.minimumWorld, amax = bba.maximumWorld;
      for (let j = i + 1; j < arr.length; j++) {
        const B = arr[j]; if (!B?.mesh) continue;
        try { B.mesh.computeWorldMatrix(true); B.mesh.refreshBoundingInfo(); } catch {}
        const bbb = B.mesh.getBoundingInfo()?.boundingBox; if (!bbb) continue;
        const bmin = bbb.minimumWorld, bmax = bbb.maximumWorld;
        const ixmin = { x: Math.max(amin.x, bmin.x), y: Math.max(amin.y, bmin.y), z: Math.max(amin.z, bmin.z) };
        const ixmax = { x: Math.min(amax.x, bmax.x), y: Math.min(amax.y, bmax.y), z: Math.min(amax.z, bmax.z) };
        const dx = ixmax.x - ixmin.x, dy = ixmax.y - ixmin.y, dz = ixmax.z - ixmin.z;
        if (dx > 0.001 && dy > 0.001 && dz > 0.001) {
          const cx = (ixmin.x + ixmax.x) / 2, cy = (ixmin.y + ixmax.y) / 2, cz = (ixmin.z + ixmax.z) / 2;
          if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz) || !isFinite(cx) || !isFinite(cy) || !isFinite(cz)) continue;
          let mesh = null; let mat = null;
          // Prefer exact intersection via CSG if available; fall back to AABB box
          const exactOn = (() => { try { return localStorage.getItem('dw:ui:exactCSG') === '1'; } catch { return false; } })();
          try {
            if (exactOn && BABYLON.CSG && A.mesh && B.mesh) {
              const csgA = BABYLON.CSG.FromMesh(A.mesh);
              const csgB = BABYLON.CSG.FromMesh(B.mesh);
              const inter = csgA.intersect(csgB);
              mat = new BABYLON.StandardMaterial(`inter:${A.id}&${B.id}:mat`, scene);
              mat.diffuseColor = new BABYLON.Color3(0,0,0);
              mat.emissiveColor = new BABYLON.Color3(0.75, 0.7, 0.2);
              mat.alpha = 0.25; mat.specularColor = new BABYLON.Color3(0,0,0);
              mesh = inter.toMesh(`inter:${A.id}&${B.id}`, mat, scene, true);
              mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; mesh.renderingGroupId = 1;
            }
          } catch {}
          if (!mesh) {
            mat = new BABYLON.StandardMaterial(`inter:${A.id}&${B.id}:mat`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.0, 0.0, 0.0);
            mat.emissiveColor = new BABYLON.Color3(0.75, 0.7, 0.2);
            mat.alpha = 0.25; mat.specularColor = new BABYLON.Color3(0,0,0);
            mesh = BABYLON.MeshBuilder.CreateBox(`inter:${A.id}&${B.id}`, { width: dx, height: dy, depth: dz }, scene);
            mesh.material = mat; mesh.isPickable = false; mesh.position.set(cx, cy, cz);
          }
          built.intersections.push({ a: A.id, b: B.id, mesh, mat });
        }
      }
    }
  } catch {}

  return built;
}

export function disposeBuilt(built) {
  if (!built) return;
  for (const x of built.caverns || []) x.mesh?.dispose();
  for (const x of built.links || []) x.mesh?.dispose();
  for (const x of built.cavernLabels || []) { x.mesh?.dispose(); x.dt?.dispose(); }
  for (const x of built.carddons || []) { x.mesh?.dispose(); x.dt?.dispose(); }
  for (const x of built.spaces || []) x.mesh?.dispose();
  for (const x of built.spaceLabels || []) { x.mesh?.dispose(); x.dt?.dispose(); }
  for (const x of built.intersections || []) { x.mesh?.dispose(); }
  built.label?.dispose();
}
