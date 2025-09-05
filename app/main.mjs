import { makeDefaultBarrow, mergeInstructions, directions, layoutBarrow } from './modules/barrow/schema.mjs';
import { loadBarrow, saveBarrow, snapshot } from './modules/barrow/store.mjs';
import { buildSceneFromBarrow, disposeBuilt } from './modules/barrow/builder.mjs';
import { AssistantBus } from './modules/assistant/bus.mjs';
import { parseInstructions, parseCommands } from './modules/assistant/nlParser.mjs';
import { executeCommands } from './modules/assistant/commands.mjs';
import { loadAISettings, saveAISettings, askAI } from './modules/assistant/ai.mjs';

// Babylon setup
const canvas = document.getElementById('renderCanvas');
const hud = document.getElementById('hud');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.07, 1.0);

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', Math.PI * 1.2, Math.PI / 3, 24, new BABYLON.Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 6; camera.upperRadiusLimit = 200;
camera.minZ = 0.1; camera.maxZ = 1000;

// Lighting
const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, -1), scene);
dir.position = new BABYLON.Vector3(10, 20, 10); dir.intensity = 1.1;
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.2;

// Ground and backdrop
const cave = BABYLON.MeshBuilder.CreateSphere('cave', { diameter: 120, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
const caveMat = new BABYLON.PBRMetallicRoughnessMaterial('caveMat', scene);
caveMat.baseColor = new BABYLON.Color3(0.22, 0.24, 0.28); caveMat.metallic = 0.0; caveMat.roughness = 1.0; cave.material = caveMat;
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 400, height: 400 }, scene);
ground.position.y = -2; const groundMat = new BABYLON.PBRMetallicRoughnessMaterial('groundMat', scene);
groundMat.baseColor = new BABYLON.Color3(0.18, 0.18, 0.18); groundMat.metallic = 0.0; groundMat.roughness = 0.9; ground.material = groundMat;

// App state
const state = {
  mode: 'edit', // 'edit' | 'game'
  running: true,
  barrow: null,
  built: null, // handles to built meshes
};

// Load or create barrow
state.barrow = loadBarrow() || makeDefaultBarrow();
layoutBarrow(state.barrow); // ensure positions from directions
state.built = buildSceneFromBarrow(scene, state.barrow);

function setMode(mode) {
  state.mode = mode;
  hud.textContent = `Dwarf War • ${mode === 'edit' ? 'Edit' : 'Game'} mode ${state.running ? '• Running' : '• Paused'}`;
}
function setRunning(run) {
  state.running = run;
  hud.textContent = `Dwarf War • ${state.mode === 'edit' ? 'Edit' : 'Game'} mode ${run ? '• Running' : '• Paused'}`;
}

// UI wiring
const toggleRunBtn = document.getElementById('toggleRun');
const resetBtn = document.getElementById('reset');
const exportBtn = document.getElementById('export');
const importBtn = document.getElementById('import');
const importFile = document.getElementById('importFile');
const applyBtn = document.getElementById('apply');
const parseBtn = document.getElementById('parse');
const executeBtn = document.getElementById('execute');
const assistantOutput = document.getElementById('assistantOutput');
const askAIBtn = document.getElementById('askAI');
const clearBtn = document.getElementById('clear');
const assistantInput = document.getElementById('assistantInput');
const panel = document.getElementById('rightPanel');
const collapsePanelBtn = document.getElementById('collapsePanel');
const settingsOpenBtn = document.getElementById('settingsOpen');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsClose');
// Settings elements
const aiProviderEl = document.getElementById('aiProvider');
const aiModelEl = document.getElementById('aiModel');
const aiKeyEl = document.getElementById('aiKey');
const aiBaseUrlEl = document.getElementById('aiBaseUrl');
const saveAIBtn = document.getElementById('saveAI');
const testAIBtn = document.getElementById('testAI');

