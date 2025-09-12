import { VoxelType, bakeHollowContainer, fillAllVoxels } from '../voxels/voxelize.mjs';
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

  bakeBtn.addEventListener('click', () => {
    const spaces = getSelectedSpaces(); if (!spaces.length) return;
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
  });

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
