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
  // Fill available height of the panel content
  logPane.style.display = 'flex';
  logPane.style.flexDirection = 'column';
  logPane.style.minHeight = '0';
  const filterRow = document.createElement('div'); filterRow.className = 'row'; filterRow.style.justifyContent = 'space-between'; filterRow.style.alignItems = 'center';
  const filtersBox = document.createElement('div'); filtersBox.id = 'logClassFilters'; filtersBox.style.display = 'flex'; filtersBox.style.flexWrap = 'wrap'; filtersBox.style.gap = '8px';
  filterRow.appendChild(filtersBox);
  const actionsBox = document.createElement('div'); actionsBox.style.display = 'flex'; actionsBox.style.gap = '8px';
  const copyBtn = document.createElement('button'); copyBtn.className = 'btn'; copyBtn.textContent = 'Copy Log';
  const clearBtn = document.createElement('button'); clearBtn.className = 'btn warn'; clearBtn.textContent = 'Clear Log';
  clearBtn.addEventListener('click', () => { Log.clear(); });
  copyBtn.addEventListener('click', async () => {
    // Rebuild the same filtered text as renderEntries
    const list = Log.getEntries();
    const classes = Array.from(Log.getClasses());
    const selected = new Set(); // infer selected from current checkboxes
    const cbs = filtersBox.querySelectorAll('input[type="checkbox"]');
    cbs.forEach(cb => { if (cb.checked) selected.add(cb.nextSibling && cb.nextSibling.textContent ? cb.nextSibling.textContent : null); });

    const filtered = list.filter(e => selected.size === 0 || selected.has(e.cls));
    const lines = filtered.map(e => {
      const t = new Date(e.time).toLocaleTimeString();
      const d = e.data != null ? ` ${JSON.stringify(e.data, (k,v) => (typeof v === 'number' ? parseFloat(Number(v).toPrecision(2)) : v))}` : '';
      return `[${t}] [${e.cls}] ${e.msg}${d}`;
 }).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(lines);
 } else {
      const ta = document.createElement('textarea'); ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.value = lines; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy Log'; }, 1200);

 });
  actionsBox.appendChild(copyBtn);
  actionsBox.appendChild(clearBtn);
  filterRow.appendChild(actionsBox);
  logPane.appendChild(filterRow);
  const entries = document.createElement('div'); entries.id = 'logEntries'; entries.style.whiteSpace = 'pre-wrap'; entries.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; entries.style.fontSize = '12px'; entries.style.flex = '1'; entries.style.minHeight = '0'; entries.style.overflow = 'auto'; entries.style.border = '1px solid #1e2a30'; entries.style.borderRadius = '6px'; entries.style.padding = '8px'; entries.style.background = '#0f151a';
  logPane.appendChild(entries); panelContent.appendChild(logPane);

  // Central tab system handles activation; we only log and render when active
  tabBtn.addEventListener('click', () => { Log.log('UI', 'Activate tab', { tab: 'Log' }); });

  const SELECTED_KEY = 'dw:log:selected';
  const selected = new Set();
  // Load persisted selection
  const raw = localStorage.getItem(SELECTED_KEY);
  if (raw) {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(c => selected.add(String(c)));
  }

  function renderFilters() {
    const classes = Array.from(Log.getClasses()).sort();
    // If no persisted selection yet, default-select all current classes and persist once
    if (selected.size === 0 && classes.length > 0) {
      classes.forEach(c => selected.add(c));
      localStorage.setItem(SELECTED_KEY, JSON.stringify(Array.from(selected)));
    }
    filtersBox.innerHTML = '';
    classes.forEach(c => {
      const label = document.createElement('label'); label.style.display = 'inline-flex'; label.style.alignItems = 'center'; label.style.gap = '6px';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(c);
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(c); else selected.delete(c);
        localStorage.setItem(SELECTED_KEY, JSON.stringify(Array.from(selected)));
        renderEntries();
 });
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
  window.addEventListener('dw:tabChange', (e) => { if (e.detail && e.detail.id === 'tab-log') { renderFilters(); renderEntries(); } });
}
