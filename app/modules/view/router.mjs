// Router orchestrator: delegates hover vs. click/drag to separate modules
import { log, logErr } from '../util/log.mjs';
import { routerHandleHover, clearSpaceHover } from './routerHover.mjs';
import { classifyPointerDown, routerIsOverPPOrGizmo, routerHandleCameraDown, routerHandleCameraMove, routerHandleCameraUp } from './routerClick.mjs';

function routerLogsEnabled() {
  const v = localStorage.getItem('dw:dev:routerLogs');
  return (v ?? '1') === '1';
}

export function initRouter(ctx) {
  const { scene, engine, camera, state, Log } = ctx;
  const canvas = engine.getRenderingCanvas();
  const routerState = { scene, engine, camera, state, Log, canvas,
    gesture: { decision: null, ptrId: null, panGuard: null, lastX: 0, lastY: 0 },
    hover: { kind: null, axis: null, mat: null },
    hoverSpace: { id: null, mesh: null },
    ppHover: { mat: null, name: null }
  };
  scene.onPointerObservable.add((pi) => routerOnPointer(pi, routerState));
  window.addEventListener('dw:selectionChange', () => { clearSpaceHover(routerState); });
}

function routerOnPointer(pi, routerState) {
  try {
    const { scene, camera, state, Log, canvas } = routerState;
    const t = pi.type; const e = pi.event || window.event;
    if (t === BABYLON.PointerEventTypes.POINTERDOWN) {
      if (routerLogsEnabled()) { const route = classifyPointerDown({ scene, state, e }); log('ROUTER', 'route', route); }
      if (routerIsOverPPOrGizmo(e, routerState)) {
        camera.inputs?.attached?.pointers?.detachControl(canvas);
        if (e.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
        log('GIZMO', 'pre-capture:router', { pointerId: e.pointerId ?? null });
        return;
      }
      routerHandleCameraDown(e, routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERMOVE) {
      routerHandleCameraMove(routerState);
      routerHandleHover(routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERUP) {
      routerHandleCameraUp(routerState);
    }
  } catch (e) { logErr('router:onPointer', e); }
}

export { classifyPointerDown } from './routerClick.mjs';

