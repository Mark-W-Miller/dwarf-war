// Router orchestrator: delegates hover vs. click/drag to separate modules
import { log, logErr } from '../util/log.mjs';
import { routerHandleHover, clearSpaceHover } from './routerHover.mjs';
import { classifyPointerDown, routerIsOverPPOrGizmo, routerHandleCameraDown, routerHandleCameraMove, routerHandleCameraUp, routerHandlePrimaryClick, routerHandleBrushMove } from './routerClick.mjs';

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
      const route = classifyPointerDown({ scene, state, e });
      if (routerLogsEnabled()) { log('ROUTER', 'route', route); }
      // Record down info to detect click on pointerup
      routerState._down = { x: scene.pointerX, y: scene.pointerY, t: Date.now(), button: e.button, meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey };
      // Do not start camera if over PP, gizmo, or space
      if (route && (route.hit === 'pp' || route.hit === 'gizmo')) return;
      if (route && (route.hit === 'space' || route.hit === 'voxel|space')) return;
      routerHandleCameraDown(e, routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERMOVE) {
      routerHandleCameraMove(routerState);
      // Extend voxel brush when active (Shift+LC across voxels)
      routerHandleBrushMove(routerState);
      routerHandleHover(routerState);
    } else if (t === BABYLON.PointerEventTypes.POINTERUP) {
      // Detect quick click (small move + short time) for primary actions
      try {
        const up = { x: scene.pointerX, y: scene.pointerY, t: Date.now(), button: (pi.event && typeof pi.event.button === 'number') ? pi.event.button : 0 };
        const dn = routerState._down || null;
        const dx = dn ? Math.abs(up.x - dn.x) : 9999;
        const dy = dn ? Math.abs(up.y - dn.y) : 9999;
        const dt = dn ? (up.t - dn.t) : 9999;
        const isClick = dn && up.button === dn.button && dx <= 3 && dy <= 3 && dt <= 320;
        if (isClick) {
          // Prefer selection/click actions before releasing camera gesture
          routerHandlePrimaryClick(pi.event || window.event, routerState);
        }
      } catch {}
      routerHandleCameraUp(routerState);
      // End brush
      try { routerState._brush = null; } catch {}
    }
  } catch (e) { logErr('router:onPointer', e); }
}

export { classifyPointerDown } from './routerClick.mjs';
