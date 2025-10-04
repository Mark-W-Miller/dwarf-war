// Build the tabs/panes inside the right panel and attach the Log tab
import { initTabsUI } from './handlers/ui/tabs.mjs';
import { buildEditTab } from './editTab.mjs';

export function buildTabPanel({ renderDbView, state, Log }) {
  const panelContent = document.querySelector('.panel-content');
  if (!panelContent) return null;
  const created = initTabsUI({ renderDbView, state, Log }) || {};
  // Build Edit tab DOM and return it so handlers can bind
  let editDom = null;
  editDom = buildEditTab({ state, Log }) || null;
  return { ...created, editDom };
}
