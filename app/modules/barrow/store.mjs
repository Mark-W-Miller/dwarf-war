const KEY_CURRENT = 'dw:barrow:current';
const KEY_HISTORY = 'dw:barrow:history';

import { compressVox, decompressVox } from '../voxels/voxelize.mjs';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function cloneForSave(barrow) {
  const out = deepClone(barrow || {});
  try {
    const spaces = Array.isArray(out.spaces) ? out.spaces : [];
    for (let i = 0; i < spaces.length; i++) {
      const s = spaces[i];
      if (s && s.vox && s.vox.data && Array.isArray(s.vox.data)) {
        // compress voxel payload for storage
        s.vox = compressVox(s.vox);
      }
    }
  } catch {}
  return out;
}

export function inflateAfterLoad(barrow) {
  const out = deepClone(barrow || {});
  try {
    const spaces = Array.isArray(out.spaces) ? out.spaces : [];
    for (let i = 0; i < spaces.length; i++) {
      const s = spaces[i];
      if (s && s.vox && s.vox.data && !Array.isArray(s.vox.data)) {
        // decompress voxel payload for runtime use
        s.vox = decompressVox(s.vox);
      }
    }
  } catch {}
  return out;
}

export function loadBarrow() {
  try {
    const raw = localStorage.getItem(KEY_CURRENT);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed) return null;
    return inflateAfterLoad(parsed);
  } catch (e) { console.warn('loadBarrow failed', e); return null; }
}

export function saveBarrow(barrow) {
  try {
    const toStore = cloneForSave(barrow);
    localStorage.setItem(KEY_CURRENT, JSON.stringify(toStore));
  }
  catch (e) { console.warn('saveBarrow failed', e); }
}

export function snapshot(barrow) {
  try {
    const hist = loadHistory();
    hist.push({ at: Date.now(), barrow: cloneForSave(barrow) });
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

export function undoLast() {
  try {
    const hist = loadHistory();
    if (!Array.isArray(hist) || hist.length < 2) return null;
    // Remove the most recent snapshot and restore the previous
    hist.pop();
    const prev = hist[hist.length - 1];
    const barrowCompressed = prev && prev.barrow ? prev.barrow : null;
    if (!barrowCompressed) return null;
    localStorage.setItem(KEY_HISTORY, JSON.stringify(hist));
    // Update current
    localStorage.setItem(KEY_CURRENT, JSON.stringify(barrowCompressed));
    // Return inflated barrow for runtime
    return inflateAfterLoad(barrowCompressed);
  } catch (e) { console.warn('undoLast failed', e); return null; }
}
