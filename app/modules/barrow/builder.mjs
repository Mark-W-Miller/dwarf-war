// Build Babylon meshes from Barrow data
import { Log } from '../util/log.mjs';
import { VoxelType, decompressVox } from '../voxels/voxelize.mjs';

export function buildSceneFromBarrow(scene, barrow) {
  const built = { caverns: [], links: [], carddons: [], cavernLabels: [], spaces: [], spaceLabels: [], intersections: [], voxParts: [] };
  function vLog(msg, data) { try { Log.log('VOXEL', msg, data); } catch {} }
  function errLog(ctx, e) { try { Log.log('ERROR', ctx, { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {} }

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

      let mesh;
      if (s.vox && s.vox.size) {
        // Voxelized display: render solid per-voxel cubes (thin instances) for walls and rock.
        // Invisible pick/bounds box
        mesh = BABYLON.MeshBuilder.CreateBox(`space:${s.id}`, { width: w, height: h, depth: d }, scene);
        const pm = new BABYLON.StandardMaterial(`space:${s.id}:pickMat`, scene);
        pm.diffuseColor = new BABYLON.Color3(0,0,0); pm.emissiveColor = new BABYLON.Color3(0,0,0); pm.alpha = 0.0; pm.specularColor = new BABYLON.Color3(0,0,0);
        pm.backFaceCulling = false; mesh.material = pm;
        mesh.position.set(s.origin?.x||0, s.origin?.y||0, s.origin?.z||0);
        try {
          const worldAligned = !!(s.vox && s.vox.worldAligned);
          if (worldAligned) {
            mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
            mesh.rotation.set(0,0,0);
          } else {
            const rx = Number(s.rotation?.x ?? 0) || 0;
            const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
            const rz = Number(s.rotation?.z ?? 0) || 0;
            mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
            mesh.rotation.set(0,0,0);
          }
        } catch {}
        mesh.isPickable = true; mesh.alwaysSelectAsActiveMesh = true;
        built.spaces.push({ id: s.id, mesh, mat: pm });

        const vox = decompressVox(s.vox);
        const nx = Math.max(1, vox.size?.x || 1);
        const ny = Math.max(1, vox.size?.y || 1);
        const nz = Math.max(1, vox.size?.z || 1);
        const data = Array.isArray(vox.data) ? vox.data : [];
        const shrink = 0.96; // slight gap between voxels
        const sx = res * shrink, sy = res * shrink, sz = res * shrink;

        // Base meshes for walls and rock
        const wallBase = BABYLON.MeshBuilder.CreateBox(`space:${s.id}:vox:wall`, { size: 1, updatable: false }, scene);
        wallBase.isPickable = false; // DDA handles picking; keep base offscreen (identity rotation)
        const HIDE_OFF = 100000; // base is offset in local space; instances compensate
        try { wallBase.parent = mesh; wallBase.position.set(HIDE_OFF, HIDE_OFF, HIDE_OFF); wallBase.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch {}
        const wallMat = new BABYLON.StandardMaterial(`space:${s.id}:vox:wall:mat`, scene);
        // Rotated variant for ±X faces (declared here for outer scope)
        let wallMatRot = null;
        // Cavern view: opaque textured cubes
        let cavernView = false; try { cavernView = (localStorage.getItem('dw:viewMode') === 'cavern'); } catch {}
        if (cavernView) {
          const size = 256;
          const dt = new BABYLON.DynamicTexture(`space:${s.id}:vox:wall:tx`, { width: size, height: size }, scene, false);
          const ctx = dt.getContext(); ctx.clearRect(0,0,size,size);
          // Light brick pattern over mortar background
          const mortar = '#efeae2';
          const brick = '#e2d2bf';
          const brick2 = '#dcc9b2'; // subtle variation
          ctx.fillStyle = mortar; ctx.fillRect(0,0,size,size);
          // Larger bricks: allow scaling via localStorage (dw:ui:brickScale), default 3.0x
          let bScale = 3.0;
          try {
            const sVal = Number(localStorage.getItem('dw:ui:brickScale') || '3.0') || 3.0;
            bScale = Math.max(0.5, Math.min(6.0, sVal));
          } catch {}
          const bwBase = 40, bhBase = 18, gapBase = 2;
          const bw = Math.max(8, Math.round(bwBase * bScale));
          const bh = Math.max(8, Math.round(bhBase * bScale));
          const gap = Math.max(2, Math.round(gapBase * bScale));
          const bevel = Math.max(2, Math.round(2 * bScale));
          for (let row = 0, y = 0; y < size + bh; row++, y += (bh + gap)) {
            const offset = (row % 2 === 0) ? 0 : Math.floor(bw / 2);
            for (let x = -offset; x < size + bw; x += bw) {
              const bx = x + gap, by = y + gap; const ww = bw - gap*2, hh = bh - gap*2;
              ctx.fillStyle = (Math.random() < 0.5) ? brick : brick2;
              ctx.fillRect(bx, by, ww, hh);
              // light bevel/shadow scaled with brick size
              ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(bx, by, ww, bevel);
              ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(bx, by+hh-bevel, ww, bevel);
            }
          }
          dt.update(false);
          wallMat.diffuseTexture = dt; wallMat.emissiveColor = new BABYLON.Color3(0.22, 0.22, 0.2);
          wallMat.specularColor = new BABYLON.Color3(0,0,0); wallMat.backFaceCulling = false;
          // Ensure brick pattern orientation and visibility on both sides
          try {
            wallMat.diffuseTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
            wallMat.diffuseTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
            // Z-facing faces rotation (default 0°). If these look 90° off, set dw:ui:brickRotZDeg to 90 or -90.
            let rotZDeg = 0;
            try { const v = Number(localStorage.getItem('dw:ui:brickRotZDeg') || '0') || 0; rotZDeg = Math.max(-180, Math.min(180, v)); } catch {}
            wallMat.diffuseTexture.wAng = (rotZDeg * Math.PI) / 180;
          } catch {}
          wallMat.alpha = 1.0;
        } else {
          // WR view: also use textured bricks for consistency; honor WR opacity settings
          const size = 256;
          const dt = new BABYLON.DynamicTexture(`space:${s.id}:vox:wall:tx`, { width: size, height: size }, scene, false);
          const ctx = dt.getContext(); ctx.clearRect(0,0,size,size);
          const mortar = '#efeae2';
          const brick = '#e2d2bf';
          const brick2 = '#dcc9b2';
          ctx.fillStyle = mortar; ctx.fillRect(0,0,size,size);
          let bScale = 3.0; try { const sVal = Number(localStorage.getItem('dw:ui:brickScale') || '3.0') || 3.0; bScale = Math.max(0.5, Math.min(6.0, sVal)); } catch {}
          const bwBase = 40, bhBase = 18, gapBase = 2;
          const bw = Math.max(8, Math.round(bwBase * bScale));
          const bh = Math.max(8, Math.round(bhBase * bScale));
          const gap = Math.max(2, Math.round(gapBase * bScale));
          const bevel = Math.max(2, Math.round(2 * bScale));
          for (let row = 0, y = 0; y < size + bh; row++, y += (bh + gap)) {
            const offset = (row % 2 === 0) ? 0 : Math.floor(bw / 2);
            for (let x = -offset; x < size + bw; x += bw) {
              const bx = x + gap, by = y + gap; const ww = bw - gap*2, hh = bh - gap*2;
              ctx.fillStyle = (Math.random() < 0.5) ? brick : brick2;
              ctx.fillRect(bx, by, ww, hh);
              ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(bx, by, ww, bevel);
              ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(bx, by+hh-bevel, ww, bevel);
            }
          }
          dt.update(false);
          wallMat.diffuseTexture = dt; wallMat.emissiveColor = new BABYLON.Color3(0.18, 0.18, 0.2);
          wallMat.specularColor = new BABYLON.Color3(0,0,0); wallMat.backFaceCulling = false;
          try {
            wallMat.diffuseTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
            wallMat.diffuseTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
            let rotZDeg = 0; try { const v = Number(localStorage.getItem('dw:ui:brickRotZDeg') || '0') || 0; rotZDeg = Math.max(-180, Math.min(180, v)); } catch {}
            wallMat.diffuseTexture.wAng = (rotZDeg * Math.PI) / 180;
          } catch {}
          try {
            const pct = Math.max(0, Math.min(100, Number(localStorage.getItem('dw:ui:wallOpacity') || '100') || 100));
            wallMat.alpha = Math.max(0.0, Math.min(1.0, pct / 100));
          } catch { wallMat.alpha = 1.0; }
        }
        // Per-face materials: rotate ±Z faces (use wallMat), ±X faces use rotated texture (wallMatRot)
        if (cavernView || !cavernView) {
          wallMatRot = new BABYLON.StandardMaterial(`space:${s.id}:vox:wall:matRot`, scene);
          // Create an independent dynamic texture for X faces so rotation does not affect Z faces
          const sizeX = 256;
          const dtX = new BABYLON.DynamicTexture(`space:${s.id}:vox:wall:txX`, { width: sizeX, height: sizeX }, scene, false);
          const ctxX = dtX.getContext(); ctxX.clearRect(0,0,sizeX,sizeX);
          // Rebuild the same brick pattern
          try {
            ctxX.fillStyle = '#efeae2'; ctxX.fillRect(0,0,sizeX,sizeX);
            const bwBase2 = 40, bhBase2 = 18, gapBase2 = 2;
            let bScale2 = 3.0; try { const sVal2 = Number(localStorage.getItem('dw:ui:brickScale') || '3.0') || 3.0; bScale2 = Math.max(0.5, Math.min(6.0, sVal2)); } catch {}
            const bw2 = Math.max(8, Math.round(bwBase2 * bScale2));
            const bh2 = Math.max(8, Math.round(bhBase2 * bScale2));
            const gap2 = Math.max(2, Math.round(gapBase2 * bScale2));
            const bevel2 = Math.max(2, Math.round(2 * bScale2));
            for (let row = 0, y = 0; y < sizeX + bh2; row++, y += (bh2 + gap2)) {
              const offset = (row % 2 === 0) ? 0 : Math.floor(bw2 / 2);
              for (let x = -offset; x < sizeX + bw2; x += bw2) {
                const bx = x + gap2, by = y + gap2; const ww = bw2 - gap2*2, hh = bh2 - gap2*2;
                ctxX.fillStyle = (Math.random() < 0.5) ? '#e2d2bf' : '#dcc9b2';
                ctxX.fillRect(bx, by, ww, hh);
                ctxX.fillStyle = 'rgba(255,255,255,0.06)'; ctxX.fillRect(bx, by, ww, bevel2);
                ctxX.fillStyle = 'rgba(0,0,0,0.06)'; ctxX.fillRect(bx, by+hh-bevel2, ww, bevel2);
              }
            }
          } catch {}
          dtX.update(false);
          wallMatRot.diffuseTexture = dtX;
          wallMatRot.emissiveColor = wallMat.emissiveColor.clone();
          wallMatRot.specularColor = wallMat.specularColor.clone();
          wallMatRot.backFaceCulling = false; wallMatRot.alpha = 1.0;
          try {
            wallMatRot.diffuseTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
            wallMatRot.diffuseTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
            let rotXDeg = 90; try { const v = Number(localStorage.getItem('dw:ui:brickRotXDeg') || '90') || 90; rotXDeg = Math.max(-180, Math.min(180, v)); } catch {}
            wallMatRot.diffuseTexture.wAng = (rotXDeg * Math.PI) / 180;
          } catch {}

          const multi = new BABYLON.MultiMaterial(`space:${s.id}:vox:wall:multi`, scene);
          // Order: 0=+Z,1=-Z,2=+X,3=-X,4=+Y,5=-Y
          multi.subMaterials.push(wallMat);     // +Z (rotZDeg, default 90)
          multi.subMaterials.push(wallMat);     // -Z
          multi.subMaterials.push(wallMatRot);  // +X (rotXDeg, default 0)
          multi.subMaterials.push(wallMatRot);  // -X
          multi.subMaterials.push(wallMat);     // +Y
          multi.subMaterials.push(wallMat);     // -Y
          wallBase.material = multi;
          try {
            wallBase.subMeshes = [];
            const totalVerts = wallBase.getTotalVertices();
            const indices = wallBase.getIndices();
            const idxPerFace = Math.floor(indices.length / 6) || 6;
            for (let fi = 0; fi < 6; fi++) new BABYLON.SubMesh(fi, 0, totalVerts, fi*idxPerFace, idxPerFace, wallBase);
          } catch {}
        } else {
          wallBase.material = wallMat;
        }
        built.voxParts.push(wallBase);

        const rockBase = BABYLON.MeshBuilder.CreateBox(`space:${s.id}:vox:rock`, { size: 1 }, scene);
        rockBase.isPickable = false; // DDA handles picking; keep base offscreen (identity rotation)
        try { rockBase.parent = mesh; rockBase.position.set(HIDE_OFF, HIDE_OFF, HIDE_OFF); rockBase.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch {}
        const rockMat = new BABYLON.StandardMaterial(`space:${s.id}:vox:rock:mat`, scene);
        if (cavernView) {
          const sizeR = 128;
          const dtR = new BABYLON.DynamicTexture(`space:${s.id}:vox:rock:tx`, { width: sizeR, height: sizeR }, scene, false);
          const ctxR = dtR.getContext(); ctxR.clearRect(0,0,sizeR,sizeR);
          // Much darker rock base with white speckles
          ctxR.fillStyle = '#15181c'; ctxR.fillRect(0,0,sizeR,sizeR);
          // Subtle dark noise layers
          for (let i = 0; i < 240; i++) {
            const x = Math.random()*sizeR, y = Math.random()*sizeR, r = Math.random()*4+1;
            const g = 20 + (Math.random()*20|0);
            ctxR.fillStyle = `rgba(${g},${g},${g},0.15)`;
            ctxR.fillRect(x, y, r, r);
          }
          // Bright white speckles
          for (let i = 0; i < 520; i++) {
            const x = Math.random()*sizeR, y = Math.random()*sizeR, r = Math.random()*2+0.8;
            const w = 225 + (Math.random()*30|0);
            ctxR.fillStyle = `rgb(${w},${w},${w})`;
            ctxR.fillRect(x, y, r, r);
          }
          dtR.update(false);
          rockMat.diffuseTexture = dtR; rockMat.emissiveColor = new BABYLON.Color3(0.06, 0.07, 0.08);
          rockMat.specularColor = new BABYLON.Color3(0,0,0); rockMat.backFaceCulling = false;
          rockMat.alpha = 1.0;
        } else {
          rockMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.24);
          rockMat.emissiveColor = new BABYLON.Color3(0.08, 0.08, 0.10);
          rockMat.specularColor = new BABYLON.Color3(0,0,0);
          rockMat.backFaceCulling = false; // consistent with cavern for visibility
          try {
            const pctR = Math.max(0, Math.min(100, Number(localStorage.getItem('dw:ui:rockOpacity') || '100') || 100));
            rockMat.alpha = Math.max(0.0, Math.min(1.0, pctR / 100));
          } catch { rockMat.alpha = 1.0; }
        }
        rockBase.material = rockMat;
        built.voxParts.push(rockBase);

        const wallMatrices = [];
        const rockMatrices = [];
        const centerX = (nx * res) / 2;
        const centerY = (ny * res) / 2;
        const centerZ = (nz * res) / 2;
        // Optional slicing: hide top N voxel layers (expose interior from top down)
        let hideTop = 0;
        try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch { hideTop = 0; }
        const yCut = Math.max(1, ny - hideTop); // ensure at least one layer shows in WR view
        // Rotation: inherited from parent mesh; per-instance rotation stays identity
        const worldAligned = !!(s.vox && s.vox.worldAligned);
        let qMesh = BABYLON.Quaternion.Identity();
        try {
          if (!worldAligned) {
            const rx = Number(s.rotation?.x ?? 0) || 0;
            const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
            const rz = Number(s.rotation?.z ?? 0) || 0;
            qMesh = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
          } else {
            qMesh = BABYLON.Quaternion.Identity();
          }
        } catch {}
        const rotM = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qMesh, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
        const hideOffVec = new BABYLON.Vector3(HIDE_OFF, HIDE_OFF, HIDE_OFF);
        for (let z = 0; z < nz; z++) {
          for (let y = 0; y < ny; y++) {
            if (y >= yCut) continue;
            for (let x = 0; x < nx; x++) {
              const idx = x + nx * (y + ny * z);
              const v = data[idx];
              if (v !== VoxelType.Wall && v !== VoxelType.Rock) continue;
              // Local offset in voxel space (centered)
              const lx = (x + 0.5) * res - centerX;
              const ly = (y + 0.5) * res - centerY;
              const lz = (z + 0.5) * res - centerZ;
              const local = new BABYLON.Vector3(lx, ly, lz);
              // Rotate local offset into mesh-local orientation; parent provides rotation/translation
              const localAfterRot = BABYLON.Vector3.TransformCoordinates(local, rotM);
              // Per-instance translation in parent space compensating for base offset
              const t = localAfterRot.subtract(hideOffVec);
              const sc = new BABYLON.Vector3(sx, sy, sz);
              const m = BABYLON.Matrix.Compose(sc, BABYLON.Quaternion.Identity(), t);
              const target = (v === VoxelType.Wall) ? wallMatrices : rockMatrices;
              for (let k = 0; k < 16; k++) target.push(m.m[k]);
            }
          }
        }
        try {
	  if (wallMatrices.length > 0) wallBase.thinInstanceSetBuffer('matrix', new Float32Array(wallMatrices), 16, true);
	  if (rockMatrices.length > 0) rockBase.thinInstanceSetBuffer('matrix', new Float32Array(rockMatrices), 16, true);
	  vLog('builder:vox:instances', { id: s.id, wall: wallMatrices.length/16|0, rock: rockMatrices.length/16|0, res });
	} catch (e) { errLog('builder:vox:thinInstances', e); }
        // Refresh bounding info to ensure instances are not culled
        try { wallBase.thinInstanceRefreshBoundingInfo?.(); } catch {}
        try { rockBase.thinInstanceRefreshBoundingInfo?.(); } catch {}
      } else {
        // Material by type
        const mat = new BABYLON.StandardMaterial(`space:${s.id}:mat`, scene);
        const color = s.type === 'Carddon' ? new BABYLON.Color3(0.85, 0.35, 0.25)
          : s.type === 'Cavern' ? new BABYLON.Color3(0.95, 0.85, 0.2)
          : s.type === 'Tunnel' ? new BABYLON.Color3(0.4, 0.8, 0.9)
          : s.type === 'Room' ? new BABYLON.Color3(0.7, 0.6, 0.9)
          : new BABYLON.Color3(0.6, 0.8, 0.6);
        mat.diffuseColor = color.scale(0.25); mat.emissiveColor = color.scale(0.35); mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
        mat.backFaceCulling = false; // ensure click/pick works from both sides

        if (s.type === 'Cavern') {
          const dia = Math.min(w, h, d);
          mesh = BABYLON.MeshBuilder.CreateSphere(`space:${s.id}`, { diameter: dia, segments: 24 }, scene);
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
      }

      const label = BABYLON.MeshBuilder.CreatePlane(`space:${s.id}:label`, { width: 3.0, height: 1.1 }, scene);
      label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      // Parent label to the space mesh so it follows moves/rotations.
      // Position relative to the mesh's local origin (center) just above its top face.
      const yOff = (s.type === 'Cavern' ? Math.min(w,h,d)/2 : h/2) + 1.0;
      try { label.parent = mesh; } catch {}
      label.position = new BABYLON.Vector3(0, yOff, 0);
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
    const voxIds = new Set(((barrow && Array.isArray(barrow.spaces)) ? barrow.spaces : []).filter(s => s && s.vox).map(s => s.id));
    const arr = Array.isArray(built.spaces) ? built.spaces : [];
    for (let i = 0; i < arr.length; i++) {
      const A = arr[i]; if (!A?.mesh) continue;
      try { A.mesh.computeWorldMatrix(true); A.mesh.refreshBoundingInfo(); } catch {}
      const bba = A.mesh.getBoundingInfo()?.boundingBox; if (!bba) continue;
      const amin = bba.minimumWorld, amax = bba.maximumWorld;
      for (let j = i + 1; j < arr.length; j++) {
        const B = arr[j]; if (!B?.mesh) continue;
        // Show intersections if at least one space is non-voxed; skip only when both are voxed
        const bothVoxed = voxIds.has(A.id) && voxIds.has(B.id);
        if (bothVoxed) continue;
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
  for (const x of built.voxParts || []) { try { x.dispose(); } catch {} }
  built.label?.dispose();
}
