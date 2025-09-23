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

  // When zoomed to max magnification (radius at lower limit), use wheel to dolly forward instead of doing nothing
  (function attachWheelDolly(){
    let _lastCamWheelLog = 0;
    let _dollyLatchUntil = 0; // time until which we keep dollying regardless of nearMin
    function onWheel(e){
      try {
        const minR = camera.lowerRadiusLimit || 0;
        const tol = Math.max(0.12, minR * 0.15); // generous tolerance near min
        const nearMin = (camera.radius - minR) <= tol;
        const zoomIn = (e && typeof e.deltaY === 'number') ? (e.deltaY < 0) : false;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        // Throttled raw wheel trace
        try {
          if (Log && now - _lastCamWheelLog > 180) {
            _lastCamWheelLog = now;
            Log.log('CAMERA', 'wheel:raw', { deltaY: e?.deltaY ?? null, radius: camera.radius, lower: minR, tol, nearMin, zoomIn });
          }
        } catch {}
        const latchActive = now < _dollyLatchUntil;
        if (zoomIn && (nearMin || latchActive)) {
          // Cancel any residual zoom inertia so it doesn't "fight" the dolly
          try { camera.inertialRadiusOffset = 0; } catch {}
          // Hard clamp radius to min so we remain in dolly mode across events
          try {
            if (camera.radius > minR) {
              camera.radius = minR;
              if (Log) Log.log('CAMERA', 'wheel:clamp', { radius: camera.radius, lower: minR });
            }
          } catch {}
          // Compute a forward dolly step proportional to wheel delta and a base tied to scene scale
          let speed = 1.0;
          try {
            const raw = Number(localStorage.getItem('dw:ui:dollySpeed')||'100');
            if (isFinite(raw) && raw > 0) speed = (raw > 5) ? (raw / 100) : raw; // accept percent or multiplier
          } catch {}
          const mag = Math.max(1, Math.abs(e.deltaY || 0));
          const base = Math.max(0.5, Math.max(0.25, camera.radius * 0.18));
          const stepRaw = (mag * 0.0025) * base * speed;
          const step = Math.min(100, Math.max(0.15, stepRaw * 4)); // 4x faster (doubled again)
          const dir = camera.getForwardRay()?.direction || new BABYLON.Vector3(0,0,1);
          const t0 = camera.target.clone ? camera.target.clone() : new BABYLON.Vector3(camera.target.x, camera.target.y, camera.target.z);
          const t1 = t0.add(dir.scale(step));
          camera.target = t1;
          // Latch dolly mode for a short duration to keep movement continuous across events
          _dollyLatchUntil = now + 320; // ms
          try { if (Log) Log.log('CAMERA', 'wheel:dolly', { step, speed, base, from: { x: t0.x, y: t0.y, z: t0.z }, to: { x: t1.x, y: t1.y, z: t1.z }, latch: true }); } catch {}
          // Block default zoom handler so we only dolly
          try { e.preventDefault(); e.stopImmediatePropagation?.(); e.stopPropagation(); } catch {}
        } else {
          if (!zoomIn) {
            // Leaving dolly mode on zoom-out
            _dollyLatchUntil = 0;
          }
          try { if (Log) Log.log('CAMERA', 'wheel:pass', { reason: (!zoomIn ? 'notZoomIn' : 'notNearMin'), radius: camera.radius, lower: minR }); } catch {}
        }
      } catch {}
    }
    try { canvas.addEventListener('wheel', onWheel, { passive: false, capture: true }); } catch {}
  })();

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
      const radius = Math.max(10, span * 1.3 + 15);
      camera.target.set(cx, cy, cz);
      camera.radius = radius;
      if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
      // Ensure far clip exceeds scene span
      const desiredMaxZ = Math.max(1000, radius * 3);
      if (camera.maxZ < desiredMaxZ) camera.maxZ = desiredMaxZ;
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
    const radius = Math.max(10, span * 1.3 + 15);
    camera.target.set(cx, cy, cz);
    camera.radius = radius;
    if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
    // Ensure far clip exceeds scene span
    const desiredMaxZ = Math.max(1000, radius * 3);
    if (camera.maxZ < desiredMaxZ) camera.maxZ = desiredMaxZ;
    if (Log) Log.log('UI', 'Fit view', { center: { x: cx, y: cy, z: cz }, span, radius });
  }

  // Fit view prioritizing caverns' center of mass for target while sizing radius from spaces extents
  function fitViewSmart(barrow) {
    try {
      const spaces = Array.isArray(barrow?.spaces) ? barrow.spaces : [];
      // Compute extents as before over spaces
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const voxelSize = barrow?.meta?.voxelSize || 1;
      for (const s of spaces) {
        const res = s.res || voxelSize;
        const w = (s.size?.x||0) * res, h = (s.size?.y||0) * res, d = (s.size?.z||0) * res;
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        minX = Math.min(minX, cx - w/2); maxX = Math.max(maxX, cx + w/2);
        minY = Math.min(minY, cy - h/2); maxY = Math.max(maxY, cy + h/2);
        minZ = Math.min(minZ, cz - d/2); maxZ = Math.max(maxZ, cz + d/2);
      }
      if (!isFinite(minX) || !isFinite(maxX)) { if (spaces.length) return fitViewAll(spaces, voxelSize); }
      const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      const radius = Math.max(10, span * 1.3 + 15);
      // Center on caverns COM when available; fallback to spaces mid-point
      let tx, ty, tz;
      const cavs = Array.isArray(barrow?.caverns) ? barrow.caverns : [];
      const haveCav = cavs.length > 0;
      if (haveCav) {
        let cx = 0, cy = 0, cz = 0, n = 0;
        for (const c of cavs) {
          const p = c?.pos; if (!p) continue; cx += (p.x||0); cy += (p.y||0); cz += (p.z||0); n++;
        }
        if (n > 0) { tx = cx / n; ty = cy / n; tz = cz / n; }
      }
      if (!(isFinite(tx) && isFinite(ty) && isFinite(tz))) {
        tx = (minX + maxX) / 2; ty = (minY + maxY) / 2; tz = (minZ + maxZ) / 2;
      }
      camera.target.set(tx, ty, tz);
      camera.radius = radius;
      if (camera.upperRadiusLimit < radius * 1.2) camera.upperRadiusLimit = radius * 1.2;
      const desiredMaxZ = Math.max(1000, radius * 3);
      if (camera.maxZ < desiredMaxZ) camera.maxZ = desiredMaxZ;
      if (Log) Log.log('UI', 'Fit view (smart)', { target: { x: tx, y: ty, z: tz }, span, radius, used: haveCav ? 'cavernsCOM' : 'spacesMid' });
    } catch (e) { try { if (Log) Log.log('ERROR', 'fitViewSmart', { error: String(e) }); } catch {} }
  }

  return { camera, applyZoomBase, applyPanBase, getZoomBase, getPanBase, updatePanDynamics, centerOnMesh, fitViewAll, fitViewSmart };
}
