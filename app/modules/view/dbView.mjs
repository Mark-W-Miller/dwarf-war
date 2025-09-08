// Database view renderer for barrow summary and spaces
export function renderDbView(barrow) {
  const root = document.getElementById('dbView'); if (!root) return;
  const meta = barrow.meta || {};
  function kv(label, value) { return `<div class="kv"><b>${label}:</b> ${value}</div>`; }
  function s2(n){ if (typeof n !== 'number') return n; return parseFloat(Number(n).toPrecision(2)); }
  root.innerHTML = `
    <details open>
      <summary>Summary</summary>
      ${kv('barrowId', barrow.id || '-')}
      ${kv('units', meta.units || '-')}
      ${kv('voxelSize', s2(meta.voxelSize ?? '-'))}
      ${kv('spaces', (barrow.spaces||[]).length)}
      ${kv('version', meta.version ?? '-')}
    </details>
    <details>
      <summary>Spaces ${(barrow.spaces||[]).length}</summary>
      ${(barrow.spaces||[]).map(s => `<div class=\"kv\">${s.id} — ${s.type} size ${s2(s.size?.x||0)}×${s2(s.size?.y||0)}×${s2(s.size?.z||0)} @${s2(s.res)} origin (${s2(s.origin?.x||0)},${s2(s.origin?.y||0)},${s2(s.origin?.z||0)})</div>`).join('') || '<div class=\"kv\">(none)</div>'}
    </details>
  `;
}

