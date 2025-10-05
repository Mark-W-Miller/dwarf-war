const KEY_CURRENT = 'dw:barrow:current';
const KEY_HISTORY = 'dw:barrow:history';
const KEY_SAVED = 'dw:barrow:saved';

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

function readSavedEntries() {
  try {
    const raw = localStorage.getItem(KEY_SAVED);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedEntries(entries) {
  try {
    localStorage.setItem(KEY_SAVED, JSON.stringify(entries));
  } catch (e) {
    console.warn('writeSavedEntries failed', e);
  }
}

function sanitizeBaseName(name) {
  const str = String(name ?? '').trim();
  if (!str) return 'barrow';
  return str;
}

function ensureUniqueName(baseName, entries) {
  const existing = new Set(entries.map((e) => e && typeof e.name === 'string' ? e.name : ''));
  if (!existing.has(baseName)) return baseName;
  let idx = 2;
  while (existing.has(`${baseName} (${idx})`)) idx++;
  return `${baseName} (${idx})`;
}

export function saveNamedBarrow(name, barrow, options = {}) {
  const entries = readSavedEntries();
  const baseName = sanitizeBaseName(name);
  const finalName = ensureUniqueName(baseName, entries);
  const storedBarrow = cloneForSave(barrow);
  const selection = Array.isArray(options?.selection) ? options.selection.map(String) : null;
  if (selection && selection.length) {
    storedBarrow.meta = storedBarrow.meta || {};
    storedBarrow.meta.selected = selection;
  }
  const entry = {
    name: finalName,
    savedAt: Date.now(),
    barrow: storedBarrow,
  };
  entries.push(entry);
  writeSavedEntries(entries);
  return entry;
}

export function listSavedBarrows() {
  const entries = readSavedEntries();
  return entries
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => ({ name: entry.name, savedAt: Number(entry.savedAt) || 0 }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function loadNamedBarrow(name) {
  const entries = readSavedEntries();
  const match = entries.find((entry) => entry && entry.name === name);
  if (!match || !match.barrow) return null;
  return inflateAfterLoad(match.barrow);
}

export function removeNamedBarrow(name) {
  const entries = readSavedEntries();
  const next = entries.filter((entry) => entry && entry.name !== name);
  const changed = next.length !== entries.length;
  if (changed) writeSavedEntries(next);
  return changed;
}
