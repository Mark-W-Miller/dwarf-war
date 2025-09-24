import { VoxelType, bakeHollowContainer, fillAllVoxels } from '../voxels/voxelize.mjs';
import { mergeOverlappingSpaces, mergeOverlappingSpacesAsync } from '../barrow/merge.mjs';
import { Log } from '../util/log.mjs';

export function initVoxelTab(panelContent, api) {
  const tabsBar = panelContent.querySelector('.tabs');
  const editPane = panelContent.querySelector('#tab-edit');
  const dbPane = panelContent.querySelector('#tab-db');
  const settingsPane = panelContent.querySelector('#tab-settings');
  if (!tabsBar || !dbPane || !editPane || !settingsPane) return;

  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab'; tabBtn.dataset.tab = 'tab-vox'; tabBtn.textContent = 'Voxel';
  tabsBar.appendChild(tabBtn);
  const voxPane = document.createElement('div'); voxPane.id = 'tab-vox'; voxPane.className = 'tab-pane'; panelContent.appendChild(voxPane);

  // Controls — two-column grouped layout
  const groups = document.createElement('div');
  // Force two-column layout using CSS grid so groups are true columns
  Object.assign(groups.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    alignItems: 'start'
  });
  voxPane.appendChild(groups);
  const opsGroup = document.createElement('div');
  Object.assign(opsGroup.style, { minWidth: '0', border: '1px solid #1e2a30', borderRadius: '8px', padding: '8px' });
  const opsTitle = document.createElement('h3'); opsTitle.textContent = 'Voxel Operations'; opsTitle.style.marginTop = '0'; opsGroup.appendChild(opsTitle);
  const opsCol = document.createElement('div'); Object.assign(opsCol.style, { display: 'flex', flexDirection: 'column', gap: '8px' }); opsGroup.appendChild(opsCol);
  const dbgGroup = document.createElement('div');
  Object.assign(dbgGroup.style, { minWidth: '0', border: '1px solid #1e2a30', borderRadius: '8px', padding: '8px' });
  const dbgTitle = document.createElement('h3'); dbgTitle.textContent = 'Debug View Options'; dbgTitle.style.marginTop = '0'; dbgGroup.appendChild(dbgTitle);
  const dbgCol = document.createElement('div'); Object.assign(dbgCol.style, { display: 'flex', flexDirection: 'column', gap: '8px' }); dbgGroup.appendChild(dbgCol);
  groups.appendChild(opsGroup); groups.appendChild(dbgGroup);

  // Controls — whole-space ops first (in operations group)
  const row1 = document.createElement('div'); row1.className = 'row';
  const labelT = document.createElement('label'); labelT.style.display = 'inline-flex'; labelT.style.alignItems = 'center'; labelT.style.gap = '6px';
  labelT.textContent = 'Wall Thickness';
  const tInput = document.createElement('input'); tInput.type = 'number'; tInput.min = '1'; tInput.step = '1'; tInput.value = '1'; tInput.style.width = '64px';
  labelT.appendChild(tInput); row1.appendChild(labelT);
  const bakeBtn = document.createElement('button'); bakeBtn.className = 'btn'; bakeBtn.textContent = 'Bake Voxels (Walls + Empty)'; row1.appendChild(bakeBtn);
  opsCol.appendChild(row1);

  const row2 = document.createElement('div'); row2.className = 'row';
  const mergeBtn = document.createElement('button'); mergeBtn.className = 'btn'; mergeBtn.textContent = 'Hard Merge Spaces'; row2.appendChild(mergeBtn);
  const softMergeBtn = document.createElement('button'); softMergeBtn.className = 'btn'; softMergeBtn.textContent = 'Soft Merge Spaces'; row2.appendChild(softMergeBtn);
  const fillBtn = document.createElement('button'); fillBtn.className = 'btn'; fillBtn.textContent = 'Fill Space Voxels = Rock'; row2.appendChild(fillBtn);
  // Progress + Cancel cluster
  const progWrap = document.createElement('div'); progWrap.style.display = 'none'; progWrap.style.alignItems = 'center'; progWrap.style.gap = '8px';
  const progTrack = document.createElement('div'); progTrack.style.width = '160px'; progTrack.style.height = '8px'; progTrack.style.border = '1px solid #2b3a42'; progTrack.style.borderRadius = '6px'; progTrack.style.background = '#0f151a'; progTrack.style.overflow = 'hidden';
  const progBar = document.createElement('div'); progBar.style.height = '100%'; progBar.style.width = '0%'; progBar.style.background = 'linear-gradient(90deg, #3aa6ff, #59d0ff)'; progBar.style.transition = 'width 120ms linear'; progTrack.appendChild(progBar);
  const progPct = document.createElement('span'); progPct.style.fontSize = '11px'; progPct.style.color = '#a7bac3'; progPct.textContent = '0%';
  progWrap.appendChild(progTrack); progWrap.appendChild(progPct); row2.appendChild(progWrap);
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn warn'; cancelBtn.textContent = 'Cancel'; cancelBtn.disabled = true; row2.appendChild(cancelBtn);
  opsCol.appendChild(row2);

  // Central tab activation is handled elsewhere; we just log
  tabBtn.addEventListener('click', () => { try { Log.log('UI', 'Activate tab', { tab: 'Voxel' }); } catch {} });

  function getSelectedSpaces() {
    try {
      const sel = Array.from(api.state.selection || []);
      const byId = new Map((api.state.barrow.spaces||[]).map(s => [s.id, s]));
      return sel.map(id => byId.get(id)).filter(Boolean);
    } catch { return []; }
  }

  // ——— Selection info section (moved from Properties into Voxel tab) ———
  const selBox = document.createElement('div'); selBox.id = 'voxSelection'; voxPane.appendChild(selBox);
  const selTitle = document.createElement('h3'); selTitle.textContent = 'Selection'; selBox.appendChild(selTitle);
  const selContent = document.createElement('div'); selBox.appendChild(selContent);
  function renderSelection() {
    const spaces = getSelectedSpaces();
    selContent.innerHTML = '';
    const makeRow = (label, value) => {
      const row = document.createElement('div'); row.className = 'row';
      const b = document.createElement('b'); b.textContent = label + ':'; b.style.minWidth = '120px';
      const span = document.createElement('span'); span.textContent = value;
      row.appendChild(b); row.appendChild(span); selContent.appendChild(row);
    };
    const vName = (val) => { try { return Object.keys(VoxelType).find(k => VoxelType[k] === val) || String(val); } catch { return String(val); } };
    const renderLastPick = () => {
      try {
        const lp = api?.state?.lastVoxPick;
        if (!lp || lp.id == null) return;
        const msg = `space ${lp.id}: (${lp.x|0}, ${lp.y|0}, ${lp.z|0}) = ${vName(lp.v)}`;
        const row = document.createElement('div'); row.className = 'row';
        const b = document.createElement('b'); b.textContent = 'Last Voxel Pick:'; b.style.minWidth = '120px';
        const span = document.createElement('span'); span.textContent = msg;
        row.appendChild(b); row.appendChild(span); selContent.appendChild(row);
      } catch {}
    };
    if (spaces.length === 0) { selContent.appendChild(document.createTextNode('No selection.')); renderLastPick(); return; }
    if (spaces.length > 1) {
      // Group selection: if 2+ have voxels, show a group expose control that applies a relative delta to all
      const voxed = spaces.filter(s => s && s.vox && s.vox.size);
      selContent.appendChild(document.createTextNode(`${spaces.length} spaces selected.`));
      if (voxed.length >= 2) {
        const vTitleG = document.createElement('h3'); vTitleG.textContent = 'Voxel Map (Group)'; selContent.appendChild(vTitleG);
        const rows = document.createElement('div'); rows.className = 'row'; rows.style.alignItems = 'center'; rows.style.gap = '8px';
        const label = document.createElement('b'); label.textContent = 'Expose (top layers):'; label.style.minWidth = '120px';
        // Compute base averages and per-space bases
        const bases = voxed.map(s => ({ s, vy: Math.max(0, s.vox?.size?.y|0), e: Math.max(0, Math.min((s.vox?.size?.y|0), Number(s.voxExposeTop||0))) }));
        const baseAvg = Math.round(bases.reduce((a,b)=>a+(b.e||0),0) / Math.max(1, bases.length));
        const maxY = Math.max(0, bases.reduce((m,b)=>Math.max(m, b.vy), 0));
        const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String(maxY); range.step = '1'; range.value = String(baseAvg); range.style.flex = '1';
        const num = document.createElement('input'); num.type = 'number'; num.min = '0'; num.max = String(maxY); num.step = '1'; num.value = String(baseAvg); num.style.width = '72px';
        const reset = document.createElement('button'); reset.className = 'btn'; reset.textContent = 'Reset All';
        rows.appendChild(label); rows.appendChild(range); rows.appendChild(num); rows.appendChild(reset); selContent.appendChild(rows);

        let timer = null; const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { api.rebuildScene?.(); } catch {}; timer = null; }, 60); };
        const applyGroup = (targetVal) => {
          const v = Math.max(0, Math.min(maxY, Math.floor(Number(targetVal)||0)));
          range.value = String(v); num.value = String(v);
          const delta = v - baseAvg;
          for (const b of bases) { try { b.s.voxExposeTop = Math.max(0, Math.min(b.vy, (b.e + delta)|0)); } catch {} }
          schedule();
        };
        range.addEventListener('input', () => applyGroup(range.value));
        num.addEventListener('input', () => applyGroup(num.value));
        reset.addEventListener('click', () => { applyGroup(0); });
      }
      renderLastPick();
      return;
    }
    const s = spaces[0];
    makeRow('id', s.id);
    makeRow('type', s.type);
    makeRow('res', String(s.res ?? (api.state.barrow?.meta?.voxelSize || 1)));
    makeRow('size (vox)', `${s.size?.x||0} × ${s.size?.y||0} × ${s.size?.z||0}`);
    makeRow('origin', `${Number(s.origin?.x||0).toFixed(2)}, ${Number(s.origin?.y||0).toFixed(2)}, ${Number(s.origin?.z||0).toFixed(2)}`);
    const rx = Number(s.rotation?.x||0), ry = Number(s.rotation?.y||0), rz = Number(s.rotation?.z||0);
    makeRow('rotation (rad)', `${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}`);
    const vTitle = document.createElement('h3'); vTitle.textContent = 'Voxel Map'; selContent.appendChild(vTitle);
    if (s.vox && s.vox.size) {
      const vx = s.vox.size?.x||0, vy = s.vox.size?.y||0, vz = s.vox.size?.z||0;
      makeRow('dimensions', `${vx} × ${vy} × ${vz}`);
      makeRow('resolution', String(s.vox.res || s.res || api.state.barrow?.meta?.voxelSize || 1));
      try { const len = Array.isArray(s.vox.data) ? s.vox.data.length : (s.vox.data?.rle?.length || 0); makeRow('data (len)', String(len)); } catch {}

      // Expose control: hide top N layers (slice from top down)
      const exposeRow = document.createElement('div'); exposeRow.className = 'row'; exposeRow.style.alignItems = 'center'; exposeRow.style.gap = '8px';
      const label = document.createElement('b'); label.textContent = 'Expose (top layers):'; label.style.minWidth = '120px';
      const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String(Math.max(0, vy)); range.step = '1'; range.value = String(Math.max(0, Math.min(vy, Number(s.voxExposeTop || 0)))); range.style.flex = '1';
      const num = document.createElement('input'); num.type = 'number'; num.min = '0'; num.max = String(Math.max(0, vy)); num.step = '1'; num.value = String(Math.max(0, Math.min(vy, Number(s.voxExposeTop || 0)))); num.style.width = '72px';
      const reset = document.createElement('button'); reset.className = 'btn'; reset.textContent = 'Reset';
      exposeRow.appendChild(label); exposeRow.appendChild(range); exposeRow.appendChild(num); exposeRow.appendChild(reset);
      selContent.appendChild(exposeRow);

      let timer = null; const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { api.rebuildScene?.(); } catch {}; timer = null; }, 60); };
      const clamp = (v) => Math.max(0, Math.min(vy, Math.floor(Number(v)||0)));
      const update = (v, doRebuild = false) => { const nv = clamp(v); range.value = String(nv); num.value = String(nv); try { s.voxExposeTop = nv; } catch {}; if (doRebuild) schedule(); };
      range.addEventListener('input', () => update(range.value, true));
      num.addEventListener('input', () => update(num.value, true));
      reset.addEventListener('click', () => update(0, true));

      // Last picked voxel info (click in viewport)
      const pickInfoRow = document.createElement('div'); pickInfoRow.className = 'row';
      const pickLabel = document.createElement('b'); pickLabel.textContent = 'Voxel Pick:'; pickLabel.style.minWidth = '120px';
      const pickSpan = document.createElement('span');
      const renderPick = () => {
        const p = s.voxPick; // { x,y,z,v }
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number') {
          pickSpan.textContent = `(${p.x}, ${p.y}, ${p.z}) = ${vName(p.v)}`;
        } else {
          pickSpan.textContent = 'Click a voxel in the viewport';
        }
      };
      renderPick();
      pickInfoRow.appendChild(pickLabel); pickInfoRow.appendChild(pickSpan);
      selContent.appendChild(pickInfoRow);
    } else {
      selContent.appendChild(document.createTextNode('No voxel data for this space.'));
    }
  }

  bakeBtn.addEventListener('click', async () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:disable')); } catch {}
    const t = Math.max(1, Math.floor(Number(tInput.value || '1')));
    Log.log('UI', 'Voxel bake', { sel: spaces.map(s => s?.id), wallThickness: t });
    for (const s of spaces) {
      try {
        const vox = bakeHollowContainer(s, { wallThickness: t });
        s.voxelized = 1; // prevent transforms
        s.vox = vox; // attach baked voxels to space
      } catch {}
    }
    try { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-bake', sel: spaces.map(s => s.id), wallThickness: t } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:enable')); } catch {}
  });

  // New: explicit Merge button handler (union merge of overlapping spaces)
  let _cancelMerge = { value: false };
  cancelBtn.addEventListener('click', () => { if (!cancelBtn.disabled) { _cancelMerge.value = true; try { Log.log('UI', 'Cancel voxel op', {}); } catch {} } });

  // Progress helpers shared by merge flows
  let _nyTotal = 0;
  function _showProg() { progWrap.style.display = 'flex'; }
  function _hideProg() { progWrap.style.display = 'none'; progBar.style.width = '0%'; progPct.textContent = '0%'; }
  function _setProgFromLayer(y) { if (_nyTotal > 0) { const pct = Math.max(0, Math.min(100, Math.round(((y+1) * 100) / _nyTotal))); progBar.style.width = pct + '%'; progPct.textContent = pct + '%'; } }

  mergeBtn.addEventListener('click', async () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    // Use the first selected space as the seed for overlap union
    const seed = spaces[0];
    Log.log('UI', 'Voxel merge', { sel: spaces.map(s => s?.id), seed: seed?.id });
    let keepId = null;
    try {
      try { window.dispatchEvent(new CustomEvent('dw:gizmos:disable')); } catch {}
      const res = seed.res || (api.state.barrow?.meta?.voxelSize || 1);
      const showDots = !!scanDotsCb?.checked;
      // Record last res for mid-run enable
      try { lastScanRes = res; } catch {}
      // Enable cancel UI
      _cancelMerge.value = false; cancelBtn.disabled = false;
      Log.log('DEBUG', 'mergeAsync:invoke', { seed: seed.id });
      const debugCfg = {
        chunk: 256,
        // Progress + terse logs
        onStart: ({ nx, ny, nz }) => { try { Log.log('DEBUG', 'Union scan start', { ny }); } catch {}; _nyTotal = ny||0; _showProg(); _setProgFromLayer(-1); },
        onLayer: (y) => { _setProgFromLayer(y); },
        onEnd: () => { try { if (scanDotsOn) api.debug?.flushVoxelScanPoints?.(); Log.log('DEBUG', 'Union scan end', {}); } catch {}; _hideProg(); },
        showObb: (corners) => { try { api.debug?.showObbDebug?.(corners); } catch {} }
      };
      // If currently enabled, prepare base meshes
      try { if (scanDotsOn) api.debug?.startVoxelScanDebug?.(res); } catch {}
      // Always provide callbacks; gate with scanDotsOn so toggling works mid-run
      debugCfg.onTestInside = (wx, wy, wz) => { if (scanDotsOn) { try { api.debug?.addVoxelScanPointInside?.(wx, wy, wz); } catch {} } };
      debugCfg.onTestOutside = (wx, wy, wz) => { if (scanDotsOn) { try { api.debug?.addVoxelScanPointOutside?.(wx, wy, wz); } catch {} } };
      debugCfg.flush = () => { if (scanDotsOn) { try { api.debug?.flushVoxelScanPoints?.(); } catch {} } };
      keepId = await mergeOverlappingSpacesAsync(api.state.barrow, seed.id, { debug: debugCfg, cancel: () => _cancelMerge.value });
      Log.log('DEBUG', 'mergeAsync:returned', { keepId });
      if (!_cancelMerge.value && keepId && keepId !== seed.id) {
        Log.log('UI', 'Merged overlapping spaces', { keepId, from: seed.id });
      }
    } catch {}
    // Update selection to the kept id (or seed)
    try { if (!_cancelMerge.value) { const id = keepId || seed.id; api.state.selection.clear(); api.state.selection.add(id); } } catch {}
    try { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { if (!_cancelMerge.value) window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-merge', sel: [seed.id], keepId: keepId||seed.id } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:enable')); } catch {}
    _hideProg();
    cancelBtn.disabled = true;
  });

  // Soft merge: compute union like hard merge, but apply the union vox to the seed space and DO NOT remove other spaces
  softMergeBtn.addEventListener('click', async () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    const seed = spaces[0];
    Log.log('UI', 'Voxel soft-merge', { sel: spaces.map(s => s?.id), seed: seed?.id });
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:disable')); } catch {}
    let keepId = null;
    try {
      const res = seed.res || (api.state.barrow?.meta?.voxelSize || 1);
      try { lastScanRes = res; } catch {}
      _cancelMerge.value = false; cancelBtn.disabled = false; _nyTotal = 0; _showProg(); _setProgFromLayer(-1);
      const debugCfg = { chunk: 256,
        onStart: ({ ny }) => { _nyTotal = ny||0; _setProgFromLayer(-1); if (scanDotsOn) { try { api.debug?.flushVoxelScanPoints?.(); } catch {} } },
        onLayer: (y) => { _setProgFromLayer(y); if (scanDotsOn && (y % 2 === 0)) { try { api.debug?.flushVoxelScanPoints?.(); } catch {} } },
        onEnd: () => { _hideProg(); try { if (scanDotsOn) api.debug?.flushVoxelScanPoints?.(); } catch {} },
        onTestInside: (wx, wy, wz) => { if (scanDotsOn) { try { api.debug?.addVoxelScanPointInside?.(wx, wy, wz); } catch {} } },
        onTestOutside: (wx, wy, wz) => { if (scanDotsOn) { try { api.debug?.addVoxelScanPointOutside?.(wx, wy, wz); } catch {} } }
      };
      if (scanDotsOn) try { api.debug?.startVoxelScanDebug?.(res); } catch {}
      // Work on a deep clone so we don't delete spaces
      const clone = (typeof structuredClone === 'function') ? structuredClone(api.state.barrow) : JSON.parse(JSON.stringify(api.state.barrow));
      keepId = await mergeOverlappingSpacesAsync(clone, seed.id, { debug: debugCfg, cancel: () => _cancelMerge.value });
      Log.log('DEBUG', 'softMerge:returned', { keepId });
      if (!_cancelMerge.value && keepId) {
        const k = (clone.spaces||[]).find(s => s && s.id === keepId);
        if (k && k.vox && k.vox.size) {
          // Apply ONLY intersection changes across all selected spaces (symmetric); outside intersection preserve each space
          const nx = k.vox.size?.x|0, ny = k.vox.size?.y|0, nz = k.vox.size?.z|0;
          const uRes = k.vox.res || res || 1;
          const uOrigin = { x: (k.origin?.x||0), y: (k.origin?.y||0), z: (k.origin?.z||0) };
          const idxU = (x,y,z) => x + nx*(y + ny*z);
          const sampleVal = (sp, wx, wy, wz) => {
            try {
              if (!sp || !sp.vox || !sp.vox.size || !sp.vox.data) return VoxelType.Uninstantiated;
              const vox = sp.vox; const sx = vox.size?.x||0, sy = vox.size?.y||0, sz = vox.size?.z||0;
              const sres = vox.res || sp.res || (api.state.barrow?.meta?.voxelSize || 1);
              const cx = sp.origin?.x||0, cy = sp.origin?.y||0, cz = sp.origin?.z||0;
              const worldAligned = !!(sp.vox && sp.vox.worldAligned);
              let qInv = BABYLON.Quaternion.Identity();
              if (!worldAligned) {
                const rx = Number(sp.rotation?.x||0), ry = (typeof sp.rotation?.y==='number')?Number(sp.rotation.y):Number(sp.rotY||0)||0, rz = Number(sp.rotation?.z||0);
                const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); qInv = BABYLON.Quaternion.Inverse(q);
              }
              const rotInv = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero());
              const vLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), rotInv);
              const minX = -(sx * sres) / 2, minY = -(sy * sres) / 2, minZ = -(sz * sres) / 2;
              const ix = Math.floor((vLocal.x - minX) / sres);
              const iy = Math.floor((vLocal.y - minY) / sres);
              const iz = Math.floor((vLocal.z - minZ) / sres);
              if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return VoxelType.Uninstantiated;
              return sp.vox.data[ix + sx*(iy + sy*iz)] ?? VoxelType.Uninstantiated;
            } catch { return VoxelType.Uninstantiated; }
          };
          const writeVal = (sp, wx, wy, wz, vNew) => {
            try {
              if (!sp || !sp.vox || !sp.vox.size || !sp.vox.data) return false;
              const vox = sp.vox; const sx = vox.size?.x||0, sy = vox.size?.y||0, sz = vox.size?.z||0;
              const sres = vox.res || sp.res || (api.state.barrow?.meta?.voxelSize || 1);
              const cx = sp.origin?.x||0, cy = sp.origin?.y||0, cz = sp.origin?.z||0;
              const worldAligned = !!(sp.vox && sp.vox.worldAligned);
              let qInv = BABYLON.Quaternion.Identity();
              if (!worldAligned) {
                const rx = Number(sp.rotation?.x||0), ry = (typeof sp.rotation?.y==='number')?Number(sp.rotation.y):Number(sp.rotY||0)||0, rz = Number(sp.rotation?.z||0);
                const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz); qInv = BABYLON.Quaternion.Inverse(q);
              }
              const rotInv = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), qInv, BABYLON.Vector3.Zero());
              const vLocal = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(wx - cx, wy - cy, wz - cz), rotInv);
              const minX = -(sx * sres) / 2, minY = -(sy * sres) / 2, minZ = -(sz * sres) / 2;
              const ix = Math.floor((vLocal.x - minX) / sres);
              const iy = Math.floor((vLocal.y - minY) / sres);
              const iz = Math.floor((vLocal.z - minZ) / sres);
              if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return false;
              sp.vox.data[ix + sx*(iy + sy*iz)] = vNew; return true;
            } catch { return false; }
          };
          for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
              for (let x = 0; x < nx; x++) {
                const wx = uOrigin.x + ((x + 0.5) - nx/2) * uRes;
                const wy = uOrigin.y + ((y + 0.5) - ny/2) * uRes;
                const wz = uOrigin.z + ((z + 0.5) - nz/2) * uRes;
                // Evaluate contributions
                let count = 0; let hasEmpty = false, hasWall = false, hasRock = false;
                const vals = new Map();
                for (const sp of spaces) {
                  const v = sampleVal(sp, wx, wy, wz);
                  vals.set(sp, v);
                  if (v !== VoxelType.Uninstantiated) {
                    count++;
                    if (v === VoxelType.Empty) hasEmpty = true; else if (v === VoxelType.Wall) hasWall = true; else if (v === VoxelType.Rock) hasRock = true;
                  }
                }
                if (count >= 2) {
                  const vOut = hasEmpty ? VoxelType.Empty : (hasWall ? VoxelType.Wall : (hasRock ? VoxelType.Rock : VoxelType.Uninstantiated));
                  for (const sp of spaces) {
                    const vPrev = vals.get(sp);
                    if (vPrev !== VoxelType.Uninstantiated) writeVal(sp, wx, wy, wz, vOut);
                  }
                }
              }
            }
          }
          Log.log('UI', 'Soft merged intersection across spaces', { ids: spaces.map(s=>s.id), dims: { x: nx, y: ny, z: nz } });
        }
      }
    } catch {}
    // Persist and refresh
    try { if (!_cancelMerge.value) { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { if (!_cancelMerge.value) window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-soft-merge', sel: spaces.map(s => s.id), seedId: seed.id, keepId } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:enable')); } catch {}
    _hideProg();
    cancelBtn.disabled = true;
  });

  // Add a Clear Dots button for debug
  const row3 = document.createElement('div'); row3.className = 'row';
  // Scan dots toggle (unchecked by default)
  const dotsLabel = document.createElement('label'); dotsLabel.style.display = 'inline-flex'; dotsLabel.style.alignItems = 'center'; dotsLabel.style.gap = '6px';
  const scanDotsCb = document.createElement('input'); scanDotsCb.type = 'checkbox'; scanDotsCb.id = 'scanDots';
  // Runtime flag + last resolution for mid-run toggling
  let scanDotsOn = false;
  let lastScanRes = 1;
  // Remember preference in localStorage; default = on
  try {
    const key = 'dw:ui:scanDots';
    const stored = localStorage.getItem(key);
    const def = true; // on by default
    scanDotsCb.checked = (stored == null) ? def : (stored === '1');
    scanDotsOn = !!scanDotsCb.checked;
    scanDotsCb.addEventListener('change', () => {
      scanDotsOn = !!scanDotsCb.checked;
      try { localStorage.setItem(key, scanDotsCb.checked ? '1' : '0'); } catch {}
      // If enabling mid-run and no base meshes exist, (re)start debug so dots appear
      try {
        const hasBases = !!(api.state?._scanDebug?.redBase && api.state?._scanDebug?.greenBase);
        if (scanDotsOn && !hasBases) api.debug?.startVoxelScanDebug?.(lastScanRes || 1);
      } catch {}
    });
  } catch { scanDotsCb.checked = true; scanDotsOn = true; }
  dotsLabel.appendChild(scanDotsCb); dotsLabel.appendChild(document.createTextNode('Show scan dots'));
  row3.appendChild(dotsLabel);
  const clearBtn = document.createElement('button'); clearBtn.className = 'btn warn'; clearBtn.textContent = 'Clear Scan Dots';
  clearBtn.addEventListener('click', () => { try { api.debug?.endVoxelScanDebug?.(); Log.log('DEBUG', 'Cleared scan dots', {}); } catch {} });
  row3.appendChild(clearBtn);

  // OBB overlay controls
  const showObbBtn = document.createElement('button'); showObbBtn.className = 'btn'; showObbBtn.textContent = 'Show OBB Lines';
  const clearObbBtn = document.createElement('button'); clearObbBtn.className = 'btn warn'; clearObbBtn.textContent = 'Clear OBB Lines';
  showObbBtn.addEventListener('click', () => {
    try {
      const spaces = getSelectedSpaces(); if (!spaces.length) return;
      const s = spaces[0];
      const sr = s.res || (api.state.barrow?.meta?.voxelSize || 1);
      const w = (s.size?.x||0) * sr, h = (s.size?.y||0) * sr, d = (s.size?.z||0) * sr;
      const hx = w/2, hy = h/2, hz = d/2;
      const cx = s.origin?.x||0, cy = s.origin?.y||0, cz = s.origin?.z||0;
      const rx = (s.rotation && typeof s.rotation.x === 'number') ? s.rotation.x : 0;
      const ry = (s.rotation && typeof s.rotation.y === 'number') ? s.rotation.y : (typeof s.rotY === 'number' ? s.rotY : 0);
      const rz = (s.rotation && typeof s.rotation.z === 'number') ? s.rotation.z : 0;
      const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
      const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(1,1,1), q, new BABYLON.Vector3(cx,cy,cz));
      const locals = [
        new BABYLON.Vector3(-hx,-hy,-hz), new BABYLON.Vector3(+hx,-hy,-hz),
        new BABYLON.Vector3(-hx,+hy,-hz), new BABYLON.Vector3(+hx,+hy,-hz),
        new BABYLON.Vector3(-hx,-hy,+hz), new BABYLON.Vector3(+hx,-hy,+hz),
        new BABYLON.Vector3(-hx,+hy,+hz), new BABYLON.Vector3(+hx,+hy,+hz)
      ];
      const world = locals.map(v => BABYLON.Vector3.TransformCoordinates(v, m)).map(v => ({ x: v.x, y: v.y, z: v.z }));
      api.debug?.showObbDebug?.(world);
      Log.log('DEBUG', 'Show OBB (button)', { id: s.id });
    } catch (e) { Log.log('ERROR', 'Show OBB failed', { error: String(e) }); }
  });
  clearObbBtn.addEventListener('click', () => { try { api.debug?.clearObbDebug?.(); Log.log('DEBUG', 'Clear OBB (button)', {}); } catch {} });
  row3.appendChild(showObbBtn); row3.appendChild(clearObbBtn);
  dbgCol.appendChild(row3);

  fillBtn.addEventListener('click', () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:disable')); } catch {}
    Log.log('UI', 'Voxel fill', { sel: spaces.map(s => s?.id), value: 'Rock' });
    for (const s of spaces) {
      try {
        if (!s.vox || !s.vox.size) {
          // Create a full solid voxel map for this space and fill it with Rock
          const res = s.res || (api.state.barrow?.meta?.voxelSize || 1);
          const nx = Math.max(1, (s.size?.x|0) || 1);
          const ny = Math.max(1, (s.size?.y|0) || 1);
          const nz = Math.max(1, (s.size?.z|0) || 1);
          const nTot = nx * ny * nz;
          const data = new Array(nTot);
          for (let i = 0; i < nTot; i++) data[i] = VoxelType.Rock;
          s.vox = { res, size: { x: nx, y: ny, z: nz }, data, palette: VoxelType, bakedAt: Date.now(), source: 'fill-rock', worldAligned: true };
          s.voxelized = 1;
        } else {
          fillAllVoxels(s.vox, VoxelType.Rock);
        }
        // Ensure exposed top layers are visible (avoid hiding everything)
        try { s.voxExposeTop = 0; } catch {}
      } catch {}
    }
    try { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    // Rebuild scene so new rock voxels render immediately
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-fill', sel: spaces.map(s => s.id), value: 'Rock' } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:gizmos:enable')); } catch {}
  });

  // Warn/log when buttons are clicked with no selection
  [bakeBtn, fillBtn, mergeBtn].forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const hasSel = Array.isArray(api?.state?.selection) ? (api.state.selection.size > 0) : (Array.from(api?.state?.selection || []).length > 0);
        if (!hasSel) Log.log('UI', 'Voxel action with no selection', { action: btn === bakeBtn ? 'Bake' : 'Fill' });
      } catch {}
    });
  });

  // Keep selection panel in sync when relevant
  window.addEventListener('dw:dbRowClick', renderSelection);
  window.addEventListener('dw:dbEdit', renderSelection);
  window.addEventListener('dw:transform', renderSelection);
  window.addEventListener('dw:selectionChange', renderSelection);
  window.addEventListener('dw:voxelPick', renderSelection);
  window.addEventListener('dw:tabChange', (e) => { if (e.detail && e.detail.id === 'tab-vox') renderSelection(); });
}
