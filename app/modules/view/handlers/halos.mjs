import { Log } from '../../util/log.mjs';

export function createRebuildHalos({ scene, state }) {
  return function rebuildHalos() {
    const report = (ctx, e) => { try { Log.log('ERROR', ctx, { error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack) : undefined }); } catch {} };
    try { const selArr = Array.from(state.selection || []); Log.log('HILITE', 'rebuild:start', { sel: selArr, last: state.lastVoxPick || null, locked: state.lockedVoxPick || null }); } catch {}
    for (const [id, mesh] of state.halos) { try { mesh.dispose(); } catch {} }
    state.halos.clear();
    try { for (const [id, m] of (state.selObb || new Map())) { try { m.dispose?.(); } catch {} } } catch {}
    try { state.selObb.clear(); } catch {}
    try { for (const [id, m] of (state.voxHl || new Map())) { try { m.dispose?.(); } catch {} } } catch {}
    try { state.voxHl.clear(); } catch {}
    try { for (const m of (state.voxSelMeshes || [])) { try { m.dispose?.(); } catch {} } } catch {}
    try { state.voxSelMeshes = []; } catch {}
    try { state.hl.removeAllMeshes(); } catch {}
    const bySpace = new Map((state.built.spaces||[]).map(x => [x.id, x.mesh]));
    let glowK = 0.7; try { const s = Number(localStorage.getItem('dw:ui:glowStrength') || '70') || 70; glowK = Math.max(0.2, Math.min(3.0, s / 100)); } catch {}
    const byCav = new Map((state.built.caverns||[]).map(x => [x.id, x.mesh]));
    const blue = new BABYLON.Color3(0.12 * glowK, 0.35 * glowK, 0.7 * glowK);
    const yellow = new BABYLON.Color3(0.7 * glowK, 0.65 * glowK, 0.15 * glowK);
    const redGlow = new BABYLON.Color3(0.9 * glowK, 0.18 * glowK, 0.18 * glowK);
    const subtleBlue = new BABYLON.Color3(0.10 * glowK, 0.28 * glowK, 0.55 * glowK);
    try { for (const part of (state?.built?.voxParts || [])) { try { part.renderOutline = false; } catch {} } } catch {}
    for (const id of state.selection) {
      const m = bySpace.get(id) || byCav.get(id); if (!m) continue;
      try { state.hl.addMesh(m, blue); } catch {}
      try { for (const part of (state?.built?.voxParts || [])) { const nm = String(part?.name || ''); if (nm.startsWith(`space:${id}:`)) { try { part.outlineColor = subtleBlue; part.renderOutline = true; part.outlineWidth = 0.02; } catch {} } } } catch {}
      try {
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
          const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:obb:${id}`, { lines: edges }, scene);
          lines.color = new BABYLON.Color3(0.1, 0.9, 0.9); lines.isPickable = false; lines.renderingGroupId = 3;
          state.selObb.set(id, lines);
        }
      } catch {}
      try {
        const s2 = (state.barrow.spaces||[]).find(x => x.id === id);
        const lock = state.lockedVoxPick && state.lockedVoxPick.id === id ? state.lockedVoxPick : null;
        const pickToUse = lock ? { x: lock.x, y: lock.y, z: lock.z } : (s2?.voxPick ? { x: s2.voxPick.x, y: s2.voxPick.y, z: s2.voxPick.z } : null);
        if (s2 && s2.vox && s2.vox.size && pickToUse) {
          const nx = Math.max(1, s2.vox.size?.x || 1), ny = Math.max(1, s2.vox.size?.y || 1), nz = Math.max(1, s2.vox.size?.z || 1);
          const res = s2.vox.res || s2.res || (state.barrow?.meta?.voxelSize || 1);
          const { x: ix, y: iy, z: iz } = pickToUse; if (!(ix>=0 && iy>=0 && iz>=0 && ix<nx && iy<ny && iz<nz)) { /* skip */ }
          let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s2.voxExposeTop || 0) || 0))); } catch {}
          const yCut = ny - hideTop; if (iy < yCut) {
            const centerX = (nx * res) / 2, centerY = (ny * res) / 2, centerZ = (nz * res) / 2;
            const lx = (ix + 0.5) * res - centerX, ly = (iy + 0.5) * res - centerY, lz = (iz + 0.5) * res - centerZ;
            let q = BABYLON.Quaternion.Identity(); try { const worldAligned = !!(s2.vox && s2.vox.worldAligned); if (!worldAligned) { const rx = Number(s2.rotation?.x ?? 0) || 0; const ry = (s2.rotation && typeof s2.rotation.y === 'number') ? Number(s2.rotation.y) : Number(s2.rotY || 0) || 0; const rz = Number(s2.rotation?.z ?? 0) || 0; q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } } catch {}
            const parent = bySpace.get(id); try { if (!parent) Log.log('HILITE', 'parent:missing', { id }); } catch {}
            const box = BABYLON.MeshBuilder.CreateBox(`sel:voxel:${id}`, { size: res * 1.06 }, scene);
            const mat = new BABYLON.StandardMaterial(`sel:voxel:${id}:mat`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.05); mat.emissiveColor = new BABYLON.Color3(0.9, 0.1, 0.1);
            mat.alpha = 0.35; mat.specularColor = new BABYLON.Color3(0,0,0);
            try { mat.disableDepthWrite = true; } catch (e) { report('HILITE:mat:disableDepthWrite', e); }
            mat.backFaceCulling = false; try { mat.zOffset = -2; } catch (e) { report('HILITE:mat:zOffset', e); }
            box.material = mat; box.isPickable = false; box.renderingGroupId = 3;
            const rotM = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
            const afterLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(lx,ly,lz), rotM);
            try { box.parent = parent; } catch (e) { report('HILITE:box:parent', e); }
            box.position.set(afterLocal.x, afterLocal.y, afterLocal.z);
            try { box.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:box:rot', e); }
            try { state.hl.addMesh(box, redGlow); } catch (e) { report('HILITE:hl:add:box', e); }
            try { const wm = parent?.getWorldMatrix?.() || BABYLON.Matrix.Identity(); const wpos = BABYLON.Vector3.TransformCoordinates(afterLocal, wm); Log.log('HILITE', 'voxel:draw', { id, world: { x: wpos.x, y: wpos.y, z: wpos.z }, local: { x: afterLocal.x, y: afterLocal.y, z: afterLocal.z } }); } catch (e) { report('HILITE:voxel:draw:log', e); }
            try { const h = (res * 0.52); const c = [ new BABYLON.Vector3(-h,-h,-h), new BABYLON.Vector3(+h,-h,-h), new BABYLON.Vector3(-h,+h,-h), new BABYLON.Vector3(+h,+h,-h), new BABYLON.Vector3(-h,-h,+h), new BABYLON.Vector3(+h,-h,+h), new BABYLON.Vector3(-h,+h,+h), new BABYLON.Vector3(+h,+h,+h) ]; const edges = [[c[0],c[1]],[c[1],c[3]],[c[3],c[2]],[c[2],c[0]],[c[4],c[5]],[c[5],c[7]],[c[7],c[6]],[c[6],c[4]],[c[0],c[4]],[c[1],c[5]],[c[2],c[6]],[c[3],c[7]]]; const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:voxel:${id}:edges`, { lines: edges }, scene); lines.color = new BABYLON.Color3(0.95, 0.2, 0.2); lines.isPickable = false; lines.renderingGroupId = 3; try { lines.parent = box; } catch (e) { report('HILITE:lines:parent', e); } lines.position.set(0, 0, 0); try { lines.rotationQuaternion = BABYLON.Quaternion.Identity(); } catch (e) { report('HILITE:lines:rot', e); } const lmat = new BABYLON.StandardMaterial(`sel:voxel:${id}:edges:mat`, scene); lmat.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2); lmat.disableDepthWrite = true; try { lmat.zOffset = -2; } catch (e) { report('HILITE:lines:z', e); } lines.material = lmat; } catch (e) { report('HILITE:lines', e); }
            try { state.voxHl.set(id, box); } catch {}
          }
        }
      } catch {}
    }
    try { for (const x of state?.built?.intersections || []) if (x?.mesh) state.hl.addMesh(x.mesh, yellow); } catch {}
    try { if (state?._scry?.scryMode && state?._scry?.ball) { const color = new BABYLON.Color3(0.4, 0.85, 1.0); state.hl.addMesh(state._scry.ball, color); try { state._scry.ball.outlineColor = color; state._scry.ball.outlineWidth = 0.02; state._scry.ball.renderOutline = true; } catch {} } } catch {}
  };
}

