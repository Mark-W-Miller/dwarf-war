// Scryball helpers and keyboard-driven navigation in cavern mode.
import { VoxelType, decompressVox } from '../../voxels/voxelize.mjs';
import { worldAabbFromSpace } from '../../barrow/schema.mjs';

export function initScryApi({ scene, engine, camera, state, Log }) {
  const controller = createScryController({ scene, engine, camera, state, Log });

  return {
    disposeScryBall: controller.disposeBall,
    voxelValueAtWorld: controller.sampleVoxelValue,
    findScryWorldPosForSpace: controller.findPreferredBallPosition,
    ensureScryBallAt: controller.ensureBall,
    enterScryMode: controller.enter,
    exitScryMode: controller.exit,
  };
}

// Ensure the global scry state bag exists and has expected structure.
function ensureScryState(appState) {
  if (!appState._scry) {
    appState._scry = {};
  }
  const scryState = appState._scry;
  scryState.ball = scryState.ball || null;
  scryState.spaceId = scryState.spaceId || null;
  scryState.prev = scryState.prev || null;
  scryState.isActive = Boolean(scryState.isActive);
  scryState.scryMode = Boolean(scryState.scryMode);
  scryState.lastPersistMs = scryState.lastPersistMs || 0;
  scryState.capturedKeyboard = scryState.capturedKeyboard || null;
  scryState.loopToken = scryState.loopToken || null;
  scryState.lastPosition = scryState.lastPosition || null;
  scryState.spaceName = scryState.spaceName || null;
  scryState.spaceActive = Boolean(scryState.spaceActive);
  if (!scryState.spaceData) {
    scryState.spaceData = { map: new Map(), items: [] };
  }
  scryState._lastSpaceBroadcast = scryState._lastSpaceBroadcast || null;
  return scryState;
}

function sampleVoxelSignature(vox) {
  if (!vox || !Array.isArray(vox.data)) return 'novox';
  const data = vox.data;
  if (!data.length) return 'len:0';
  const sampleCount = Math.min(16, data.length);
  const step = Math.max(1, Math.floor(data.length / sampleCount));
  const samples = [];
  for (let i = 0; i < data.length && samples.length < sampleCount; i += step) {
    samples.push(data[i]);
  }
  samples.push(data[data.length - 1]);
  return `${vox.res || 0}:${vox.size?.x || 0}:${vox.size?.y || 0}:${vox.size?.z || 0}:${vox.worldAligned ? 1 : 0}:${samples.join(',')}`;
}

function computeSpaceHash(space) {
  const origin = space?.origin || {};
  const rotation = space?.rotation || {};
  const ry = typeof rotation.y === 'number' ? rotation.y : (typeof space?.rotY === 'number' ? space.rotY : 0);
  const voxSignature = sampleVoxelSignature(space?.vox || null);
  return [
    space?.id || 'space',
    origin.x ?? 0,
    origin.y ?? 0,
    origin.z ?? 0,
    rotation.x ?? 0,
    ry,
    rotation.z ?? 0,
    space?.res ?? 0,
    space?.size?.x ?? 0,
    space?.size?.y ?? 0,
    space?.size?.z ?? 0,
    voxSignature
  ].join('|');
}

function ensureSpaceData(state) {
  const scryState = ensureScryState(state);
  if (!scryState.spaceData) {
    scryState.spaceData = { map: new Map(), items: [] };
  }
  const cache = scryState.spaceData;
  const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
  const defaultResolution = getDefaultVoxelResolution(state);
  const map = new Map();
  const items = [];
  for (const space of spaces) {
    if (!space) continue;
    const hash = computeSpaceHash(space);
    let entry = cache.map.get(space.id);
    if (entry && entry.hash === hash) {
      items.push(entry);
      map.set(space.id, entry);
      continue;
    }
    const sampler = createVoxelSampler(space, defaultResolution);
    const bounds = worldAabbFromSpace(space, space.res || defaultResolution);
    const resolution = sampler?.resolution || space?.res || defaultResolution;
    entry = { space, sampler, bounds, resolution, hash };
    items.push(entry);
    map.set(space.id, entry);
  }
  cache.items = items;
  cache.map = map;
  return items;
}

