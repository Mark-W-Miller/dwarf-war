import { Log } from '../util/log.mjs';

// Properties tab showing selection summary and voxel info
export function initPropertiesTab(panelContent, api) {
  const tabsBar = panelContent.querySelector('.tabs');
  const editPane = panelContent.querySelector('#tab-edit');
  const dbPane = panelContent.querySelector('#tab-db');
  const settingsPane = panelContent.querySelector('#tab-settings');
  if (!tabsBar || !dbPane || !editPane || !settingsPane) return;

  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab'; tabBtn.dataset.tab = 'tab-props'; tabBtn.textContent = 'Properties';
  tabsBar.appendChild(tabBtn);
  const propsPane = document.createElement('div'); propsPane.id = 'tab-props'; propsPane.className = 'tab-pane'; panelContent.appendChild(propsPane);

  function activateProps() {
    editPane.classList.remove('active'); dbPane.classList.remove('active'); settingsPane.classList.remove('active'); propsPane.classList.add('active');
    const allTabs = tabsBar.querySelectorAll('.tab');
    allTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'tab-props'));
    try { Log.log('UI', 'Activate tab', { tab: 'Properties' }); } catch {}
    render();
  }
  tabBtn.addEventListener('click', activateProps);

  function getSelectedSpaces() {
    try {
      const sel = Array.from(api.state.selection || []);
      const byId = new Map((api.state.barrow.spaces||[]).map(s => [s.id, s]));
      return sel.map(id => byId.get(id)).filter(Boolean);
    } catch { return []; }
  }

  function render() {
    const spaces = getSelectedSpaces();
    propsPane.innerHTML = '';
    const title = document.createElement('h3'); title.textContent = 'Selection'; propsPane.appendChild(title);
    if (spaces.length === 0) {
      propsPane.appendChild(document.createTextNode('No selection.'));
      return;
    }
    if (spaces.length > 1) {
      propsPane.appendChild(document.createTextNode(`${spaces.length} spaces selected.`));
      return;
    }
    const s = spaces[0];
    const makeRow = (label, value) => {
      const row = document.createElement('div'); row.className = 'row';
      const b = document.createElement('b'); b.textContent = label + ':'; b.style.minWidth = '120px';
      const span = document.createElement('span'); span.textContent = value;
      row.appendChild(b); row.appendChild(span); propsPane.appendChild(row);
    };
    makeRow('id', s.id);
    makeRow('type', s.type);
    makeRow('res', String(s.res ?? (api.state.barrow?.meta?.voxelSize || 1)));
    makeRow('size (vox)', `${s.size?.x||0} × ${s.size?.y||0} × ${s.size?.z||0}`);
    makeRow('origin', `${Number(s.origin?.x||0).toFixed(2)}, ${Number(s.origin?.y||0).toFixed(2)}, ${Number(s.origin?.z||0).toFixed(2)}`);
    const rx = Number(s.rotation?.x||0), ry = Number(s.rotation?.y||0), rz = Number(s.rotation?.z||0);
    makeRow('rotation (rad)', `${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}`);
    // Voxel section
    const vTitle = document.createElement('h3'); vTitle.textContent = 'Voxel Map'; propsPane.appendChild(vTitle);
    if (s.vox && s.vox.size) {
      const vx = s.vox.size?.x||0, vy = s.vox.size?.y||0, vz = s.vox.size?.z||0;
      makeRow('dimensions', `${vx} × ${vy} × ${vz}`);
      makeRow('resolution', String(s.vox.res || s.res || api.state.barrow?.meta?.voxelSize || 1));
      try {
        const len = Array.isArray(s.vox.data) ? s.vox.data.length : (s.vox.data?.rle?.length || 0);
        makeRow('data (len)', String(len));
      } catch {}
    } else {
      propsPane.appendChild(document.createTextNode('No voxel data for this space.'));
    }
  }

  // Refresh properties on relevant events
  window.addEventListener('dw:dbRowClick', render);
  window.addEventListener('dw:dbEdit', render);
  window.addEventListener('dw:transform', render);
}

