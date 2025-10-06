import { Log } from '../../util/log.mjs';
import { updateConnectMeshesGeometry, syncConnectPathToDb } from '../connectMeshes.mjs';

const GIZMO_ACTIVE_MODES = new Set(['edit', 'war']);
const CONNECT_GIZMO_SCALE = 18;

export function getVoxelPickWorldCenter(state) {
  let pid = null, px = null, py = null, pz = null;
  if (state && state.lastVoxPick && state.lastVoxPick.id) {
    pid = state.lastVoxPick.id; px = state.lastVoxPick.x; py = state.lastVoxPick.y; pz = state.lastVoxPick.z;
 } else {
    const picks = Array.isArray(state?.voxSel) ? state.voxSel : [];
    if (!picks.length) return null;
    const p = picks[picks.length - 1]; pid = p.id; px = p.x; py = p.y; pz = p.z;
  }
  const space = (state?.barrow?.spaces || []).find(x => x && x.id === pid);
  if (!space || !space.vox || !space.vox.size) return null;
  const vox = space.vox;
  const nx = Math.max(1, vox.size?.x || 1);
  const ny = Math.max(1, vox.size?.y || 1);
  const nz = Math.max(1, vox.size?.z || 1);
  const res = vox.res || space.res || (state?.barrow?.meta?.voxelSize || 1);

  const minX = -(nx * res) / 2;
  const minY = -(ny * res) / 2;
  const minZ = -(nz * res) / 2;

  let wx = minX + (px + 0.5) * res;
  let wy = minY + (py + 0.5) * res;
  let wz = minZ + (pz + 0.5) * res;
  let vector = new BABYLON.Vector3(wx, wy, wz);
  const worldAligned = !!(space.vox && space.vox.worldAligned);
  if (!worldAligned) {
    const rx = Number(space.rotation?.x ?? 0) || 0;
    const ry = (space.rotation && typeof space.rotation.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0;
    const rz = Number(space.rotation?.z ?? 0) || 0;
    const quaternion = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
    const matrix = BABYLON.Matrix.Compose(new BABYLON.Vector3(1, 1, 1), quaternion, BABYLON.Vector3.Zero());
    vector = BABYLON.Vector3.TransformCoordinates(vector, matrix);
  }
  const cx = space.origin?.x || 0;
  const cy = space.origin?.y || 0;
  const cz = space.origin?.z || 0;
  vector.x += cx;
  vector.y += cy;
  vector.z += cz;
  return vector;

}

function gatherSelectedConnectIndices(sel, pathLength) {
  const indices = new Set();
  if (!sel || !sel.size) return indices;
  for (const raw of sel) {
    const name = String(raw || '');
    if (name.startsWith('connect:node:')) {
      const idx = Number(name.split(':')[2] || NaN);
      if (Number.isFinite(idx) && idx >= 0 && idx < pathLength) indices.add(idx);
      continue;
    }
    if (name.startsWith('connect:seg:')) {
      const idx = Number(name.split(':')[2] || NaN);
      if (Number.isFinite(idx) && idx >= 0 && idx < pathLength) {
        indices.add(idx);
        if (idx + 1 < pathLength) indices.add(idx + 1);
      }
    }
  }
  return indices;
}

export function initConnectGizmo({ scene, engine, camera, state, renderDbView, saveBarrow, snapshot: snapshotFn, scheduleGridUpdate, rebuildScene }) {
  if (!scene || !engine || !camera || !state) {
    throw new Error('initConnectGizmo requires scene, engine, camera, and state');
  }

  const canvas = engine.getRenderingCanvas?.() || null;
  let lastPickMissLog = 0;

  function pickPointOnPlane(normal, point) {
    let n = normal.clone();
    n.normalize();
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
    const origin = ray.origin;
    const dir = ray.direction;
    let denom = BABYLON.Vector3.Dot(n, dir);
    const EPS = 1e-6;
    if (Math.abs(denom) < EPS) {
      const forward = camera.getForwardRay?.()?.direction || new BABYLON.Vector3(0, 0, 1);
      n = n.add(forward.scale(0.001));
      n.normalize();
      denom = BABYLON.Vector3.Dot(n, dir);
    }
    if (Math.abs(denom) < EPS) {
      const now = performance.now?.() || Date.now();
      if (now - lastPickMissLog > 120) {
        lastPickMissLog = now;
        Log.log('GIZMO_2', 'connect:pickParallel', { normal: n.asArray(), dir: dir.asArray() });
      }
      return null;
    }
    const t = BABYLON.Vector3.Dot(point.subtract(origin), n) / denom;
    if (!isFinite(t) || t < 0) {
      const now = performance.now?.() || Date.now();
      if (now - lastPickMissLog > 120) {
        lastPickMissLog = now;
        Log.log('GIZMO_2', 'connect:pickBehind', { t });
      }
      return null;
    }
    return origin.add(dir.scale(t));

  }

  function disposeConnectGizmo() {
    const gizmo = state?._connect?.gizmo;
    if (!gizmo) return;
    const parts = Array.isArray(gizmo.parts) ? gizmo.parts : [];
    for (const part of parts) {
      part?.dispose?.();
    }
    gizmo.root?.dispose?.();
    state._connect.gizmo = null;
  }

  function ensureConnectGizmoFromSel() {
    state._connect = state._connect || {};
    const sel = (state._connect.sel instanceof Set) ? state._connect.sel : null;
    if (!sel || sel.size === 0) { disposeConnectGizmo(); return; }

    const nodes = Array.isArray(state._connect.nodes) ? state._connect.nodes : [];
    const path = Array.isArray(state._connect.path) ? state._connect.path : [];
    const byName = new Map(nodes
      .map((n) => [n?.mesh?.name || `connect:node:${n?.i}`, n?.mesh])
      .filter(([, mesh]) => !!mesh)
    );

    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const rawName of sel) {
      const name = String(rawName);
      let px = null, py = null, pz = null;
      const mesh = byName.get(name);
      if (mesh?.position) {
        px = mesh.position.x;
        py = mesh.position.y;
        pz = mesh.position.z;
 } else if (name.startsWith('connect:node:')) {
        const idx = Number(name.split(':').pop());
        if (Number.isFinite(idx) && path[idx]) {
          const p = path[idx];
          px = Number(p.x) || 0;
          py = Number(p.y) || 0;
          pz = Number(p.z) || 0;
        }
 } else if (name.startsWith('connect:seg:')) {
        const idx = Number(name.split(':').pop());
        if (Number.isFinite(idx) && path[idx] && path[idx + 1]) {
          const p0 = path[idx];
          const p1 = path[idx + 1];
          px = ((Number(p0.x) || 0) + (Number(p1.x) || 0)) / 2;
          py = ((Number(p0.y) || 0) + (Number(p1.y) || 0)) / 2;
          pz = ((Number(p0.z) || 0) + (Number(p1.z) || 0)) / 2;
        }
      }

      if (px != null && py != null && pz != null) {
        cx += px;
        cy += py;
        cz += pz;
        count += 1;
      }
    }

    if (!count) {
      disposeConnectGizmo();
      return;
    }

    const center = { x: cx / count, y: cy / count, z: cz / count };
    const existing = state._connect.gizmo || {};
    let root = existing.root;
    let parts = Array.isArray(existing.parts) ? existing.parts : [];

    if (!root || root.isDisposed?.()) {
      for (const part of parts) part?.dispose?.();
      parts = [];

      root = new BABYLON.TransformNode('connectGizmo:root', scene);
      root.scaling.set(CONNECT_GIZMO_SCALE, CONNECT_GIZMO_SCALE, CONNECT_GIZMO_SCALE);

      const disc = BABYLON.MeshBuilder.CreateDisc('connectGizmo:disc', { radius: 1.0, tessellation: 64 }, scene);
      const discMat = new BABYLON.StandardMaterial('connectGizmo:disc:mat', scene);
      discMat.diffuseColor = new BABYLON.Color3(0.15, 0.5, 0.95);
      discMat.emissiveColor = new BABYLON.Color3(0.12, 0.42, 0.85);
      discMat.alpha = 0.22;
      discMat.specularColor = new BABYLON.Color3(0, 0, 0);
      discMat.disableDepthWrite = true;
      disc.zOffset = 8;
      disc.material = discMat;
      disc.isPickable = false;
      disc.alwaysSelectAsActiveMesh = true;
      disc.renderingGroupId = 3;
      disc.rotation.x = Math.PI / 2;
      disc.parent = root;
      parts.push(disc);

      const planeGrab = BABYLON.MeshBuilder.CreateDisc('connectGizmo:disc:grab', { radius: 1.05, tessellation: 24 }, scene);
      planeGrab.isVisible = false;
      planeGrab.isPickable = true;
      planeGrab.alwaysSelectAsActiveMesh = true;
      planeGrab.renderingGroupId = 3;
      planeGrab.rotation.x = Math.PI / 2;
      planeGrab.parent = root;
      parts.push(planeGrab);

      const shaft = BABYLON.MeshBuilder.CreateCylinder('connectGizmo:arrow:y:shaft', { height: 1.0, diameter: 0.08, tessellation: 24 }, scene);
      const tip = BABYLON.MeshBuilder.CreateCylinder('connectGizmo:arrow:y:tip', { height: 0.24, diameterTop: 0, diameterBottom: 0.2, tessellation: 24 }, scene);
      const grab = BABYLON.MeshBuilder.CreateCylinder('connectGizmo:arrow:y:grab', { height: 1.05, diameter: 0.4, tessellation: 16 }, scene);
      const arrowMat = new BABYLON.StandardMaterial('connectGizmo:arrow:y:mat', scene);
      arrowMat.diffuseColor = new BABYLON.Color3(0.2, 0.95, 0.2);
      arrowMat.emissiveColor = new BABYLON.Color3(0.18, 0.8, 0.18);
      shaft.material = arrowMat;
      tip.material = arrowMat;
      grab.material = arrowMat;
      shaft.isPickable = true;
      tip.isPickable = true;
      grab.isPickable = true;
      grab.isVisible = false;
      shaft.renderingGroupId = 3;
      tip.renderingGroupId = 3;
      grab.renderingGroupId = 3;
      shaft.zOffset = 8;
      tip.zOffset = 8;
      grab.zOffset = 8;
      shaft.parent = root;
      tip.parent = root;
      grab.parent = root;
      shaft.position.y = 0.5;
      tip.position.y = 1.12;
      grab.position.y = 0.5;
      parts.push(shaft, tip, grab);

      state._connect.gizmo = { root, parts };
    }

    if (root) {
      root.scaling.set(CONNECT_GIZMO_SCALE, CONNECT_GIZMO_SCALE, CONNECT_GIZMO_SCALE);
    }

    root.position.set(center.x, center.y, center.z);
    state._connect.gizmo.center = center;
  }

  function handleDragUpdate({ dx, dy, dz }) {
    state._connect = state._connect || {};
    const drag = state._connect._drag;
    if (!drag || !drag.active) return;
    const path = Array.isArray(state._connect.path) ? state._connect.path : [];
    const indicesSet = (drag.selIndexSet instanceof Set) ? drag.selIndexSet : new Set(drag.selIndices || []);
    if (!indicesSet.size || !path.length) return;

    if (drag.pathSnapshot && drag.pathSnapshot.length === path.length) {
      for (let i = 0; i < drag.pathSnapshot.length; i++) {
        const base = drag.pathSnapshot[i] || { x: 0, y: 0, z: 0 };
        const target = path[i] || (path[i] = { x: base.x, y: base.y, z: base.z });
        if (indicesSet.has(i)) {
          target.x = base.x + dx;
          target.y = base.y + dy;
          target.z = base.z + dz;
 } else {
          target.x = base.x;
          target.y = base.y;
          target.z = base.z;
        }
      }
 } else {
      for (const idx of indicesSet) {
        const point = path[idx];
        if (!point) continue;
        const px = Number(point.x) || 0;
        const py = Number(point.y) || 0;
        const pz = Number(point.z) || 0;
        point.x = px + dx;
        point.y = py + dy;
        point.z = pz + dz;
      }
    }
    updateConnectMeshesGeometry({ scene, state });
    ensureConnectGizmoFromSel();
    scene.render();

  }

  scene.onPointerObservable.add((pi) => {
    if (!GIZMO_ACTIVE_MODES.has(state.mode)) return;
    const type = pi.type;
    if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const hitArrow = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('connectGizmo:arrow:'));
      const hitPlane = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'connectGizmo:disc:grab');
      const hitConnect = hitArrow?.hit ? hitArrow : (hitPlane?.hit ? hitPlane : scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('connectGizmo:')));
      if (hitConnect?.hit && hitConnect.pickedMesh) {
        const ev = pi.event || window.event;
        const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
        if (!isLeft) return;
        pi.skipOnPointerObservable = true;
        ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.();

        ensureConnectGizmoFromSel();

        const center = (state?._connect?.gizmo?.center)
          ? new BABYLON.Vector3(state._connect.gizmo.center.x, state._connect.gizmo.center.y, state._connect.gizmo.center.z)
          : new BABYLON.Vector3(0, 0, 0);
        const drag = (state._connect._drag = state._connect._drag || {});
        drag.active = true;
        drag.mode = null;
        drag.axisStart = 0;
        drag.startPick = null;
        const sensPref = Number(localStorage.getItem('dw:ui:ppMoveSens') || '1.0');
        drag.sens = Math.max(0.05, Math.min(2.0, sensPref || 1.0)) * (ev && ev.altKey ? 0.25 : 1.0);
        drag.delta = { x: 0, y: 0, z: 0 };

        const sel = (state?._connect?.sel instanceof Set) ? state._connect.sel : new Set();
        const path = Array.isArray(state?._connect?.path) ? state._connect.path : [];
        const selIndices = gatherSelectedConnectIndices(sel, path.length);
        if (!selIndices.size) {
          drag.active = false;
          drag.selIndices = [];
          drag.selIndexSet = new Set();
          drag.pathSnapshot = null;
          camera.inputs?.attached?.pointers?.attachControl(canvas, true);
          return;
        }

        drag.selIndices = Array.from(selIndices);
        drag.selIndexSet = new Set(selIndices);
        drag.pathSnapshot = path.map((p) => ({
          x: Number(p?.x) || 0,
          y: Number(p?.y) || 0,
          z: Number(p?.z) || 0
 }));

        const meshName = String(hitConnect.pickedMesh.name || '');
        let axisMode = !meshName.startsWith('connectGizmo:disc');
        if (!axisMode) {
          const pickPoint = hitConnect.pickedPoint;
          if (pickPoint && center) {
            const dx = pickPoint.x - center.x;
            const dz = pickPoint.z - center.z;
            const radial = Math.hypot(dx, dz);
            if (radial <= 0.35) axisMode = true;
          }
        }

        if (axisMode) {
          drag.mode = 'axis';
          drag.axis = 'y';
          const axis = new BABYLON.Vector3(0, 1, 0);
          const view = camera.getForwardRay?.()?.direction || new BABYLON.Vector3(0, 0, 1);
          let planeNormal = BABYLON.Vector3.Cross(axis, BABYLON.Vector3.Cross(view, axis));
          if (planeNormal.lengthSquared() < 1e-4) planeNormal = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(0, 1, 0));
          if (planeNormal.lengthSquared() < 1e-4) planeNormal = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(1, 0, 0));
          planeNormal.normalize();
          drag.planeN = planeNormal;
          drag.planeP = center.clone();
          const sp = pickPointOnPlane(drag.planeN, drag.planeP) || center.clone();
          drag.startPick = sp;
          drag.axisStart = BABYLON.Vector3.Dot(sp, axis);
 } else {
          drag.mode = 'plane';
          drag.axis = null;
          drag.planeN = new BABYLON.Vector3(0, 1, 0);
          drag.planeP = new BABYLON.Vector3(0, center.y, 0);
          drag.startPick = pickPointOnPlane(drag.planeN, drag.planeP) || center.clone();
        }

        const ptr = camera.inputs?.attached?.pointers;
        const canvasEl = canvas;
        if (ptr && ptr.detachControl && canvasEl) ptr.detachControl(canvasEl);
        if (ev && ev.pointerId != null && canvasEl?.setPointerCapture) canvasEl.setPointerCapture(ev.pointerId);

      }
 } else if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const drag = state?._connect?._drag;
      if (!drag || !drag.active) return;
      pi.skipOnPointerObservable = true;
      pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.();

      const planePoint = drag.planeP || new BABYLON.Vector3(0, 0, 0);
      const planeNormal = drag.planeN || new BABYLON.Vector3(0, 1, 0);
      const pick = pickPointOnPlane(planeNormal, planePoint);
      if (!pick) return;
      const start = drag.startPick || planePoint;
      let dx = 0, dy = 0, dz = 0;
      if (drag.mode === 'plane') {
        const delta = pick.subtract(start).scale(drag.sens || 1);
        dx = delta.x;
        dy = 0;
        dz = delta.z;
 } else {
        const axis = new BABYLON.Vector3(0, 1, 0);
        const scalar = BABYLON.Vector3.Dot(pick, axis);
        const startScalar = drag.axisStart || 0;
        dy = (scalar - startScalar) * (drag.sens || 1);
        dx = 0;
        dz = 0;
      }
      drag.delta = { x: dx, y: dy, z: dz };
      handleDragUpdate({ dx, dy, dz });
    }

 });

  const releasePointer = () => {
    const drag = state?._connect?._drag;
    if (drag && drag.active) {
      const selectedIndices = Array.isArray(drag.selIndices) ? drag.selIndices.slice() : [];
      drag.active = false;
      drag.delta = { x: 0, y: 0, z: 0 };
      drag.selIndices = [];
      drag.selIndexSet = new Set();
      drag.pathSnapshot = null;
      camera.inputs?.attached?.pointers?.attachControl(canvas, true);
      syncConnectPathToDb(state);
      saveBarrow?.(state.barrow); snapshotFn?.(state.barrow);
      renderDbView?.(state.barrow);
      scheduleGridUpdate?.();
      rebuildScene?.();
      window.dispatchEvent(new CustomEvent('dw:connect:update'));
      Log.log('GIZMO_2', 'connect:dragEnd', { indices: selectedIndices });
    }

 };

  window.addEventListener('pointerup', releasePointer, { passive: true });
  window.addEventListener('pointercancel', releasePointer, { passive: true });

  return {
    ensureConnectGizmoFromSel,
    disposeConnectGizmo
 };
}