function pointInBounds(position, bounds, padding = 0) {
  if (!bounds) return false;
  return (
    position.x >= bounds.min.x - padding &&
    position.x <= bounds.max.x + padding &&
    position.y >= bounds.min.y - padding &&
    position.y <= bounds.max.y + padding &&
    position.z >= bounds.min.z - padding &&
    position.z <= bounds.max.z + padding
  );
}

function findSpaceContainingPosition(spaceData, position) {
  if (!position) return null;
  for (const entry of spaceData) {
    if (!entry) continue;
    const { bounds, sampler } = entry;
    if (bounds && !pointInBounds(position, bounds, 0)) continue;
    if (sampler) {
      const sample = sampler.valueAt(position.x, position.y, position.z);
      if (sample !== VoxelType.Uninstantiated) return entry;
    } else if (bounds && pointInBounds(position, bounds, 0)) {
      return entry;
    }
  }
  return null;
}

function setActiveSpace(scryState, spaceInfo) {
  const space = spaceInfo?.space || null;
  const spaceId = space?.id || null;
  const spaceName = space?.name || spaceId || null;
  const active = !!spaceInfo;
  const last = scryState._lastSpaceBroadcast || {};
  if (last.id === spaceId && last.name === spaceName && last.active === active) return;
  scryState.spaceId = spaceId;
  scryState.spaceName = spaceName;
  scryState.spaceActive = active;
  scryState._lastSpaceBroadcast = { id: spaceId, name: spaceName, active };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('dw:scry:space', { detail: { spaceId, name: spaceName, active } }));
  }
}

