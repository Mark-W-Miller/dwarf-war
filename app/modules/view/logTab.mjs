import { Log } from '../util/log.mjs';

// Build a Log tab with class filters and entries panel
export function initLogTab(panelContent) {
  const tabsBar = panelContent.querySelector('.tabs');
  const editPane = panelContent.querySelector('#tab-edit');
  const dbPane = panelContent.querySelector('#tab-db');
  const settingsPane = panelContent.querySelector('#tab-settings');
  if (!tabsBar || !dbPane || !editPane || !settingsPane) return;

  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab'; tabBtn.dataset.tab = 'tab-log'; tabBtn.textContent = 'Log';
  tabsBar.appendChild(tabBtn);
  const logPane = document.createElement('div'); logPane.id = 'tab-log'; logPane.className = 'tab-pane';
  const filterRow = document.createElement('div'); filterRow.className = 'row';
  const filtersBox = document.createElement('div'); filtersBox.id = 'logClassFilters'; filtersBox.style.display = 'flex'; filtersBox.style.flexWrap = 'wrap'; filtersBox.style.gap = '8px';
  filterRow.appendChild(filtersBox); logPane.appendChild(filterRow);
  const entries = document.createElement('div'); entries.id = 'logEntries'; entries.style.whiteSpace = 'pre-wrap'; entries.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; entries.style.fontSize = '12px'; entries.style.maxHeight = '240px'; entries.style.overflow = 'auto'; entries.style.border = '1px solid #1e2a30'; entries.style.borderRadius = '6px'; entries.style.padding = '8px'; entries.style.background = '#0f151a';
  logPane.appendChild(entries); panelContent.appendChild(logPane);

  function activateLog() {
    editPane.classList.remove('active'); dbPane.classList.remove('active'); settingsPane.classList.remove('active'); logPane.classList.add('active');
    const allTabs = tabsBar.querySelectorAll('.tab');
    allTabs.forEach(b => b.classList.toggle('active', b.dataset.tab === 'tab-log'));
    renderFilters(); renderEntries();
  }
  tabBtn.addEventListener('click', activateLog);

  const selected = new Set();
  function renderFilters() {
    const classes = Array.from(Log.getClasses()).sort();
    if (selected.size === 0) classes.forEach(c => selected.add(c));
    filtersBox.innerHTML = '';
    classes.forEach(c => {
      const label = document.createElement('label'); label.style.display = 'inline-flex'; label.style.alignItems = 'center'; label.style.gap = '6px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(c);
      cb.addEventListener('change', () => { if (cb.checked) selected.add(c); else selected.delete(c); renderEntries(); });
      label.appendChild(cb); label.appendChild(document.createTextNode(c));
      filtersBox.appendChild(label);
    });
  }
  function renderEntries() {
    const list = Log.getEntries();
    const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
    const lines = filtered.slice(-500).map(e => {
      const t = new Date(e.time).toLocaleTimeString();
      const d = e.data != null ? ` ${JSON.stringify(e.data, (k,v) => (typeof v === 'number' ? parseFloat(Number(v).toPrecision(2)) : v))}` : '';
      return `[${t}] [${e.cls}] ${e.msg}${d}`;
    });
    entries.textContent = lines.join('\n'); entries.scrollTop = entries.scrollHeight;
  }
  Log.on(() => { renderFilters(); renderEntries(); });
}

