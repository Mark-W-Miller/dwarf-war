import { Log } from '../../util/log.mjs';

export function createRebuildHalos({ scene, state }) {
  return function rebuildHalos() {
    const report = (ctx, e) => { Log.log('ERROR', ctx, { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); };
    let highlightAdded = false;
    const addHighlight = (mesh, color) => {
      if (!mesh) return;
      state.hl.addMesh(mesh, color); highlightAdded = true;
 };
    const selArr = Array.from(state.selection || []); Log.log('HILITE', 'rebuild:start', { sel: selArr, last: state.lastVoxPick || null, locked: state.lockedVoxPick || null });
    for (const [id, mesh] of state.halos) { mesh.dispose();  }
    state.halos.clear();
    for (const [id, m] of (state.selObb || new Map())) { m.dispose?.();  }
    state.selObb.clear();
    for (const [id, m] of (state.voxHl || new Map())) { m.dispose?.();  }
    state.voxHl.clear();
    for (const m of (state.voxSelMeshes || [])) { m.dispose?.();  }
    state.voxSelMeshes = [];
    state.hl.removeAllMeshes();
    const bySpace = new Map((state.built.spaces||[]).map(x => [x.id, x.mesh]));
    const spacesById = new Map((state?.barrow?.spaces || []).map(s => [s?.id, s]));
    let glowK = 0.7;  const s = Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70; glowK = Math.max(0.2, Math.min(3.0, s / 100));
    const byCav = new Map((state.built.caverns||[]).map(x => [x.id, x.mesh]));
    const blue = new BABYLON.Color3(0.12 * glowK, 0.35 * glowK, 0.7 * glowK);
    const yellow = new BABYLON.Color3(0.7 * glowK, 0.65 * glowK, 0.15 * glowK);
    const redGlow = new BABYLON.Color3(0.9 * glowK, 0.18 * glowK, 0.18 * glowK);
    const subtleBlue = new BABYLON.Color3(0.10 * glowK, 0.28 * glowK, 0.55 * glowK);
    for (const part of (state?.built?.voxParts || [])) { part.renderOutline = false;  }
    for (const id of state.selection) {
      const m = bySpace.get(id) || byCav.get(id); if (!m) continue;
      addHighlight(m, blue);
      for (const part of (state?.built?.voxParts || [])) { const nm = String(part?.name || ''); if (nm.startsWith(`space:${id}:`)) { part.outlineColor = subtleBlue; part.renderOutline = true; part.outlineWidth = 0.02; } }
            const s = (state.barrow.spaces||[]).find(x => x.id === id);
      if (s) {
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
        const hx = w/2, hy = h/2, hz = d/2;
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
        const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const mtx = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
        const locals = [
          new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz),
          new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz),
          new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz),
          new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz)
        ];
        const cs = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, mtx));
        const edges = [
          [cs[0], cs[1]], [cs[1], cs[3]], [cs[3], cs[2]], [cs[2], cs[0]],
          [cs[4], cs[5]], [cs[5], cs[7]], [cs[7], cs[6]], [cs[6], cs[4]],
          [cs[0], cs[4]], [cs[1], cs[5]], [cs[2], cs[6]], [cs[3], cs[7]]
        ];
        const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:obb:${id}`, { lines: edges, updatable: true }, scene);
        lines.color = new BABYLON.Color3(0.1, 0.9, 0.9); lines.isPickable = false; lines.renderingGroupId = 3;
        state.selObb.set(id, lines);
      }

            const s2 = (state.barrow.spaces||[]).find(x => x.id === id);
      const lock = state.lockedVoxPick && state.lockedVoxPick.id === id ? state.lockedVoxPick : null;
      const pickToUse = lock ? { x: lock.x, y: lock.y, z: lock.z } : (s2?.voxPick ? { x: s2.voxPick.x, y: s2.voxPick.y, z: s2.voxPick.z } : null);
      if (s2 && s2.vox && s2.vox.size && pickToUse) {
        const nx = Math.max(1, s2.vox.size?.x || 1), ny = Math.max(1, s2.vox.size?.y || 1), nz = Math.max(1, s2.vox.size?.z || 1);
        const res = s2.vox.res || s2.res || (state.barrow?.meta?.voxelSize || 1);
        const { x: ix, y: iy, z: iz } = pickToUse; if (!(ix>=0 && iy>=0 && iz>=0 && ix<nx && iy<ny && iz<nz)) { /* skip */ }
        let hideTop = 0;  hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s2.voxExposeTop || 0) || 0)));
        const yCut = ny - hideTop; if (iy < yCut) {
          const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
          const lx = (ix + 0.5) * res - centerX, ly = (iy + 0.5) * res - centerY, lz = (iz + 0.5) * res - centerZ;
          let q = BABYLON.Quaternion.Identity();  const worldAligned = !!(s2.vox && s2.vox.worldAligned); if (!worldAligned) { const rx = Number(s2.rotation?.x ?? 0) || 0; const ry = (s2.rotation && typeof s2.rotation.y === 'number') ? Number(s2.rotation.y) : Number(s2.rotY || 0) || 0; const rz = Number(s2.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); }
          const parent = bySpace.get(id);  if (!parent) Log.log('HILITE', 'parent:missing', { id });
          const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:${id}`, { size: res * 1.06 }, scene);
          const mat = new BABYLON.StandardMaterial(`sel:voxel:${id}:mat`, scene);
          mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05); mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
          mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
          mat.disableDepthWrite = true;
          mat.backFaceCulling = false;  mat.zOffset = -2;
          box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
          const rotM = (() => { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); })();
          const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx,ly,lz), rotM);
          box.parent = parent;
          box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
          box.rotationQuaternion = BABYLON.Quaternion.Identity();
          addHighlight(box, redGlow);
          const wm = parent?.getWorldMatrix?.() || BABYLON.Matrix.Identity(); const wpos = BABYLON.Vector3.TransformCoordinates(afterLocal, wm); Log.log('HILITE', 'voxel:draw', { id, world: { x: wpos.x, y: wpos.y, z: wpos.z }, local: { x: afterLocal.x, y: afterLocal.y, z: afterLocal.z } });
          const h = (res * 0.52); const c = [ new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h), new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h), new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h), new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h) ]; const edges = [[c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],[c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],[c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]]; const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:${id}:edges`, { lines: edges }, scene); lines.color = new BABYLON.Color3(0.95, 0.2, 0.2); lines.isPickable = false; lines.renderingGroupId = 3;  lines.parent = box;  lines.position.set(0, 0, 0);  lines.rotationQuaternion = BABYLON.Quaternion.Identity();  const lmat = new BABYLON.StandardMaterial(`sel:voxel:${id}:edges:mat`, scene); lmat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2); lmat.disableDepthWrite = true;  lmat.zOffset = -2;  lines.material = lmat;
          state.voxHl.set(id, box);
        }
      }

    }
    for (const x of state?.built?.intersections || []) if (x?.mesh) addHighlight(x.mesh, yellow);
    const voxSelArr = Array.isArray(state.voxSel) ? state.voxSel : [];
    if (voxSelArr.length) {
      const voxSelBySpace = new Map();
      for (const pick of voxSelArr) {
        if (!pick || pick.id == null) continue;
        const sid = pick.id;
        if (!voxSelBySpace.has(sid)) voxSelBySpace.set(sid, []);
        voxSelBySpace.get(sid).push(pick);
      }
        for (const [sid, picks] of voxSelBySpace) {
          const s = spacesById.get(sid);
          const parent = bySpace.get(sid);
          if (!s || !parent || !s.vox || !s.vox.size) continue;
          const res = s.vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
        const nx = Math.max(1, s.vox.size?.x || 1);
        const ny = Math.max(1, s.vox.size?.y || 1);
        const nz = Math.max(1, s.vox.size?.z || 1);
        const centerX = (nx * res) / 2;
        const centerY = (ny * res) / 2;
        const centerZ = (nz * res) / 2;
        let q = BABYLON.Quaternion.Identity();
        const worldAligned = !!(s.vox && s.vox.worldAligned);
        if (!worldAligned) {
          const rx = Number(s.rotation?.x ?? 0) || 0;
          const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
          const rz = Number(s.rotation?.z ?? 0) || 0;
          q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        }

        const rotM = (() => { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); })();
        let hideTop = 0;  hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0)));
        const yCut = ny - hideTop;
          for (const pick of picks) {
            const ix = pick.x|0, iy = pick.y|0, iz = pick.z|0;
            if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) continue;
            if (iy >= yCut) continue;
            const lx = (ix + 0.5) * res - centerX;
            const ly = (iy + 0.5) * res - centerY;
            const lz = (iz + 0.5) * res - centerZ;
            const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx, ly, lz), rotM);
            const tag = `sel:voxBrush:${sid}:${ix}:${iy}:${iz}:${state.voxSelMeshes.length}`;
            let box;
              box = BABYLON.MeshBuilder.CreateBox(tag, { size: res * 1.04 }, scene);
              const mat = new BABYLON.StandardMaterial(`${tag}:mat`, scene);
              mat.diffuseColor = new BABYLON.Color3(0.6, 0.1, 0.1);
              mat.emissiveColor = new BABYLON.Color3(0.9, 0.2, 0.2);
              mat.alpha = 0.35;
              mat.specularColor = new BABYLON.Color3(0,0,0);
              mat.disableDepthWrite = true;
              mat.backFaceCulling = false;
            mat.zOffset = -2;
            box.material = mat;
            box.isPickable = false;
            box.renderingGroupId = 3;
            box.parent = parent;
            box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
            box.rotationQuaternion = BABYLON.Quaternion.Identity();
            state.voxSelMeshes.push(box);

                        const h = (res * 0.5);
            const c = [
              new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h),
              new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h),
              new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h),
              new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h)
            ];
            const edges = [
              [c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],
              [c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],
              [c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]
            ];
            const lines = BABYLON.MeshBuilder.CreateLineSystem(`${tag}:edges`, { lines: edges }, scene);
            lines.color = new BABYLON.Color3(0.95, 0.25, 0.25);
            lines.isPickable = false;
            lines.renderingGroupId = 3;
            if (box) lines.parent = box;
            lines.position.set(0,0,0);
            lines.rotationQuaternion = BABYLON.Quaternion.Identity();
            const lmat = new BABYLON.StandardMaterial(`${tag}:edges:mat`, scene);
            lmat.emissiveColor = new BABYLON.Color3(0.95, 0.25, 0.25);
            lmat.disableDepthWrite = true;
            lmat.zOffset = -2;
            lines.material = lmat;
            state.voxSelMeshes.push(lines);

        }
      }
    }
    if (state?._scry?.scryMode && state?._scry?.ball) { const color = new BABYLON.Color3(0.4, 0.85, 1.0); addHighlight(state._scry.ball, color);  state._scry.ball.outlineColor = color; state._scry.ball.outlineWidth = 0.02; state._scry.ball.renderOutline = true;  }

    // Also render a locked voxel highlight even if its space is not selected
    const lock = state.lockedVoxPick || null;
    if (lock && typeof lock.id === 'string') {
      const id = lock.id;
      // Skip if already highlighted via selection
      if (!state.selection || !state.selection.has(id)) {
        const s2 = (state.barrow.spaces||[]).find(x => x.id === id);
        if (s2 && s2.vox && s2.vox.size) {
          const nx = Math.max(1, s2.vox.size?.x || 1), ny = Math.max(1, s2.vox.size?.y || 1), nz = Math.max(1, s2.vox.size?.z || 1);
          const res = s2.vox.res || s2.res || (state.barrow?.meta?.voxelSize || 1);
          const ix = lock.x|0, iy = lock.y|0, iz = lock.z|0;
          if (ix>=0 && iy>=0 && iz>=0 && ix<nx && iy<ny && iz<nz) {
            let hideTop = 0;  hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s2.voxExposeTop || 0) || 0)));
            const yCut = ny - hideTop;
            if (iy < yCut) {
              const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
              const lx = (ix + 0.5) * res - centerX, ly = (iy + 0.5) * res - centerY, lz = (iz + 0.5) * res - centerZ;
              let q = BABYLON.Quaternion.Identity();
              const worldAligned = !!(s2.vox && s2.vox.worldAligned); if (!worldAligned) { const rx = Number(s2.rotation?.x ?? 0) || 0; const ry = (s2.rotation && typeof s2.rotation.y === 'number') ? Number(s2.rotation.y) : Number(s2.rotY || 0) || 0; const rz = Number(s2.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); }
              const parent = bySpace.get(id);
              if (parent) {
                const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:lock:${id}`, { size: res * 1.06 }, scene);
                const mat = new BABYLON.StandardMaterial(`sel:voxel:lock:${id}:mat`, scene);
                mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05); mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
                mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
                mat.disableDepthWrite = true;
                mat.backFaceCulling = false;  mat.zOffset = -2;
                box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
                const rotM = (() => { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); })();
                const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx,ly,lz), rotM);
                box.parent = parent;
                box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
                box.rotationQuaternion = BABYLON.Quaternion.Identity();
                addHighlight(box, redGlow);
                const h = (res * 0.52);
                const c = [ new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h), new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h), new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h), new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h) ];
                const edges = [[c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],[c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],[c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]];
                const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:lock:${id}:edges`, { lines: edges }, scene);
                lines.color = new BABYLON.Color3(0.95, 0.2, 0.2); lines.isPickable = false; lines.renderingGroupId = 3;  lines.parent = box;
                lines.position.set(0, 0, 0);  lines.rotationQuaternion = BABYLON.Quaternion.Identity();
                const lmat = new BABYLON.StandardMaterial(`sel:voxel:lock:${id}:edges:mat`, scene); lmat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2); lmat.disableDepthWrite = true;  lmat.zOffset = -2;
                lines.material = lmat;

                state.voxHl.set(id, box);
              }
            }
          }
        }
      }
    }

    // Show per-space voxel pick (s.voxPick) even when the space is not selected (e.g., in Cavern mode)
    const spaces = Array.isArray(state.barrow.spaces) ? state.barrow.spaces : [];
    for (const s of spaces) {
      if (!s || !s.id || !s.vox || !s.vox.size) continue;
      if (!s.voxPick || typeof s.voxPick.x !== 'number') continue;
      const id = s.id;
      // Skip if selected — already handled above — or if a locked voxel for this space was drawn
      if (state.selection && state.selection.has(id)) continue;
      const nx = Math.max(1, s.vox.size?.x || 1), ny = Math.max(1, s.vox.size?.y || 1), nz = Math.max(1, s.vox.size?.z || 1);
      const res = s.vox.res || s.res || (state.barrow?.meta?.voxelSize || 1);
      const ix = s.voxPick.x|0, iy = s.voxPick.y|0, iz = s.voxPick.z|0;
      if (!(ix>=0 && iy>=0 && iz>=0 && ix<nx && iy<ny && iz<nz)) continue;
      let hideTop = 0;  hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0)));
      const yCut = ny - hideTop; if (iy >= yCut) continue;
      const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
      const lx = (ix + 0.5) * res - centerX, ly = (iy + 0.5) * res - centerY, lz = (iz + 0.5) * res - centerZ;
      let q = BABYLON.Quaternion.Identity();
      const worldAligned = !!(s.vox && s.vox.worldAligned); if (!worldAligned) { const rx = Number(s.rotation?.x ?? 0) || 0; const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0; const rz = Number(s.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); }
      const parent = bySpace.get(id);
      if (!parent) continue;
      const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:pick:${id}`, { size: res * 1.06 }, scene);
      const mat = new BABYLON.StandardMaterial(`sel:voxel:pick:${id}:mat`, scene);
      mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05); mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
      mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;  mat.zOffset = -2;
      box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
      const rotM = (() => { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); })();
      const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx,ly,lz), rotM);
      box.parent = parent;
      box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
      box.rotationQuaternion = BABYLON.Quaternion.Identity();
      addHighlight(box, redGlow);
      const h = (res * 0.52);
      const c = [ new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h), new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h), new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h), new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h) ];
      const edges = [[c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],[c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],[c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]];
      const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:pick:${id}:edges`, { lines: edges }, scene);
      lines.color = new BABYLON.Color3(0.95, 0.2, 0.2); lines.isPickable = false; lines.renderingGroupId = 3;  lines.parent = box;
      lines.position.set(0, 0, 0);  lines.rotationQuaternion = BABYLON.Quaternion.Identity();
      const lmat = new BABYLON.StandardMaterial(`sel:voxel:pick:${id}:edges:mat`, scene); lmat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2); lmat.disableDepthWrite = true;  lmat.zOffset = -2;
      lines.material = lmat;

      state.voxHl.set(id, box);
    }

    state.hl.isEnabled = !!highlightAdded;
 };
}
