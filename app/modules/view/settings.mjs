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
}