// Create controller responsible for scryball lifecycle and keyboard navigation.
function createScryController({ scene, engine, camera, state, Log }) {
  const scryState = ensureScryState(state);
  const keyState = { up: false, down: false, left: false, right: false, fast: false, vertical: false };
  scryState.keyState = keyState;
  const keyTracker = createKeyTracker({ keyState, Log });

  // Dispose the current scryball mesh if it exists.
  function disposeBall() {
    const currentState = ensureScryState(state);
    currentState.ball?.dispose?.();
    currentState.ball = null;
    setActiveSpace(currentState, null);
  }

  // Sample voxel value at the provided world position.
  function sampleVoxelValue(space, x, y, z) {
    const sampler = createVoxelSampler(space, getDefaultVoxelResolution(state));
    return sampler ? sampler.valueAt(x, y, z) : VoxelType.Uninstantiated;
  }

  // Compute a good world-space placement for the scryball.
  function findPreferredBallPosition(space) {
    const sampler = createVoxelSampler(space, getDefaultVoxelResolution(state));
    if (!sampler) {
      const origin = space?.origin || { x: 0, y: 0, z: 0 };
      return new BABYLON.Vector3(origin.x, origin.y, origin.z);
    }
    const resolution = sampler.resolution;
    const halfX = sampler.sizeX * resolution * 0.5;
    const halfY = sampler.sizeY * resolution * 0.5;
    const halfZ = sampler.sizeZ * resolution * 0.5;
    let bestCandidate = null;
    for (let z = 0; z < sampler.sizeZ; z++) {
      for (let y = 0; y < sampler.sizeY; y++) {
        for (let x = 0; x < sampler.sizeX; x++) {
          const value = sampler.valueAtIndex(x, y, z);
          if (value == null) continue;
          const localX = (x + 0.5) * resolution - halfX;
          const localY = (y + 0.5) * resolution - halfY;
          const localZ = (z + 0.5) * resolution - halfZ;
          const distanceSquared = localX * localX + localY * localY + localZ * localZ;
          if (!bestCandidate || distanceSquared < bestCandidate.d2) {
            bestCandidate = { localX, localY, localZ, d2: distanceSquared };
            if (value === VoxelType.Empty) {
              bestCandidate.isEmpty = true;
            }
          }
        }
      }
    }
    if (!bestCandidate) {
      const origin = space.origin || { x: 0, y: 0, z: 0 };
      return new BABYLON.Vector3(origin.x, origin.y, origin.z);
    }
    const worldPosition = BABYLON.Vector3.TransformCoordinates(
      new BABYLON.Vector3(bestCandidate.localX, bestCandidate.localY, bestCandidate.localZ),
      sampler.worldTransform
    );
    return worldPosition;
  }

  // Create or reuse the scryball mesh at the desired world position.
  function ensureBall(position, diameter) {
    const currentState = ensureScryState(state);
    const resolvedDiameter = Math.max(0.6, diameter || 1);
    if (currentState.ball && !currentState.ball.isDisposed()) {
      currentState.ball.position.copyFrom(position);
      if (currentState.ball.position.clone) {
        currentState.lastPosition = currentState.ball.position.clone();
      } else if (typeof BABYLON !== 'undefined' && BABYLON.Vector3) {
        currentState.lastPosition = new BABYLON.Vector3(currentState.ball.position.x, currentState.ball.position.y, currentState.ball.position.z);
      } else {
        currentState.lastPosition = { x: currentState.ball.position.x, y: currentState.ball.position.y, z: currentState.ball.position.z };
      }
      const spaceData = ensureSpaceData(state);
      const spaceInfo = findSpaceContainingPosition(spaceData, currentState.ball.position);
      setActiveSpace(currentState, spaceInfo);
      return currentState.ball;
    }
    const ballMesh = BABYLON.MeshBuilder.CreateSphere('scryBall', { diameter: resolvedDiameter, segments: 16 }, scene);
    const material = new BABYLON.StandardMaterial('scryBall:mat', scene);
    material.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.9);
    material.emissiveColor = new BABYLON.Color3(0.15, 0.55, 1.0);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.alpha = 0.6;
    material.backFaceCulling = false;
    material.zOffset = 4;
    ballMesh.material = material;
    ballMesh.isPickable = true;
    ballMesh.renderingGroupId = 2;
    ballMesh.position.copyFrom(position);
    currentState.ball = ballMesh;
    currentState.lastPosition = ballMesh.position.clone ? ballMesh.position.clone() : new BABYLON.Vector3(ballMesh.position.x, ballMesh.position.y, ballMesh.position.z);
    const spaceData = ensureSpaceData(state);
    const spaceInfo = findSpaceContainingPosition(spaceData, ballMesh.position);
    setActiveSpace(currentState, spaceInfo);
    return ballMesh;
  }

  // Activate scry controls and keyboard tracking.
  function enter() {
    const currentState = ensureScryState(state);
    if (currentState.isActive) return;
    if (state?._scry?.spaceId) currentState.spaceId = state._scry.spaceId;
    currentState.isActive = true;
    currentState.scryMode = true;
    keyTracker.reset();
    keyTracker.attach();
    captureCameraKeyboard(camera, currentState, Log);
    startUpdateLoop();
    Log?.log('SCRY', 'mode:enter', { spaceId: currentState.spaceId });
    const spaceData = ensureSpaceData(state);
    const initialInfo = currentState.ball ? findSpaceContainingPosition(spaceData, currentState.ball.position) : null;
    setActiveSpace(currentState, initialInfo);
    if (initialInfo?.space?.id && state?.history) state.history.lastCavernId = initialInfo.space.id;
    if (state.hl && currentState.ball) {
      const highlightColor = new BABYLON.Color3(0.4, 0.85, 1.0);
      state.hl.addMesh(currentState.ball, highlightColor);
      currentState.ball.renderOutline = true;
      currentState.ball.outlineColor = highlightColor;
      currentState.ball.outlineWidth = 0.02;
    }
  }

  // Deactivate scry mode and restore camera input.
  function exit() {
    const currentState = ensureScryState(state);
    if (!currentState.isActive) return;
    stopUpdateLoop();
    keyTracker.detach();
    keyTracker.reset();
    releaseCameraKeyboard(camera, currentState, Log);
    if (state.hl && currentState.ball) {
      state.hl.removeMesh(currentState.ball);
      currentState.ball.renderOutline = false;
    }
    setActiveSpace(currentState, null);
    currentState.isActive = false;
    currentState.scryMode = false;
    Log?.log('SCRY', 'mode:exit', {});
  }

  // Begin per-frame updates while scry is active.
  function startUpdateLoop() {
    const currentState = ensureScryState(state);
    if (currentState.loopToken) return;
    currentState.loopToken = scene.onBeforeRenderObservable.add(updateScryMovement);
  }

  // Stop per-frame updates when scry ends.
  function stopUpdateLoop() {
    const currentState = ensureScryState(state);
    if (!currentState.loopToken) return;
    scene.onBeforeRenderObservable.remove(currentState.loopToken);
    currentState.loopToken = null;
  }

  // Move the scryball each frame based on accumulated key state.
  function updateScryMovement() {
    const currentState = ensureScryState(state);
    if (!currentState.isActive) return;
    const scryBall = currentState.ball;
    if (!scryBall) return;
    const spaceData = ensureSpaceData(state);
    const currentInfo = findSpaceContainingPosition(spaceData, scryBall.position);
    setActiveSpace(currentState, currentInfo);
    if (currentInfo?.space?.id && state?.history) state.history.lastCavernId = currentInfo.space.id;
    const deltaSeconds = Math.min(Math.max(engine?.getDeltaTime?.() || 16.6, 1) / 1000, 0.25);

    applyYaw(camera, keyState, deltaSeconds);
    const updatedInfo = moveBall(scryBall, spaceData, currentInfo, currentState, keyState, camera, deltaSeconds, Log, state);
    setActiveSpace(currentState, updatedInfo);
    if (updatedInfo?.space?.id && state?.history) state.history.lastCavernId = updatedInfo.space.id;
  }

  return {
    disposeBall,
    sampleVoxelValue,
    findPreferredBallPosition,
    ensureBall,
    enter,
    exit,
  };
}

