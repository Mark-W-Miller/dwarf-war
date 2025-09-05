const KEY_CURRENT = 'dw:barrow:current';
const KEY_HISTORY = 'dw:barrow:history';

export function loadBarrow() {
  try {
    const raw = localStorage.getItem(KEY_CURRENT);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { console.warn('loadBarrow failed', e); return null; }
}

export function saveBarrow(barrow) {
  try { localStorage.setItem(KEY_CURRENT, JSON.stringify(barrow)); }
  catch (e) { console.warn('saveBarrow failed', e); }
}

export function snapshot(barrow) {
  try {
    const hist = loadHistory();
    hist.push({ at: Date.now(), barrow });
    while (hist.length > 50) hist.shift();
    localStorage.setItem(KEY_HISTORY, JSON.stringify(hist));
  } catch (e) { console.warn('snapshot failed', e); }
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

