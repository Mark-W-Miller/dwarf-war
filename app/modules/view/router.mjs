// Router orchestrator: delegates hover vs. click/drag to separate modules
import { log, logErr } from '../util/log.mjs';
import { routerHandleHover, clearSpaceHover } from './routerHover.mjs';
import { classifyPointerDown, routerHandleCameraDown, routerHandleCameraMove, routerHandleCameraUp, routerHandlePrimaryClick, routerHandleBrushMove, routerBeginVoxelStroke } from './routerClick.mjs';

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
    ppHover: { mat: null, name: null },
    sceneApi: state?._sceneApi || null
  };
  scene.onPointerObservable.add((pi) => routerOnPointer(pi, routerState));
  window.addEventListener('dw:selectionChange', () => { clearSpaceHover(routerState); });
}

function routerOnPointer(pi, routerState) {
  try {
    const { scene, camera, state, Log, canvas } = routerState;
    const t = pi.type; const e = pi.event || window.event;
    const gizmo2 = state?._selectionGizmo || state?._testGizmo || null;
    if (gizmo2?.isActive?.()) {
      let handled = false;
      if (t === BABYLON.PointerEventTypes.POINTERMOVE) {
        handled = gizmo2.handleMouseOver?.(e) ?? gizmo2.handlePointerMove?.(e) ?? false;
      } else if (t === BABYLON.PointerEventTypes.POINTERDOWN) {
        handled = gizmo2.handleMouseDown?.(e) ?? gizmo2.handlePointerDown?.(e) ?? false;
      } else if (t === BABYLON.PointerEventTypes.POINTERUP) {
        handled = gizmo2.handleMouseUp?.(e) ?? gizmo2.handlePointerUp?.(e) ?? false;
      }
      handled = !!handled;
      if (handled) {
        pi.skipOnPointerObservable = true;
        return;
      }
    }
    if (t === BABYLON.PointerEventTypes.POINTERDOWN) {
      const route = classifyPointerDown({ scene, state, e });
      if (routerLogsEnabled()) { log('ROUTER', 'route', route); }
      // Record down info to detect click on pointerup
      routerState._down = {
        x: scene.pointerX,
        y: scene.pointerY,
        t: Date.now(),
        button: e.button,
        meta: !!e.metaKey,
        ctrl: !!e.ctrlKey,
        shift: !!e.shiftKey,
        route
      };
      // Do not start camera if over PP, gizmo, or space
      const isLeftButton = (e.button === 0);
      const isMiddleButton = (e.button === 1);
      if (isLeftButton && route && (route.hit === 'pp' || route.hit === 'gizmo')) return;
      if (isLeftButton && route && route.hit === 'voxel|space') { routerBeginVoxelStroke(e, routerState, route); return; }
      if (isLeftButton && route && (route.hit === 'space' || route.hit === 'scryball')) return;
      if (isLeftButton || isMiddleButton) {
        routerHandleCameraDown(e, routerState);
      }
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
          handleDoubleClickIfNeeded({ routerState, state, upTime: up.t });
        }
      } catch {}
      routerHandleCameraUp(routerState);
      // End brush
      try { routerState._brush = null; } catch {}
    }
  } catch (e) { logErr('router:onPointer', e); }
}

export { classifyPointerDown } from './routerClick.mjs';

function handleDoubleClickIfNeeded({ routerState, state, upTime }) {
  try {
    const down = routerState._down || null;
    if (!down || down.button !== 0 || down.shift || down.ctrl || down.meta) {
      routerState._lastClick = null;
      return;
    }
    const route = down.route || null;
    if (!route || (route.hit !== 'voxel|space' && route.hit !== 'scryball')) {
      routerState._lastClick = null;
      return;
    }
    if (route.hit === 'voxel|space' && !route.id) {
      routerState._lastClick = null;
      return;
    }

    const last = routerState._lastClick || null;
    const dblThreshold = 360;
    const isDouble = last && last.hit === route.hit && last.id === route.id && (upTime - last.t) <= dblThreshold;
    if (isDouble) {
      if (route.hit === 'voxel|space') {
        if ((state.mode || 'war') === 'war') {
          const sceneApi = state?._sceneApi || routerState.sceneApi || null;
          routerState.sceneApi = sceneApi || routerState.sceneApi;
          try { sceneApi?.enterCavernModeForSpace?.(route.id); } catch {}
        }
      } else if (route.hit === 'scryball') {
        const ball = state?._scry?.ball;
        if (ball && !ball.isDisposed?.()) {
          const sceneApi = state?._sceneApi || routerState.sceneApi || null;
          routerState.sceneApi = sceneApi || routerState.sceneApi;
          let centered = false;
          try {
            if (sceneApi?.centerCameraOnMesh) {
              sceneApi.centerCameraOnMesh(ball);
              centered = true;
            }
          } catch {}
          if (!centered) {
            try {
              const target = ball.getAbsolutePosition?.() || ball.position;
              if (target) {
                const camera = routerState.camera;
                camera?.target?.copyFrom?.(target);
                if (camera) {
                  const lower = (typeof camera.lowerRadiusLimit === 'number' && isFinite(camera.lowerRadiusLimit)) ? camera.lowerRadiusLimit : 2.0;
                  const current = (typeof camera.radius === 'number' && isFinite(camera.radius)) ? camera.radius : lower;
                  const desired = Math.max(lower, Math.min(current, 12));
                  camera.radius = desired;
                  if (typeof camera.upperRadiusLimit === 'number' && camera.upperRadiusLimit < desired * 1.2) {
                    camera.upperRadiusLimit = desired * 1.2;
                  }
                }
              }
            } catch {}
          }
        }
      }
      routerState._lastClick = null;
      return;
    }

    routerState._lastClick = { hit: route.hit, id: route.id || route.hit, t: upTime };
  } catch {
    routerState._lastClick = null;
  }
}
