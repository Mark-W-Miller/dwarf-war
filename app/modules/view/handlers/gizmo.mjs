// Gizmo input handling (priority/capture to prevent camera rotation) extracted from eventHandler.mjs
import { Log } from '../../util/log.mjs';

// Pre-pointer capture for gizmo priority (connect/move/rot)
export function initGizmoHandlers({ scene, engine, camera, state }) {
  try {
    // Pre-pointer observer to prioritize gizmo parts over camera gestures
    scene.onPrePointerObservable.add((pi) => {
      try {
        if (state.mode !== 'edit') return;
        if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
        const ev = pi.event || window.event;
        // Ignore gizmo when modifiers are active (spec: modifiers bypass gizmo)
        if (ev && (ev.metaKey || ev.shiftKey || ev.ctrlKey || ev.altKey)) return;
        // Priority: connect gizmo → move disc/axes → rot rings
        const hitConnect = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('connectGizmo:'));
        let handled = false;
        if (hitConnect?.hit) handled = true;
        if (!handled) {
          const hitMoveDisc = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:'));
          const hitMove = hitMoveDisc?.hit ? hitMoveDisc : scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
          if (hitMove?.hit) handled = true;
        }
        if (!handled) {
          const hitRot = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
          if (hitRot?.hit) handled = true;
        }
        if (!handled) return;
        // Detach camera so it doesn't rotate; capture pointer to canvas
        try {
          const canvas = engine.getRenderingCanvas();
          camera.inputs?.attached?.pointers?.detachControl(canvas);
          if (ev && ev.pointerId != null && canvas && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
          Log.log('GIZMO', 'pre-capture', { name: (hitConnect?.pickedMesh?.name || (hitMove?.pickedMesh?.name) || (hitRot?.pickedMesh?.name) || '') });
        } catch {}
      } catch {}
    });
    // Release camera control on pointerup/cancel
    const release = () => {
      try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
    };
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
  } catch {}
}