// Create a key tracker that captures arrow/meta/shift state for scry movement.
function createKeyTracker({ keyState, Log }) {
  const handlerOptions = { passive: false, capture: true };

  function handleKeyDown(event) {
    if (!matchesScryKey(event.key)) return;
    const detail = buildArrowLogDetail(event);
    if (isEditableEventTarget(event)) {
      Log?.log('ARROWS', 'skip:editable', detail);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateModifierFlags(event, keyState);
    applyArrowKeyState(event.key, true, keyState);
    Log?.log('ARROWS', 'keydown', detail);
    Log?.log('SCRY', 'keyDown', { key: event.key, shift: !!event.shiftKey, meta: !!(event.metaKey || event.ctrlKey) });
  }

  function handleKeyUp(event) {
    if (!matchesScryKey(event.key)) return;
    const detail = buildArrowLogDetail(event);
    if (isEditableEventTarget(event)) {
      Log?.log('ARROWS', 'skip:editable', detail);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateModifierFlags(event, keyState);
    applyArrowKeyState(event.key, false, keyState);
    if (event.key === 'Meta' || event.key === 'Control') {
      keyState.vertical = false;
      keyState.up = false;
      keyState.down = false;
    }
    Log?.log('ARROWS', 'keyup', detail);
    Log?.log('SCRY', 'keyUp', { key: event.key, shift: !!event.shiftKey, meta: !!(event.metaKey || event.ctrlKey) });
  }

  function attach() {
    window.addEventListener('keydown', handleKeyDown, handlerOptions);
    window.addEventListener('keyup', handleKeyUp, handlerOptions);
  }

  function detach() {
    window.removeEventListener('keydown', handleKeyDown, handlerOptions);
    window.removeEventListener('keyup', handleKeyUp, handlerOptions);
  }

  function reset() {
    keyState.up = false;
    keyState.down = false;
    keyState.left = false;
    keyState.right = false;
    keyState.fast = false;
    keyState.vertical = false;
  }

  return { attach, detach, reset };
}

// Determine whether the key participates in scry controls.
function matchesScryKey(key) {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Up':
    case 'Down':
    case 'Left':
    case 'Right':
    case 'Shift':
    case 'Meta':
    case 'Control':
      return true;
    default:
      return false;
  }
}

function buildArrowLogDetail(event) {
  return {
    key: event?.key,
    shift: !!event?.shiftKey,
    ctrl: !!event?.ctrlKey,
    meta: !!event?.metaKey,
    alt: !!event?.altKey,
    target: describeEventTarget(event?.target || event?.srcElement || null),
    editable: isEditableEventTarget(event),
  };
}

function describeEventTarget(target) {
  if (!target) return 'null';
  if (typeof window !== 'undefined' && target === window) return 'window';
  if (typeof document !== 'undefined') {
    if (target === document) return 'document';
    if (target === document.body) return 'body';
  }
  const id = target.id ? `#${target.id}` : '';
  const cls = target.className ? `.${String(target.className).split(/\s+/).filter(Boolean).join('.')}` : '';
  const tag = target.tagName ? String(target.tagName).toLowerCase() : target.nodeName ? String(target.nodeName).toLowerCase() : 'node';
  return `${tag}${id}${cls}`;
}

function isEditableEventTarget(event) {
  const target = event?.target || event?.srcElement || null;
  if (!target) return false;
  if (typeof window !== 'undefined' && (target === window)) return false;
  if (typeof document !== 'undefined' && (target === document || target === document.body)) return false;
  if (target.isContentEditable) return true;
  const tagName = (target.tagName || '').toString().toLowerCase();
  if (!tagName) return false;
  if (tagName === 'input') return true;
  if (tagName === 'textarea') return true;
  if (tagName === 'select') return true;
  return false;
}

// Update modifier flags (shift/meta) used for speed and vertical movement.
function updateModifierFlags(event, keyState) {
  keyState.fast = !!event.shiftKey;
  keyState.vertical = !!(event.metaKey || event.ctrlKey || event.key === 'Meta' || event.key === 'Control');
}

// Apply arrow key state changes via a switch for clarity.
function applyArrowKeyState(key, isPressed, keyState) {
  switch (key) {
    case 'ArrowUp':
    case 'Up':
      keyState.up = isPressed;
      break;
    case 'ArrowDown':
    case 'Down':
      keyState.down = isPressed;
      break;
    case 'ArrowLeft':
    case 'Left':
      keyState.left = isPressed;
      break;
    case 'ArrowRight':
    case 'Right':
      keyState.right = isPressed;
      break;
    default:
      break;
  }
}

// Capture the camera's keyboard input so arrows can be repurposed.
function captureCameraKeyboard(camera, scryState, Log) {
  const keyboardInput = camera.inputs?.attached?.keyboard || null;
  if (!keyboardInput) return;
  scryState.capturedKeyboard = {
    input: keyboardInput,
    keysUp: keyboardInput.keysUp?.slice() || [],
    keysDown: keyboardInput.keysDown?.slice() || [],
    keysLeft: keyboardInput.keysLeft?.slice() || [],
    keysRight: keyboardInput.keysRight?.slice() || [],
  };
  keyboardInput.keysUp = [];
  keyboardInput.keysDown = [];
  keyboardInput.keysLeft = [];
  keyboardInput.keysRight = [];
  Log?.log('SCRY', 'cameraKeyboard:capture', {});
}

// Restore the camera's keyboard input after leaving scry mode.
function releaseCameraKeyboard(camera, scryState, Log) {
  const captured = scryState.capturedKeyboard;
  if (!captured) return;
  const { input, keysUp, keysDown, keysLeft, keysRight } = captured;
  input.keysUp = keysUp;
  input.keysDown = keysDown;
  input.keysLeft = keysLeft;
  input.keysRight = keysRight;
  input.attachControl?.(true);
  scryState.capturedKeyboard = null;
  Log?.log('SCRY', 'cameraKeyboard:release', {});
}

// Apply camera yaw when left/right arrows are held.
function applyYaw(camera, keyState, deltaSeconds) {
  if (!keyState.left && !keyState.right) return;
  const degreesPerSecond = keyState.fast ? 80 : 40;
  const direction = keyState.left ? 1 : -1;
  const deltaAlpha = (degreesPerSecond * Math.PI / 180) * direction * deltaSeconds;
  camera.alpha = (camera.alpha + deltaAlpha) % (Math.PI * 2);
  if (camera.alpha < 0) camera.alpha += Math.PI * 2;
}

// Move the scry ball according to the current key state.
function moveBall(ballMesh, spaceData, activeSpaceInfo, scryState, keyState, camera, deltaSeconds, Log, state) {
  const forwardSign = (keyState.up ? 1 : 0) - (keyState.down ? 1 : 0);
  if (forwardSign === 0) return activeSpaceInfo;
  const isVerticalMove = keyState.vertical;
  const baseResolution = activeSpaceInfo?.resolution || getDefaultVoxelResolution(state);
  const speedMultiplier = readScrySpeedMultiplier();
  const speedFactor = keyState.fast ? 20 : 10;
  const travelDistance = baseResolution * 0.9 * speedMultiplier * speedFactor * deltaSeconds * Math.abs(forwardSign);
  if (travelDistance <= 0) return activeSpaceInfo;
  const movementDirection = computeMovementDirection(camera, forwardSign, isVerticalMove);
  const directionLengthSquared = typeof movementDirection.lengthSquared === 'function'
    ? movementDirection.lengthSquared()
    : (movementDirection.x ** 2 + movementDirection.y ** 2 + movementDirection.z ** 2);
  if (directionLengthSquared === 0) return activeSpaceInfo;
  const movementStep = travelDistanceDirection(movementDirection, travelDistance, isVerticalMove);
  const collisionRadius = Math.max(0.15, (baseResolution * 0.8) / 2);
  const stepCount = Math.max(1, Math.ceil(travelDistance / (collisionRadius * 0.6)));
  const incrementalStep = movementStep.scale(1 / stepCount);
  const workingPosition = ballMesh.position.clone();

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const candidate = workingPosition.add(incrementalStep);
    if (canOccupyPosition(candidate, spaceData, collisionRadius)) {
      workingPosition.copyFrom(candidate);
    } else {
      Log?.log('SCRY', 'move:block', {
        target: { x: candidate.x, y: candidate.y, z: candidate.z },
        vertical: isVerticalMove,
      });
      break;
    }
  }

  if (!workingPosition.equals(ballMesh.position)) {
    ballMesh.position.copyFrom(workingPosition);
    camera.target.copyFrom(workingPosition);
    maybePersistBallPosition(scryState, workingPosition);
    Log?.log('SCRY', 'move:step', {
      position: { x: workingPosition.x, y: workingPosition.y, z: workingPosition.z },
      vertical: isVerticalMove,
    });
  }

  const updatedInfo = findSpaceContainingPosition(spaceData, workingPosition);
  return updatedInfo || activeSpaceInfo || null;
}


