import { Log, logErr } from '../util/log.mjs';
import { initScryApi } from './handlers/scry.mjs';
import { initViewManipulations } from './handlers/view.mjs';
import { initRouter } from './router.mjs';
import { getVoxelPickWorldCenter as computeVoxelPickWorldCenter, initConnectGizmo } from './handlers/gizmo.mjs';
import { createGizmoBuilder } from './gizmoBuilder.mjs';
import { initCavernApi } from './handlers/cavern.mjs';
import { initVoxelHandlers } from './handlers/voxel.mjs';
import { getSelectionCenter as computeSelectionCenter } from './handlers/ui/selection.mjs';
import { saveBarrow, snapshot } from '../barrow/store.mjs';
import { renderDbView } from './dbTab.mjs';

export function initSceneHandlers({ scene, engine, camApi, camera, state, helpers }) {
  const { setMode, rebuildScene, rebuildHalos, scheduleGridUpdate } = helpers || {};

  let _gizmosSuppressed = false;
  const noop = () => {};
  let _scryApi = null;
  let _cavernApi = null;
  let _selectionGizmo = null;
  let _translationHandler = null;
  let _rotationHandler = null;

  const getSelectionCenter = () => { try { return computeSelectionCenter(state); } catch { return null; } };
  const getVoxelPickWorldCenter = () => { try { return computeVoxelPickWorldCenter(state); } catch { return null; } };

  function pickPointOnPlane(normal, point) {
    try {
      const n = normal.clone(); n.normalize();
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const origin = ray.origin;
      const dir = ray.direction;
      const denom = BABYLON.Vector3.Dot(n, dir);
      if (Math.abs(denom) < 1e-6) return null;
      const t = BABYLON.Vector3.Dot(point.subtract(origin), n) / denom;
      if (!isFinite(t) || t < 0) return null;
      return origin.add(dir.scale(t));
    } catch { return null; }
  }

  try { _scryApi = initScryApi({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:scry:init', e); }
  state._scry = { ball: null, prev: null, exitObs: null, prevWallOpacity: null, prevRockOpacity: null };

  function exitScryMode() { try { _scryApi?.exitScryMode?.(); } catch { } }

  // Attach debug router logs before view handlers so logs still appear
  try { initRouter({ scene, engine, camera, state, Log }); } catch (e) { logErr('EH:router:init', e); }
  let _viewApi = null;
  try { _viewApi = initViewManipulations({ scene, engine, camera, state, helpers: { getSelectionCenter, getVoxelPickWorldCenter } }) || null; }
  catch (e) { logErr('EH:view:init', e); }

  function initSelectionGizmo() {
    try {
      _selectionGizmo = createGizmoBuilder({
        scene,
        camera,
        log: (evt, data) => {
          try { Log.log('GIZMO_2', evt, data); } catch {}
        },
        translationHandler: _translationHandler,
        rotationHandler: _rotationHandler
      });
      _selectionGizmo.setActive(false);
      state._selectionGizmo = _selectionGizmo;
    } catch (e) { logErr('EH:gizmo2:init', e); }
  }

  // Legacy gizmo system disabled; ensure downstream consumers work with no-op API.
  try { window.addEventListener('dw:connect:update', () => { /* legacy gizmo disabled */ }); } catch {}

  try {
    _cavernApi = initCavernApi({
      scene, engine, camera, state,
      helpers: { rebuildScene, rebuildHalos, setMode, setGizmoHudVisible: noop, disposeMoveWidget: disposeSelectionWidgets, disposeRotWidget: disposeSelectionWidgets },
      scryApi: _scryApi,
      Log,
    });
  } catch (e) { logErr('EH:cavern:init', e); }

  let _vox = null;
  try {
    _vox = initVoxelHandlers({ scene, engine, camera, state });
    _vox.initVoxelHover({
      isGizmoBusy: () => {
        try {
          const info = _selectionGizmo?.getDragState?.();
          return !!(info && info.active);
        } catch {
          return false;
        }
      }
    });
  } catch (e) { logErr('EH:voxel:init', e); }

  function gatherSelectionTargets() {
    const accumulator = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity }, count: 0, hasVox: false };

    const expandBounds = (minVec, maxVec) => {
      if (!minVec || !maxVec) return;
      accumulator.min.x = Math.min(accumulator.min.x, minVec.x);
      accumulator.min.y = Math.min(accumulator.min.y, minVec.y);
      accumulator.min.z = Math.min(accumulator.min.z, minVec.z);
      accumulator.max.x = Math.max(accumulator.max.x, maxVec.x);
      accumulator.max.y = Math.max(accumulator.max.y, maxVec.y);
      accumulator.max.z = Math.max(accumulator.max.z, maxVec.z);
      accumulator.count++;
    };

    const expandPoint = (pos, radius = 0.8) => {
      if (!pos) return;
      accumulator.min.x = Math.min(accumulator.min.x, pos.x - radius);
      accumulator.min.y = Math.min(accumulator.min.y, pos.y - radius);
      accumulator.min.z = Math.min(accumulator.min.z, pos.z - radius);
      accumulator.max.x = Math.max(accumulator.max.x, pos.x + radius);
      accumulator.max.y = Math.max(accumulator.max.y, pos.y + radius);
      accumulator.max.z = Math.max(accumulator.max.z, pos.z + radius);
      accumulator.count++;
    };

    try {
      const selectedSpaces = Array.from(state?.selection || []);
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      for (const id of selectedSpaces) {
        const entry = builtSpaces.find((x) => x && x.id === id);
        const mesh = entry?.mesh;
        if (!mesh) continue;
        try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
        const bb = mesh.getBoundingInfo()?.boundingBox;
        if (!bb) continue;
        expandBounds(bb.minimumWorld, bb.maximumWorld);
        const space = (state?.barrow?.spaces || []).find((s) => s && s.id === id);
        if (space && space.vox && space.vox.size) accumulator.hasVox = true;
      }
    } catch {}

    try {
      const connectSel = (state?._connect?.sel instanceof Set) ? Array.from(state._connect.sel) : [];
      for (const name of connectSel) {
        if (!name) continue;
        let mesh = null;
        try { mesh = scene.getMeshByName(name); } catch {}
        if (!mesh) {
          try { mesh = scene.getMeshByName(`${name}:mesh`); } catch {}
        }
        if (!mesh) continue;
        let pos = null;
        try { pos = mesh.getAbsolutePosition ? mesh.getAbsolutePosition() : mesh.position; } catch {}
        if (!pos) continue;
        expandPoint(pos, 0.9);
      }
    } catch {}

    if (accumulator.count === 0) return null;

    const minSpan = 1.2;
    const ensureSpan = (minVal, maxVal) => {
      if (!isFinite(minVal) || !isFinite(maxVal)) return [minVal, maxVal];
      const span = maxVal - minVal;
      if (span >= minSpan) return [minVal, maxVal];
      const mid = (minVal + maxVal) / 2;
      return [mid - minSpan / 2, mid + minSpan / 2];
    };

    const [minX, maxX] = ensureSpan(accumulator.min.x, accumulator.max.x);
    const [minY, maxY] = ensureSpan(accumulator.min.y, accumulator.max.y);
    const [minZ, maxZ] = ensureSpan(accumulator.min.z, accumulator.max.z);

    try {
      Log.log('GIZMO_2', 'selection:gizmo:bounds', {
        count: accumulator.count,
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ }
      });
    } catch {}

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      hasVox: accumulator.hasVox
    };
  }

  function buildTranslationContext() {
    const context = { spaceIds: [], spaceTargets: [], nodeTargets: [], bounds: null };
    const bounds = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity }
    };
    try {
      const selectedSpaces = Array.from(state?.selection || []);
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      for (const id of selectedSpaces) {
        const entry = builtSpaces.find((x) => x && x.id === id);
        const mesh = entry?.mesh;
        const space = (state?.barrow?.spaces || []).find((s) => s && s.id === id) || null;
        if (!mesh || !space) continue;
        let startPos = null;
        try { startPos = mesh.getAbsolutePosition ? mesh.getAbsolutePosition().clone() : mesh.position.clone(); }
        catch { startPos = mesh.position ? mesh.position.clone() : null; }
        if (!startPos) startPos = new BABYLON.Vector3(space.origin?.x || 0, space.origin?.y || 0, space.origin?.z || 0);
        const origin = {
          x: Number(space.origin?.x) || 0,
          y: Number(space.origin?.y) || 0,
          z: Number(space.origin?.z) || 0
        };
        context.spaceIds.push(id);
        context.spaceTargets.push({ id, mesh, startPos, origin, space });
        bounds.min.x = Math.min(bounds.min.x, startPos.x);
        bounds.min.y = Math.min(bounds.min.y, startPos.y);
        bounds.min.z = Math.min(bounds.min.z, startPos.z);
        bounds.max.x = Math.max(bounds.max.x, startPos.x);
        bounds.max.y = Math.max(bounds.max.y, startPos.y);
        bounds.max.z = Math.max(bounds.max.z, startPos.z);
      }
    } catch {}

    try {
      const nodes = Array.isArray(state?._connect?.nodes) ? state._connect.nodes : [];
      for (const node of nodes) {
        const mesh = node?.mesh;
        if (!mesh) continue;
        let start = null;
        try { start = mesh.getAbsolutePosition ? mesh.getAbsolutePosition().clone() : mesh.position.clone(); }
        catch { start = mesh.position ? mesh.position.clone() : null; }
        if (!start) continue;
        context.nodeTargets.push({ mesh, start });
        bounds.min.x = Math.min(bounds.min.x, start.x);
        bounds.min.y = Math.min(bounds.min.y, start.y);
        bounds.min.z = Math.min(bounds.min.z, start.z);
        bounds.max.x = Math.max(bounds.max.x, start.x);
        bounds.max.y = Math.max(bounds.max.y, start.y);
        bounds.max.z = Math.max(bounds.max.z, start.z);
      }
    } catch {}

    if (bounds.min.x !== Infinity) {
      context.bounds = {
        min: { ...bounds.min },
        max: { ...bounds.max }
      };
    }

    return context;
  }

  function updateSelectionObbLiveForTargets(spaceTargets, opts = {}) {
    if (!Array.isArray(spaceTargets) || !spaceTargets.length) return;
    const metaVoxel = state?.barrow?.meta?.voxelSize || 1;
    const selObb = state.selObb instanceof Map ? state.selObb : null;
    if (!selObb || !selObb.size) return;
    for (const target of spaceTargets) {
      const id = target?.id;
      const space = target?.space;
      if (!id || !space) continue;
      const lines = selObb.get(id);
      if (!lines || lines.isDisposed?.()) continue;
      const sr = space.res || metaVoxel;
      const size = space.size || {};
      const w = (size.x || 0) * sr;
      const h = (size.y || 0) * sr;
      const d = (size.z || 0) * sr;
      const hx = w / 2;
      const hy = h / 2;
      const hz = d / 2;
      const originBase = target.origin || { x: 0, y: 0, z: 0 };
      const origin = (() => {
        if (opts.useSpaceOrigin && space.origin) {
          return {
            x: Number(space.origin.x) || 0,
            y: Number(space.origin.y) || 0,
            z: Number(space.origin.z) || 0
          };
        }
        const delta = opts.delta || { x: 0, y: 0, z: 0 };
        return {
          x: originBase.x + (Number(delta.x) || 0),
          y: originBase.y + (Number(delta.y) || 0),
          z: originBase.z + (Number(delta.z) || 0)
        };
      })();
      const rx = (space.rotation && typeof space.rotation.x === 'number') ? space.rotation.x : 0;
      const ry = (space.rotation && typeof space.rotation.y === 'number') ? space.rotation.y : (typeof space.rotY === 'number' ? space.rotY : 0);
      const rz = (space.rotation && typeof space.rotation.z === 'number') ? space.rotation.z : 0;
      const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      const matrix = BABYLON.Matrix.Compose(new BABYLON.Vector3(1, 1, 1), q, new BABYLON.Vector3(origin.x, origin.y, origin.z));
      const locals = [
        new BABYLON.Vector3(-hx, -hy, -hz), new BABYLON.Vector3(+hx, -hy, -hz),
        new BABYLON.Vector3(-hx, +hy, -hz), new BABYLON.Vector3(+hx, +hy, -hz),
        new BABYLON.Vector3(-hx, -hy, +hz), new BABYLON.Vector3(+hx, -hy, +hz),
        new BABYLON.Vector3(-hx, +hy, +hz), new BABYLON.Vector3(+hx, +hy, +hz)
      ];
      const corners = locals.map((v) => BABYLON.Vector3.TransformCoordinates(v, matrix));
      const edges = [
        [corners[0], corners[1]], [corners[1], corners[3]], [corners[3], corners[2]], [corners[2], corners[0]],
        [corners[4], corners[5]], [corners[5], corners[7]], [corners[7], corners[6]], [corners[6], corners[4]],
        [corners[0], corners[4]], [corners[1], corners[5]], [corners[2], corners[6]], [corners[3], corners[7]]
      ];
      try {
        BABYLON.MeshBuilder.CreateLineSystem(lines.name, { lines: edges, updatable: true, instance: lines });
      } catch {}
    }
  }

  function buildRotationContext({ axis = 'y', center = new BABYLON.Vector3(0, 0, 0), axisDir = null } = {}) {
    const selection = Array.from(state?.selection || []);
    if (!selection.length) return null;
    const spacesById = new Map((state?.barrow?.spaces || []).map((s) => [s.id, s]));
    const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
    const axisVec = axisDir?.clone?.() || (() => {
      switch (axis) {
        case 'x': return new BABYLON.Vector3(1, 0, 0);
        case 'z': return new BABYLON.Vector3(0, 0, 1);
        default: return new BABYLON.Vector3(0, 1, 0);
      }
    })();
    try { axisVec.normalize(); }
    catch {}
    const pivot = center?.clone?.() || new BABYLON.Vector3(0, 0, 0);
    const items = [];
    for (const id of selection) {
      const space = spacesById.get(id);
      if (!space) continue;
      if (space.vox && space.vox.size) continue;
      const entry = builtSpaces.find((x) => x && x.id === id);
      const mesh = entry?.mesh || null;
      if (!mesh) continue;
      try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
      let meshPos = null;
      try { meshPos = mesh.getAbsolutePosition ? mesh.getAbsolutePosition() : mesh.position; }
      catch { meshPos = mesh.position || null; }
      if (!meshPos) {
        meshPos = new BABYLON.Vector3(space.origin?.x || 0, space.origin?.y || 0, space.origin?.z || 0);
      }
      const meshPosVec = meshPos.clone ? meshPos.clone() : new BABYLON.Vector3(meshPos.x, meshPos.y, meshPos.z);
      const offset = meshPosVec.subtract(pivot);
      const meshStartQuat = (() => {
        try {
          if (mesh.rotationQuaternion) return mesh.rotationQuaternion.clone();
          if (mesh.rotation) return BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x || 0, mesh.rotation.y || 0, mesh.rotation.z || 0);
        } catch {}
        return BABYLON.Quaternion.Identity();
      })();
      const spaceRot = (() => {
        try {
          if (space.rotation && typeof space.rotation === 'object') {
            const rx = Number(space.rotation.x || 0) || 0;
            const ry = Number(space.rotation.y || space.rotY || 0) || 0;
            const rz = Number(space.rotation.z || 0) || 0;
            return BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
          }
        } catch {}
        const ry = Number(space.rotY || 0) || 0;
        return BABYLON.Quaternion.FromEulerAngles(0, ry, 0);
      })();
      const originVec = new BABYLON.Vector3(space.origin?.x || 0, space.origin?.y || 0, space.origin?.z || 0);
      items.push({
        id,
        space,
        mesh,
        startOffset: offset,
        meshStartPos: meshPosVec,
        meshStartQuat,
        spaceStartQuat: spaceRot,
        spaceStartOrigin: originVec,
        latestPos: meshPosVec.clone(),
        latestQuat: meshStartQuat.clone()
      });
    }
    if (!items.length) return null;
    return { axis, axisDir: axisVec, center: pivot, items, totalAngle: 0 };
  }

  _translationHandler = {
    begin() {
      return buildTranslationContext();
    },
    apply(context, totalDelta, deltaStep) {
    if (!context || !totalDelta || !deltaStep) return;
    if (context.spaceTargets?.length) {
      for (const target of context.spaceTargets) {
        const mesh = target?.mesh;
        const start = target?.startPos;
        if (!mesh || !start) continue;
        const newPos = new BABYLON.Vector3(
          start.x + totalDelta.x,
          start.y + totalDelta.y,
          start.z + totalDelta.z
        );
        try { mesh.setAbsolutePosition(newPos); }
        catch { try { mesh.position.copyFrom(newPos); } catch {} }
      }
      updateSelectionObbLiveForTargets(context.spaceTargets, { delta: totalDelta });
    }
    if (context.bounds && _selectionGizmo?.setBounds) {
      const min = context.bounds.min;
      const max = context.bounds.max;
      const offsetMin = {
        x: min.x + totalDelta.x,
        y: min.y + totalDelta.y,
        z: min.z + totalDelta.z
      };
      const offsetMax = {
        x: max.x + totalDelta.x,
        y: max.y + totalDelta.y,
        z: max.z + totalDelta.z
      };
      try {
        _selectionGizmo.setBounds({ min: offsetMin, max: offsetMax });
        const center = new BABYLON.Vector3(
          (offsetMin.x + offsetMax.x) / 2,
          (offsetMin.y + offsetMax.y) / 2,
          (offsetMin.z + offsetMax.z) / 2
        );
        _selectionGizmo.setPosition?.(center);
      } catch {}
    }
    const voxStep = deltaStep && deltaStep.lengthSquared() > 1e-6 ? deltaStep : null;
    if (voxStep) {
      for (const target of context.nodeTargets || []) {
        const mesh = target?.mesh;
        const start = target?.start;
        if (!mesh || !start) continue;
        start.addInPlace(voxStep);
        try { mesh.setAbsolutePosition(start); }
        catch { try { mesh.position.copyFrom(start); } catch {} }
      }
    }
    },
    cancel(context) {
      if (!context) return;
      if (context.spaceTargets?.length) {
        for (const target of context.spaceTargets) {
          const mesh = target?.mesh;
          const start = target?.startPos;
          if (!mesh || !start) continue;
          try { mesh.setAbsolutePosition(start.clone()); }
          catch { try { mesh.position.copyFrom(start); } catch {} }
        }
        updateSelectionObbLiveForTargets(context.spaceTargets);
        if (context.bounds && _selectionGizmo?.setBounds) {
          try {
            _selectionGizmo.setBounds({ min: context.bounds.min, max: context.bounds.max });
            const c = new BABYLON.Vector3(
              (context.bounds.min.x + context.bounds.max.x) / 2,
              (context.bounds.min.y + context.bounds.max.y) / 2,
              (context.bounds.min.z + context.bounds.max.z) / 2
            );
            _selectionGizmo.setPosition?.(c);
          } catch {}
        }
      }
    },
    commit(context, totalDelta) {
      if (!context || !totalDelta) return;
      if (context.spaceTargets?.length) {
        const selectionArray = Array.from(state?.selection || []);
        for (const target of context.spaceTargets) {
          const space = target?.space;
          if (!space) continue;
          const originBase = target.origin || { x: 0, y: 0, z: 0 };
          let nx = originBase.x + totalDelta.x;
          let ny = originBase.y + totalDelta.y;
          let nz = originBase.z + totalDelta.z;
          try {
            if (space.vox && space.vox.size) {
              const res = space.vox?.res || space.res || (state?.barrow?.meta?.voxelSize || 1);
              const snap = (v) => { const r = Math.max(1e-6, Number(res) || 0); return Math.round(v / r) * r; };
              nx = snap(nx); ny = snap(ny); nz = snap(nz);
            }
          } catch {}
          space.origin = { x: nx, y: ny, z: nz };
        }
        try { saveBarrow(state.barrow); snapshot(state.barrow); } catch (e) { logErr('EH:gizmo2:commitSave', e); }
        try { renderDbView(state.barrow); } catch (e) { logErr('EH:gizmo2:commitDb', e); }
        try { rebuildScene?.(); } catch (e) { logErr('EH:gizmo2:commitRebuild', e); }
        try { scheduleGridUpdate?.(); } catch (e) { logErr('EH:gizmo2:commitGrid', e); }
        try {
          window.dispatchEvent(new CustomEvent('dw:transform', {
            detail: { kind: 'move', dx: totalDelta.x, dy: totalDelta.y, dz: totalDelta.z, selection: selectionArray }
          }));
        } catch {}
        setTimeout(() => updateSelectionGizmo(), 0);
        updateSelectionObbLiveForTargets(context.spaceTargets, { useSpaceOrigin: true });
      }
    }
  };

  _rotationHandler = {
    begin(opts = {}) {
      return buildRotationContext(opts);
    },
    apply(context, totalAngle, deltaAngle, opts = {}) {
      if (!context || !context.items?.length) return;
      if (!isFinite(totalAngle) || !isFinite(deltaAngle)) return;
      context.totalAngle = totalAngle;
      const axisDir = opts?.axisDir?.clone?.() || context.axisDir.clone();
      try { axisDir.normalize(); } catch {}
      context.axisDir = axisDir;
      if (opts?.axis) context.axis = opts.axis;
      const quat = BABYLON.Quaternion.RotationAxis(axisDir, totalAngle);
      const rotMatrix = BABYLON.Matrix.Identity();
      quat.toRotationMatrix(rotMatrix);
      const pivot = context.center.clone();
      for (const item of context.items) {
        if (!item) continue;
        const rotatedOffset = BABYLON.Vector3.TransformCoordinates(item.startOffset, rotMatrix);
        const newPos = pivot.clone();
        newPos.addInPlace(rotatedOffset);
        const newQuat = quat.multiply(item.spaceStartQuat);
        item.latestPos = newPos;
        item.latestQuat = newQuat;
        const mesh = item.mesh;
        if (mesh && !mesh.isDisposed?.()) {
          try {
            if (typeof mesh.setAbsolutePosition === 'function') mesh.setAbsolutePosition(newPos.clone());
            else mesh.position.copyFrom(newPos);
          } catch {}
          mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
          try { mesh.rotationQuaternion.copyFrom(newQuat); } catch {}
          try { mesh.rotation.set(0, 0, 0); } catch {}
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
        }
      }
    },
    cancel(context) {
      if (!context || !context.items?.length) return;
      for (const item of context.items) {
        if (!item) continue;
        const mesh = item.mesh;
        if (mesh && !mesh.isDisposed?.()) {
          try {
            if (typeof mesh.setAbsolutePosition === 'function') mesh.setAbsolutePosition(item.meshStartPos.clone());
            else mesh.position.copyFrom(item.meshStartPos);
          } catch {}
          mesh.rotationQuaternion = mesh.rotationQuaternion || new BABYLON.Quaternion();
          try { mesh.rotationQuaternion.copyFrom(item.meshStartQuat); } catch {}
          try { mesh.rotation.set(0, 0, 0); } catch {}
          try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
        }
      }
    },
    commit(context, totalAngle, opts = {}) {
      if (!context || !context.items?.length) return;
      if (!isFinite(totalAngle)) return;
      const axisDir = opts?.axisDir?.clone?.() || context.axisDir.clone();
      try { axisDir.normalize(); } catch {}
      if (opts?.axis) context.axis = opts.axis;
      const quat = BABYLON.Quaternion.RotationAxis(axisDir, totalAngle);
      const rotMatrix = BABYLON.Matrix.Identity();
      quat.toRotationMatrix(rotMatrix);
      const pivot = context.center.clone();
      let changed = false;
      for (const item of context.items) {
        if (!item?.space) continue;
        const rotatedOffset = BABYLON.Vector3.TransformCoordinates(item.startOffset, rotMatrix);
        const newPos = pivot.clone();
        newPos.addInPlace(rotatedOffset);
        const newQuat = quat.multiply(item.spaceStartQuat);
        const euler = newQuat.toEulerAngles();
        if (!item.space.rotation || typeof item.space.rotation !== 'object') {
          item.space.rotation = { x: 0, y: 0, z: 0 };
        }
        item.space.rotation.x = euler.x;
        item.space.rotation.y = euler.y;
        item.space.rotation.z = euler.z;
        item.space.rotY = euler.y;
        item.space.origin = { x: newPos.x, y: newPos.y, z: newPos.z };
        changed = true;
      }
      if (!changed) return;
      try { saveBarrow(state.barrow); snapshot(state.barrow); } catch (e) { logErr('EH:gizmo2:rotate:save', e); }
      try { renderDbView(state.barrow); } catch (e) { logErr('EH:gizmo2:rotate:db', e); }
      try { rebuildScene?.(); } catch (e) { logErr('EH:gizmo2:rotate:rebuild', e); }
      try { scheduleGridUpdate?.(); } catch (e) { logErr('EH:gizmo2:rotate:grid', e); }
      try {
        window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'rotate', axis: context.axis, angle: totalAngle, selection: Array.from(state.selection || []) } }));
      } catch {}
      setTimeout(() => updateSelectionGizmo(), 0);
    }
  };

  const connectGizmo = initConnectGizmo({
    scene,
    engine,
    camera,
    state,
    renderDbView,
    saveBarrow,
    snapshot,
    scheduleGridUpdate,
    rebuildScene
  });

  initSelectionGizmo();
  updateSelectionGizmo();

  const moveWidgetProxy = {
    get dragging() {
      const info = _selectionGizmo?.getDragState?.();
      if (!info || !info.active) return false;
      return info.kind === 'axis' || info.kind === 'plane';
    },
    get preDrag() { return false; }
  };

  const rotWidgetProxy = {
    get dragging() {
      const info = _selectionGizmo?.getDragState?.();
      if (!info || !info.active) return false;
      return info.kind === 'rotation';
    },
    get preDrag() { return false; }
  };

  function suppressSelectionGizmo(on) {
    _gizmosSuppressed = !!on;
    if (_gizmosSuppressed) {
      try { _selectionGizmo?.setActive(false); } catch {}
    } else {
      updateSelectionGizmo();
    }
  }

  function ensureSelectionWidgets() {
    if (_gizmosSuppressed) return;
    updateSelectionGizmo();
  }

  function disposeSelectionWidgets() {
    try { _selectionGizmo?.setActive(false); } catch {}
  }

  try {
    window.addEventListener('dw:gizmos:disable', () => suppressSelectionGizmo(true));
    window.addEventListener('dw:gizmos:enable', () => suppressSelectionGizmo(false));
  } catch {}

  function updateSelectionGizmo() {
    if (!_selectionGizmo) return;
    const setRotationEnabled = (on) => {
      try { _selectionGizmo.setGroupEnabled('rotate:x', on); } catch {}
      try { _selectionGizmo.setGroupEnabled('rotate:y', on); } catch {}
      try { _selectionGizmo.setGroupEnabled('rotate:z', on); } catch {}
    };
    const connectSelSize = (() => {
      try {
        const sel = state?._connect?.sel;
        if (sel instanceof Set) return sel.size;
        if (Array.isArray(sel)) return sel.length;
      } catch {}
      return 0;
    })();
    if (connectSelSize > 0) {
      try { connectGizmo?.ensureConnectGizmoFromSel?.(); } catch {}
      setRotationEnabled(false);
      try {
        _selectionGizmo.setGroupEnabled('move:x', false);
        _selectionGizmo.setGroupEnabled('move:z', false);
        _selectionGizmo.setGroupEnabled('plane:ground', false);
      } catch {}
      try { _selectionGizmo.setActive(false); } catch {}
      try { Log.log('GIZMO_2', 'selection:gizmo:suppressedForConnect', { connectSelSize }); } catch {}
      return;
    }
    try { connectGizmo?.ensureConnectGizmoFromSel?.(); } catch {}
    const bounds = gatherSelectionTargets();
    if (!bounds) {
      setRotationEnabled(false);
      try { Log.log('GIZMO_2', 'selection:gizmo:update', { active: false, reason: 'no-bounds', selection: Array.from(state?.selection || []), connect: state?._connect?.sel ? Array.from(state._connect.sel) : [] }); } catch {}
      _selectionGizmo.setActive(false);
      return;
    }
    const selectionSize = (() => {
      if (state?.selection instanceof Set) return state.selection.size;
      if (Array.isArray(state?.selection)) return state.selection.length;
      return 0;
    })();
    const enableRotation = selectionSize > 0 && !bounds.hasVox;
    setRotationEnabled(enableRotation);
    try { _selectionGizmo.setGroupEnabled(`move:x`, !bounds.hasVox); } catch {}
    try { _selectionGizmo.setGroupEnabled(`move:z`, !bounds.hasVox); } catch {}
    try { _selectionGizmo.setGroupEnabled(`plane:ground`, !bounds.hasVox); } catch {}
    try { _selectionGizmo.setGroupEnabled(`plane:ground`, true); } catch {}
    try {
      _selectionGizmo.setBounds(bounds);
      _selectionGizmo.setActive(true);
      try { Log.log('GIZMO_2', 'selection:gizmo:update', { active: true, bounds }); } catch {}
    } catch (e) { logErr('EH:gizmo2:update', e); }
  }

  window.addEventListener('dw:selectionChange', () => updateSelectionGizmo());
  window.addEventListener('dw:connect:update', () => updateSelectionGizmo());
  window.addEventListener('dw:transform', () => updateSelectionGizmo());

  setTimeout(() => updateSelectionGizmo(), 0);

  const api = {
    // exposure for UI module
    isGizmosSuppressed: () => _gizmosSuppressed,
    getRotWidget: () => rotWidgetProxy,
    getMoveWidget: () => moveWidgetProxy,
    ensureRotWidget: ensureSelectionWidgets,
    ensureMoveWidget: ensureSelectionWidgets,
    disposeRotWidget: disposeSelectionWidgets,
    disposeMoveWidget: disposeSelectionWidgets,
    pickPointOnPlane: (normal, point) => pickPointOnPlane(normal || new BABYLON.Vector3(0, 1, 0), point || new BABYLON.Vector3(0, 0, 0)),
    disposeLiveIntersections: noop,
    updateLiveIntersectionsFor: noop,
    updateSelectionObbLive: noop,
    updateContactShadowPlacement: noop,
    ensureConnectGizmoFromSel: () => { try { connectGizmo?.ensureConnectGizmoFromSel?.(); } catch {} },
    disposeConnectGizmo: () => { try { connectGizmo?.disposeConnectGizmo?.(); } catch {} },
    setGizmoHudVisible: noop,
    setTargetDotVisible: _viewApi?.setTargetDotVisible,
    isTargetDotVisible: _viewApi?.isTargetDotVisible,
    enterCavernModeForSpace: (id) => { try { _cavernApi?.enterCavernModeForSpace?.(id); } catch { } },
    exitCavernMode: () => { try { _cavernApi?.exitCavernMode?.(); } catch { } },
    exitScryMode,
    voxelHitAtPointerForSpace: (s) => { try { return _vox?.voxelHitAtPointerForSpace?.(s) || null; } catch { return null; } },
  };
  try { state._sceneApi = api; } catch {}
  state._selectionGizmo = _selectionGizmo;
  state._selectionGizmoUpdate = updateSelectionGizmo;
  return api;
}
