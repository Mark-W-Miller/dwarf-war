// Centralized view (camera) manipulation and gesture mapping
// - Maps right-click to rotate, cmd+right to pan
// - Prevents camera rotation when interacting with gizmos by detaching camera input
// - Adds inertial guards while rotating or when a gizmo has claimed the pointer

import { Log } from '../../util/log.mjs';

export function initViewManipulations({ scene, engine, camera, state, helpers }) {
  const canvas = engine.getRenderingCanvas();
  try { canvas.addEventListener('contextmenu', (e) => e.preventDefault()); } catch {}
  let _rcPanGuard = null; // { saved: number }
  let _rcDecision = null; // 'rotate' | 'pan' | null
  let _claimed = { by: null, ptrId: null }; // 'gizmo' | null

  function modsOf(ev) {
    return { cmd: !!ev?.metaKey, ctrl: !!ev?.ctrlKey, shift: !!ev?.shiftKey, alt: !!ev?.altKey };
  }
  function comboName(button, mods) {
    const parts = [];
    if (mods?.cmd) parts.push('cmd');
    if (mods?.ctrl) parts.push('ctrl');
    if (mods?.shift) parts.push('shift');
    if (mods?.alt) parts.push('alt');
    const btn = (button === 2) ? 'RC' : (button === 1) ? 'MC' : 'LC';
    parts.push(btn);
    return parts.join('-');
  }
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

  function onPointerDownCapture(e) {
    try {
      if (state.mode !== 'edit') return;
      // If a gizmo part is under the cursor, temporarily claim the pointer for view to prevent camera handling.
      // Do NOT stop the event — Babylon/gizmo handlers still need it.
      if (isGizmoHitAt(e)) {
        try {
          camera.inputs?.attached?.pointers?.detachControl(canvas);
          if (e.pointerId != null && canvas.setPointerCapture) { canvas.setPointerCapture(e.pointerId); _claimed = { by: 'gizmo', ptrId: e.pointerId }; }
          Log.log('GIZMO', 'view:claimed', {});
        } catch {}
        return; // skip RC mapping below
      }

      // Right-click mapping: RC rotates, Cmd+RC pans
      const emulateRC = (e.button === 0 && !!e.ctrlKey && !e.metaKey);
      const rcLike = (e.button === 2) || emulateRC;
      if (!rcLike) return;
      const isCmd = !!e.metaKey;
      camera.panningMouseButton = isCmd ? 2 : 1;
      const decision = (camera.panningMouseButton === 2) ? 'pan' : 'rotate';
      _rcDecision = decision;
      try { Log.log('CAMERA', 'rc:map', { button: e.button, cmd: !!e.metaKey, ctrl: !!e.ctrlKey, alt: !!e.altKey, emulateRC, rcLike, panningMouseButton: camera.panningMouseButton, decision }); } catch {}
      try { Log.log('INPUT', 'pointer:rc:decision', { combo: comboName(e.button || (emulateRC?0:undefined), modsOf(e)), emulateRC, decision }); } catch {}
      // Shift+RC: recenter to selection/voxel pick
      if (e.shiftKey) {
        try {
          const vox = helpers?.getVoxelPickWorldCenter?.();
          const sel = helpers?.getSelectionCenter?.();
          const tgt = vox || sel || null;
          if (tgt) camera.target.copyFrom(tgt);
        } catch {}
      }
      // Guard against panning while rotating
      if (decision === 'rotate') {
        try { _rcPanGuard = { saved: camera.panningSensibility }; camera.panningSensibility = 1e9; } catch {}
      } else if (_rcPanGuard && typeof _rcPanGuard.saved === 'number') {
        try { camera.panningSensibility = _rcPanGuard.saved; } catch {}
        _rcPanGuard = null;
      }
    } catch {}
  }

  function onPointerMoveCapture() {
    try {
      if (_claimed.by === 'gizmo') {
        // Zero inertials so camera never moves while a gizmo is active
        try { camera.inertialPanningX = 0; camera.inertialPanningY = 0; camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; } catch {}
        return;
      }
      if (_rcDecision === 'rotate') {
        try { camera.inertialPanningX = 0; camera.inertialPanningY = 0; } catch {}
      }
    } catch {}
  }

  function onPointerUpCapture() {
    try { camera.panningMouseButton = 1; } catch {}
    if (_claimed.by === 'gizmo') {
      try {
        if (_claimed.ptrId != null && canvas.releasePointerCapture) canvas.releasePointerCapture(_claimed.ptrId);
        camera.inputs?.attached?.pointers?.attachControl(canvas, true);
      } catch {}
    }
    _claimed = { by: null, ptrId: null };
    if (_rcPanGuard && typeof _rcPanGuard.saved === 'number') {
      try { camera.panningSensibility = _rcPanGuard.saved; } catch {}
      _rcPanGuard = null;
    }
    _rcDecision = null;
  }

  try {
    canvas.addEventListener('pointerdown', onPointerDownCapture, { capture: true });
  } catch {}
  try { canvas.addEventListener('pointermove', onPointerMoveCapture, { capture: true }); } catch {}
  try { window.addEventListener('pointerup', onPointerUpCapture, { capture: true }); } catch {}
}