// Transform gizmos (rotate/move) — build/teardown and helpers
export function initTransformGizmos({ scene, engine, camera, state, renderDbView, saveBarrow, snapshot, scheduleGridUpdate, rebuildScene, helpers = {} }) {
  // HUD helpers
  let _gizmoHudEl = null;
  function ensureGizmoHud() {
    if (_gizmoHudEl && document.body.contains(_gizmoHudEl)) return _gizmoHudEl;
    const el = document.createElement('div'); el.id = 'gizmoHud';
    el.style.position = 'absolute'; el.style.left = '10px'; el.style.top = '32px';
    el.style.background = 'rgba(10,14,18,0.85)'; el.style.border = '1px solid #1e2a30'; el.style.borderRadius = '6px';
    el.style.padding = '6px 8px'; el.style.color = '#e3edf3'; el.style.fontSize = '11px'; el.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    el.style.pointerEvents = 'none'; el.style.zIndex = '9999'; el.style.display = 'none';
    el.textContent = 'Gizmo Live';
    document.body.appendChild(el); _gizmoHudEl = el; return el;
  }
  function setGizmoHudVisible(v) { try { ensureGizmoHud().style.display = v ? 'block' : 'none'; } catch {} }
  function renderGizmoHud({ selCount=0, center=null, deltaDeg=null, pickMode='-' }={}) {
    try {
      const el = ensureGizmoHud();
      const c = center ? { x: Number(center.x||0).toFixed(2), y: Number(center.y||0).toFixed(2), z: Number(center.z||0).toFixed(2) } : { x: '-', y: '-', z: '-' };
      const d = (deltaDeg == null || !isFinite(deltaDeg)) ? '-' : String(Math.round(deltaDeg));
      el.innerHTML = `
        <div style="opacity:0.8; font-weight:600; margin-bottom:2px;">Gizmo Live</div>
        <div>Sel: ${selCount}</div>
        <div>Center: ${c.x}, ${c.y}, ${c.z}</div>
        <div>Δ: ${d}°</div>
        <div>Mode: ${pickMode}</div>
      `;
    } catch {}
  }

  // Rotation widget state and API
  let rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '', mStartX: 0, mStartY: 0 };
  function disposeRotWidget() {
    try { for (const k of ['x','y','z']) { try { rotWidget.meshes[k]?.dispose?.(); } catch {} } try { rotWidget.groupNode?.dispose?.(); } catch {} Log.log('GIZMO', 'Dispose rot widget', { id: rotWidget.spaceId }); } catch {}
    rotWidget = { meshes: { x: null, y: null, z: null }, mats: { x: null, y: null, z: null }, axis: 'y', activeAxis: null, spaceId: null, dragging: false, preDrag: false, downX: 0, downY: 0, startAngle: 0, startRot: 0, lastRot: 0, baseDiam: { x: 0, y: 0, z: 0 }, startQuat: null, axisLocal: null, refLocal: null, group: false, groupIDs: [], groupCenter: null, groupNode: null, startById: null, axisWorld: null, refWorld: null, groupKey: '' };
  }
  function ensureRotWidget() {
    try {
      // Mode/suppression handled outside — caller should skip in cavern mode
      const sel = Array.from(state.selection || []).filter(id => (state?.built?.spaces || []).some(x => x.id === id));
      if (sel.length < 1) { disposeRotWidget(); return; }
      // Suppress for voxelized spaces
      try { const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s])); const anyVox = sel.some(id => !!byId.get(id)?.vox); if (anyVox) { disposeRotWidget(); return; } } catch {}
      const isGroup = sel.length > 1; const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0];
      const builtSpaces = (state?.built?.spaces || []); const entries = builtSpaces.filter(x => sel.includes(x.id)); if (entries.length < 1) { disposeRotWidget(); return; }
      const primary = entries[0]; const mesh = primary.mesh;
      // Bounds and COM
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity; let com = new BABYLON.Vector3(0,0,0); let mass=0;
      for (const e of entries) { try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}; const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue; const bmin = bb.minimumWorld, bmax = bb.maximumWorld; minX=Math.min(minX,bmin.x); minY=Math.min(minY,bmin.y); minZ=Math.min(minZ,bmin.z); maxX=Math.max(maxX,bmax.x); maxY=Math.max(maxY,bmax.y); maxZ=Math.max(maxZ,bmax.z); const cx=(bmin.x+bmax.x)/2, cy=(bmin.y+bmax.y)/2, cz=(bmin.z+bmax.z)/2; const dx=(bmax.x-bmin.x), dy=(bmax.y-bmin.y), dz=(bmax.z-bmin.z); const m=Math.max(1e-6, dx*dy*dz); com.x+=cx*m; com.y+=cy*m; com.z+=cz*m; mass+=m; }
      if (!isFinite(minX) || !isFinite(maxX)) { disposeRotWidget(); return; }
      if (mass > 0) { com.x/=mass; com.y/=mass; com.z/=mass; }
      const halfX=Math.max(0.1,(maxX-minX)/2), halfY=Math.max(0.1,(maxY-minY)/2), halfZ=Math.max(0.1,(maxZ-minZ)/2);
      const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100; const gScale=Math.max(0.1,scalePct/100);
      const radY=Math.max(halfX,halfZ)*1.05*gScale, radX=Math.max(halfY,halfZ)*1.05*gScale, radZ=Math.max(halfX,halfY)*1.05*gScale;
      const thicknessY=Math.max(0.08,radY*0.0625), thicknessX=Math.max(0.08,radX*0.0625), thicknessZ=Math.max(0.08,radZ*0.0625);
      const id = primary.id;
      if (!rotWidget.meshes.y || rotWidget.group !== isGroup || rotWidget.groupKey !== groupKey || (rotWidget.meshes.y.isDisposed && rotWidget.meshes.y.isDisposed())) {
        disposeRotWidget();
        const diamY = radY * 2; const ringY = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Y:${isGroup ? 'group' : id}`, { diameter: diamY, thickness: thicknessY, tessellation: 96 }, scene);
        const matY = new BABYLON.StandardMaterial(`rotGizmo:Y:${id}:mat`, scene); matY.emissiveColor = new BABYLON.Color3(0.2, 0.95, 0.2); matY.diffuseColor = new BABYLON.Color3(0,0,0); matY.specularColor = new BABYLON.Color3(0,0,0); ringY.material = matY; ringY.isPickable = true; ringY.renderingGroupId = 2; ringY.alwaysSelectAsActiveMesh = true;
        const diamX = radX * 2; const ringX = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:X:${isGroup ? 'group' : id}`, { diameter: diamX, thickness: thicknessX, tessellation: 96 }, scene);
        const matX = new BABYLON.StandardMaterial(`rotGizmo:X:${id}:mat`, scene); matX.emissiveColor = new BABYLON.Color3(0.95, 0.2, 0.2); matX.diffuseColor = new BABYLON.Color3(0,0,0); matX.specularColor = new BABYLON.Color3(0,0,0); ringX.material = matX; ringX.isPickable = true; ringX.renderingGroupId = 2; ringX.alwaysSelectAsActiveMesh = true; ringX.rotation.z = Math.PI/2;
        const diamZ = radZ * 2; const ringZ = BABYLON.MeshBuilder.CreateTorus(`rotGizmo:Z:${isGroup ? 'group' : id}`, { diameter: diamZ, thickness: thicknessZ, tessellation: 96 }, scene);
        const matZ = new BABYLON.StandardMaterial(`rotGizmo:Z:${id}:mat`, scene); matZ.emissiveColor = new BABYLON.Color3(0.2, 0.45, 0.95); matZ.diffuseColor = new BABYLON.Color3(0,0,0); matZ.specularColor = new BABYLON.Color3(0,0,0); ringZ.material = matZ; ringZ.isPickable = true; ringZ.renderingGroupId = 2; ringZ.alwaysSelectAsActiveMesh = true; ringZ.rotation.x = Math.PI/2;
        rotWidget.meshes = { x: ringX, y: ringY, z: ringZ }; rotWidget.mats = { x: matX, y: matY, z: matZ }; rotWidget.spaceId = id; rotWidget.group = isGroup; rotWidget.groupIDs = sel.slice(); rotWidget.groupKey = groupKey; rotWidget.baseDiam = { x: diamX, y: diamY, z: diamZ };
        try { ringX.parent = null; ringY.parent = null; ringZ.parent = null; ringX.position.copyFrom(com); ringY.position.copyFrom(com); ringZ.position.copyFrom(com); } catch {}
      }
      return;
    } catch (e) { try { disposeRotWidget(); } catch {} }
  }
  function updateRotWidgetFromMesh(mesh) {
    if (!rotWidget?.meshes?.y || !mesh || rotWidget.dragging) return;
    try { const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) return; const min = bb.minimumWorld, max = bb.maximumWorld; const halfX = Math.max(0.1,(max.x-min.x)/2), halfY=Math.max(0.1,(max.y-min.y)/2), halfZ=Math.max(0.1,(max.z-min.z)/2); const radY=Math.max(halfX,halfZ)*1.05; const radX=Math.max(halfY,halfZ)*1.05; const radZ=Math.max(halfX,halfY)*1.05; const desiredX=Math.max(0.001,radX*2), desiredY=Math.max(0.001,radY*2), desiredZ=Math.max(0.001,radZ*2); const sx=Math.max(0.001,desiredX/(rotWidget.baseDiam.x||desiredX)); const sy=Math.max(0.001,desiredY/(rotWidget.baseDiam.y||desiredY)); const sz=Math.max(0.001,desiredZ/(rotWidget.baseDiam.z||desiredZ)); rotWidget.meshes.x.scaling.set(sx,sx,sx); rotWidget.meshes.y.scaling.set(sy,sy,sy); rotWidget.meshes.z.scaling.set(sz,sz,sz); rotWidget.meshes.x.position.set(0,0,0); rotWidget.meshes.y.position.set(0,0,0); rotWidget.meshes.z.position.set(0,0,0); } catch {}
  }
  function setRingsDim() { try { const mats = rotWidget?.mats || {}; const dims = 0.35; for (const k of ['x','y','z']) { const m = mats[k]; if (!m) continue; const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1)); m.emissiveColor = base.scale(dims); m.diffuseColor = base.scale(0.05 + 0.15 * dims); } rotWidget.activeAxis = null; } catch {} }
  function setRingActive(axis) { try { const mats = rotWidget?.mats || {}; const kActive = 1.1, kDim = 0.35; for (const k of ['x','y','z']) { const m = mats[k]; if (!m) continue; const base = (m.metadata && m.metadata.baseColor) ? m.metadata.baseColor : (m.emissiveColor || new BABYLON.Color3(1,1,1)); const kf = (k === axis) ? kActive : kDim; m.emissiveColor = base.scale(kf); m.diffuseColor = base.scale(0.05 + 0.15 * kf); } rotWidget.activeAxis = axis; } catch {} }

  // Move widget state and API
  let moveWidget = { mesh: null, root: null, arrowMeshes: [], disc: null, spaceId: null, dragging: false, preDrag: false, mode: 'axis', downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, planeY: 0, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '', axis: null, axisStart: 0 };
  function disposeMoveWidget() { try { try { for (const m of moveWidget.arrowMeshes || []) { try { m.dispose(); } catch {} } } catch {} moveWidget.arrowMeshes = []; try { moveWidget.disc?.dispose?.(); } catch {} if (moveWidget.root) { try { moveWidget.root.dispose(); } catch {} } try { (scene.meshes||[]).filter(m => (m?.name||'').startsWith('moveGizmo:')).forEach(m => { try { m.dispose(); } catch {} }); } catch {} } catch {} moveWidget = { mesh: null, root: null, arrowMeshes: [], disc: null, spaceId: null, dragging: false, preDrag: false, mode: 'axis', downX: 0, downY: 0, startPoint: null, startOrigin: null, offsetVec: null, planeNormal: null, planeY: 0, group: false, groupIDs: [], groupCenter: null, startCenter: null, startById: null, groupKey: '', axis: null, axisStart: 0 }; }
  function ensureMoveWidget() {
    try {
      const sel = Array.from(state.selection || []); const builtSpaces = (state?.built?.spaces || []); const entries = builtSpaces.filter(x => sel.includes(x.id)); if (entries.length < 1) { disposeMoveWidget(); return; }
      const isGroup = sel.length > 1; const groupKey = isGroup ? sel.slice().sort().join(',') : sel[0]; let id = entries[0].id; let rad = 1; let center = null; let planeY = 0;
      if (isGroup) {
        let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity; let cx=0,cy=0,cz=0,mass=0;
        for (const e of entries) { try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}; const bb=e.mesh.getBoundingInfo()?.boundingBox; if(!bb)continue; const bmin=bb.minimumWorld,bmax=bb.maximumWorld; minX=Math.min(minX,bmin.x);maxX=Math.max(maxX,bmax.x);minY=Math.min(minY,bmin.y);maxY=Math.max(maxY,bmax.y);minZ=Math.min(minZ,bmin.z);maxZ=Math.max(maxZ,bmax.z); const cxi=(bmin.x+bmax.x)/2, cyi=(bmin.y+bmax.y)/2, czi=(bmin.z+bmax.z)/2; const dx=(bmax.x-bmin.x), dy=(bmax.y-bmin.y), dz=(bmax.z-bmin.z); const m=Math.max(1e-6, dx*dy*dz); cx+=cxi*m; cy+=cyi*m; cz+=czi*m; mass+=m; }
        if (mass>0){cx/=mass;cy/=mass;cz/=mass;} center=new BABYLON.Vector3(cx,cy,cz); const halfX=Math.max(0.1,(maxX-minX)/2); const halfZ=Math.max(0.1,(maxZ-minZ)/2); rad=Math.max(halfX,halfZ)*0.9; planeY = isFinite(minY) ? minY : 0; id='group';
      } else {
        const mesh = entries[0].mesh; const bb = mesh.getBoundingInfo()?.boundingBox; if (!bb) { disposeMoveWidget(); return; } const min=bb.minimumWorld, max=bb.maximumWorld; const halfX=Math.max(0.1,(max.x-min.x)/2), halfZ=Math.max(0.1,(max.z-min.z)/2); rad=Math.max(halfX,halfZ)*0.9; center=new BABYLON.Vector3((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2); planeY=min.y;
      }
      if (!moveWidget.root || moveWidget.group !== isGroup || moveWidget.groupKey !== groupKey || (moveWidget.root.isDisposed && moveWidget.root.isDisposed())) {
        disposeMoveWidget(); const scalePct = Number(localStorage.getItem('dw:ui:gizmoScale') || '100') || 100; const gScale=Math.max(0.1,scalePct/100); const len=Math.max(0.8,rad*1.2*gScale); const shaft=Math.max(0.04,len*0.05); const tipLen=Math.max(0.08,len*0.18); const tipDia=shaft*2.2; const root = new BABYLON.TransformNode(`moveGizmo:root:${id}`, scene);
        const mkArrow=(axis,color)=>{ const name=`moveGizmo:${axis}:${id}`; const shaftMesh=BABYLON.MeshBuilder.CreateCylinder(`${name}:shaft`,{height:len-tipLen,diameter:shaft},scene); const tipMesh=BABYLON.MeshBuilder.CreateCylinder(`${name}:tip`,{height:tipLen,diameterTop:0,diameterBottom:tipDia,tessellation:24},scene); const mat=new BABYLON.StandardMaterial(`${name}:mat`,scene); mat.diffuseColor=color.scale(0.25); mat.emissiveColor=color.clone(); mat.specularColor=new BABYLON.Color3(0,0,0); shaftMesh.material=mat; tipMesh.material=mat; shaftMesh.isPickable=true; tipMesh.isPickable=true; shaftMesh.alwaysSelectAsActiveMesh=true; tipMesh.alwaysSelectAsActiveMesh=true; shaftMesh.renderingGroupId=2; tipMesh.renderingGroupId=2; shaftMesh.parent=root; tipMesh.parent=root; if(axis==='x'){shaftMesh.rotation.z=-Math.PI/2; tipMesh.rotation.z=-Math.PI/2; shaftMesh.position.x=(len-tipLen)/2; tipMesh.position.x=len-tipLen/2;} else if(axis==='y'){shaftMesh.position.y=(len-tipLen)/2; tipMesh.position.y=len-tipLen/2;} else {shaftMesh.rotation.x=Math.PI/2; tipMesh.rotation.x=Math.PI/2; shaftMesh.position.z=(len-tipLen)/2; tipMesh.position.z=len-tipLen/2;} shaftMesh.name=name; tipMesh.name=name; try{moveWidget.arrowMeshes.push(shaftMesh,tipMesh);}catch{}};
        moveWidget.root=root; moveWidget.mesh=root; moveWidget.spaceId=id; moveWidget.group=isGroup; moveWidget.groupIDs = sel.slice(); moveWidget.groupKey = groupKey; mkArrow('y', new BABYLON.Color3(0.2, 0.95, 0.2));
        try { const discR=Math.max(0.6,rad*0.9*gScale); const disc=BABYLON.MeshBuilder.CreateDisc(`moveGizmo:disc:${id}`,{radius:discR,tessellation:64},scene); const dmat=new BABYLON.StandardMaterial(`moveGizmo:disc:${id}:mat`,scene); dmat.diffuseColor=new BABYLON.Color3(0.15,0.5,0.95); dmat.emissiveColor=new BABYLON.Color3(0.12,0.42,0.85); dmat.alpha=0.18; dmat.specularColor=new BABYLON.Color3(0,0,0); disc.material=dmat; disc.isPickable=true; disc.alwaysSelectAsActiveMesh=true; disc.renderingGroupId=2; disc.rotation.x=Math.PI/2; moveWidget.disc=disc; } catch {}
      }
      // Position
      if (isGroup) { try { moveWidget.root.parent=null; moveWidget.root.position.copyFrom(center); } catch {}; moveWidget.groupCenter=center; moveWidget.startCenter=null; }
      else { const mesh=entries[0].mesh; try { moveWidget.root.parent=null; mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); const bb=mesh.getBoundingInfo()?.boundingBox; const min=bb?.minimumWorld, max=bb?.maximumWorld; const c=(min&&max)? new BABYLON.Vector3((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2) : mesh.position.clone(); moveWidget.root.position.copyFrom(c); } catch {} }
      try { const p=isGroup ? center : (entries[0]?.mesh?.position || center); moveWidget.planeY = planeY || 0; if (moveWidget.disc) { moveWidget.disc.position.x = p.x; moveWidget.disc.position.y = moveWidget.planeY; moveWidget.disc.position.z = p.z; } } catch {}
    } catch { try { disposeMoveWidget(); } catch {} }
  }

  // Plane picking helper (shared with drag code)
  let _lastPickMissLog = 0;
  function pickPointOnPlane(normal, point) {
    try {
      let n = normal.clone(); n.normalize();
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const ro = ray.origin, rd = ray.direction; const eps = 1e-6; let denom = BABYLON.Vector3.Dot(n, rd);
      if (Math.abs(denom) < eps) { try { const fwd = camera.getForwardRay()?.direction || new BABYLON.Vector3(0,0,1); n = n.add(fwd.scale(0.001)); n.normalize(); denom = BABYLON.Vector3.Dot(n, rd); } catch {} }
      if (Math.abs(denom) < eps) { const now = performance.now(); if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: ray parallel to plane', { normal: n.asArray() }); } catch {} } return null; }
      const t = BABYLON.Vector3.Dot(point.subtract(ro), n) / denom; if (!isFinite(t) || t < 0) { const now = performance.now(); if (now - _lastPickMissLog > 120) { _lastPickMissLog = now; try { Log.log('GIZMO', 'Pick miss: behind origin', { t }); } catch {} } return null; }
      return ro.add(rd.scale(t));
    } catch (e) { try { Log.log('GIZMO', 'Pick error', { err: String(e) }); } catch {}; return null; }
  }

  // Suppression flag for long ops
  let _gizmosSuppressed = false;
  function suppressGizmos(on) {
    _gizmosSuppressed = !!on;
    if (_gizmosSuppressed) {
      try { Log.log('GIZMO', 'Suppress on', { reason: 'voxel-op' }); } catch {}
      try { disposeMoveWidget(); } catch {}
      try { disposeRotWidget(); } catch {}
      try { setGizmoHudVisible(false); } catch {}
    } else {
      try { Log.log('GIZMO', 'Suppress off', {}); } catch {}
      try { ensureRotWidget(); ensureMoveWidget(); } catch {}
    }
  }

  const _GIZMO_DCLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;

  // ——————————— Widget pointer actions (moved from eventHandler) ———————————
  let _lastDbRefresh = 0;
  let _lastGizmoClick = 0;
  const dragThreshold = 6; // pixels
  function dPick(event, data) { try { Log.log('PICK', event, data); } catch {} }
  function mLog(event, data) { try { Log.log('MOVE', event, data); } catch {} }
  function getSelectedSpaceAndMesh() {
    const sel = Array.from(state.selection || []);
    if (sel.length !== 1) return { space: null, mesh: null, id: null };
    const id = sel[0];
    const mesh = (state?.built?.spaces || []).find(x => x.id === id)?.mesh || null;
    const space = (state?.barrow?.spaces || []).find(x => x.id === id) || null;
    return { space, mesh, id };
  }
  function updateMoveDiscPlacement() {
    try {
      if (!moveWidget?.disc) return;
      const ids = Array.from(state.selection || []);
      if (!ids.length) return;
      const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
      let minY = Infinity;
      for (const id of ids) {
        const s = spaces.find(x => x && x.id === id);
        if (!s) continue;
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const y0 = (s.origin?.y||0) - ((s.size?.y||0) * sr)/2;
        if (y0 < minY) minY = y0;
      }
      if (!isFinite(minY)) minY = 0;
      const center = moveWidget.group ? (moveWidget.groupCenter || new BABYLON.Vector3(0,0,0)) : ((state?.built?.spaces||[]).find(x => ids.includes(x.id))?.mesh?.position || new BABYLON.Vector3(0,0,0));
      moveWidget.disc.position.x = center.x;
      moveWidget.disc.position.z = center.z;
      moveWidget.disc.position.y = minY;
      moveWidget.planeY = minY;
    } catch {}
  }

  // ——————————— Live intersection preview (selected vs others) ———————————
  const liveIx = new Map();
  const ixLastExact = new Map();
  const ixMat = (() => {
    try {
      const m = new BABYLON.StandardMaterial('ixLive:mat', scene);
      m.diffuseColor = new BABYLON.Color3(0,0,0);
      m.emissiveColor = new BABYLON.Color3(0.95, 0.9, 0.2);
      m.alpha = 0.25; m.specularColor = new BABYLON.Color3(0,0,0); m.zOffset = 3;
      return m;
    } catch { return null; }
  })();
  function disposeLiveIntersections(){
    try { for (const m of liveIx.values()) { try { state.hl?.removeMesh(m); } catch {}; try { m.dispose(); } catch {} } } catch {}
    liveIx.clear();
  }
  function updateLiveIntersectionsFor(selectedId){
    try {
      if (!selectedId) { disposeLiveIntersections(); return; }
      const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
      const selEntry = builtSpaces.find(x => x.id === selectedId); if (!selEntry?.mesh) { disposeLiveIntersections(); return; }
      const bba = selEntry.mesh.getBoundingInfo()?.boundingBox; if (!bba) { disposeLiveIntersections(); return; }
      const amin = bba.minimumWorld, amax = bba.maximumWorld;
      const seen = new Set();
      const exactOn = (() => { try { return localStorage.getItem('dw:ui:exactCSG') === '1'; } catch { return false; } })();
      const canCSG = exactOn && !!(BABYLON && BABYLON.CSG);
      for (const entry of builtSpaces) {
        if (!entry || entry.id === selectedId || !entry.mesh) continue;
        const bbb = entry.mesh.getBoundingInfo()?.boundingBox; if (!bbb) continue;
        const bmin = bbb.minimumWorld, bmax = bbb.maximumWorld;
        const ixmin = { x: Math.max(amin.x, bmin.x), y: Math.max(amin.y, bmin.y), z: Math.max(amin.z, bmin.z) };
        const ixmax = { x: Math.min(amax.x, bmax.x), y: Math.min(amax.y, bmax.y), z: Math.min(amax.z, bmax.z) };
        const dx = ixmax.x - ixmin.x, dy = ixmax.y - ixmin.y, dz = ixmax.z - ixmin.z;
        const key = `live:${selectedId}&${entry.id}`;
        if (dx > 0.001 && dy > 0.001 && dz > 0.001) {
          seen.add(key);
          const cx = (ixmin.x + ixmax.x) / 2, cy = (ixmin.y + ixmax.y) / 2, cz = (ixmin.z + ixmax.z) / 2;
          if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz) || !isFinite(dx) || !isFinite(dy) || !isFinite(dz)) continue;

          let mesh = liveIx.get(key);
          if (canCSG) {
            const now = performance.now();
            const last = ixLastExact.get(key) || 0;
            const needExact = (!mesh) || (now - last > 220);
            if (needExact) {
              try {
                if (mesh) { try { state.hl?.removeMesh(mesh); } catch {}; try { mesh.dispose(); } catch {}; liveIx.delete(key); }
                const csgA = BABYLON.CSG.FromMesh(selEntry.mesh);
                const csgB = BABYLON.CSG.FromMesh(entry.mesh);
                const inter = csgA.intersect(csgB);
                const csgMesh = inter.toMesh(key, ixMat || undefined, scene, true);
                csgMesh.isPickable = false; csgMesh.renderingGroupId = 1;
                liveIx.set(key, csgMesh);
                ixLastExact.set(key, now);
                try { state.hl?.addMesh(csgMesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
              } catch {
                if (!mesh) {
                  const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
                  if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
                  liveIx.set(key, box);
                  box.position.set(cx, cy, cz);
                  try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
                }
              }
            }
          } else {
            // AABB-only preview
            if (!mesh) {
              mesh = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) mesh.material = ixMat;
              mesh.isPickable = false; mesh.renderingGroupId = 1;
              liveIx.set(key, mesh);
              mesh.position.set(cx, cy, cz);
              try { state.hl?.addMesh(mesh, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            } else {
              try { state.hl?.removeMesh(mesh); mesh.dispose(); } catch {}
              const box = BABYLON.MeshBuilder.CreateBox(key, { width: dx, height: dy, depth: dz }, scene);
              if (ixMat) box.material = ixMat; box.isPickable = false; box.renderingGroupId = 1;
              liveIx.set(key, box);
              box.position.set(cx, cy, cz);
              try { state.hl?.addMesh(box, new BABYLON.Color3(0.95, 0.9, 0.2)); } catch {}
            }
          }
        } else {
          if (liveIx.has(key)) { try { const old = liveIx.get(key); state.hl?.removeMesh(old); old?.dispose(); } catch {}; liveIx.delete(key); ixLastExact.delete(key); }
        }
      }
      for (const [k, m] of Array.from(liveIx.entries())) {
        if (!k.startsWith(`live:${selectedId}&`) || !seen.has(k)) { try { state.hl?.removeMesh(m); m.dispose(); } catch {}; liveIx.delete(k); ixLastExact.delete(k); }
      }
    } catch {}
  }

  // ——————————— Contact shadow (visual aid) ———————————
  state._contactShadow = state._contactShadow || { mesh: null, ids: [] };
  function disposeContactShadow() { try { state._contactShadow.mesh?.dispose?.(); } catch {}; state._contactShadow.mesh = null; state._contactShadow.ids = []; }
  function ensureContactShadow() {
    try {
      if (state._contactShadow.mesh && !state._contactShadow.mesh.isDisposed()) return state._contactShadow.mesh;
      const disc = BABYLON.MeshBuilder.CreateDisc('contactShadow', { radius: 1, tessellation: 64 }, scene);
      disc.rotation.x = Math.PI / 2; // XZ plane
      const mat = new BABYLON.StandardMaterial('contactShadow:mat', scene);
      mat.diffuseColor = new BABYLON.Color3(0.85, 0.80, 0.20);
      mat.emissiveColor = new BABYLON.Color3(0.35, 0.33, 0.10);
      mat.alpha = 0.28; mat.specularColor = new BABYLON.Color3(0,0,0);
      try { mat.backFaceCulling = false; mat.zOffset = 2; mat.disableLighting = false; } catch {}
      disc.material = mat; disc.isPickable = false; disc.renderingGroupId = 1;
      state._contactShadow.mesh = disc; return disc;
    } catch { return null; }
  }
  function updateContactShadowPlacement() {
    try {
      const ids = Array.from(state.selection || []);
      if (!ids.length) { disposeContactShadow(); return; }
      const mesh = ensureContactShadow(); if (!mesh) return;
      const builtSpaces = (state?.built?.spaces || []);
      const entries = builtSpaces.filter(x => ids.includes(x.id)); if (!entries.length) { disposeContactShadow(); return; }
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const e of entries) {
        try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
        const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
        const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
        minX = Math.min(minX, bmin.x); maxX = Math.max(maxX, bmax.x);
        minY = Math.min(minY, bmin.y); maxY = Math.max(maxY, bmax.y);
        minZ = Math.min(minZ, bmin.z); maxZ = Math.max(maxZ, bmax.z);
      }
      if (!isFinite(minX)) { disposeContactShadow(); return; }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const y = 0.0;
      const rx = Math.max(0.2, (maxX - minX) / 2);
      const rz = Math.max(0.2, (maxZ - minZ) / 2);
      const base = Math.max(rx, rz) * 1.5;
      const minorBase = Math.min(rx, rz) * 1.5;
      const minor = Math.max(base * 0.6, minorBase);
      let sx = base, sz = minor; if (rz > rx) { sx = minor; sz = base; }
      sx = Math.max(3.0, sx); sz = Math.max(3.0, sz);
      mesh.position.set(cx, y + 0.01, cz);
      mesh.scaling.x = sx; mesh.scaling.y = sz; mesh.scaling.z = 1;
      state._contactShadow.ids = ids;
    } catch {}
  }

  // Update selection OBB lines live (dispose and rebuild for selected ids)
  function updateSelectionObbLive() {
    try {
      const ids = Array.from(state.selection || []);
      if (!ids.length) return;
      const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
      for (const id of ids) {
        const s = byId.get(id); if (!s) continue;
        try { const prev = state.selObb?.get?.(id); if (prev) { prev.dispose?.(); state.selObb.delete?.(id); } } catch {}
        const sr = s.res || (state.barrow?.meta?.voxelSize || 1);
        const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
        const hx = w/2, hy = h/2, hz = d/2;
        const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
        const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
        const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
        const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
        const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        const mtx = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
        const locals = [ new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz), new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz), new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz), new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz) ];
        const cs = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, mtx));
        const edges = [ [cs[0], cs[1]], [cs[1], cs[3]], [cs[3], cs[2]], [cs[2], cs[0]], [cs[4], cs[5]], [cs[5], cs[7]], [cs[7], cs[6]], [cs[6], cs[4]], [cs[0], cs[4]], [cs[1], cs[5]], [cs[2], cs[6]], [cs[3], cs[7]] ];
        const lines = BABYLON.MeshBuilder.CreateLineSystem(`sel:obb:${id}`, { lines: edges }, scene);
        lines.color = new BABYLON.Color3(0.1, 0.9, 0.9);
        lines.isPickable = false; lines.renderingGroupId = 3;
        try { state.selObb?.set?.(id, lines); } catch {}
      }
    } catch {}
  }

  scene.onPointerObservable.add((pi) => {
    try {
      // Widget actions only in Edit mode
      if (state.mode !== 'edit') return;
      const type = pi.type;
      // Rotation widget press
      if (type === BABYLON.PointerEventTypes.POINTERDOWN) {
        const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
        if (pick?.hit && pick.pickedMesh) {
          const nm = String(pick.pickedMesh.name || '');
          const mY = rotWidget.meshes?.y, mX = rotWidget.meshes?.x, mZ = rotWidget.meshes?.z;
          let axis = null;
          if (nm.startsWith('rotGizmo:Y:') && pick.pickedMesh === mY) axis = 'y';
          else if (nm.startsWith('rotGizmo:X:') && pick.pickedMesh === mX) axis = 'x';
          else if (nm.startsWith('rotGizmo:Z:') && pick.pickedMesh === mZ) axis = 'z';
          if (axis) {
            try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
            rotWidget.axis = axis; rotWidget.preDrag = false; rotWidget.downX = scene.pointerX; rotWidget.downY = scene.pointerY; dPick('preDrag:rot', { axis, x: rotWidget.downX, y: rotWidget.downY });
            try { setRingActive(axis); } catch {}
            try {
              const ax = rotWidget.axis || 'y';
              const sel = Array.from(state.selection || []);
              const isGroup = (sel.length > 1);
              if (isGroup) {
                const axisWorld = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
                rotWidget.axisWorld = axisWorld.clone();
                const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
                const p0 = pickPointOnPlane(axisWorld, center) || center.clone();
                let ref = p0.subtract(center);
                ref = ref.subtract(axisWorld.scale(BABYLON.Vector3.Dot(ref, axisWorld)));
                if (ref.lengthSquared() < 1e-6) ref = new BABYLON.Vector3(1,0,0); else ref.normalize();
                rotWidget.refWorld = ref;
                try { rotWidget.startAngle = (function(center){ try { const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()); const proj = BABYLON.Vector3.Project(center, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport); const dx = (scene.pointerX - proj.x), dy = (scene.pointerY - proj.y); return Math.atan2(dy, dx); } catch { return 0; } })(center); } catch {}
                rotWidget.mStartX = scene.pointerX; rotWidget.mStartY = scene.pointerY;
                const map = new Map();
                for (const id of rotWidget.groupIDs || []) {
                  const m = (state?.built?.spaces || []).find(x => x.id === id)?.mesh; if (!m) continue;
                  try { if (!m.rotationQuaternion) m.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0); } catch {}
                  map.set(id, { q: m.rotationQuaternion?.clone ? m.rotationQuaternion.clone() : null, p: m.position?.clone ? m.position.clone() : new BABYLON.Vector3(m.position.x, m.position.y, m.position.z) });
                }
                rotWidget.startById = map; rotWidget.dragging = true;
              } else {
                const { mesh } = getSelectedSpaceAndMesh(); if (!mesh) return;
                const center = mesh.position.clone();
                const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
                rotWidget.axisLocal = axisLocal.clone();
                if (!mesh.rotationQuaternion) { mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); }
                rotWidget.startQuat = mesh.rotationQuaternion.clone();
                const wm = mesh.getWorldMatrix();
                const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
                const p0 = pickPointOnPlane(nWorld, center) || center.clone();
                const inv = BABYLON.Matrix.Invert(wm);
                const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
                let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal)));
                if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0); else refLocal.normalize();
                rotWidget.refLocal = refLocal; rotWidget.dragging = true;
              }
              const canvas = engine.getRenderingCanvas();
              camera.inputs?.attached?.pointers?.detachControl(canvas);
              try { const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); } catch {}
            } catch {}
            try {
              const now = performance.now();
              if (now - _lastGizmoClick <= _GIZMO_DCLICK_MS) { const { id } = getSelectedSpaceAndMesh(); if (id) window.dispatchEvent(new CustomEvent('dw:showDbForSpace', { detail: { id } })); }
              _lastGizmoClick = now;
            } catch {}
          }
        }
        // Move widget press
        let pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:'));
        if (!pick2?.hit) pick2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
        if (pick2?.hit && pick2.pickedMesh && String(pick2.pickedMesh.name||'').startsWith('moveGizmo:')) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          moveWidget.preDrag = true; moveWidget.downX = scene.pointerX; moveWidget.downY = scene.pointerY;
          const _nm = String(pick2.pickedMesh.name||'');
          try { const m = _nm.match(/^moveGizmo:(y):/i); moveWidget.axis = m ? m[1].toLowerCase() : null; } catch { moveWidget.axis = null; }
          moveWidget.mode = _nm.startsWith('moveGizmo:disc:') ? 'plane' : 'axis';
          dPick('preDrag:move', { x: moveWidget.downX, y: moveWidget.downY, mode: moveWidget.mode, axis: moveWidget.axis });
          mLog('press', { picked: _nm, mode: moveWidget.mode, axis: moveWidget.axis });
        }
      } else if (type === BABYLON.PointerEventTypes.POINTERUP) {
        if (rotWidget.dragging) {
          rotWidget.dragging = false;
          try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
          try {
            const sel = Array.from(state.selection || []);
            if (sel.length > 1) {
              const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
              for (const id2 of sel) {
                const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
                const sp = byId.get(id2); if (!sp) continue;
                const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
                sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
              }
              try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
              try { renderDbView?.(state.barrow); } catch {}
              try { scheduleGridUpdate?.(); } catch {}
              try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            } else {
              const { space, mesh } = getSelectedSpaceAndMesh();
              if (space && mesh) {
                if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
                const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
                space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
                try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
                try { renderDbView?.(state.barrow); } catch {}
                try { scheduleGridUpdate?.(); } catch {}
                try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
              }
            }
          } catch {}
          try { setRingsDim(); } catch {}
        }
        if (moveWidget.dragging) {
          moveWidget.dragging = false; moveWidget.preDrag = false; try { moveWidget.dragPlaneY = null; } catch {}
          try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
          try {
            const { space, mesh } = getSelectedSpaceAndMesh();
            if (space && mesh) {
              space.origin = space.origin || { x: 0, y: 0, z: 0 };
              space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
              try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
              try { renderDbView?.(state.barrow); } catch {}
              try { scheduleGridUpdate?.(); } catch {}
              try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          } catch {}
          try { setRingsDim(); } catch {}
        }
      } else if (type === BABYLON.PointerEventTypes.POINTERMOVE) {
        const selNowGlobal = Array.from(state.selection || []);
        const isGroupGlobal = selNowGlobal.length > 1;
        const { space, mesh, id } = getSelectedSpaceAndMesh(); if (!isGroupGlobal && !mesh) return;
        try {
          if (!rotWidget.dragging && !rotWidget.preDrag && !moveWidget.dragging && !moveWidget.preDrag) {
            const hp = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
            let hAxis = null;
            if (hp?.hit && hp.pickedMesh) {
              const n = String(hp.pickedMesh.name || '');
              if (n.startsWith('rotGizmo:Y:') && rotWidget.meshes?.y && hp.pickedMesh === rotWidget.meshes.y) hAxis = 'y';
              else if (n.startsWith('rotGizmo:X:') && rotWidget.meshes?.x && hp.pickedMesh === rotWidget.meshes.x) hAxis = 'x';
              else if (n.startsWith('rotGizmo:Z:') && rotWidget.meshes?.z && hp.pickedMesh === rotWidget.meshes.z) hAxis = 'z';
            }
            if (hAxis) { if (rotWidget.activeAxis !== hAxis) { try { setRingActive(hAxis); } catch {} } }
            else { if (rotWidget.activeAxis) { try { setRingsDim(); } catch {} } }
          }
        } catch {}
        if (!rotWidget.dragging && rotWidget.preDrag) {
          const dx = (scene.pointerX - rotWidget.downX); const dy = (scene.pointerY - rotWidget.downY);
          if (Math.hypot(dx, dy) >= dragThreshold) {
            try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
            const ax = rotWidget.axis || 'y';
            const center = mesh.position.clone();
            const axisLocal = (ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
            rotWidget.axisLocal = axisLocal.clone();
            try { if (!mesh.rotationQuaternion) { mesh.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); } } catch {}
            rotWidget.startQuat = (mesh.rotationQuaternion && mesh.rotationQuaternion.clone) ? mesh.rotationQuaternion.clone() : null;
            const wm = mesh.getWorldMatrix(); const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
            const p0 = pickPointOnPlane(nWorld, center) || center.clone();
            const inv = BABYLON.Matrix.Invert(wm);
            const p0Local = BABYLON.Vector3.TransformCoordinates(p0, inv);
            let refLocal = p0Local.subtract(axisLocal.scale(BABYLON.Vector3.Dot(p0Local, axisLocal))); if (refLocal.lengthSquared() < 1e-6) refLocal = new BABYLON.Vector3(1,0,0); else refLocal.normalize();
            rotWidget.refLocal = refLocal; rotWidget.dragging = true; rotWidget.preDrag = false;
            try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); Log.log('GIZMO', 'Drag start', { id: rotWidget.spaceId, axis: ax }); } catch {}
            dPick('dragStart:rot', {});
            try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
            try { if (space) { if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 }; const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y; renderDbView?.(state.barrow); } } catch {}
          }
        }
        if (rotWidget.dragging) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const ax = rotWidget.axis || 'y';
          const sel = Array.from(state.selection || []);
          const isGroup = (sel.length > 1);
          let delta = 0;
          if (isGroup) {
            const center = rotWidget.groupCenter || new BABYLON.Vector3(0,0,0);
            let ok = true; try { const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()); const proj = BABYLON.Vector3.Project(center, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport); const angNow = Math.atan2(scene.pointerY - proj.y, scene.pointerX - proj.x); const ang0 = rotWidget.startAngle || angNow; delta = angNow - ang0; } catch { ok = false; }
            if (!isFinite(delta) || Math.abs(delta) < 1e-6 || ok === false) { const dx = (scene.pointerX - rotWidget.mStartX); const sens2 = (() => { try { return Math.max(0.0005, Math.min(0.01, Number(localStorage.getItem('dw:ui:rotSens') || '0.008')/100)); } catch { return 0.008/100; } })(); delta = dx * sens2 * Math.PI; }
            if (delta > Math.PI) delta -= 2*Math.PI; else if (delta < -Math.PI) delta += 2*Math.PI;
            const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })();
            const nWorld = rotWidget.axisWorld || new BABYLON.Vector3(0,1,0);
            const qRot = BABYLON.Quaternion.RotationAxis(nWorld, sens * delta);
            const mRot = BABYLON.Matrix.RotationAxis(nWorld, sens * delta);
            for (const id of rotWidget.groupIDs || []) {
              const entry = (state?.built?.spaces || []).find(x => x.id === id); if (!entry?.mesh) continue;
              const start = rotWidget.startById?.get?.(id); if (!start) continue;
              const m = entry.mesh;
              const p0 = start.p || m.position; const rel = p0.subtract(center); const relRot = BABYLON.Vector3.TransformCoordinates(rel, mRot); const pNew = center.add(relRot); m.position.copyFrom(pNew);
              try { const q0 = start.q || m.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(m.rotation.x||0, m.rotation.y||0, m.rotation.z||0); m.rotationQuaternion = qRot.multiply ? qRot.multiply(q0) : q0; m.rotation.set(0,0,0); } catch {}
              try { m.computeWorldMatrix(true); m.refreshBoundingInfo(); } catch {}
            }
            rotWidget.lastRot = delta;
            try { renderGizmoHud({ selCount: sel.length, center, deltaDeg: (delta*180/Math.PI), pickMode: 'screen|mouse' }); } catch {}
          } else {
            const center = mesh.position.clone();
            const axisLocal = rotWidget.axisLocal || ((ax === 'x') ? new BABYLON.Vector3(1,0,0) : (ax === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1));
            const wm = mesh.getWorldMatrix(); const nWorld = BABYLON.Vector3.TransformNormal(axisLocal, wm).normalize();
            const p = pickPointOnPlane(nWorld, center); if (!p) return;
            const inv = BABYLON.Matrix.Invert(wm); const pLocal = BABYLON.Vector3.TransformCoordinates(p, inv);
            let curLocal = pLocal.subtract(axisLocal.scale(BABYLON.Vector3.Dot(pLocal, axisLocal))); if (curLocal.lengthSquared() < 1e-8) return; curLocal.normalize();
            const refLocal = rotWidget.refLocal || new BABYLON.Vector3(1,0,0);
            const crossL = BABYLON.Vector3.Cross(refLocal, curLocal);
            const s = BABYLON.Vector3.Dot(axisLocal, crossL);
            const c = BABYLON.Vector3.Dot(refLocal, curLocal);
            delta = Math.atan2(s, c);
            try { const qStart = rotWidget.startQuat || mesh.rotationQuaternion || BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0); mesh.rotationQuaternion = (qStart.clone ? qStart.clone() : qStart); const sens = (() => { try { return Math.max(0.1, Math.min(2.0, Number(localStorage.getItem('dw:ui:rotSens') || '0.8'))); } catch { return 0.8; } })(); mesh.rotate(axisLocal, sens * delta, BABYLON.Space.LOCAL); mesh.rotation.set(0,0,0); } catch {}
            try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
            rotWidget.lastRot = delta; try { renderGizmoHud({ selCount: 1, center, deltaDeg: (delta*180/Math.PI), pickMode: 'plane' }); } catch {}
          }
          try { updateRotWidgetFromMesh(mesh); } catch {}
          try {
            const selLive = Array.from(state.selection || []);
            const isGroupLive = selLive.length > 1;
            if (isGroupLive) {
              const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
              for (const id2 of selLive) {
                const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue;
                const sp = byId.get(id2); if (!sp) continue;
                const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0);
                sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y;
              }
            } else if (space && mesh) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
              space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
            }
            const now = performance.now();
            if (now - _lastDbRefresh > 60) {
              _lastDbRefresh = now;
              const deg = (rotWidget.lastRot * 180 / Math.PI);
              try { Log.log('GIZMO', 'Drag update', { id: rotWidget.spaceId, axis: rotWidget.axis || 'y', delta: rotWidget.lastRot, deg: isFinite(deg) ? Math.round(deg*10)/10 : null }); } catch {}
              try { renderDbView?.(state.barrow); } catch {}
            }
            try { if (!isGroupLive) helpers.updateLiveIntersectionsFor?.(id); else if (selLive.length) helpers.updateLiveIntersectionsFor?.(selLive[0]); } catch {}
          } catch {}
          return;
        }
        if (!moveWidget.dragging && moveWidget.preDrag) {
          const dx = (scene.pointerX - moveWidget.downX); const dy = (scene.pointerY - moveWidget.downY);
          if (Math.hypot(dx, dy) >= dragThreshold) {
            try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
            const selNow = Array.from(state.selection || []);
            const isGroup = selNow.length > 1;
            const isPlane = (moveWidget.mode === 'plane');
            const axis = (moveWidget.axis === 'x') ? new BABYLON.Vector3(1,0,0) : (moveWidget.axis === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
            const view = camera.getForwardRay().direction.clone();
            let n = isPlane ? new BABYLON.Vector3(0,1,0) : BABYLON.Vector3.Cross(axis, BABYLON.Vector3.Cross(view, axis));
            if (!isPlane) {
              if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(0,1,0));
              if (n.lengthSquared() < 1e-4) n = BABYLON.Vector3.Cross(axis, new BABYLON.Vector3(1,0,0));
            }
            try { n.normalize(); } catch {}
            mLog('drag:init', { isGroup, isPlane, axis: moveWidget.axis, planeY: moveWidget.planeY, dragPlaneY: moveWidget.dragPlaneY, n: { x: n.x, y: n.y, z: n.z } });
            if (isGroup) {
              const center = moveWidget.groupCenter || new BABYLON.Vector3(0,0,0);
              if (isPlane && (moveWidget.dragPlaneY == null)) moveWidget.dragPlaneY = moveWidget.planeY || 0;
              const base0 = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : center;
              const p0 = pickPointOnPlane(n, base0) || base0.clone();
              moveWidget.axisStart = isPlane ? 0 : BABYLON.Vector3.Dot(p0, axis);
              moveWidget.startPoint = p0.clone();
              moveWidget.startCenter = center.clone ? center.clone() : new BABYLON.Vector3(center.x, center.y, center.z);
              moveWidget.startById = new Map(); moveWidget.groupIDs = selNow.slice();
              for (const id2 of moveWidget.groupIDs) { const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue; moveWidget.startById.set(id2, m2.position?.clone ? m2.position.clone() : new BABYLON.Vector3(m2.position.x, m2.position.y, m2.position.z)); }
              moveWidget.planeNormal = n.clone(); moveWidget.dragging = true; moveWidget.preDrag = false;
              try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', isPlane ? 'Group Plane Move start' : 'Group Move start', { ids: moveWidget.groupIDs, mode: moveWidget.mode, axis: moveWidget.axis }); } catch {}
            } else {
              const mref = (state?.built?.spaces || []).find(x => x.id === selNow[0])?.mesh; if (!mref) return;
              const center = mref.position.clone();
              if (isPlane && (moveWidget.dragPlaneY == null)) moveWidget.dragPlaneY = moveWidget.planeY || 0;
              const base0 = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : center;
              const p0 = pickPointOnPlane(n, base0) || base0.clone();
              moveWidget.axisStart = isPlane ? 0 : BABYLON.Vector3.Dot(p0, axis);
              moveWidget.startPoint = p0.clone(); moveWidget.startCenter = center.clone(); moveWidget.planeNormal = n.clone(); moveWidget.dragging = true; moveWidget.preDrag = false;
              try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.detachControl(canvas); const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId); Log.log('GIZMO', isPlane ? 'Plane Move start' : 'Move start', { id: moveWidget.spaceId, mode: moveWidget.mode, axis: moveWidget.axis, start: center }); } catch {}
            }
            dPick('dragStart:move', {});
            try { for (const x of state?.built?.intersections || []) { try { state.hl?.removeMesh(x.mesh); } catch {}; x.mesh?.setEnabled(false); } } catch {}
          }
        }
        if (moveWidget.dragging) {
          try { pi.event?.stopImmediatePropagation?.(); pi.event?.stopPropagation?.(); pi.event?.preventDefault?.(); pi.skipOnPointerObservable = true; } catch {}
          const selNow = Array.from(state.selection || []);
          const isGroup = selNow.length > 1;
          const isPlane = (moveWidget.mode === 'plane');
          const axis = (moveWidget.axis === 'x') ? new BABYLON.Vector3(1,0,0) : (moveWidget.axis === 'y') ? new BABYLON.Vector3(0,1,0) : new BABYLON.Vector3(0,0,1);
          if (isGroup) {
            const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
            const basePt = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : (moveWidget.startCenter || new BABYLON.Vector3(0,0,0));
            const p = pickPointOnPlane(n, basePt); if (!p) return;
            let deltaScalar = 0; let deltaVec = null;
            if (isPlane) { deltaVec = p.subtract(moveWidget.startPoint || basePt); }
            else { const s = BABYLON.Vector3.Dot(p, axis); deltaScalar = s - (moveWidget.axisStart || 0); }
            const snapVal = (v, res) => { const r = Math.max(1e-6, Number(res) || 0); return Math.round(v / r) * r; };
            for (const id2 of moveWidget.groupIDs || []) {
              const entry = (state?.built?.spaces || []).find(x => x.id === id2); if (!entry?.mesh) continue;
              const startPos = moveWidget.startById?.get?.(id2); if (!startPos) continue;
              const targetPos = isPlane ? startPos.add(deltaVec) : startPos.add(axis.scale(deltaScalar));
              try { const sp2 = (state?.barrow?.spaces || []).find(x => x && x.id === id2); const hasVox = !!(sp2 && sp2.vox && sp2.vox.size); if (hasVox) { const resV = sp2.vox?.res || sp2.res || (state?.barrow?.meta?.voxelSize || 1); targetPos.x = snapVal(targetPos.x, resV); targetPos.y = snapVal(targetPos.y, resV); targetPos.z = snapVal(targetPos.z, resV); } } catch {}
              const m2 = entry.mesh; m2.position.copyFrom(targetPos); try { m2.computeWorldMatrix(true); m2.refreshBoundingInfo(); } catch {}
            }
            const targetCenter = isPlane ? (moveWidget.startCenter || new BABYLON.Vector3(0,0,0)).add(deltaVec) : (moveWidget.startCenter || new BABYLON.Vector3(0,0,0)).add(axis.scale(deltaScalar));
            try { moveWidget.root.position.copyFrom(targetCenter); } catch {}
            try { updateMoveDiscPlacement(); } catch {}
            try { helpers.updateContactShadowPlacement?.(); } catch {}
            moveWidget.groupCenter = targetCenter; try { if (rotWidget.group && rotWidget.groupNode) rotWidget.groupNode.position.copyFrom(targetCenter); } catch {}
            try { const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s])); for (const id2 of moveWidget.groupIDs || []) { const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue; const sp = byId.get(id2); if (!sp) continue; sp.origin = { x: m2.position.x, y: m2.position.y, z: m2.position.z }; } const now = performance.now(); if (now - _lastDbRefresh > 60) { _lastDbRefresh = now; Log.log('GIZMO', isPlane ? 'Group Plane Move update' : 'Group Move update', { ids: moveWidget.groupIDs, mode: moveWidget.mode, axis: moveWidget.axis }); try { renderDbView?.(state.barrow); } catch {}; try { helpers.updateSelectionObbLive?.(); } catch {} } } catch {}
          } else {
            const n = moveWidget.planeNormal || new BABYLON.Vector3(0,1,0);
            const basePt = isPlane ? new BABYLON.Vector3(0, (moveWidget.dragPlaneY != null ? moveWidget.dragPlaneY : (moveWidget.planeY || 0)), 0) : (moveWidget.startCenter || mesh.position || new BABYLON.Vector3(0,0,0));
            const p = pickPointOnPlane(n, basePt); if (!p) return; let target;
            if (isPlane) { const deltaVec = p.subtract(moveWidget.startPoint || basePt); target = (moveWidget.startCenter || mesh.position).add(deltaVec); }
            else { const s = BABYLON.Vector3.Dot(p, axis); const deltaScalar = s - (moveWidget.axisStart || 0); target = (moveWidget.startCenter || mesh.position).add(axis.scale(deltaScalar)); }
            try { const sp = (state?.barrow?.spaces || []).find(x => x && x.id === moveWidget.spaceId); const hasVox = !!(sp && sp.vox && sp.vox.size); if (hasVox) { const resV = sp.vox?.res || sp.res || (state?.barrow?.meta?.voxelSize || 1); const snapVal = (v, r) => { r = Math.max(1e-6, Number(r)||0); return Math.round(v / r) * r; }; target.x = snapVal(target.x, resV); target.y = snapVal(target.y, resV); target.z = snapVal(target.z, resV); } } catch {}
            try { const now = performance.now(); moveWidget._lastLog = moveWidget._lastLog || 0; if (now - moveWidget._lastLog > 100) { moveWidget._lastLog = now; mLog('drag:update', { isPlane, basePt: { x: basePt.x, y: basePt.y, z: basePt.z }, target: { x: target.x, y: target.y, z: target.z }, dragPlaneY: moveWidget.dragPlaneY }); } } catch {}
            mesh.position.copyFrom(target); try { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); } catch {}
            try { if (moveWidget.root) moveWidget.root.position.copyFrom(target); } catch {}
            try { updateMoveDiscPlacement(); } catch {}
            try { helpers.updateContactShadowPlacement?.(); } catch {}
            try { updateRotWidgetFromMesh(mesh); } catch {}
            try { if (space) { space.origin = space.origin || { x: 0, y: 0, z: 0 }; space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z; const now = performance.now(); if (now - _lastDbRefresh > 60) { _lastDbRefresh = now; Log.log('GIZMO', isPlane ? 'Plane Move update' : 'Move update', { id: moveWidget.spaceId, mode: moveWidget.mode, axis: moveWidget.axis, origin: space.origin }); try { renderDbView?.(state.barrow); } catch {} } try { helpers.updateLiveIntersectionsFor?.(id); } catch {} } } catch {}
            try { helpers.updateSelectionObbLive?.(); } catch {}
          }
        }
      }
    } catch {}
  });

  window.addEventListener('pointerup', () => {
    try {
      if (rotWidget.dragging) {
        rotWidget.dragging = false; rotWidget.preDrag = false;
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        try {
          const sel = Array.from(state.selection || []);
          if (sel.length > 1) {
            const byId = new Map((state.barrow.spaces||[]).map(s => [s.id, s]));
            for (const id2 of sel) { const m2 = (state?.built?.spaces || []).find(x => x.id === id2)?.mesh; if (!m2) continue; const sp = byId.get(id2); if (!sp) continue; const e = m2.rotationQuaternion?.toEulerAngles ? m2.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(m2.rotation.x||0, m2.rotation.y||0, m2.rotation.z||0); sp.rotation = { x: e.x, y: e.y, z: e.z }; sp.rotY = e.y; }
            try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
            try { renderDbView?.(state.barrow); } catch {}
            try { scheduleGridUpdate?.(); } catch {}
            try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          } else {
            const { space, mesh } = getSelectedSpaceAndMesh();
            if (space && mesh) {
              if (!space.rotation || typeof space.rotation !== 'object') space.rotation = { x: 0, y: 0, z: 0 };
              const e = mesh.rotationQuaternion?.toEulerAngles ? mesh.rotationQuaternion.toEulerAngles() : new BABYLON.Vector3(mesh.rotation.x||0, mesh.rotation.y||0, mesh.rotation.z||0);
              space.rotation.x = e.x; space.rotation.y = e.y; space.rotation.z = e.z; space.rotY = e.y;
              try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
              try { renderDbView?.(state.barrow); } catch {}
              try { scheduleGridUpdate?.(); } catch {}
              try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
            }
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
      if (moveWidget.dragging) {
        moveWidget.dragging = false; moveWidget.preDrag = false;
        try { moveWidget.dragPlaneY = null; } catch {}
        try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
        try {
          const { space, mesh } = getSelectedSpaceAndMesh();
          if (space && mesh) {
            space.origin = space.origin || { x: 0, y: 0, z: 0 };
            space.origin.x = mesh.position.x; space.origin.y = mesh.position.y; space.origin.z = mesh.position.z;
            try { saveBarrow?.(state.barrow); snapshot?.(state.barrow); } catch {}
            try { renderDbView?.(state.barrow); } catch {}
            try { scheduleGridUpdate?.(); } catch {}
            try { rebuildScene?.(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          }
        } catch {}
        try { setRingsDim(); } catch {}
      }
    } catch {}
  }, { passive: true });

  return { rotWidget, moveWidget, disposeRotWidget, ensureRotWidget, disposeMoveWidget, ensureMoveWidget, pickPointOnPlane, setRingsDim, setRingActive, setGizmoHudVisible, renderGizmoHud, suppressGizmos, updateRotWidgetFromMesh, updateContactShadowPlacement, updateSelectionObbLive, updateLiveIntersectionsFor, disposeLiveIntersections, _GIZMO_DCLICK_MS };
}