// Compute the movement direction vector for the arrow input.
function computeMovementDirection(camera, forwardSign, isVerticalMove) {
  if (isVerticalMove) {
    return new BABYLON.Vector3(0, forwardSign, 0);
  }
  const forward = camera.getForwardRay?.()?.direction?.clone?.() || new BABYLON.Vector3(0, 0, 1);
  forward.y = 0;
  if (forward.lengthSquared() < 1e-6) {
    forward.set(Math.sin(camera.alpha), 0, Math.cos(camera.alpha));
  }
  forward.normalize();
  forward.scaleInPlace(forwardSign);
  return forward;
}

// Scale direction vector to the desired travel distance.
function travelDistanceDirection(direction, travelDistance, isVerticalMove) {
  if (isVerticalMove) {
    return direction.scale(travelDistance);
  }
  const normalized = direction.clone();
  normalized.normalize();
  normalized.scaleInPlace(travelDistance);
  return normalized;
}

// Check whether the scry ball can occupy a given position.
function canOccupyPosition(position, spaceData, collisionRadius) {
  const offsets = [
    { x: 0, z: 0 },
    { x: collisionRadius * 0.5, z: 0 },
    { x: -collisionRadius * 0.5, z: 0 },
    { x: 0, z: collisionRadius * 0.5 },
    { x: 0, z: -collisionRadius * 0.5 },
  ];
  for (const entry of spaceData) {
    if (!entry?.sampler) continue;
    const bounds = entry.bounds;
    if (bounds && !pointInBounds(position, bounds, collisionRadius)) continue;
    for (const offset of offsets) {
      const sampleValue = entry.sampler.valueAt(position.x + offset.x, position.y, position.z + offset.z);
      if (sampleValue === VoxelType.Rock || sampleValue === VoxelType.Wall) return false;
    }
  }
  return true;
}


