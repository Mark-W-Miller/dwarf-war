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
export function initTransformGizmos({ scene, engine, camera, state, renderDbView }) {
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

  return { rotWidget, moveWidget, disposeRotWidget, ensureRotWidget, disposeMoveWidget, ensureMoveWidget, pickPointOnPlane, setRingsDim, setRingActive, setGizmoHudVisible, renderGizmoHud, suppressGizmos, updateRotWidgetFromMesh, _GIZMO_DCLICK_MS };
}
