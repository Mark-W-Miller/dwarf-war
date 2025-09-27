// Scryball helpers and mode management (CM/SB support)
import { VoxelType, decompressVox } from '../../voxels/voxelize.mjs';

export function initScryApi({ scene, engine, camera, state, Log }) {
  // Ensure scry state bag
  state._scry = state._scry || { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function disposeScryBall() {
    try { state._scry.ball?.dispose?.(); } catch {}
    state._scry.ball = null;
  }

  function voxelValueAtWorld(space, wx, wy, wz) {
    try {
      if (!space || !space.vox) return VoxelType.Uninstantiated;
      const vox = decompressVox(space.vox);
      const nx = Math.max(1, vox.size?.x || 1);
      const ny = Math.max(1, vox.size?.y || 1);
      const nz = Math.max(1, vox.size?.z || 1);
      const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);
      const cx = space.origin?.x||0, cy = space.origin?.y||0, cz = space.origin?.z||0;
      let q = BABYLON.Quaternion.Identity();
      const worldAligned = !!(space.vox && space.vox.worldAligned);
      if (!worldAligned) {
        const rx = Number(space.rotation?.x ?? 0) || 0;
        const ry = (space.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0;
        const rz = Number(space.rotation?.z ?? 0) || 0;
        q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      }
      const qInv = BABYLON.Quaternion.Inverse(q);
      const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
      const vLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), rotInv);
      const minX = -(nx * res) / 2, minY = -(ny * res) / 2, minZ = -(nz * res) / 2;
      const ix = Math.floor((vLocal.x - minX) / res);
      const iy = Math.floor((vLocal.y - minY) / res);
      const iz = Math.floor((vLocal.z - minZ) / res);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return VoxelType.Uninstantiated;
      const flat = ix + nx * (iy + ny * iz);
      const data = Array.isArray(vox.data) ? vox.data : [];
      return data[flat] ?? VoxelType.Uninstantiated;
    } catch { return VoxelType.Uninstantiated; }
  }

  function findScryWorldPosForSpace(space) {
    try {
      const res = space.res || (state?.barrow?.meta?.voxelSize || 1);
      if (!space.vox || !space.vox.size) return new BABYLON.Vector3(space.origin?.x||0, space.origin?.y||0, space.origin?.z||0);
      const vox = decompressVox(space.vox);
      const nx = Math.max(1, vox.size?.x|0), ny = Math.max(1, vox.size?.y|0), nz = Math.max(1, vox.size?.z|0);
      const idx = (x,y,z) => x + nx*(y + ny*z);
      const cxr = (nx * res) / 2, cyr = (ny * res) / 2, czr = (nz * res) / 2;
      let bestEmpty = { i:-1, d2: Infinity, x:0, y:0, z:0 };
      let bestSolid = { i:-1, d2: Infinity, x:0, y:0, z:0 };
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const i = idx(x,y,z);
            const v = vox.data[i]; if (v == null) continue;
            const lx = (x + 0.5) * res - cxr;
            const ly = (y + 0.5) * res - cyr;
            const lz = (z + 0.5) * res - czr;
            const d2 = lx*lx + ly*ly + lz*lz;
            if (v === VoxelType.Empty) { if (d2 < bestEmpty.d2) bestEmpty = { i, d2, x: lx, y: ly, z: lz }; }
            else { if (d2 < bestSolid.d2) bestSolid = { i, d2, x: lx, y: ly, z: lz }; }
          }
        }
      }
      const loc = (bestEmpty.i >= 0) ? bestEmpty : bestSolid;
      const q = (() => { try { const rx=Number(space.rotation?.x||0), ry=(typeof space.rotation?.y==='number')? Number(space.rotation.y):Number(space.rotY||0)||0, rz=Number(space.rotation?.z||0); return BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); } catch { return BABYLON.Quaternion.Identity(); } })();
      const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(space.origin?.x||0, space.origin?.y||0, space.origin?.z||0));
      const world = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(loc.x, loc.y, loc.z), m);
      return world;
    } catch (e) { try { Log?.log('ERROR', 'EH:findScryWorldPosForSpace', { error: String(e) }); } catch {} return null; }
  }

  function ensureScryBallAt(pos, diameter) {
    try {
      const dia = Math.max(0.6, diameter || 1);
      if (state._scry.ball && !state._scry.ball.isDisposed()) { state._scry.ball.position.copyFrom(pos); return state._scry.ball; }
      const m = BABYLON.MeshBuilder.CreateSphere('scryBall', { diameter: dia, segments: 16 }, scene);
      const mat = new BABYLON.StandardMaterial('scryBall:mat', scene);
      mat.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.9); mat.emissiveColor = new BABYLON.Color3(0.15, 0.55, 1.0); mat.specularColor = new BABYLON.Color3(0,0,0);
      mat.alpha = 0.6; mat.backFaceCulling = false; mat.zOffset = 4; m.material = mat; m.isPickable = true; m.renderingGroupId = 2;
      m.position.copyFrom(pos);
      state._scry.ball = m; return m;
    } catch (e) { try { Log?.log('ERROR', 'EH:ensureScryBallAt', { error: String(e) }); } catch {} return null; }
  }

  function enterScryMode() {
    try {
      if (state.mode !== 'cavern') return;
      const ball = state._scry?.ball; if (!ball) return;
      state._scry.scryMode = true;
      // Save and override camera key bindings
      try { state._scry._camKeys = { up: camera.keysUp?.slice(), down: camera.keysDown?.slice(), left: camera.keysLeft?.slice(), right: camera.keysRight?.slice() }; } catch {}
      try { camera.keysUp = []; camera.keysDown = []; camera.keysLeft = []; camera.keysRight = []; } catch {}
      try { if (state.hl && ball) { state.hl.addMesh(ball, new BABYLON.Color3(0.4, 0.85, 1.0)); } } catch {}
      try { if (ball) { ball.outlineColor = new BABYLON.Color3(0.35, 0.9, 1.0); ball.outlineWidth = 0.02; ball.renderOutline = true; } } catch {}
      // Per-frame lock to scry ball and handle arrows/movement saved below
      if (state._scry.scryObs) { try { engine.onBeginFrameObservable.remove(state._scry.scryObs); } catch {} state._scry.scryObs = null; }
      state._scry.scryObs = engine.onBeginFrameObservable.add(() => {
        try {
          if (!state._scry?.scryMode) return;
          if (state._scry?.ball) camera.target.copyFrom(state._scry.ball.position);
        } catch {}
      });
    } catch (e) { try { Log?.log('ERROR', 'EH:enterScry', { error: String(e) }); } catch {} }
  }

  function exitScryMode() {
    try {
      if (!state._scry?.scryMode) return;
      try { const id = state._scry.spaceId; const b = state._scry.ball; if (id && b && !b.isDisposed()) localStorage.setItem('dw:scry:pos:'+id, JSON.stringify({ x: b.position.x, y: b.position.y, z:b.position.z })); } catch {}
      state._scry.scryMode = false;
      try { if (state._scry.scryObs) { engine.onBeginFrameObservable.remove(state._scry.scryObs); state._scry.scryObs = null; } } catch {}
      try { if (state._scry._camKeys) { camera.keysUp = state._scry._camKeys.up || camera.keysUp; camera.keysDown = state._scry._camKeys.down || camera.keysDown; camera.keysLeft = state._scry._camKeys.left || camera.keysLeft; camera.keysRight = state._scry._camKeys.right || camera.keysRight; state._scry._camKeys = null; } } catch {}
      try { if (state.hl && state._scry?.ball) state.hl.removeMesh(state._scry.ball); } catch {}
      try { if (state._scry?.ball) state._scry.ball.renderOutline = false; } catch {}
      Log?.log('SCRY', 'exit', {});
    } catch (e) { try { Log?.log('ERROR', 'EH:exitScry', { error: String(e) }); } catch {} }
  }

  return { disposeScryBall, voxelValueAtWorld, findScryWorldPosForSpace, ensureScryBallAt, enterScryMode, exitScryMode };
}

