import { VoxelType, decompressVox } from '../../../voxels/voxelize.mjs';

// Selection UI side-effects: respond to selectionChange bus events
export function initSelectionUI({ state, scene, engine, camera, rebuildHalos, ensureRotWidget, ensureMoveWidget }) {
  try {
    window.addEventListener('dw:selectionChange', (e) => {
      try {
        const sel = (e && e.detail && Array.isArray(e.detail.selection)) ? e.detail.selection : Array.from(state.selection || []);
        if (!sel || sel.length === 0) {
          try { state.hl?.removeAllMeshes?.(); } catch {}
          try { requestAnimationFrame(() => { try { state.hl?.removeAllMeshes?.(); } catch {} }); } catch {}
          try { state.hl.isEnabled = true; } catch {}
          try { ensureMoveWidget?.(); ensureRotWidget?.(); } catch {}
          return;
        }
        try { state.hl.isEnabled = true; } catch {}
        try { ensureRotWidget?.(); ensureMoveWidget?.(); } catch {}
      } catch {}
    });
  } catch {}
}

// Initialize pointer-based selection and double-click behavior
// Expects logging helpers and gizmo accessors to be provided by caller.
export function initPointerSelection(opts) {
  try { opts?.Log?.log?.('TRACE', 'selection:init', { mode: (opts?.state?.mode || null) }); } catch {}
  const {
    scene, engine, camera, state, camApi,
    rebuildHalos, ensureRotWidget, ensureMoveWidget, disposeLiveIntersections,
    voxelHitAtPointerForSpace,
    pickPointOnPlane: pickPointOnPlaneOpt,
    isGizmosSuppressed = () => false,
    getRotWidget = () => null,
    getMoveWidget = () => null,
    enterCavernModeForSpace = () => {},
    ensureConnectGizmoFromSel = () => {},
    disposeConnectGizmo = () => {},
    // logging helpers
    Log,
    dPick = () => {},
    sLog = () => {},
    inputLog = () => {},
    modsOf = () => ({}),
    comboName = () => ''
  } = opts || {};

  // Click trace helpers
  function _genCt() { try { return `ct:${Date.now()}-${Math.floor(Math.random()*1e6)}`; } catch { return `ct:${Date.now()}`; } }
  function trace(tag, data = {}) { try { const ct = state?._clickTrace?.id || null; Log?.log?.('TRACE', `click:${tag}`, { ct, ...data }); } catch {} }
  function startTrace(ev) {
    try {
      const id = _genCt();
      const mods = modsOf(ev || {});
      state._clickTrace = { id, t0: (performance.now ? performance.now() : Date.now()), x: scene.pointerX, y: scene.pointerY, button: ev?.button ?? 0, mods };
      trace('start', { x: scene.pointerX, y: scene.pointerY, button: ev?.button ?? 0, mods });
    } catch {}
  }
  function endTrace(reason) { try { trace('end', { reason }); } catch {} try { state._clickTrace = null; } catch {} }

  // Global pointerup failsafe (release outside canvas) — only handles voxel brush here
  const DOUBLE_CLICK_MS = Number(localStorage.getItem('dw:ui:doubleClickMs') || '500') || 500;
  const _VOX_BRUSH_THROTTLE_MS = 16; // ~60 Hz
  let lastPickName = null;
  let lastPickTime = 0;
  let voxBrush = { active: false, lastAt: 0, pointerId: null };

  // PP gizmo creation/teardown now handled in handlers/gizmo.mjs; we call into that API via opts.

  try {
    window.addEventListener('pointerup', () => {
      try {
        if (voxBrush.active) {
          voxBrush.active = false; voxBrush.pointerId = null; voxBrush.lastAt = 0;
          try { const canvas = engine.getRenderingCanvas(); camera.inputs?.attached?.pointers?.attachControl(canvas, true); } catch {}
          try { inputLog('pointer', 'brush:end', {}); } catch {}
          try { setTimeout(() => { try { scene.render(); } catch {} }, 0); } catch {}
        }
      } catch {}
      try { endTrace('pointerup'); } catch {}
    }, { passive: true });
  } catch {}

  // Keyboard logging (arrows + modifiers) without changing behavior
  ;(function setupKeyboardLogging(){
    try {
      function keyCombo(e){
        const mods = modsOf(e);
        const parts = [];
        if (mods.cmd) parts.push('cmd');
        if (mods.ctrl) parts.push('ctrl');
        if (mods.shift) parts.push('shift');
        if (mods.alt) parts.push('alt');
        parts.push(String(e.key||''));
        return parts.join('-');
      }
      function onKeyDown(e){
        try {
          if (!e || typeof e.key !== 'string') return;
          if (e.key.startsWith('Arrow')) {
            const inScry = !!(state?._scry?.scryMode);
            const decision = inScry ? 'scry:drive' : 'none';
            inputLog('keyboard', 'arrow', { combo: keyCombo(e), decision });
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            inputLog('keyboard', 'delete', { combo: keyCombo(e), selection: Array.from(state?.selection||[]) });
          }
        } catch {}
      }
      window.addEventListener('keydown', onKeyDown, { capture: true });
    } catch {}
  })();

  // Pre-pointer capture: log and prepare voxel brush (Cavern), respect gizmo busy state
  ;(function setupPreCapture(){
    try {
      scene.onPrePointerObservable.add((pi) => {
        try {
          if (state.mode !== 'edit' && state.mode !== 'cavern') return;
          if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
          const ev = pi.event || window.event;
          const _mods = modsOf(ev || {});
          try { inputLog('pointer', 'down-capture', { combo: comboName(ev?.button, _mods), pointerType: ev?.pointerType || 'mouse', x: scene.pointerX, y: scene.pointerY }); } catch {}
          try { if (!state?._clickTrace?.id) startTrace(ev); else trace('pre-capture', { reuse: true, x: scene.pointerX, y: scene.pointerY }); } catch {}
        } catch {}
      });
    } catch {}
  })();

  // Pre-pointer capture: in Cavern mode, claim LMB early to prevent camera rotation; otherwise just observe
  ;(function setupPreVoxelBrushCapture(){
    try {
      scene.onPrePointerObservable.add((pi) => {
        try {
          if (state.mode !== 'edit' && state.mode !== 'cavern') return;
          if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
          if (isGizmosSuppressed() || getRotWidget()?.dragging || getMoveWidget()?.dragging) return;
          const ev = pi.event || window.event;
          const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
          const isCmd = !!(ev && ev.metaKey);
          const isShift = !!(ev && ev.shiftKey);
          const isCtrl = !!(ev && ev.ctrlKey);
          const isAlt = !!(ev && ev.altKey);
          const _mods = modsOf(ev);
          inputLog('pointer', 'down-capture', { combo: comboName(ev?.button, _mods), pointerType: ev?.pointerType || 'mouse', x: scene.pointerX, y: scene.pointerY });
          // In Cavern mode: start brush immediately on plain left click over a voxel to prevent camera rotation
          if (state.mode === 'cavern') {
            if (!isLeft) return;
            if (isCmd || isCtrl || isAlt) return; // respect modifier behaviors
            // Do not start brush if clicking the scry ball
            try {
              const pickScry = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name === 'scryBall');
              if (pickScry?.hit) return;
            } catch {}
            // Do not start brush if clicking a gizmo
            try {
              const onGizmo = (() => {
                const g1 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('moveGizmo:'));
                const g2 = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('rotGizmo:'));
                return !!(g1?.hit || g2?.hit);
              })();
              if (onGizmo) return;
            } catch {}
            // Find nearest voxel hit among all spaces
            let vBest = null;
            try {
              for (const sp of (state?.barrow?.spaces || [])) {
                if (!sp || !sp.vox || !sp.vox.size) continue;
                const hit = voxelHitAtPointerForSpace(sp);
                if (hit && isFinite(hit.t) && (vBest == null || hit.t < vBest.t)) vBest = { ...hit, id: sp.id };
              }
            } catch {}
            if (!vBest) return;
            // Begin brush: detach camera pointers and capture pointer, update voxel selection
            try {
              const canvas = engine.getRenderingCanvas();
              camera.inputs?.attached?.pointers?.detachControl(canvas);
              if (ev && ev.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
              voxBrush.active = true; voxBrush.pointerId = ev && ev.pointerId != null ? ev.pointerId : null; voxBrush.lastAt = 0;
              // Update selection vox array
              const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
              state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
              if (isShift) {
                if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
              } else {
                state.voxSel = [{ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v }];
              }
              try { rebuildHalos(); } catch {}
              try { inputLog('pointer', 'brush:start', { combo: comboName(ev?.button, _mods), id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, add: !!isShift }); } catch {}
            } catch {}
          }
          // In Edit mode: do not start brush here; main handler will manage selection, double-click, and brush
        } catch {}
      });
    } catch {}
  })();

  // Brush-select: while left mouse held after an initial voxel pick, keep adding voxels under the cursor
  try {
    scene.onPointerObservable.add((pi) => {
      try {
        if (!voxBrush.active) return;
        if (pi.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;
        const now = performance.now ? performance.now() : Date.now();
        if (now - voxBrush.lastAt < _VOX_BRUSH_THROTTLE_MS) return;
        voxBrush.lastAt = now;
        // Find nearest voxel hit among all spaces
        let vBest = null;
        try {
          for (const sp of (state?.barrow?.spaces || [])) {
            if (!sp || !sp.vox || !sp.vox.size) continue;
            const hit = voxelHitAtPointerForSpace(sp);
            if (hit && isFinite(hit.t) && (vBest == null || hit.t < vBest.t)) vBest = { ...hit, id: sp.id };
          }
        } catch {}
        if (!vBest) return;
        const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
        state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
        if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) {
          state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
          // Redraw halos to reflect growing voxel selection
          try { rebuildHalos(); } catch {}
        }
        // Block camera rotation while brushing (already detached on start), also stop further pointer processing
        try { const ev = pi.event; ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
        try { pi.skipOnPointerObservable = true; } catch {}
      } catch {}
    });
  } catch {}

  // PP gizmo drag is handled in handlers/gizmo.mjs now.

  // Main pointerdown selection + double-click
  try {
    scene.onPointerObservable.add((pi) => {
      // Only trace click-observer entries for actual click-related events,
      // not for mouseover/move spam.
      try {
        const t = pi.type;
        if (
          t === BABYLON.PointerEventTypes.POINTERDOWN ||
          t === BABYLON.PointerEventTypes.POINTERPICK ||
          t === BABYLON.PointerEventTypes.POINTERTAP ||
          t === BABYLON.PointerEventTypes.POINTERDOUBLETAP
        ) {
          trace('obs', { type: t, mode: state?.mode || null });
        }
      } catch {}
      if (isGizmosSuppressed()) {
        try { const rw = getRotWidget(); if (rw) { rw.dragging = false; rw.preDrag = false; rw.axis = null; } } catch {}
        try { const mw = getMoveWidget(); if (mw) { mw.dragging = false; mw.preDrag = false; mw.axis = null; } } catch {}
        try { Log?.log?.('GIZMO', 'Pointer blocked during voxel-op', { type: pi.type }); } catch {}
        try { trace('blocked:gizmosSuppressed', { type: pi.type }); } catch {}
        return;
      }
      if (state.mode !== 'edit') return;
      // Handle selection logic strictly on POINTERDOWN to avoid duplicate
      // processing from PICK/TAP events that can fire for the same click.
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (getRotWidget()?.dragging || getMoveWidget()?.dragging) return; // do not interfere while dragging gizmo
      const ev = pi.event || window.event;
      dPick('pointerdown', { x: scene.pointerX, y: scene.pointerY });
      sLog('edit:pointerdown', { x: scene.pointerX, y: scene.pointerY });
      try { trace('pointerdown', { x: scene.pointerX, y: scene.pointerY, type: pi.type }); } catch {}
      // Normalize button/modifiers once up front
      const isLeft = (ev && typeof ev.button === 'number') ? (ev.button === 0) : true;
      const isCmd = !!(ev && ev.metaKey);
      const isShift = !!(ev && ev.shiftKey);
      const isCtrl = !!(ev && ev.ctrlKey);
      // On macOS, Ctrl+LeftClick emulates RightClick. Treat that as NOT a left click
      // for selection so it doesn't trigger selection paths.
      const isEmulatedRC = (!!isCtrl && !isCmd && isLeft);
      const isLeftMeaningful = isLeft && !isEmulatedRC;
      // Priority: gizmo (handled elsewhere) → PP node → voxel → empty
      if (!isCmd && isLeftMeaningful) {
        try {
          const ppPick = scene.pick(scene.pointerX, scene.pointerY, (m) => m && m.name && String(m.name).startsWith('connect:node:'));
          if (ppPick?.hit && ppPick.pickedMesh) {
            try { trace('pp:hit', { name: ppPick.pickedMesh?.name || null }); } catch {}
            const n = String(ppPick.pickedMesh.name || '');
            state._connect = state._connect || {};
            const sel = (state._connect.sel instanceof Set) ? state._connect.sel : (state._connect.sel = new Set());
            if (isShift) {
              if (sel.has(n)) sel.delete(n); else sel.add(n);
            } else {
              sel.clear(); sel.add(n);
            }
            try { sLog?.('pp:select', { node: n, selection: Array.from(sel) }); } catch {}
            try { inputLog('pointer', 'pp:select', { node: n, add: !!isShift }); } catch {}
            try { ensureConnectGizmoFromSel(); } catch {}
            // In future: ensure PP gizmo visibility here
            // Stop further handling (voxel/space selection)
            try { ev?.stopImmediatePropagation?.(); ev?.stopPropagation?.(); ev?.preventDefault?.(); } catch {}
            try { pi.skipOnPointerObservable = true; } catch {}
            try { trace('handled:pp', { selection: Array.from(state?._connect?.sel || []) }); } catch {}
            return;
          }
        } catch {}
      }
      let pick = scene.pick(
        scene.pointerX,
        scene.pointerY,
        (m) => {
          if (!m || typeof m.name !== 'string') return false;
          const n = m.name;
          // Allow any mesh that belongs to a space (including label/voxel walls),
          // so clicks on visible parts still hit. Cavern meshes also count.
          return n.startsWith('space:') || n.startsWith('cavern:');
        }
      );
      dPick('primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null });
      sLog('edit:primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null });
      try { trace('primaryPick', { hit: !!pick?.hit, name: pick?.pickedMesh?.name || null, dist: pick?.distance ?? null }); } catch {}
      // For Cmd+Left, honor only the direct primary pick (no fallback) to avoid
      // selecting a different space than the one under the cursor.
      if (isCmd && isLeftMeaningful) {
        if (pick?.hit && pick.pickedMesh && String(pick.pickedMesh.name||'').startsWith('space:')) {
          const pickedName = String(pick.pickedMesh.name||'');
          let _id = pickedName.slice('space:'.length).split(':')[0];
          state.selection.clear();
          state.selection.add(_id);
          try { rebuildHalos(); ensureRotWidget(); ensureMoveWidget(); } catch {}
          try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
          try { disposeConnectGizmo(); } catch {}
          try { trace('handled:space:single', { id: _id, selection: Array.from(state.selection) }); } catch {}
        }
        return;
      }

      // Fallback: robust ray/mesh intersection if Babylon pick misses (non-Cmd paths only)
      if (!pick?.hit || !pick.pickedMesh) {
        try {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
          let best = null;
          for (const entry of (state?.built?.spaces || [])) {
            const mesh = entry?.mesh; if (!mesh) continue;
            const info = ray.intersectsMesh(mesh, false);
            if (info?.hit) {
              if (!best || info.distance < best.distance) best = { info, mesh, id: entry.id };
            }
          }
          if (best) {
            pick = { hit: true, pickedMesh: best.mesh, distance: best.info.distance };
            dPick('fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance });
            sLog('edit:fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance });
            try { trace('fallbackPick', { id: best.id, name: best.mesh?.name || null, dist: best.info.distance }); } catch {}
          } else {
            dPick('fallbackPickMiss', {});
            sLog('edit:fallbackPickMiss', {});
            try { trace('fallbackPick:miss', {}); } catch {}
          }
        } catch {}
      }
      if (!pick?.hit || !pick.pickedMesh) {
        // No mesh hit
        if (isLeftMeaningful) {
          // LC on empty: clear selection
          try { state.selection.clear(); } catch {}
          try { rebuildHalos(); } catch {}
          try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: [] } })); } catch {}
          try { inputLog('pointer', 'select:deselectAll', { combo: comboName(ev?.button, modsOf(ev)), via: isCmd ? 'cmd-left-empty' : 'left-empty' }); } catch {}
          try { disposeConnectGizmo(); } catch {}
          try { trace('handled:empty', {}); } catch {}
        } else {
          try { inputLog('pointer', 'noHit:ignore', { combo: comboName(ev?.button, modsOf(ev)) }); } catch {}
          try { trace('noHit:ignore', {}); } catch {}
        }
        return;
      }
      const pickedName = pick.pickedMesh.name; // space:<id> or cavern:<id> or space:<id>:label
      let id = '';
      let name = pickedName;
      if (pickedName.startsWith('space:')) {
        const rest = pickedName.slice('space:'.length);
        // Extract bare id before any suffix like :label or :wall:...
        id = rest.split(':')[0];
        name = 'space:' + id; // normalize for double-click detection
      } else if (pickedName.startsWith('cavern:')) {
        id = pickedName.slice('cavern:'.length);
        name = 'cavern:' + id;
      }
      // Cmd-Click selection handled above on primary pick only; skip here.
      dPick('selectId', { id, name });
      // Only compute voxel pick for plain LC (Cmd ignored per spec)
      sLog('edit:selectId', { id, name });
      try { trace('selectId', { id, name }); } catch {}
      // Double-click detection before handling plain-left voxel selection
      {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (name === lastPickName && (now - lastPickTime) <= DOUBLE_CLICK_MS) {
          dPick('doubleClick', { name, id });
          sLog('edit:doubleClick', { name, id });
          try { trace('doubleClick', { name, id }); } catch {}
          // Double-click enters Cavern Mode only for voxelized spaces; otherwise center.
          if (name.startsWith('space:')) {
            let sp = null; try { sp = (state?.barrow?.spaces || []).find(x => x && x.id === id) || null; } catch {}
            if (sp && sp.vox && sp.vox.size) {
              try { enterCavernModeForSpace(id); } catch {}
            } else {
              try { camApi.centerOnMesh(pick.pickedMesh); } catch (err) { Log?.log?.('ERROR', 'Center on item failed', { error: String(err) }); }
            }
          } else {
            try { camApi.centerOnMesh(pick.pickedMesh); } catch (err) { Log?.log?.('ERROR', 'Center on item failed', { error: String(err) }); }
          }
          lastPickName = '';
          lastPickTime = 0;
          try { trace('handled:dbl', {}); } catch {}
          return;
        }
        lastPickName = name;
        lastPickTime = now;
        try { trace('dbl:arm', { name, lastPickTime }); } catch {}
      }
      // If voxel hit exists on plain left click (no Cmd), handle voxel selection
      // Restrict voxel picking to the picked space only to avoid cross-selecting
      // another voxelized space when clicking a non-voxelized one.
      if (isLeftMeaningful && !isCmd) {
        let vBest = null;
        try {
          if (name.startsWith('space:')) {
            const s = (state?.barrow?.spaces || []).find(x => x && x.id === id);
            if (s && s.vox && s.vox.size) {
              const hit = voxelHitAtPointerForSpace(s);
              if (hit && isFinite(hit.t)) vBest = { ...hit, id: s.id };
            }
          }
        } catch {}
        if (vBest) {
          try {
            // Apply voxel selection semantics: shift adds, otherwise replace
            const k = `${vBest.id}:${vBest.ix},${vBest.iy},${vBest.iz}`;
            state.voxSel = Array.isArray(state.voxSel) ? state.voxSel : [];
            if (isShift) {
              if (!state.voxSel.some(p => p && `${p.id}:${p.x},${p.y},${p.z}` === k)) state.voxSel.push({ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v });
            } else {
              state.voxSel = [{ id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, v: vBest.v }];
            }
            // Begin brush mode: while mouse is down, add voxels under cursor; disable camera rotation during brush
            try {
              const canvas = engine.getRenderingCanvas();
              camera.inputs?.attached?.pointers?.detachControl(canvas);
              const pe = pi.event; if (pe && pe.pointerId != null && canvas.setPointerCapture) canvas.setPointerCapture(pe.pointerId);
              voxBrush.active = true; voxBrush.pointerId = pe && pe.pointerId != null ? pe.pointerId : null; voxBrush.lastAt = 0;
              // Prevent camera from starting a rotate on this gesture
              try { pe?.stopImmediatePropagation?.(); pe?.stopPropagation?.(); pe?.preventDefault?.(); } catch {}
              try { pi.skipOnPointerObservable = true; } catch {}
            } catch {}
            // Do not alter space selection; just redraw halos to show picks
            rebuildHalos();
            try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
            try { inputLog('pointer', 'voxel:pick', { combo: comboName(ev?.button, modsOf(ev)), id: vBest.id, x: vBest.ix, y: vBest.iy, z: vBest.iz, add: !!isShift }); } catch {}
            try { disposeConnectGizmo(); } catch {}
            try { trace('handled:voxel', {}); } catch {}
          } catch {}
          return; // handled voxel selection
        }
      }

      // Selection rules (space selection)
      // Updated semantics:
      // - Cmd+Left: select this space (clear others)
      // - Shift+Cmd+Left: add this space to selection (multi-select)
      // - Plain Left: does NOT change space selection (voxel picks still allowed above)
      try {
        // isLeft/isCmd/isShift computed above
        if (!isLeft) { /* only act on left button */ }
        else if (!isCmd) {
          // Plain left-click: optional space selection (compat)
          const plainSelectOn = (() => { try { return (localStorage.getItem('dw:ui:spaceSelectPlain') ?? '1') === '1'; } catch { return true; } })();
          if (isLeftMeaningful && plainSelectOn && name.startsWith('space:')) {
            state.selection.clear();
            state.selection.add(id);
            const selNow = Array.from(state.selection);
            sLog('edit:updateSelection', { selection: selNow, via: 'plain-left:single', id });
            try { inputLog('pointer', 'select:single:plain', { combo: comboName(ev?.button, modsOf(ev)), id, selection: selNow }); } catch {}
            rebuildHalos();
            try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
            ensureRotWidget(); ensureMoveWidget(); disposeLiveIntersections?.();
            try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
            try { disposeConnectGizmo(); } catch {}
            try { trace('handled:space:plain', { id }); } catch {}
          }
          return;
      } else {
        // Cmd held: if we already picked a space by name above, honor that exact
        // pick. Only fall back to nearest voxel-backed space when the pick is not
        // a space (e.g., label disabled or other mesh).
        if (!name.startsWith('space:')) {
          try {
            let best = { t: Infinity, id: null };
            for (const sp of (state?.barrow?.spaces || [])) {
              if (!sp || !sp.vox || !sp.vox.size) continue;
              const hit = voxelHitAtPointerForSpace(sp);
              if (hit && isFinite(hit.t) && hit.t < best.t) best = { t: hit.t, id: sp.id };
            }
            if (best.id) { id = best.id; name = 'space:' + id; }
          } catch {}
        }

          if (isShift) {
            // Shift+Cmd: multi-select (add-only)
            state.selection.add(id);
            const selNow = Array.from(state.selection);
            sLog('edit:updateSelection', { selection: selNow, via: 'shift-cmd-left:add', id });
            try { inputLog('pointer', 'select:add', { combo: comboName(ev?.button, modsOf(ev)), id, selection: selNow }); } catch {}
            try { trace('handled:space:add', { id, selection: selNow }); } catch {}
          } else {
            // Cmd only: single-select (clear others)
            state.selection.clear();
            state.selection.add(id);
            const selNow = Array.from(state.selection);
            sLog('edit:updateSelection', { selection: selNow, via: 'cmd-left:single', id });
            try { inputLog('pointer', 'select:single', { combo: comboName(ev?.button, modsOf(ev)), id, selection: selNow }); } catch {}
            try { trace('handled:space:single', { id, selection: selNow }); } catch {}
          }
          rebuildHalos();
          try { scene.render(); requestAnimationFrame(() => { try { scene.render(); } catch {} }); } catch {}
          ensureRotWidget(); ensureMoveWidget(); disposeLiveIntersections?.();
        try { window.dispatchEvent(new CustomEvent('dw:selectionChange', { detail: { selection: Array.from(state.selection) } })); } catch {}
        try { disposeConnectGizmo(); } catch {}
      }
    } catch {}

      // (double-click handled above)

      // If a voxelized space is selected and clicked, compute the voxel indices at the picked point and emit an event
      try {
        if (name.startsWith('space:')) {
          const s = (state?.barrow?.spaces || []).find(x => x && x.id === id);
          if (s && s.vox && s.vox.size) {
            const vox = decompressVox(s.vox);
            const nx = Math.max(1, vox.size?.x || 1);
            const ny = Math.max(1, vox.size?.y || 1);
            const nz = Math.max(1, vox.size?.z || 1);
            const res = vox.res || s.res || (state?.barrow?.meta?.voxelSize || 1);
            // Ray-grid DDA: walk cells along camera ray, skipping hidden (exposed) layers and empty/uninstantiated
            // Transform ray into space-local coordinates (voxel axes)
            const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
            const roW = ray.origin.clone(), rdW = ray.direction.clone();
            const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
            let q = BABYLON.Quaternion.Identity();
            const worldAligned = !!(s.vox && s.vox.worldAligned);
            try {
              if (!worldAligned) {
                const rx = Number(s.rotation?.x ?? 0) || 0;
                const ry = (s.rotation && typeof s.rotation.y === 'number') ? Number(s.rotation.y) : Number(s.rotY || 0) || 0;
                const rz = Number(s.rotation?.z ?? 0) || 0;
                q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
              } else {
                q = BABYLON.Quaternion.Identity();
              }
            } catch {}
            const qInv = BABYLON.Quaternion.Inverse(q);
            const rotInv = (() => { try { return BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero()); } catch { return BABYLON.Matrix.Identity(); } })();
            const roL = BABYLON.Vector3.TransformCoordinates(roW.subtract(new BABYLON.Vector3(cx, cy, cz)), rotInv);
            const rdL = BABYLON.Vector3.TransformNormal(rdW, rotInv);
            // Local AABB in voxel space
            const minX = -(nx * res) / 2, maxX = +(nx * res) / 2;
            const minY = -(ny * res) / 2, maxY = +(ny * res) / 2;
            const minZ = -(nz * res) / 2, maxZ = +(nz * res) / 2;
            const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / v);
            const tx1 = (minX - roL.x) * inv(rdL.x), tx2 = (maxX - roL.x) * inv(rdL.x);
            const ty1 = (minY - roL.y) * inv(rdL.y), ty2 = (maxY - roL.y) * inv(rdL.y);
            const tz1 = (minZ - roL.z) * inv(rdL.z), tz2 = (maxZ - roL.z) * inv(rdL.z);
            const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
            const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
            if (!(tmax >= Math.max(0, tmin))) { dPick('voxelPick:rayMissAABB', {}); return; }
            const EPS = 1e-6;
            let t = Math.max(tmin, 0) + EPS;
            const pos = new BABYLON.Vector3(roL.x + rdL.x * t, roL.y + rdL.y * t, roL.z + rdL.z * t);
            const toIdx = (x, y, z) => ({
              ix: Math.min(nx-1, Math.max(0, Math.floor((x - minX) / res))),
              iy: Math.min(ny-1, Math.max(0, Math.floor((y - minY) / res))),
              iz: Math.min(nz-1, Math.max(0, Math.floor((z - minZ) / res))),
            });
            let { ix, iy, iz } = toIdx(pos.x, pos.y, pos.z);
            const stepX = (rdL.x > 0) ? 1 : (rdL.x < 0 ? -1 : 0);
            const stepY = (rdL.y > 0) ? 1 : (rdL.y < 0 ? -1 : 0);
            const stepZ = (rdL.z > 0) ? 1 : (rdL.z < 0 ? -1 : 0);
            const nextBound = (i, step, min) => min + (i + (step > 0 ? 1 : 0)) * res;
            let tMaxX = (stepX !== 0) ? (nextBound(ix, stepX, minX) - roL.x) / rdL.x : Infinity;
            let tMaxY = (stepY !== 0) ? (nextBound(iy, stepY, minY) - roL.y) / rdL.y : Infinity;
            let tMaxZ = (stepZ !== 0) ? (nextBound(iz, stepZ, minZ) - roL.z) / rdL.z : Infinity;
            const tDeltaX = (stepX !== 0) ? Math.abs(res / rdL.x) : Infinity;
            const tDeltaY = (stepY !== 0) ? Math.abs(res / rdL.y) : Infinity;
            const tDeltaZ = (stepZ !== 0) ? Math.abs(res / rdL.z) : Infinity;
            // Respect expose-top slicing: ignore cells with y >= yCut
            let hideTop = 0; try { hideTop = Math.max(0, Math.min(ny, Math.floor(Number(s.voxExposeTop || 0) || 0))); } catch {}
            const yCut = ny - hideTop;
            const data = Array.isArray(vox.data) ? vox.data : [];
            let found = false;
            let guard = 0, guardMax = (nx + ny + nz) * 3 + 10;
            while (t <= tmax + EPS && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz && guard++ < guardMax) {
              if (iy < yCut) {
                const flat = ix + nx * (iy + ny * iz);
                const v = data[flat] ?? VoxelType.Uninstantiated;
                if (v !== VoxelType.Uninstantiated && v !== VoxelType.Empty) {
                  try { s.voxPick = { x: ix, y: iy, z: iz, v }; } catch {}
                  try { window.dispatchEvent(new CustomEvent('dw:voxelPick', { detail: { id: s.id, i: ix, j: iy, k: iz, v } })); } catch {}
                  dPick('voxelPick:DDA', { id: s.id, ix, iy, iz, v });
                  found = true;
                  break;
                }
              }
              // advance to next cell boundary
              if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; t = tMaxX + EPS; tMaxX += tDeltaX; }
              else if (tMaxY <= tMaxX && tMaxY <= tMaxZ) { iy += stepY; t = tMaxY + EPS; tMaxY += tDeltaY; }
              else { iz += stepZ; t = tMaxZ + EPS; tMaxZ += tDeltaZ; }
            }
            if (!found) dPick('voxelPick:notFound', { id: s.id });
          }
        }
      } catch (e) { try { Log?.log?.('ERROR', 'EH:voxelPick', { error: String(e && e.message ? e.message : e) }); } catch {} }
    });
  } catch {}
}

// Compute the world-space center of the current space selection.
// Uses built meshes' bounding boxes for accuracy.
export function getSelectionCenter(state) {
  try {
    const ids = Array.from(state?.selection || []);
    if (!ids.length) return null;
    const builtSpaces = Array.isArray(state?.built?.spaces) ? state.built.spaces : [];
    const entries = builtSpaces.filter(x => x && ids.includes(x.id));
    if (!entries.length) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const e of entries) {
      try { e.mesh.computeWorldMatrix(true); e.mesh.refreshBoundingInfo(); } catch {}
      const bb = e.mesh.getBoundingInfo()?.boundingBox; if (!bb) continue;
      const bmin = bb.minimumWorld, bmax = bb.maximumWorld;
      minX = Math.min(minX, bmin.x); minY = Math.min(minY, bmin.y); minZ = Math.min(minZ, bmin.z);
      maxX = Math.max(maxX, bmax.x); maxY = Math.max(maxY, bmax.y); maxZ = Math.max(maxZ, bmax.z);
    }
    if (!isFinite(minX)) return null;
    return new BABYLON.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  } catch { return null; }
}
