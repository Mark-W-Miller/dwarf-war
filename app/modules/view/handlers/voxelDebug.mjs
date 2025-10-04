import { Log } from '../../util/log.mjs';

export function initVoxelDebug({ scene, state }) {
  state._scanDebug = state._scanDebug || { redBase: null, greenBase: null, orangeBase: null, blueBase: null, redArr: [], greenArr: [], orangeArr: [], blueArr: [], count: 0, jitter: 0 };
  state._obbDebug = state._obbDebug || { mesh: null };

  function startVoxelScanDebug(res = 1) {
    endVoxelScanDebug();
    const dia = Math.max(0.0625, (res * 0.7) / 4);
    state._scanDebug.jitter = Math.max(0, res * 0.12);
    function mkBase(name, diffuse, emissive) {
      const m = BABYLON.MeshBuilder.CreateSphere(`dbg:scanDot:${name}`, { diameter: dia, segments: 8 }, scene);
      const mat = new BABYLON.StandardMaterial(`dbg:scanDot:${name}:mat`, scene);
      mat.diffuseColor = diffuse; mat.emissiveColor = emissive; mat.specularColor = new BABYLON.Color3(0,0,0);
      m.material = mat; m.isPickable = false; m.renderingGroupId = 3; return m;
    }
    const red = mkBase('red', new BABYLON.Color3(0.60,0.10,0.10), new BABYLON.Color3(0.40,0.08,0.08));
    const green = mkBase('green', new BABYLON.Color3(0.08,0.50,0.12), new BABYLON.Color3(0.06,0.40,0.10));
    const orange = mkBase('orange', new BABYLON.Color3(0.95,0.55,0.10), new BABYLON.Color3(0.90,0.50,0.08));
    const blue = mkBase('blue', new BABYLON.Color3(0.20,0.45,0.95), new BABYLON.Color3(0.18,0.38,0.85));
    state._scanDebug.redBase = red; state._scanDebug.greenBase = green; state._scanDebug.orangeBase = orange; state._scanDebug.blueBase = blue;
    state._scanDebug.redArr = []; state._scanDebug.greenArr = []; state._scanDebug.orangeArr = []; state._scanDebug.blueArr = [];
    state._scanDebug.count = 0;
    Log.log('VOXEL', 'scan:start', { res, dia });
  }

  function _pushDot(arr, wx, wy, wz) {
    const j = state._scanDebug.jitter || 0;
    const jx = (Math.random() - 0.5) * j;
    const jy = (Math.random() - 0.5) * j;
    const jz = (Math.random() - 0.5) * j;
    const t = BABYLON.Vector3.Zero(); t.x = wx + jx; t.y = wy + jy; t.z = wz + jz;
    const sc = new BABYLON.Vector3(1,1,1);
    const m = BABYLON.Matrix.Compose(sc, BABYLON.Quaternion.Identity(), t);
    for (let k = 0; k < 16; k++) arr.push(m.m[k]);
  }
  function addVoxelScanPointOutside(wx, wy, wz) { _pushDot(state._scanDebug.redArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
  function addVoxelScanPointInside(wx, wy, wz) { _pushDot(state._scanDebug.greenArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
  function addVoxelScanPointWall(wx, wy, wz) { _pushDot(state._scanDebug.orangeArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
  function addVoxelScanPointRock(wx, wy, wz) { _pushDot(state._scanDebug.blueArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }
  function addVoxelScanPointUninst(wx, wy, wz) { _pushDot(state._scanDebug.redArr, wx, wy, wz); state._scanDebug.count++; if (state._scanDebug.count % 256 === 0) flushVoxelScanPoints(); }

  function flushVoxelScanPoints() {
    const b = state._scanDebug.redBase; if (b && state._scanDebug.redArr.length) b.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.redArr), 16, true);
    const b2 = state._scanDebug.greenBase; if (b2 && state._scanDebug.greenArr.length) b2.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.greenArr), 16, true);
    const b3 = state._scanDebug.orangeBase; if (b3 && state._scanDebug.orangeArr.length) b3.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.orangeArr), 16, true);
    const b4 = state._scanDebug.blueBase; if (b4 && state._scanDebug.blueArr.length) b4.thinInstanceSetBuffer('matrix', new Float32Array(state._scanDebug.blueArr), 16, true);
  }

  function endVoxelScanDebug() {
    state._scanDebug.redBase?.dispose?.();
    state._scanDebug.greenBase?.dispose?.();
    state._scanDebug.orangeBase?.dispose?.();
    state._scanDebug.blueBase?.dispose?.();
    state._scanDebug.redBase = null; state._scanDebug.greenBase = null; state._scanDebug.orangeBase = null; state._scanDebug.blueBase = null;
    state._scanDebug.redArr = []; state._scanDebug.greenArr = []; state._scanDebug.orangeArr = []; state._scanDebug.blueArr = [];
    state._scanDebug.count = 0;
    Log.log('VOXEL', 'scan:end', {});
  }

  function clearObbDebug() {
    state._obbDebug.mesh?.dispose?.();
    state._obbDebug.mesh = null;
  }
  function showObbDebug(corners) {
    clearObbDebug();
    if (!Array.isArray(corners) || corners.length !== 8) return;
    const V = (p) => new BABYLON.Vector3(p.x||0, p.y||0, p.z||0);
    const cs = corners.map(V);
    const edges = [
      [cs[0], cs[1]], [cs[1], cs[5]], [cs[5], cs[4]], [cs[4], cs[0]],
      [cs[2], cs[3]], [cs[3], cs[7]], [cs[7], cs[6]], [cs[6], cs[2]],
      [cs[0], cs[2]], [cs[1], cs[3]], [cs[4], cs[6]], [cs[5], cs[7]]
    ];
    const lines = BABYLON.MeshBuilder.CreateLineSystem('dbg:obb', { lines: edges }, scene);
    lines.color = new BABYLON.Color3(0.1, 0.9, 0.9);
    lines.isPickable = false; lines.renderingGroupId = 3;
    state._obbDebug.mesh = lines;

  }

  window.addEventListener('dw:debug:clearAll', () => {
    endVoxelScanDebug();
    clearObbDebug();
    state.debugAabb?.dispose?.(); state.debugAabb = null;
    Log.log('VOXEL', 'debug:cleared', {});
 });

  return { startVoxelScanDebug, addVoxelScanPointInside, addVoxelScanPointOutside, addVoxelScanPointWall, addVoxelScanPointRock, addVoxelScanPointUninst, flushVoxelScanPoints, endVoxelScanDebug, showObbDebug, clearObbDebug };
}

