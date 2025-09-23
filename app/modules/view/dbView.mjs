// Database view renderer with nested details and inline editing
export function renderDbView(barrow) {
  const root = document.getElementById('dbView'); if (!root) return;
  const meta = barrow.meta || {};

  // Helpers
  const s2 = (n) => (typeof n !== 'number') ? n : parseFloat(Number(n).toPrecision(2));
  const make = (tag, attrs = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v; else if (k === 'html') el.innerHTML = v; else el.setAttribute(k, v);
    }
    for (const c of children) el.appendChild(c);
    return el;
  };
  const kv = (label, value, opts={}) => {
    const row = make('div', { class: 'kv' });
    const b = make('b'); b.textContent = label + ':'; row.appendChild(b); row.appendChild(document.createTextNode(' '));
    const span = make('span'); span.textContent = String(value);
    if (opts.path) { span.dataset.path = opts.path; span.dataset.type = opts.type || 'text'; span.dataset.editable = '1'; span.title = 'Double-click to edit'; }
    row.appendChild(span);
    return row;
  };

  // Preserve open/closed state of details before rebuild
  const openSet = new Set();
  try {
    root.querySelectorAll('details').forEach((d) => {
      if (!d.open) return;
      const sid = d.dataset.spaceId;
      const sec = d.dataset.section;
      if (sid && !sec) openSet.add(`space:${sid}`);
      if (sid && sec) openSet.add(`sec:${sid}:${sec}`);
    });
  } catch {}
  // Preserve top-level Spaces section open state
  let spacesWasOpen = true;
  try { const prev = root.querySelector('#dbSpaces'); if (prev) spacesWasOpen = !!prev.open; } catch {}

  // Build DOM
  root.textContent = '';

  // Summary
  const dSummary = make('details', { open: '' });
  dSummary.appendChild(make('summary', { text: 'Summary' }));
  dSummary.appendChild(kv('barrowId', barrow.id || '-', { path: 'id', type: 'text' }));
  dSummary.appendChild(kv('units', meta.units || '-', { path: 'meta.units', type: 'text' }));
  dSummary.appendChild(kv('voxelSize', s2(meta.voxelSize ?? '-'), { path: 'meta.voxelSize', type: 'number' }));
  dSummary.appendChild(kv('spaces', (barrow.spaces||[]).length));
  dSummary.appendChild(kv('version', meta.version ?? '-', { path: 'meta.version', type: 'text' }));
  root.appendChild(dSummary);

  // Spaces list with deeper drilldown
  const dSpaces = make('details'); dSpaces.id = 'dbSpaces';
  dSpaces.appendChild(make('summary', { text: `Spaces ${(barrow.spaces||[]).length}` }));
  if (!Array.isArray(barrow.spaces) || barrow.spaces.length === 0) {
    dSpaces.appendChild(make('div', { class: 'kv', text: '(none)' }));
  } else {
    barrow.spaces.forEach((s, idx) => {
      // Ensure rotation object exists for editing
      if (!s.rotation || typeof s.rotation !== 'object') s.rotation = { x: 0, y: (typeof s.rotY === 'number' ? s.rotY : 0), z: 0 };
      const d = make('details');
      d.dataset.spaceId = s.id || String(idx);
      d.appendChild(make('summary', { text: `${s.id} — ${s.type}` }));
      d.appendChild(kv('id', s.id, { path: `spaces.${idx}.id`, type: 'text' }));
      d.appendChild(kv('type', s.type, { path: `spaces.${idx}.type`, type: 'text' }));
      d.appendChild(kv('res', s2(s.res), { path: `spaces.${idx}.res`, type: 'number' }));

      const dSize = make('details'); dSize.dataset.section = 'size'; dSize.dataset.spaceId = s.id || String(idx); dSize.appendChild(make('summary', { text: 'Size' }));
      dSize.appendChild(kv('x', s2(s.size?.x||0), { path: `spaces.${idx}.size.x`, type: 'number' }));
      dSize.appendChild(kv('y', s2(s.size?.y||0), { path: `spaces.${idx}.size.y`, type: 'number' }));
      dSize.appendChild(kv('z', s2(s.size?.z||0), { path: `spaces.${idx}.size.z`, type: 'number' }));
      d.appendChild(dSize);

      const dOrigin = make('details'); dOrigin.dataset.section = 'origin'; dOrigin.dataset.spaceId = s.id || String(idx); dOrigin.appendChild(make('summary', { text: 'Origin' }));
      dOrigin.appendChild(kv('x', s2(s.origin?.x||0), { path: `spaces.${idx}.origin.x`, type: 'number' }));
      dOrigin.appendChild(kv('y', s2(s.origin?.y||0), { path: `spaces.${idx}.origin.y`, type: 'number' }));
      dOrigin.appendChild(kv('z', s2(s.origin?.z||0), { path: `spaces.${idx}.origin.z`, type: 'number' }));
      d.appendChild(dOrigin);

      const dRot = make('details'); dRot.dataset.section = 'rotation'; dRot.dataset.spaceId = s.id || String(idx); dRot.appendChild(make('summary', { text: 'Rotation (rad)' }));
      dRot.appendChild(kv('x', s2(s.rotation?.x||0), { path: `spaces.${idx}.rotation.x`, type: 'number' }));
      dRot.appendChild(kv('y', s2(s.rotation?.y||0), { path: `spaces.${idx}.rotation.y`, type: 'number' }));
      dRot.appendChild(kv('z', s2(s.rotation?.z||0), { path: `spaces.${idx}.rotation.z`, type: 'number' }));
      d.appendChild(dRot);

      // Voxel map summary
      const dVox = make('details'); dVox.dataset.section = 'voxel'; dVox.dataset.spaceId = s.id || String(idx); dVox.appendChild(make('summary', { text: 'Voxel Map' }));
      const vx = s?.vox?.size?.x || 0, vy = s?.vox?.size?.y || 0, vz = s?.vox?.size?.z || 0;
      const vres = s?.vox?.res || s?.res || (barrow?.meta?.voxelSize || 1);
      dVox.appendChild(kv('dims (vox)', `${vx} × ${vy} × ${vz}`));
      try { const vol = (vx|0) * (vy|0) * (vz|0); dVox.appendChild(kv('cells (count)', String(vol))); } catch {}
      dVox.appendChild(kv('res (world/vox)', s2(vres)));
      d.appendChild(dVox);

      dSpaces.appendChild(d);
    });
  }
  root.appendChild(dSpaces);
  // Restore top-level Spaces open state
  try { dSpaces.open = !!spacesWasOpen; } catch {}

  // Restore open/closed states for each space and its subsections
  try {
    root.querySelectorAll('details[data-space-id]').forEach((d) => {
      const sid = d.dataset.spaceId;
      if (openSet.has(`space:${sid}`)) d.open = true;
      d.querySelectorAll('details[data-section]').forEach((sec) => {
        const key = `sec:${sid}:${sec.dataset.section}`;
        if (openSet.has(key)) sec.open = true;
      });
    });
  } catch {}

  // Inline editing — double-click to edit a value
  const startEdit = (span) => {
    const path = span.dataset.path; if (!path) return;
    const type = span.dataset.type || 'text';
    const prevText = String(span.textContent || '');
    const input = document.createElement('input');
    input.type = (type === 'number') ? 'number' : 'text';
    input.value = prevText;
    input.style.width = Math.max(60, prevText.length * 9) + 'px';
    span.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      const valText = input.value;
      const newSpan = document.createElement('span');
      newSpan.dataset.path = path; newSpan.dataset.type = type; newSpan.dataset.editable = '1'; newSpan.title = 'Double-click to edit';
      newSpan.textContent = commit ? valText : prevText;
      input.replaceWith(newSpan);
      if (!commit || valText === prevText) return;
      // Apply to model
      let value = (type === 'number') ? Number(valText) : valText;
      if (type === 'number' && !isFinite(value)) return; // ignore invalid numbers
      setByPath(barrow, path, value);
      // Notify app to persist + rebuild
      try { window.dispatchEvent(new CustomEvent('dw:dbEdit', { detail: { barrow, path, value, prev: prevText } })); } catch {}
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };

  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (/^\d+$/.test(key)) {
        cur = cur[Number(key)];
      } else {
        if (cur[key] == null) cur[key] = {};
        cur = cur[key];
      }
      if (cur == null) return;
    }
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) cur[Number(last)] = value; else cur[last] = value;
  }

  root.addEventListener('dblclick', (e) => {
    const span = e.target.closest('span[data-editable="1"]');
    if (!span) return;
    startEdit(span);
  });

  // Toggle twist-open details (use native <details> behavior) and center on space when clicking within a space block
  root.addEventListener('click', (e) => {
    // Ignore clicks on editors/controls
    if (e.target.closest('input,select,textarea,button')) return;
    const spaceDetails = e.target.closest('details[data-space-id]');
    const sum = e.target.closest('summary');
    // Let the browser handle <details>/<summary> toggling by default; do not preventDefault here
    if (spaceDetails && root.contains(spaceDetails)) {
      const id = spaceDetails.dataset.spaceId;
      if (id) {
        const shiftKey = !!(e.shiftKey);
        try { window.dispatchEvent(new CustomEvent('dw:dbRowClick', { detail: { type: 'space', id, shiftKey } })); } catch {}
      }
    }
  });

  // Also support toggling via the native 'toggle' event for <details>
  root.addEventListener('toggle', (e) => {
    // No-op, but ensures event bubbles and can be listened to elsewhere if needed
  });
}
