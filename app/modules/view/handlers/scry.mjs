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

      // Track keys for simultaneous rotate + move
      state._scry.keyState = { up:false, down:false, left:false, right:false, shift:false, meta:false };
      try { if (state._scry.scryKeys) window.removeEventListener('keydown', state._scry.scryKeys); } catch {}
      try { if (state._scry.scryKeysUp) window.removeEventListener('keyup', state._scry.scryKeysUp); } catch {}
      state._scry.scryKeys = (e) => {
        if (!state._scry?.scryMode) return;
        const k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Shift' || k === 'Meta') {
          try { e.preventDefault(); e.stopPropagation(); } catch {}
          if (k === 'ArrowUp') state._scry.keyState.up = true;
          if (k === 'ArrowDown') state._scry.keyState.down = true;
          if (k === 'ArrowLeft') state._scry.keyState.left = true;
          if (k === 'ArrowRight') state._scry.keyState.right = true;
          if (k === 'Shift') state._scry.keyState.shift = true;
          if (k === 'Meta') state._scry.keyState.meta = true;
        }
      };
      state._scry.scryKeysUp = (e) => {
        if (!state._scry?.scryMode) return;
        const k = e.key;
        if (k === 'ArrowUp') state._scry.keyState.up = false;
        if (k === 'ArrowDown') state._scry.keyState.down = false;
        if (k === 'ArrowLeft') state._scry.keyState.left = false;
        if (k === 'ArrowRight') state._scry.keyState.right = false;
        if (k === 'Shift') state._scry.keyState.shift = false;
        if (k === 'Meta') { state._scry.keyState.meta = false; state._scry.keyState.up = false; state._scry.keyState.down = false; }
      };
      try { window.addEventListener('keydown', state._scry.scryKeys, { passive:false }); } catch {}
      try { window.addEventListener('keyup', state._scry.scryKeysUp, { passive:false }); } catch {}
      // Safety: clear modifier/key state on blur
      try {
        if (state._scry._onBlur) window.removeEventListener('blur', state._scry._onBlur);
        state._scry._onBlur = () => { try { state._scry.keyState = { up:false, down:false, left:false, right:false, shift:false, meta:false }; } catch {} };
        window.addEventListener('blur', state._scry._onBlur);
      } catch {}

      // Per-frame: keep target locked and drive rotation/movement
      if (state._scry.scryObs) { try { engine.onBeginFrameObservable.remove(state._scry.scryObs); } catch {} state._scry.scryObs = null; }
      state._scry.scryObs = engine.onBeginFrameObservable.add(() => {
        try {
          if (!state._scry?.scryMode) return;
          const ball2 = state._scry?.ball; if (ball2) camera.target.copyFrom(ball2.position);
          const ks = state._scry.keyState || {};
          const dt = (engine.getDeltaTime ? engine.getDeltaTime()/1000 : 1/60);
          const s = (state?.barrow?.spaces || []).find(x => x && x.id === state._scry.spaceId);
          if (!s) return;
          // Rotate camera yaw with left/right
          if (ks.left || ks.right) {
            const degPerSec = ks.shift ? 120 : 60;
            const dirYaw = ks.left ? 1 : -1; // CCW for left
            const delta = (degPerSec * Math.PI / 180) * dirYaw * dt;
            camera.alpha = (camera.alpha + delta) % (Math.PI * 2);
            if (camera.alpha < 0) camera.alpha += Math.PI * 2;
          }
          // Move scryball with up/down (Meta=vertical)
          const moveSign = (ks.up ? 1 : 0) + (ks.down ? -1 : 0);
          if (moveSign !== 0 && ball2) {
            const pos = ball2.position.clone();
            const isVert = !!ks.meta;
            let dir;
            if (isVert) {
              dir = new BABYLON.Vector3(0, moveSign, 0);
            } else {
              const fwd = camera.getForwardRay()?.direction.clone() || new BABYLON.Vector3(0,0,1);
              fwd.y = 0; try { fwd.normalize(); } catch {}
              dir = fwd.scale(moveSign);
            }
            const res = s.res || (state?.barrow?.meta?.voxelSize || 1);
            let scryMult = 1.0; try { const raw = Number(localStorage.getItem('dw:ui:scrySpeed') || '100'); if (isFinite(raw) && raw > 0) scryMult = (raw > 5) ? (raw/100) : raw; } catch {}
            const base = (isVert ? Math.max(0.06, res * 0.6) : Math.max(0.1, res * 0.9) * 2) * (ks.shift ? 2.0 : 1.0) * scryMult;
            const dist = base * Math.max(0.016, dt) * (isVert ? 3 : 6);
            const seg  = Math.max(isVert ? 0.04 : 0.08, res * (isVert ? 0.15 : 0.25));
            const radius = Math.max(0.15, (res * 0.8) / 2);
            const nSteps = Math.max(1, Math.ceil(dist / seg));
            const inc = dir.scale(dist / nSteps);
            function canOccupy(px, py, pz) {
              const offsets = [ {x:0,z:0}, {x:radius*0.5,z:0}, {x:-radius*0.5,z:0}, {x:0,z:radius*0.5}, {x:0,z:-radius*0.5} ];
              for (const o of offsets) {
                const hit = (() => { try { const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : []; for (const sp of spaces) { if (!sp || !sp.vox) continue; const v = voxelValueAtWorld(sp, px + o.x, py, pz + o.z); if (v === VoxelType.Rock || v === VoxelType.Wall) return true; } return false; } catch { return false; } })();
                if (hit) return false;
              }
              return true;
            }
            let next = pos.clone(); let blocked = false;
            for (let i = 0; i < nSteps; i++) {
              const cand = next.add(inc);
              if (canOccupy(cand.x, cand.y, cand.z)) { next.copyFrom(cand); }
              else { blocked = true; break; }
            }
            if (!next.equals(pos)) {
              ball2.position.copyFrom(next); camera.target.copyFrom(next);
              // Persist per-space scry position (throttled)
              try {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const lastT = state._scry._lastSaveT || 0;
                if (now - lastT > 120) {
                  state._scry._lastSaveT = now;
                  const key = 'dw:scry:pos:' + state._scry.spaceId;
                  localStorage.setItem(key, JSON.stringify({ x: next.x, y: next.y, z: next.z }));
                }
              } catch {}
            }
            try { if (blocked) Log?.log('COLLIDE', 'scry:block', { from: pos, to: next, vert: isVert }); } catch {}
          }
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
      try { if (state._scry.scryKeys) { window.removeEventListener('keydown', state._scry.scryKeys); state._scry.scryKeys = null; } } catch {}
      try { if (state._scry.scryKeysUp) { window.removeEventListener('keyup', state._scry.scryKeysUp); state._scry.scryKeysUp = null; } } catch {}
      try { if (state._scry._onBlur) { window.removeEventListener('blur', state._scry._onBlur); state._scry._onBlur = null; } } catch {}
      try { if (state._scry._camKeys) { camera.keysUp = state._scry._camKeys.up || camera.keysUp; camera.keysDown = state._scry._camKeys.down || camera.keysDown; camera.keysLeft = state._scry._camKeys.left || camera.keysLeft; camera.keysRight = state._scry._camKeys.right || camera.keysRight; state._scry._camKeys = null; } } catch {}
      try { if (state.hl && state._scry?.ball) state.hl.removeMesh(state._scry.ball); } catch {}
      try { if (state._scry?.ball) state._scry.ball.renderOutline = false; } catch {}
      Log?.log('SCRY', 'exit', {});
    } catch (e) { try { Log?.log('ERROR', 'EH:exitScry', { error: String(e) }); } catch {} }
  }

  return { disposeScryBall, voxelValueAtWorld, findScryWorldPosForSpace, ensureScryBallAt, enterScryMode, exitScryMode };
}
