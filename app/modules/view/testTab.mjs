import { Log } from '../util/log.mjs';
import { createGizmoBuilder } from './gizmoBuilder.mjs';

function createElement(tag, attrs = {}) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  return el;
}

export function initTestTab({ pane, scene, camera, state }) {
  if (!pane || !scene || !camera) return;

  const log = (evt, data) => {
    try { Log.log('GIZMO_2', evt, data); }
    catch { console.log('GIZMO_2', evt, data); }
  };

  pane.classList.add('test-tab');

  const title = createElement('h3', { text: 'Gizmo Builder Test' });
  const info = createElement('p', { text: 'Enable the gizmo to drag axes, the blue plane disc, or rotation rings. Logs are emitted under GIZMO_2.' });
  pane.appendChild(title);
  pane.appendChild(info);

  const actions = createElement('div');
  actions.className = 'row';
  pane.appendChild(actions);

  const toggleBtn = createElement('button', { text: 'Enable Gizmo' });
  toggleBtn.className = 'btn';
  actions.appendChild(toggleBtn);

  const randomBtn = createElement('button', { text: 'Randomize Bounds' });
  randomBtn.className = 'btn';
  randomBtn.style.marginLeft = '8px';
  randomBtn.disabled = true;
  actions.appendChild(randomBtn);

  const resetBtn = createElement('button', { text: 'Reset Position' });
  resetBtn.className = 'btn';
  resetBtn.style.marginLeft = '8px';
  resetBtn.disabled = true;
  actions.appendChild(resetBtn);

  const toggleRow = createElement('div');
  toggleRow.className = 'column gizmo-toggle-row';
  toggleRow.style.marginTop = '12px';
  pane.appendChild(toggleRow);

  const toggleState = {
    'move:x': true,
    'move:y': true,
    'move:z': true,
    'rotate:x': true,
    'rotate:y': true,
    'rotate:z': true,
    'plane:ground': true
  };
  const toggleInputs = new Map();
  const toggleDefs = [
    { group: 'move:x', label: 'Move X' },
    { group: 'move:y', label: 'Move Y' },
    { group: 'move:z', label: 'Move Z' },
    { group: 'rotate:x', label: 'Rotate X' },
    { group: 'rotate:y', label: 'Rotate Y' },
    { group: 'rotate:z', label: 'Rotate Z' },
    { group: 'plane:ground', label: 'Ground Disc' }
  ];
  for (const def of toggleDefs) {
    const labelEl = createElement('label');
    labelEl.className = 'gizmo-toggle';
    labelEl.style.display = 'flex';
    labelEl.style.alignItems = 'center';
    labelEl.style.marginBottom = '4px';
    const checkbox = createElement('input', { type: 'checkbox' });
    checkbox.checked = toggleState[def.group];
    checkbox.style.marginRight = '6px';
    labelEl.appendChild(checkbox);
    const span = createElement('span', { text: def.label });
    labelEl.appendChild(span);
    toggleRow.appendChild(labelEl);
    toggleInputs.set(def.group, checkbox);
    checkbox.addEventListener('change', () => {
      toggleState[def.group] = !!checkbox.checked;
      if (builder) builder.setGroupEnabled(def.group, toggleState[def.group]);
    });
  }

  let builder = null;
  let testMesh = null;
  let gizmoEnabled = false;

  const defaultBounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

  function randomBounds() {
    const span = () => 0.5 + Math.random() * 4;
    const size = { x: span(), y: span(), z: span() };
    const min = { x: -size.x / 2, y: -size.y / 2, z: -size.z / 2 };
    const max = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
    builder?.setBounds({ min, max });
    builder?.setPosition(new BABYLON.Vector3(0, 0, 0));
  }

  randomBtn.addEventListener('click', () => {
    if (!builder) return;
    randomBounds();
    log('bounds:randomize', {});
  });

  resetBtn.addEventListener('click', () => {
    if (!builder) return;
    builder.setBounds(defaultBounds);
    builder.setPosition(new BABYLON.Vector3(0, 0, 0));
    if (builder.root) {
      builder.root.rotationQuaternion = BABYLON.Quaternion.Identity();
      if (builder.root.rotation) builder.root.rotation.set(0, 0, 0);
    }
    log('bounds:reset', {});
  });

  function disposeGizmo() {
    if (builder) {
      builder.dispose();
      builder = null;
    }
    if (state) { try { state._testGizmo = null; } catch {} }
    if (testMesh) {
      try { testMesh.parent = null; } catch {}
      try { testMesh.setEnabled(false); } catch {}
    }
    randomBtn.disabled = true;
    resetBtn.disabled = true;
  }

  function syncGroupToggles() {
    if (!builder) return;
    for (const [group, checkbox] of toggleInputs.entries()) {
      builder.setGroupEnabled(group, !!checkbox.checked);
    }
  }

  function ensureTestMesh() {
    if (testMesh && !testMesh.isDisposed?.()) {
      testMesh.setEnabled(true);
      return testMesh;
    }
    testMesh = BABYLON.MeshBuilder.CreateBox('testGizmo:mesh', { size: 2.4 }, scene);
    const mat = new BABYLON.StandardMaterial('testGizmo:mesh:mat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.55, 0.92);
    mat.emissiveColor = new BABYLON.Color3(0.18, 0.35, 0.68);
    mat.alpha = 0.28;
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    testMesh.material = mat;
    testMesh.isPickable = false;
    testMesh.renderingGroupId = 1;
    testMesh.position.set(0, 0, 0);
    log('testMesh:create', {});
    return testMesh;
  }

  function enableGizmo(on) {
    if (gizmoEnabled === !!on) return;
    gizmoEnabled = !!on;
    if (!gizmoEnabled) {
      disposeGizmo();
      toggleBtn.textContent = 'Enable Gizmo';
      log('gizmo:disable', {});
      return;
    }
    const mesh = ensureTestMesh();
    builder = createGizmoBuilder({ scene, camera, log });
    if (state) { try { state._testGizmo = builder; } catch {} }
    if (mesh) {
      mesh.parent = builder.root;
      mesh.position.set(0, 0, 0);
    }
    builder.setBounds(defaultBounds);
    builder.setPosition(new BABYLON.Vector3(0, 0, 0));
    builder.setActive(pane.classList.contains('active'));
    randomBtn.disabled = false;
    resetBtn.disabled = false;
    toggleBtn.textContent = 'Disable Gizmo';
    log('gizmo:enable', {});
    syncGroupToggles();
  }

  toggleBtn.addEventListener('click', () => {
    enableGizmo(!gizmoEnabled);
  });

  function handleTabChange(e) {
    const active = e?.detail?.id === 'tab-test';
    if (builder) builder.setActive(active && gizmoEnabled);
    if (active && gizmoEnabled) log('tab:activate', {});
  }

  window.addEventListener('dw:tabChange', handleTabChange);

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('dw:tabChange', handleTabChange);
    disposeGizmo();
  }, { once: true });
}
