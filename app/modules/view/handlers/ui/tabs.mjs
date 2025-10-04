// Tabs UI setup: Edit / Database / Settings, and DB view container
export function initTabsUI({ renderDbView, state, Log }) {
  const panelContent = document.querySelector('.panel-content');
  if (!panelContent) return;
  // Create tabs bar and panes
  const tabsBar = document.createElement('div'); tabsBar.className = 'tabs';
  const tabEditBtn = document.createElement('button'); tabEditBtn.className = 'tab active'; tabEditBtn.dataset.tab = 'tab-edit'; tabEditBtn.textContent = 'Edit';
  const tabDbBtn = document.createElement('button'); tabDbBtn.className = 'tab'; tabDbBtn.dataset.tab = 'tab-db'; tabDbBtn.textContent = 'Database';
  const tabTestBtn = document.createElement('button'); tabTestBtn.className = 'tab'; tabTestBtn.dataset.tab = 'tab-test'; tabTestBtn.textContent = 'Test';
  const tabSettingsBtn = document.createElement('button'); tabSettingsBtn.className = 'tab'; tabSettingsBtn.dataset.tab = 'tab-settings'; tabSettingsBtn.textContent = 'Settings';
  tabsBar.appendChild(tabEditBtn); tabsBar.appendChild(tabDbBtn); tabsBar.appendChild(tabTestBtn); tabsBar.appendChild(tabSettingsBtn);

  const editPane = document.createElement('div'); editPane.id = 'tab-edit'; editPane.className = 'tab-pane active';
  const dbPane = document.createElement('div'); dbPane.id = 'tab-db'; dbPane.className = 'tab-pane';
  const testPane = document.createElement('div'); testPane.id = 'tab-test'; testPane.className = 'tab-pane';
  const settingsPane = document.createElement('div'); settingsPane.id = 'tab-settings'; settingsPane.className = 'tab-pane';

  // Move existing children into editPane
  const existing = Array.from(panelContent.childNodes);
  panelContent.textContent = '';
  panelContent.appendChild(tabsBar);
  panelContent.appendChild(editPane);
  panelContent.appendChild(dbPane);
  panelContent.appendChild(testPane);
  panelContent.appendChild(settingsPane);
  for (const node of existing) editPane.appendChild(node);

  // Split the first row: move Reset/Export/Import controls into DB pane
  const firstRow = editPane.querySelector('.row');
  if (firstRow) {
    const dbRow = document.createElement('div'); dbRow.className = 'row';
    const idsToMove = ['reset','export','import','importFile'];
    for (const id of idsToMove) {
      const el = firstRow.querySelector('#' + id) || editPane.querySelector('#' + id);
      if (el) dbRow.appendChild(el);
    }
    if (dbRow.childElementCount > 0) dbPane.appendChild(dbRow);
  }

  // Add database view container and populate
  const dbView = document.createElement('div');
  dbView.id = 'dbView'; dbView.className = 'db-view';
  dbPane.appendChild(dbView);
  renderDbView(state.barrow);

  function activate(tabId) {
    const panes = panelContent.querySelectorAll('.tab-pane');
    panes.forEach(p => p.classList.toggle('active', p.id === tabId));
    const tabs = tabsBar.querySelectorAll('.tab');
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    window.dispatchEvent(new CustomEvent('dw:tabChange', { detail: { id: tabId } }));

  }
  tabsBar.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (!btn || !btn.dataset || !btn.dataset.tab) return;
    activate(btn.dataset.tab);
 });
  window.dispatchEvent(new CustomEvent('dw:tabsReady', { detail: {} }));

  return { editPane, dbPane, testPane, settingsPane, tabsBar };
}