// Persist the latest ball position with throttling.
function maybePersistBallPosition(scryState, position) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - scryState.lastPersistMs < 120) return;
  scryState.lastPersistMs = now;
  if (!position) return;
  if (position.clone) {
    scryState.lastPosition = position.clone();
  } else if (typeof BABYLON !== 'undefined' && BABYLON.Vector3) {
    scryState.lastPosition = new BABYLON.Vector3(position.x, position.y, position.z);
  } else {
    scryState.lastPosition = { x: position.x, y: position.y, z: position.z };
  }
}


// Retrieve the active space based on the stored space identifier.
function getActiveSpace(state, spaceId) {
  if (!spaceId) return null;
  const spaces = Array.isArray(state?.barrow?.spaces) ? state.barrow.spaces : [];
  return spaces.find((candidate) => candidate && candidate.id === spaceId) || null;
}

// Read the user-configured scry speed multiplier.
function readScrySpeedMultiplier() {
  const raw = Number(localStorage.getItem('dw:ui:scrySpeed') || '100');
  if (!isFinite(raw) || raw <= 0) return 1;
  return raw > 5 ? raw / 100 : raw;
}

// Build a voxel sampler for a space, returning null when voxels are unavailable.
function createVoxelSampler(space, fallbackResolution) {
  if (!space || !space.vox || !space.vox.size) return null;
  const vox = decompressVox(space.vox);
  const sizeX = Math.max(1, vox.size?.x || 1);
  const sizeY = Math.max(1, vox.size?.y || 1);
  const sizeZ = Math.max(1, vox.size?.z || 1);
  const resolution = vox.res || space.res || fallbackResolution || 1;
  const origin = space.origin || { x: 0, y: 0, z: 0 };
  const worldAligned = !!(space.vox && space.vox.worldAligned);
  const rotation = worldAligned ? BABYLON.Quaternion.Identity() : BABYLON.Quaternion.FromEulerAngles(
    Number(space.rotation?.x || 0),
    (typeof space.rotation?.y === 'number') ? Number(space.rotation.y) : Number(space.rotY || 0) || 0,
    Number(space.rotation?.z || 0)
  );
  const inverseMatrix = BABYLON.Matrix.Compose(new BABYLON.Vector3(1, 1, 1), BABYLON.Quaternion.Inverse(rotation), BABYLON.Vector3.Zero());
  const worldTransform = BABYLON.Matrix.Compose(new BABYLON.Vector3(1, 1, 1), rotation, new BABYLON.Vector3(origin.x, origin.y, origin.z));
  const minX = -(sizeX * resolution) / 2;
  const minY = -(sizeY * resolution) / 2;
  const minZ = -(sizeZ * resolution) / 2;
  const values = Array.isArray(vox.data) ? vox.data : [];

  function valueAt(worldX, worldY, worldZ) {
    const local = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(worldX - origin.x, worldY - origin.y, worldZ - origin.z), inverseMatrix);
    const indexX = Math.floor((local.x - minX) / resolution);
    const indexY = Math.floor((local.y - minY) / resolution);
    const indexZ = Math.floor((local.z - minZ) / resolution);
    if (indexX < 0 || indexY < 0 || indexZ < 0 || indexX >= sizeX || indexY >= sizeY || indexZ >= sizeZ) return VoxelType.Uninstantiated;
    const flatIndex = indexX + sizeX * (indexY + sizeY * indexZ);
    return values[flatIndex] ?? VoxelType.Uninstantiated;
  }

  function valueAtIndex(indexX, indexY, indexZ) {
    const flatIndex = indexX + sizeX * (indexY + sizeY * indexZ);
    return values[flatIndex];
  }

  return {
    resolution,
    sizeX,
    sizeY,
    sizeZ,
    valueAt,
    valueAtIndex,
    worldTransform,
  };
}

// Derive a fallback voxel resolution from global barrow metadata.
function getDefaultVoxelResolution(state) {
  return Number(state?.barrow?.meta?.voxelSize || 1) || 1;
}
