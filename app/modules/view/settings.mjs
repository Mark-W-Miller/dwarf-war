// Settings tab UI: zoom and pan speed controls
export function initSettingsTab(camApi, ui = {}) {
  const pane = document.getElementById('tab-settings'); if (!pane) return;
  // Zoom speed slider
  const row = document.createElement('div'); row.className = 'row';
  const label = document.createElement('label'); label.textContent = 'Zoom Speed'; label.style.display = 'flex'; label.style.alignItems = 'center'; label.style.gap = '8px';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '5'; slider.max = '100'; slider.step = '1'; slider.id = 'zoomSpeed';
  const valueSpan = document.createElement('span'); valueSpan.id = 'zoomSpeedVal';
  label.appendChild(slider); label.appendChild(valueSpan); row.appendChild(label); pane.appendChild(row);

  // Pan speed slider (controls panningSensibility; lower = faster)
  const row2 = document.createElement('div'); row2.className = 'row';
  const label2 = document.createElement('label'); label2.textContent = 'Pan Speed'; label2.style.display = 'flex'; label2.style.alignItems = 'center'; label2.style.gap = '8px';
  const slider2 = document.createElement('input'); slider2.type = 'range'; slider2.min = '5'; slider2.max = '200'; slider2.step = '1'; slider2.id = 'panSpeed';
  const valueSpan2 = document.createElement('span'); valueSpan2.id = 'panSpeedVal';
  label2.appendChild(slider2); label2.appendChild(valueSpan2); row2.appendChild(label2); pane.appendChild(row2);

  const KEY = 'dw:ui:zoomBase';
  const stored = Number(localStorage.getItem(KEY) || '30') || 30;
  slider.value = String(stored); valueSpan.textContent = String(stored);
  slider.addEventListener('input', () => { valueSpan.textContent = slider.value; localStorage.setItem(KEY, slider.value); camApi.applyZoomBase(); });

  const PKEY = 'dw:ui:panBase';
  const pstored = Number(localStorage.getItem(PKEY) || '200') || 200;
  slider2.value = String(pstored); valueSpan2.textContent = String(pstored);
  slider2.addEventListener('input', () => { valueSpan2.textContent = slider2.value; localStorage.setItem(PKEY, slider2.value); camApi.applyPanBase(); });

  // Label text size slider
  const row3 = document.createElement('div'); row3.className = 'row';
  const label3 = document.createElement('label'); label3.textContent = 'Label Text Size'; label3.style.display = 'flex'; label3.style.alignItems = 'center'; label3.style.gap = '8px';
  const slider3 = document.createElement('input'); slider3.type = 'range'; slider3.min = '10'; slider3.max = '10000'; slider3.step = '100'; slider3.id = 'textSize';
  const valueSpan3 = document.createElement('span'); valueSpan3.id = 'textSizeVal';
  label3.appendChild(slider3); label3.appendChild(valueSpan3); row3.appendChild(label3); pane.appendChild(row3);

  const TSKEY = 'dw:ui:textScale';
  const tstored = Number(localStorage.getItem(TSKEY) || '100') || 100;
  slider3.value = String(tstored); valueSpan3.textContent = String(tstored + '%');
  slider3.addEventListener('input', () => {
    valueSpan3.textContent = slider3.value + '%';
    try { localStorage.setItem(TSKEY, slider3.value); } catch {}
    try { ui.applyTextScale?.(); } catch {}
  });

  // Grid intensity slider
  const row4 = document.createElement('div'); row4.className = 'row';
  const label4 = document.createElement('label'); label4.textContent = 'Grid Strength'; label4.style.display = 'flex'; label4.style.alignItems = 'center'; label4.style.gap = '8px';
  const slider4 = document.createElement('input'); slider4.type = 'range'; slider4.min = '0'; slider4.max = '100'; slider4.step = '1'; slider4.id = 'gridStrength';
  const valueSpan4 = document.createElement('span'); valueSpan4.id = 'gridStrengthVal';
  label4.appendChild(slider4); label4.appendChild(valueSpan4); row4.appendChild(label4); pane.appendChild(row4);
  const GKEY = 'dw:ui:gridStrength';
  const gstored = Number(localStorage.getItem(GKEY) || '80') || 80;
  slider4.value = String(gstored); valueSpan4.textContent = String(gstored);
  slider4.addEventListener('input', () => {
    valueSpan4.textContent = slider4.value;
    try { localStorage.setItem(GKEY, slider4.value); } catch {}
    try { ui.applyGridArrowVisuals?.(); } catch {}
  });

  // Axis arrow brightness slider
  const row5 = document.createElement('div'); row5.className = 'row';
  const label5 = document.createElement('label'); label5.textContent = 'Arrow Brightness'; label5.style.display = 'flex'; label5.style.alignItems = 'center'; label5.style.gap = '8px';
  const slider5 = document.createElement('input'); slider5.type = 'range'; slider5.min = '0'; slider5.max = '100'; slider5.step = '1'; slider5.id = 'arrowStrength';
  const valueSpan5 = document.createElement('span'); valueSpan5.id = 'arrowStrengthVal';
  label5.appendChild(slider5); label5.appendChild(valueSpan5); row5.appendChild(label5); pane.appendChild(row5);
  const AKEY = 'dw:ui:arrowStrength';
  const astored = Number(localStorage.getItem(AKEY) || '40') || 40;
  slider5.value = String(astored); valueSpan5.textContent = String(astored);
  slider5.addEventListener('input', () => {
    valueSpan5.textContent = slider5.value;
    try { localStorage.setItem(AKEY, slider5.value); } catch {}
    try { ui.applyGridArrowVisuals?.(); } catch {}
  });

  // Exact Intersection (CSG) toggle — performance note
  const row6 = document.createElement('div'); row6.className = 'row'; row6.style.alignItems = 'flex-start';
  const label6 = document.createElement('label'); label6.style.display = 'flex'; label6.style.alignItems = 'center'; label6.style.gap = '8px';
  const cb6 = document.createElement('input'); cb6.type = 'checkbox'; cb6.id = 'exactCSG';
  const text6 = document.createElement('span'); text6.textContent = 'Exact Intersection (CSG)';
  label6.appendChild(cb6); label6.appendChild(text6); row6.appendChild(label6);
  const hint6 = document.createElement('div'); hint6.className = 'hint'; hint6.textContent = 'Computes true mesh intersections on rebuild. More accurate, potentially slower on large scenes.';
  row6.appendChild(hint6); pane.appendChild(row6);
  const CKEY = 'dw:ui:exactCSG';
  try { cb6.checked = (localStorage.getItem(CKEY) === '1'); } catch { cb6.checked = false; }
  cb6.addEventListener('change', () => {
    try { localStorage.setItem(CKEY, cb6.checked ? '1' : '0'); } catch {}
    // Rebuild to apply intersection mode
    try { ui.rebuildScene?.(); } catch {}
  });
}
