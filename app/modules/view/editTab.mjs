// Build the Edit tab pane UI elements (HTML only). No event handlers here.
export function buildEditTab({ state, Log } = {}) {
  const editPane = document.getElementById('tab-edit');
  if (!editPane) return null;
  // Section container
  const section = document.createElement('div');
  section.style.borderTop = '1px solid #1e2a30';
  section.style.marginTop = '10px';
  section.style.paddingTop = '8px';
  const title = document.createElement('h3');
  title.textContent = 'Voxel Operations (Selection)'; title.style.margin = '6px 0';
  // Row 1: Add Tunnel button
  const row1 = document.createElement('div'); row1.className = 'row';
  const btnTunnel = document.createElement('button'); btnTunnel.className = 'btn'; btnTunnel.id = 'voxelAddTunnel'; btnTunnel.textContent = 'Add Tunnel Segment';
  row1.appendChild(btnTunnel);
  const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'For each space with selected voxels, adds a box-shaped tunnel outwards from the space center through the voxel selection. Discontinuous groups create multiple sprouts.';
  // Row 2: Set voxel types + Connect controls
  const row2 = document.createElement('div'); row2.className = 'row';
  const btnEmpty = document.createElement('button'); btnEmpty.className = 'btn'; btnEmpty.id = 'voxelSetEmpty'; btnEmpty.title = 'Set selected voxels = Empty'; btnEmpty.textContent = 'Empty';
  const btnRock = document.createElement('button'); btnRock.className = 'btn'; btnRock.id = 'voxelSetRock'; btnRock.title = 'Set selected voxels = Rock'; btnRock.textContent = 'Rock';
  const btnWall = document.createElement('button'); btnWall.className = 'btn'; btnWall.id = 'voxelSetWall'; btnWall.title = 'Set selected voxels = Wall'; btnWall.textContent = 'Wall';
  const btnConnect = document.createElement('button'); btnConnect.className = 'btn'; btnConnect.id = 'voxelConnectSpaces'; btnConnect.textContent = 'Connect Spaces'; btnConnect.title = 'Propose a polyline path (≤30° slope) between two spaces, then edit and finalize.';
  const btnFinalize = document.createElement('button'); btnFinalize.className = 'btn'; btnFinalize.id = 'voxelConnectFinalize'; btnFinalize.textContent = 'Finalize Path'; btnFinalize.title = 'Commit current proposed path to tunnels'; btnFinalize.style.display = 'none';
  row2.appendChild(btnEmpty); row2.appendChild(btnRock); row2.appendChild(btnWall); row2.appendChild(btnConnect); row2.appendChild(btnFinalize);
  // Row 3: Min tunnel width
  const row3 = document.createElement('div'); row3.className = 'row';
  const minLabel = document.createElement('label'); minLabel.textContent = 'Min Tunnel Width (vox)'; minLabel.style.display = 'flex'; minLabel.style.alignItems = 'center'; minLabel.style.gap = '6px';
  const minInput = document.createElement('input'); minInput.id = 'minTunnelWidth'; minInput.type = 'number'; minInput.min = '1'; minInput.step = '1'; minInput.style.width = '72px';
  minInput.value = String(Math.max(1, Number(localStorage.getItem('dw:ops:minTunnelWidth') || '6')||6));
  minLabel.appendChild(minInput); row3.appendChild(minLabel);
  // Assemble
  section.appendChild(title); section.appendChild(row1); section.appendChild(row2); section.appendChild(row3); section.appendChild(hint);
  editPane.appendChild(section);
  // Collect existing Edit tab controls present in DOM (built in index.html)
  const dom = {
    editPane,
    // Top controls
    toggleRunBtn: document.getElementById('toggleRun'),
    modeRadios: Array.from(document.querySelectorAll('input[name="mode"]')),
    // View toggles
    showNamesCb: document.getElementById('showNames'),
    gridGroundCb: document.getElementById('gridGround'),
    gridXYCb: document.getElementById('gridXY'),
    gridYZCb: document.getElementById('gridYZ'),
    axisArrowsCb: document.getElementById('axisArrows'),
    targetDotCb: document.getElementById('viewTargetDot'),
    resizeGridBtn: document.getElementById('resizeGrid'),
    // Size + type + name
    spaceTypeEl: document.getElementById('spaceType'),
    spaceNameEl: document.getElementById('spaceName'),
    newSpaceBtn: document.getElementById('newSpace'),
    fitViewBtn: document.getElementById('fitView'),
    sizeXEl: document.getElementById('sizeX'),
    sizeYEl: document.getElementById('sizeY'),
    sizeZEl: document.getElementById('sizeZ'),
    sizeLockEl: document.getElementById('sizeLock'),
    // Transform step + nudge buttons
    tStepEl: document.getElementById('tStep'),
    txMinus: document.getElementById('txMinus'),
    txPlus: document.getElementById('txPlus'),
    tyMinus: document.getElementById('tyMinus'),
    tyPlus: document.getElementById('tyPlus'),
    tzMinus: document.getElementById('tzMinus'),
    tzPlus: document.getElementById('tzPlus'),
    // Voxel ops (created above)
    btnTunnel, btnEmpty, btnRock, btnWall, btnConnect, btnFinalize, minInput,
 };
  Log?.log('UI', 'EditTab: built', {});
  return dom;

}
