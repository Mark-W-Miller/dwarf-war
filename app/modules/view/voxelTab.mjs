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

  // Controls — whole-space ops first
  const row1 = document.createElement('div'); row1.className = 'row';
  const labelT = document.createElement('label'); labelT.style.display = 'inline-flex'; labelT.style.alignItems = 'center'; labelT.style.gap = '6px';
  labelT.textContent = 'Wall Thickness';
  const tInput = document.createElement('input'); tInput.type = 'number'; tInput.min = '1'; tInput.step = '1'; tInput.value = '1'; tInput.style.width = '64px';
  labelT.appendChild(tInput); row1.appendChild(labelT);
  const bakeBtn = document.createElement('button'); bakeBtn.className = 'btn'; bakeBtn.textContent = 'Bake Voxels (Walls + Empty)'; row1.appendChild(bakeBtn);
  voxPane.appendChild(row1);

  const row2 = document.createElement('div'); row2.className = 'row';
  const fillBtn = document.createElement('button'); fillBtn.className = 'btn'; fillBtn.textContent = 'Fill Space Voxels = Rock'; row2.appendChild(fillBtn);
  voxPane.appendChild(row2);

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
    if (spaces.length === 0) { selContent.appendChild(document.createTextNode('No selection.')); return; }
    if (spaces.length > 1) { selContent.appendChild(document.createTextNode(`${spaces.length} spaces selected.`)); return; }
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
    } else {
      selContent.appendChild(document.createTextNode('No voxel data for this space.'));
    }
  }

  bakeBtn.addEventListener('click', async () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    const t = Math.max(1, Math.floor(Number(tInput.value || '1')));
    Log.log('UI', 'Voxel bake', { sel: spaces.map(s => s?.id), wallThickness: t });
    let lastKeep = null;
    for (const s of spaces) {
      try {
        const vox = bakeHollowContainer(s, { wallThickness: t });
        s.voxelized = 1; // prevent transforms
        s.vox = vox; // attach baked voxels to space
        // Merge with all overlapping spaces into a single Carddon union (voxed)
        try {
          const res = s.res || (api.state.barrow?.meta?.voxelSize || 1);
          const showDots = !!scanDotsCb?.checked;
          Log.log('DEBUG', 'mergeAsync:invoke', { seed: s.id });
          const debugCfg = {
            chunk: 256,
            onStart: ({ min, max, res, nx, ny, nz }) => { try { Log.log('DEBUG', 'Union scan start', { min, max, res, nx, ny, nz }); } catch {} },
            onLayer: (y, c) => { try { Log.log('DEBUG', 'Scan layer', { y, inside: c?.inside||0, outside: c?.outside||0 }); } catch {} },
            onEnd: () => { try { if (showDots) api.debug?.flushVoxelScanPoints?.(); Log.log('DEBUG', 'Union scan end', {}); } catch {} },
            showObb: (corners) => { try { api.debug?.showObbDebug?.(corners); } catch {} }
          };
          if (showDots) {
            try { api.debug?.startVoxelScanDebug?.(res); } catch {}
            debugCfg.onTestInside = (wx, wy, wz) => { try { api.debug?.addVoxelScanPointInside?.(wx, wy, wz); } catch {} };
            debugCfg.onTestOutside = (wx, wy, wz) => { try { api.debug?.addVoxelScanPointOutside?.(wx, wy, wz); } catch {} };
            debugCfg.flush = () => { try { api.debug?.flushVoxelScanPoints?.(); } catch {} };
          }
          const keepId = await mergeOverlappingSpacesAsync(api.state.barrow, s.id, { debug: debugCfg });
          Log.log('DEBUG', 'mergeAsync:returned', { keepId });
          // Keep dots on screen for inspection; provide a Clear button below.
          if (keepId && keepId !== s.id) {
            Log.log('UI', 'Merged overlapping spaces', { keepId, from: s.id });
          }
          if (keepId) lastKeep = keepId; else lastKeep = s.id;
        } catch {}
      } catch {}
    }
    // Update selection to the last kept id
    try { if (lastKeep) { api.state.selection.clear(); api.state.selection.add(lastKeep); } } catch {}
    try { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-bake', sel: spaces.map(s => s.id), wallThickness: t } })); } catch {}
  });

  // Add a Clear Dots button for debug
  const row3 = document.createElement('div'); row3.className = 'row';
  // Scan dots toggle (unchecked by default)
  const dotsLabel = document.createElement('label'); dotsLabel.style.display = 'inline-flex'; dotsLabel.style.alignItems = 'center'; dotsLabel.style.gap = '6px';
  const scanDotsCb = document.createElement('input'); scanDotsCb.type = 'checkbox'; scanDotsCb.id = 'scanDots'; scanDotsCb.checked = false;
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
  voxPane.appendChild(row3);

  fillBtn.addEventListener('click', () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
    Log.log('UI', 'Voxel fill', { sel: spaces.map(s => s?.id), value: 'Rock' });
    for (const s of spaces) {
      try {
        if (!s.vox) continue;
        fillAllVoxels(s.vox, VoxelType.Rock);
      } catch {}
    }
    try { api.saveBarrow(api.state.barrow); api.snapshot(api.state.barrow); } catch {}
    try { api.renderDbView(api.state.barrow); } catch {}
    // Rebuild scene so new rock voxels render immediately
    try { api.rebuildScene?.(); } catch {}
    try { api.scheduleGridUpdate?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'voxel-fill', sel: spaces.map(s => s.id), value: 'Rock' } })); } catch {}
  });

  // Warn/log when buttons are clicked with no selection
  [bakeBtn, fillBtn].forEach(btn => {
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
  window.addEventListener('dw:tabChange', (e) => { if (e.detail && e.detail.id === 'tab-vox') renderSelection(); });
}
