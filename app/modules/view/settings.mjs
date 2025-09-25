// Settings tab UI: zoom and pan speed controls
import { Log } from '../util/log.mjs';
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
  slider.addEventListener('input', () => {
    valueSpan.textContent = slider.value; localStorage.setItem(KEY, slider.value); camApi.applyZoomBase();
    try { Log.log('UI', 'Change setting', { key: 'zoomBase', value: Number(slider.value) }); } catch {}
  });

  const PKEY = 'dw:ui:panBase';
  const pstored = Number(localStorage.getItem(PKEY) || '200') || 200;
  slider2.value = String(pstored); valueSpan2.textContent = String(pstored);
  slider2.addEventListener('input', () => {
    valueSpan2.textContent = slider2.value; localStorage.setItem(PKEY, slider2.value); camApi.applyPanBase();
    try { Log.log('UI', 'Change setting', { key: 'panBase', value: Number(slider2.value) }); } catch {}
  });

  // Dolly speed slider (wheel-at-max forward speed multiplier)
  const rowDS = document.createElement('div'); rowDS.className = 'row';
  const labelDS = document.createElement('label'); labelDS.textContent = 'Dolly Speed'; labelDS.style.display = 'flex'; labelDS.style.alignItems = 'center'; labelDS.style.gap = '8px';
  const sliderDS = document.createElement('input'); sliderDS.type = 'range'; sliderDS.min = '25'; sliderDS.max = '400'; sliderDS.step = '5'; sliderDS.id = 'dollySpeed';
  const valueDS = document.createElement('span'); valueDS.id = 'dollySpeedVal';
  labelDS.appendChild(sliderDS); labelDS.appendChild(valueDS); rowDS.appendChild(labelDS); pane.appendChild(rowDS);
  const DOLLY_KEY = 'dw:ui:dollySpeed';
  let dStored = Number(localStorage.getItem(DOLLY_KEY) || '100') || 100; // percent
  dStored = Math.max(25, Math.min(400, dStored));
  sliderDS.value = String(dStored); valueDS.textContent = String(dStored) + '%';
  sliderDS.addEventListener('input', () => {
    valueDS.textContent = sliderDS.value + '%';
    try { localStorage.setItem(DOLLY_KEY, sliderDS.value); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'dollySpeed', valuePct: Number(sliderDS.value) }); } catch {}
  });

  // Scryball speed slider (arrow-key drive speed multiplier in Cavern/SBM)
  const rowSB = document.createElement('div'); rowSB.className = 'row';
  const labelSB = document.createElement('label'); labelSB.textContent = 'Scryball Speed'; labelSB.style.display = 'flex'; labelSB.style.alignItems = 'center'; labelSB.style.gap = '8px';
  const sliderSB = document.createElement('input'); sliderSB.type = 'range'; sliderSB.min = '25'; sliderSB.max = '400'; sliderSB.step = '5'; sliderSB.id = 'scrySpeed';
  const valueSB = document.createElement('span'); valueSB.id = 'scrySpeedVal';
  labelSB.appendChild(sliderSB); labelSB.appendChild(valueSB); rowSB.appendChild(labelSB); pane.appendChild(rowSB);
  const SCRY_KEY = 'dw:ui:scrySpeed';
  let sStored = Number(localStorage.getItem(SCRY_KEY) || '100') || 100;
  sStored = Math.max(25, Math.min(400, sStored));
  sliderSB.value = String(sStored); valueSB.textContent = String(sStored) + '%';
  sliderSB.addEventListener('input', () => {
    valueSB.textContent = sliderSB.value + '%';
    try { localStorage.setItem(SCRY_KEY, sliderSB.value); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'scrySpeed', valuePct: Number(sliderSB.value) }); } catch {}
  });

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
    try { Log.log('UI', 'Change setting', { key: 'textScale', value: Number(slider3.value) }); } catch {}
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
    try { Log.log('UI', 'Change setting', { key: 'gridStrength', value: Number(slider4.value) }); } catch {}
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
    try { Log.log('UI', 'Change setting', { key: 'arrowStrength', value: Number(slider5.value) }); } catch {}
  });

  // Axis thickness (radius) slider
  const rowAx = document.createElement('div'); rowAx.className = 'row';
  const labelAx = document.createElement('label'); labelAx.textContent = 'Axis Thickness'; labelAx.style.display = 'flex'; labelAx.style.alignItems = 'center'; labelAx.style.gap = '8px';
  const sliderAx = document.createElement('input'); sliderAx.type = 'range'; sliderAx.min = '5'; sliderAx.max = '200'; sliderAx.step = '1'; sliderAx.id = 'axisRadius';
  const valueAx = document.createElement('span'); valueAx.id = 'axisRadiusVal';
  labelAx.appendChild(sliderAx); labelAx.appendChild(valueAx); rowAx.appendChild(labelAx); pane.appendChild(rowAx);
  const AXKEY = 'dw:ui:axisRadius';
  const axStored = Number(localStorage.getItem(AXKEY) || '100') || 100;
  sliderAx.value = String(axStored); valueAx.textContent = String(axStored + '%');
  sliderAx.addEventListener('input', () => {
    valueAx.textContent = sliderAx.value + '%';
    try { localStorage.setItem(AXKEY, sliderAx.value); } catch {}
    try { ui.applyAxisRadius?.(); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'axisRadius', valuePct: Number(sliderAx.value) }); } catch {}
  });

  // Rotation sensitivity slider
  const rowRot = document.createElement('div'); rowRot.className = 'row';
  const labelRot = document.createElement('label'); labelRot.textContent = 'Rotation Speed'; labelRot.style.display = 'flex'; labelRot.style.alignItems = 'center'; labelRot.style.gap = '8px';
  const sliderRot = document.createElement('input'); sliderRot.type = 'range'; sliderRot.min = '10'; sliderRot.max = '200'; sliderRot.step = '5'; sliderRot.id = 'rotSens';
  const valueRot = document.createElement('span'); valueRot.id = 'rotSensVal';
  labelRot.appendChild(sliderRot); labelRot.appendChild(valueRot); rowRot.appendChild(labelRot); pane.appendChild(rowRot);
  const RKEY = 'dw:ui:rotSens';
  const rstored = Number(localStorage.getItem(RKEY) || '80') || 80;
  sliderRot.value = String(rstored); valueRot.textContent = String(rstored + '%');
  sliderRot.addEventListener('input', () => {
    valueRot.textContent = sliderRot.value + '%';
    try { localStorage.setItem(RKEY, sliderRot.value); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'rotSens', value: Number(sliderRot.value) }); } catch {}
  });

  // Selection glow strength slider (3x range and sensitivity)
  const row7 = document.createElement('div'); row7.className = 'row';
  const label7 = document.createElement('label'); label7.textContent = 'Selection Glow'; label7.style.display = 'flex'; label7.style.alignItems = 'center'; label7.style.gap = '8px';
  const slider7 = document.createElement('input'); slider7.type = 'range'; slider7.min = '0'; slider7.max = '300'; slider7.step = '1'; slider7.id = 'glowStrength';
  const valueSpan7 = document.createElement('span'); valueSpan7.id = 'glowStrengthVal';
  label7.appendChild(slider7); label7.appendChild(valueSpan7); row7.appendChild(label7); pane.appendChild(row7);
  const HKEY = 'dw:ui:glowStrength';
  const hstored = Number(localStorage.getItem(HKEY) || '70') || 70;
  slider7.value = String(hstored); valueSpan7.textContent = String(hstored);
  slider7.addEventListener('input', () => {
    valueSpan7.textContent = slider7.value;
    try { localStorage.setItem(HKEY, slider7.value); } catch {}
    try { ui.applyGlowStrength?.(); } catch {}
    try { ui.rebuildHalos?.(); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'glowStrength', value: Number(slider7.value) }); } catch {}
  });

  // Gizmo size (rotation ring diameter and move disc radius)
  const row9 = document.createElement('div'); row9.className = 'row';
  const label9 = document.createElement('label'); label9.textContent = 'Gizmo Size'; label9.style.display = 'flex'; label9.style.alignItems = 'center'; label9.style.gap = '8px';
  const slider9 = document.createElement('input'); slider9.type = 'range'; slider9.min = '50'; slider9.max = '300'; slider9.step = '5'; slider9.id = 'gizmoSize';
  const valueSpan9 = document.createElement('span'); valueSpan9.id = 'gizmoSizeVal';
  label9.appendChild(slider9); label9.appendChild(valueSpan9); row9.appendChild(label9); pane.appendChild(row9);
  const GZKEY = 'dw:ui:gizmoScale';
  const gzStored = Number(localStorage.getItem(GZKEY) || '100') || 100;
  slider9.value = String(gzStored); valueSpan9.textContent = String(gzStored + '%');
  slider9.addEventListener('input', () => {
    valueSpan9.textContent = slider9.value + '%';
    try { localStorage.setItem(GZKEY, slider9.value); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'gizmoScale', valuePct: Number(slider9.value) }); } catch {}
    try { window.dispatchEvent(new CustomEvent('dw:transform', { detail: { kind: 'settings:gizmoScale', scalePct: Number(slider9.value) } })); } catch {}
  });

  // Voxel Wall Opacity (translucent walls)
  const row10 = document.createElement('div'); row10.className = 'row';
  const label10 = document.createElement('label'); label10.textContent = 'Voxel Wall Opacity'; label10.style.display = 'flex'; label10.style.alignItems = 'center'; label10.style.gap = '8px';
  const slider10 = document.createElement('input'); slider10.type = 'range'; slider10.min = '0'; slider10.max = '100'; slider10.step = '1'; slider10.id = 'wallOpacity';
  const valueSpan10 = document.createElement('span'); valueSpan10.id = 'wallOpacityVal';
  label10.appendChild(slider10); label10.appendChild(valueSpan10); row10.appendChild(label10); pane.appendChild(row10);
  const WKEY = 'dw:ui:wallOpacity';
  const wStored = Number(localStorage.getItem(WKEY) || '60') || 60;
  slider10.value = String(wStored); valueSpan10.textContent = String(wStored + '%');
  slider10.addEventListener('input', () => {
    valueSpan10.textContent = slider10.value + '%';
    try { localStorage.setItem(WKEY, slider10.value); } catch {}
    try { ui.applyVoxelOpacity?.(); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'wallOpacity', valuePct: Number(slider10.value) }); } catch {}
  });

  // Voxel Rock Opacity
  const row11 = document.createElement('div'); row11.className = 'row';
  const label11 = document.createElement('label'); label11.textContent = 'Voxel Rock Opacity'; label11.style.display = 'flex'; label11.style.alignItems = 'center'; label11.style.gap = '8px';
  const slider11 = document.createElement('input'); slider11.type = 'range'; slider11.min = '0'; slider11.max = '100'; slider11.step = '1'; slider11.id = 'rockOpacity';
  const valueSpan11 = document.createElement('span'); valueSpan11.id = 'rockOpacityVal';
  label11.appendChild(slider11); label11.appendChild(valueSpan11); row11.appendChild(label11); pane.appendChild(row11);
  const RCKEY = 'dw:ui:rockOpacity';
  const rcStored = Number(localStorage.getItem(RCKEY) || '85') || 85;
  slider11.value = String(rcStored); valueSpan11.textContent = String(rcStored + '%');
  slider11.addEventListener('input', () => {
    valueSpan11.textContent = slider11.value + '%';
    try { localStorage.setItem(RCKEY, slider11.value); } catch {}
    try { ui.applyVoxelOpacity?.(); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'rockOpacity', valuePct: Number(slider11.value) }); } catch {}
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
    try { Log.log('UI', 'Change setting', { key: 'exactCSG', value: !!cb6.checked }); } catch {}
  });

  // Pick Debug Logs toggle
  const row8 = document.createElement('div'); row8.className = 'row';
  const label8 = document.createElement('label'); label8.style.display = 'flex'; label8.style.alignItems = 'center'; label8.style.gap = '8px';
  const cb8 = document.createElement('input'); cb8.type = 'checkbox'; cb8.id = 'pickDebug';
  const text8 = document.createElement('span'); text8.textContent = 'Pick Debug Logs';
  label8.appendChild(cb8); label8.appendChild(text8); row8.appendChild(label8); pane.appendChild(row8);
  const DKEY = 'dw:debug:picking';
  try { cb8.checked = (localStorage.getItem(DKEY) === '1'); } catch { cb8.checked = false; }
  cb8.addEventListener('change', () => {
    try { localStorage.setItem(DKEY, cb8.checked ? '1' : '0'); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'pickDebug', value: !!cb8.checked }); } catch {}
  });

  // Send Errors to Local Server toggle
  const rowSE = document.createElement('div'); rowSE.className = 'row';
  const labelSE = document.createElement('label'); labelSE.style.display = 'flex'; labelSE.style.alignItems = 'center'; labelSE.style.gap = '8px';
  const cbSE = document.createElement('input'); cbSE.type = 'checkbox'; cbSE.id = 'sendErrors';
  const textSE = document.createElement('span'); textSE.textContent = 'Send Errors to Local Server';
  labelSE.appendChild(cbSE); labelSE.appendChild(textSE); rowSE.appendChild(labelSE); pane.appendChild(rowSE);
  const SEND_KEY = 'dw:dev:sendErrors';
  try { cbSE.checked = (localStorage.getItem(SEND_KEY) === '1'); } catch { cbSE.checked = false; }
  cbSE.addEventListener('change', () => {
    try { localStorage.setItem(SEND_KEY, cbSE.checked ? '1' : '0'); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'sendErrors', value: !!cbSE.checked }); } catch {}
  });

  // Forward App Logs to Local Server toggle
  const rowSL = document.createElement('div'); rowSL.className = 'row';
  const labelSL = document.createElement('label'); labelSL.style.display = 'flex'; labelSL.style.alignItems = 'center'; labelSL.style.gap = '8px';
  const cbSL = document.createElement('input'); cbSL.type = 'checkbox'; cbSL.id = 'sendLogs';
  const textSL = document.createElement('span'); textSL.textContent = 'Send App Logs to Local Server';
  labelSL.appendChild(cbSL); labelSL.appendChild(textSL); rowSL.appendChild(labelSL); pane.appendChild(rowSL);
  const SEND_LOGS_KEY = 'dw:dev:sendLogs';
  try { cbSL.checked = (localStorage.getItem(SEND_LOGS_KEY) === '1'); } catch { cbSL.checked = false; }
  cbSL.addEventListener('change', () => {
    try { localStorage.setItem(SEND_LOGS_KEY, cbSL.checked ? '1' : '0'); } catch {}
    try { Log.log('UI', 'Change setting', { key: 'sendLogs', value: !!cbSL.checked }); } catch {}
  });

  // Assistant controls: send control signals to the local receiver so the assistant can react
  const rowAC = document.createElement('div'); rowAC.className = 'row';
  const labelAC = document.createElement('label'); labelAC.style.display = 'flex'; labelAC.style.alignItems = 'center'; labelAC.style.gap = '8px';
  labelAC.textContent = 'Assistant Controls:';
  const btnStart = document.createElement('button'); btnStart.className = 'btn'; btnStart.textContent = 'Start Watch';
  const btnStop = document.createElement('button'); btnStop.className = 'btn'; btnStop.textContent = 'Stop Watch';
  const btnMark = document.createElement('button'); btnMark.className = 'btn'; btnMark.textContent = 'Checkpoint';
  rowAC.appendChild(labelAC); rowAC.appendChild(btnStart); rowAC.appendChild(btnStop); rowAC.appendChild(btnMark); pane.appendChild(rowAC);

  function sendControl(event, note) {
    try {
      const url = 'http://localhost:6060/log';
      const data = { app: 'dwarf-war', at: Date.now(), type: 'control', event, note: note||undefined, source: 'settings' };
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(data)], { type: 'text/plain;charset=UTF-8' });
        navigator.sendBeacon(url, blob); return;
      }
      fetch(url, { method: 'POST', body: JSON.stringify(data), keepalive: true, mode: 'no-cors' }).catch(() => {});
    } catch {}
  }
  btnStart.addEventListener('click', () => { try { sendControl('watch:on'); Log.log('UI', 'Assistant control', { event: 'watch:on' }); } catch {} });
  btnStop.addEventListener('click', () => { try { sendControl('watch:off'); Log.log('UI', 'Assistant control', { event: 'watch:off' }); } catch {} });
  btnMark.addEventListener('click', () => { try { sendControl('checkpoint'); Log.log('UI', 'Assistant control', { event: 'checkpoint' }); } catch {} });
}