document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener('change', () => setMode(r.value));
});
toggleRunBtn.addEventListener('click', () => {
  setRunning(!state.running);
  toggleRunBtn.textContent = state.running ? 'Pause' : 'Run';
});
resetBtn.addEventListener('click', () => {
  disposeBuilt(state.built);
  state.barrow = makeDefaultBarrow();
  layoutBarrow(state.barrow);
  state.built = buildSceneFromBarrow(scene, state.barrow);
  saveBarrow(state.barrow); snapshot(state.barrow);
});
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.barrow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${state.barrow.id || 'barrow'}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
});
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    disposeBuilt(state.built);
    state.barrow = mergeInstructions(loadBarrow() || makeDefaultBarrow(), data);
    layoutBarrow(state.barrow);
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
  } catch (err) { console.error('Import failed', err); }
  importFile.value = '';
});
applyBtn.addEventListener('click', () => {
  const text = assistantInput.value.trim(); if (!text) return;
  try {
    const data = JSON.parse(text);
    const merged = mergeInstructions(state.barrow, data);
    disposeBuilt(state.built);
    layoutBarrow(merged);
    state.barrow = merged;
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
  } catch (err) {
    console.error('Apply failed', err);
  }
});
clearBtn.addEventListener('click', () => assistantInput.value = '');

executeBtn.addEventListener('click', () => {
  const text = assistantInput.value.trim(); if (!text) return;
  try {
    const cmds = parseCommands(text);
    if (!cmds.length) { assistantOutput.textContent = 'No command recognized.'; return; }
    const { barrow: updated, messages } = executeCommands(state.barrow, cmds);
    disposeBuilt(state.built);
    state.barrow = updated;
    state.built = buildSceneFromBarrow(scene, state.barrow);
    saveBarrow(state.barrow); snapshot(state.barrow);
    assistantOutput.textContent = messages.join('\n');
  } catch (err) {
    console.error('Execute failed', err);
    assistantOutput.textContent = 'Execute failed: ' + err.message;
  }
});

// Assistant outlet (for future in-app Q&A). For now, we just log questions.
const assistant = new AssistantBus({ onQuestion: (q) => console.log('QUESTION:', q) });
assistant.ask({ kind: 'info', text: 'Editor initialized. Paste JSON and click Apply to update the barrow.' });

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  // In edit mode and paused, skip game updates (none yet), still render
  // Future: when in game mode and running, tick AI/sim here.
  scene.render();
});

window.addEventListener('resize', () => engine.resize());

// Collapse/expand panel with persistence
const PANEL_STATE_KEY = 'dw:ui:panelCollapsed';
function applyPanelCollapsed(collapsed) {
  panel.classList.toggle('collapsed', !!collapsed);
  collapsePanelBtn.textContent = collapsed ? '⟩' : '⟨⟩';
}
applyPanelCollapsed(localStorage.getItem(PANEL_STATE_KEY) === '1');
collapsePanelBtn.addEventListener('click', () => {
  const next = !panel.classList.contains('collapsed');
  applyPanelCollapsed(next);
  try { localStorage.setItem(PANEL_STATE_KEY, next ? '1' : '0'); } catch {}
});

// AI settings load/save
function fillAIFields() {
  const aiCfg = loadAISettings();
  aiProviderEl.value = aiCfg.provider || 'none';
  aiModelEl.value = aiCfg.model || 'gpt-4o-mini';
  aiKeyEl.value = aiCfg.apiKey || '';
  aiBaseUrlEl.value = aiCfg.baseUrl || 'https://api.openai.com';
}
fillAIFields();

saveAIBtn.addEventListener('click', () => {
  const cfg = {
    provider: aiProviderEl.value,
    model: aiModelEl.value.trim(),
    apiKey: aiKeyEl.value.trim(),
    baseUrl: aiBaseUrlEl.value.trim() || 'https://api.openai.com',
  };
  saveAISettings(cfg);
  assistantOutput.textContent = 'AI settings saved.';
});

testAIBtn.addEventListener('click', async () => {
  assistantOutput.textContent = 'Testing AI...';
  const cfg = loadAISettings();
  try {
    const resp = await askAI(cfg, { mode: 'instructions', text: 'Dento is the central cavern connected north and south.' });
    assistantOutput.textContent = 'AI OK. Sample response:\n' + resp;
  } catch (err) {
    assistantOutput.textContent = 'AI test failed: ' + err.message + '\nNote: Calling OpenAI from a browser may require CORS to be enabled or a proxy server.';
  }
});

