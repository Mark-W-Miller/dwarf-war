// Camera setup and helpers (zoom/pan dynamics, fit/center)

export function initCamera(scene, canvas, Log) {
  const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 24, new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  // Enforce Y-up: never allow upside-down or roll
  camera.upVector = new BABYLON.Vector3(0, 1, 0);
  camera.allowUpsideDown = false;
  camera.lowerBetaLimit = 0.01;
  camera.upperBetaLimit = Math.PI - 0.01;
  camera.lowerRadiusLimit = 2; camera.upperRadiusLimit = 5000;
  camera.minZ = 0.1; camera.maxZ = 10000;
  camera.wheelPrecision = 1; // percentage-based zoom
  camera.panningMouseButton = 2; // right-button pan
  camera.panningSensibility = 40;
  camera.panningInertia = 0.2;

  function getZoomBase(){ return Number(localStorage.getItem('dw:ui:zoomBase') || '30') || 30; }
  function getPanBase(){ return Number(localStorage.getItem('dw:ui:panBase') || '200') || 200; }

  function applyZoomBase(){
    const base = getZoomBase();
    const pct = Math.max(0.001, Math.min(0.08, base / 2000));
    camera.wheelDeltaPercentage = pct;
    camera.pinchDeltaPercentage = pct;
    if (Log) Log.log('UI', 'Apply zoom base', { base, wheelDeltaPercentage: pct });
  }

  function applyPanBase(){
    const base = getPanBase();
    const baseSens = Math.max(1, 300 / base);
    camera.panningSensibility = baseSens;
    if (Log) Log.log('UI', 'Apply pan base', { panBase: base, panningSensibility: camera.panningSensibility });
  }

  function updatePanDynamics(){
    const panBase = getPanBase();
    const r = Math.max(1, camera.radius);
    const f = Math.max(0.2, r / 100);
    const baseSens = Math.max(1, 300 / panBase);
    camera.panningSensibility = Math.max(1, baseSens / f);
  }

  function centerOnMesh(mesh) {
    const bb = mesh.getBoundingInfo()?.boundingBox;
    const min = bb?.minimumWorld, max = bb?.maximumWorld;
    if (min && max) {
      const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
      const spanX = max.x - min.x, spanY = max.y - min.y, spanZ = max.z - min.z;
      const span = Math.max(spanX, spanY, spanZ);
      const radius = Math.max(10, span * 0.9 + 10);
      camera.target.set(cx, cy, cz);
      camera.radius = radius;
      if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
      if (Log) Log.log('UI', 'Center on item', { name: mesh.name, center: { x: cx, y: cy, z: cz }, span: { x: spanX, y: spanY, z: spanZ }, radius });
    } else {
      camera.target.copyFrom(mesh.position);
      if (Log) Log.log('UI', 'Center on item', { name: mesh.name, center: mesh.position });
    }
  }

  function fitViewAll(spaces, voxelSize = 1) {
    if (!spaces || !spaces.length) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const s of spaces) {
      const res = s.res || voxelSize;
      const w = (s.size?.x||0) * res, h = (s.size?.y||0) * res, d = (s.size?.z||0) * res;
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      minX = Math.min(minX, cx - w/2); maxX = Math.max(maxX, cx + w/2);
      minY = Math.min(minY, cy - h/2); maxY = Math.max(maxY, cy + h/2);
      minZ = Math.min(minZ, cz - d/2); maxZ = Math.max(maxZ, cz + d/2);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const radius = Math.max(10, span * 0.8 + 10);
    camera.target.set(cx, cy, cz);
    camera.radius = radius;
    if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
    if (Log) Log.log('UI', 'Fit view', { center: { x: cx, y: cy, z: cz }, span, radius });
  }

  return { camera, applyZoomBase, applyPanBase, getZoomBase, getPanBase, updatePanDynamics, centerOnMesh, fitViewAll };
}
