// Centralized view (camera) manipulation and gesture mapping
// - Maps right-click to rotate, cmd+right to pan
// - Prevents camera rotation when interacting with gizmos by detaching camera input
// - Adds inertial guards while rotating or when a gizmo has claimed the pointer

import { Log, modsOf, comboName } from '../../util/log.mjs';

export function initViewManipulations({ scene, engine, camera, state, helpers }) {
  const canvas = engine.getRenderingCanvas();
  try { canvas.addEventListener('contextmenu', (e) => e.preventDefault()); } catch {}
  // Camera gesture handling is centralized in routeDebug now.
  let _targetDot = null;
  let _targetDotObs = null;

  // modsOf/comboName centralized in util/log.mjs
  function isGizmoHitAt(e) {
    try {
      const rect = canvas.getBoundingClientRect();
      const x = (typeof e.offsetX === 'number') ? e.offsetX : (e.clientX - rect.left);
      const y = (typeof e.offsetY === 'number') ? e.offsetY : (e.clientY - rect.top);
      const hitConnect = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('connectGizmo:'));
      if (hitConnect?.hit) return true;
      const hitMoveDisc = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('moveGizmo:disc:'));
      if (hitMoveDisc?.hit) return true;
      const hitMove = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
      if (hitMove?.hit) return true;
      const hitRot = scene.pick(x, y, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
      if (hitRot?.hit) return true;
    } catch {}
    return false;
  }

  function ensureTargetDot() {
    try {
      if (_targetDot && !_targetDot.isDisposed()) return _targetDot;
      const s = BABYLON.MeshBuilder.CreateSphere('cam:targetDot', { diameter: 0.6, segments: 16 }, scene);
      const m = new BABYLON.StandardMaterial('cam:targetDot:mat', scene);
      m.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.05); // bright orange
      m.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.0);
      m.specularColor = new BABYLON.Color3(0,0,0);
      s.material = m; s.isPickable = false; s.renderingGroupId = 3;
      _targetDot = s;
      try { if (_targetDotObs) scene.onBeforeRenderObservable.remove(_targetDotObs); } catch {}
      _targetDotObs = scene.onBeforeRenderObservable.add(() => {
        try { s.position.copyFrom(camera.target); } catch {}
      });
      return s;
    } catch { return null; }
  }

  // Camera pointer mapping moved to routeDebug; no pointer event wiring here.

  // No pointer event wiring here (handled centrally in routeDebug).

  // Ensure target dot exists and follows camera target
  try { ensureTargetDot(); } catch {}
}
