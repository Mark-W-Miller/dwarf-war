// Gizmo input handling (priority/capture to prevent camera rotation) extracted from eventHandler.mjs
import { Log } from '../../util/log.mjs';

export function initGizmoHandlers({ scene, engine, camera, state }) {
  try {
    // Pre-pointer observer to prioritize gizmo parts over camera gestures
    scene.onPrePointerObservable.add((pi) => {
      try {
        if (state.mode !== 'edit') return;
        if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
        const ev = pi.event || window.event;
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