askAIBtn.addEventListener('click', async () => {
  const text = assistantInput.value.trim(); if (!text) return;
  assistantOutput.textContent = 'Asking AI...';
  const cfg = loadAISettings();
  try {
    // Heuristic: if the text starts with verbs like create/add/rename/list, interpret as commands
    const mode = /^\s*(create|add|rename|list|show|connect)\b/i.test(text) ? 'commands' : 'instructions';
    const resp = await askAI(cfg, { mode, text });
    if (mode === 'commands') {
      // Try to parse response as JSON array of commands and execute
      let cmds;
      try { cmds = JSON.parse(resp); } catch (e) { throw new Error('AI did not return valid commands JSON'); }
      const { barrow: updated, messages } = executeCommands(state.barrow, cmds);
      disposeBuilt(state.built);
      state.barrow = updated;
      state.built = buildSceneFromBarrow(scene, state.barrow);
      saveBarrow(state.barrow); snapshot(state.barrow);
      assistantOutput.textContent = messages.join('\n');
    } else {
      // Instructions mode -> fill textarea with JSON for review
      assistantInput.value = resp;
      assistantOutput.textContent = 'AI produced instructions JSON. Click Apply to merge.';
    }
  } catch (err) {
    assistantOutput.textContent = 'AI request failed: ' + err.message + '\nIf this is a CORS issue, set up a proxy or run from a server.';
  }
});

// Settings modal open/close
function openSettings() {
  fillAIFields();
  settingsModal.classList.add('open');
}
function closeSettings() { settingsModal.classList.remove('open'); }
settingsOpenBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

// Build tabs: Edit and Database, and move existing controls accordingly
(function setupTabs() {
  const panelContent = document.querySelector('.panel-content');
  if (!panelContent) return;
  // Create tabs bar and panes
  const tabsBar = document.createElement('div'); tabsBar.className = 'tabs';
  const tabEditBtn = document.createElement('button'); tabEditBtn.className = 'tab active'; tabEditBtn.dataset.tab = 'tab-edit'; tabEditBtn.textContent = 'Edit';
  const tabDbBtn = document.createElement('button'); tabDbBtn.className = 'tab'; tabDbBtn.dataset.tab = 'tab-db'; tabDbBtn.textContent = 'Database';
  tabsBar.appendChild(tabEditBtn); tabsBar.appendChild(tabDbBtn);

  const editPane = document.createElement('div'); editPane.id = 'tab-edit'; editPane.className = 'tab-pane active';
  const dbPane = document.createElement('div'); dbPane.id = 'tab-db'; dbPane.className = 'tab-pane';

  // Move existing children into editPane
  const existing = Array.from(panelContent.childNodes);
  panelContent.textContent = '';
  panelContent.appendChild(tabsBar);
  panelContent.appendChild(editPane);
  panelContent.appendChild(dbPane);
  for (const node of existing) editPane.appendChild(node);

  // Split the first row: move Reset/Export/Import controls into DB pane
  const firstRow = editPane.querySelector('.row');
  if (firstRow) {
    const dbRow = document.createElement('div'); dbRow.className = 'row';
    const idsToMove = ['reset','export','import','importFile'];
    for (const id of idsToMove) {
      const el = firstRow.querySelector('#' + id) || editPane.querySelector('#' + id);
      if (el) dbRow.appendChild(el);
    }
    if (dbRow.childElementCount > 0) dbPane.appendChild(dbRow);
  }

  function activate(tabId) {
    editPane.classList.toggle('active', tabId === 'tab-edit');
    dbPane.classList.toggle('active', tabId === 'tab-db');
    tabEditBtn.classList.toggle('active', tabId === 'tab-edit');
    tabDbBtn.classList.toggle('active', tabId === 'tab-db');
  }
  tabEditBtn.addEventListener('click', () => activate('tab-edit'));
  tabDbBtn.addEventListener('click', () => activate('tab-db'));
})();
parseBtn.addEventListener('click', () => {
  const text = assistantInput.value.trim(); if (!text) return;
  try {
    const instr = parseInstructions(text);
    assistantInput.value = JSON.stringify(instr, null, 2);
  } catch (err) {
    console.error('Parse failed', err);
  }
});
