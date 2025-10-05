// Scryball helpers and keyboard-driven navigation in cavern mode.
import { VoxelType, decompressVox } from '../../voxels/voxelize.mjs';

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
  return scryState;
}

// Create controller responsible for scryball lifecycle and keyboard navigation.
function createScryController({ scene, engine, camera, state, Log }) {
  const scryState = ensureScryState(state);
  const keyState = { up: false, down: false, left: false, right: false, fast: false, vertical: false };
  scryState.keyState = keyState;
  const keyTracker = createKeyTracker({ keyState, Log });

  // Dispose the current scryball mesh if it exists.
  function disposeBall() {
    scryState.ball?.dispose?.();
    scryState.ball = null;
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
    const space = getActiveSpace(state, currentState.spaceId);
    if (!space) return;
    const sampler = createVoxelSampler(space, getDefaultVoxelResolution(state));
    const deltaSeconds = Math.min(Math.max(engine?.getDeltaTime?.() || 16.6, 1) / 1000, 0.25);

    applyYaw(camera, keyState, deltaSeconds);
    moveBall(scryBall, space, sampler, currentState, keyState, camera, deltaSeconds, Log);
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
    event.preventDefault();
    event.stopPropagation();
    updateModifierFlags(event, keyState);
    applyArrowKeyState(event.key, true, keyState);
    Log?.log('SCRY', 'keyDown', { key: event.key, shift: !!event.shiftKey, meta: !!(event.metaKey || event.ctrlKey) });
  }

  function handleKeyUp(event) {
    if (!matchesScryKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    updateModifierFlags(event, keyState);
    applyArrowKeyState(event.key, false, keyState);
    if (event.key === 'Meta' || event.key === 'Control') {
      keyState.vertical = false;
      keyState.up = false;
      keyState.down = false;
    }
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
  const degreesPerSecond = keyState.fast ? 160 : 80;
  const direction = keyState.left ? -1 : 1;
  const deltaAlpha = (degreesPerSecond * Math.PI / 180) * direction * deltaSeconds;
  camera.alpha = (camera.alpha + deltaAlpha) % (Math.PI * 2);
  if (camera.alpha < 0) camera.alpha += Math.PI * 2;
}

// Move the scry ball according to the current key state.
function moveBall(ballMesh, space, sampler, scryState, keyState, camera, deltaSeconds, Log) {
  if (!sampler) return;
  const forwardSign = (keyState.up ? 1 : 0) - (keyState.down ? 1 : 0);
  if (forwardSign === 0) return;
  const isVerticalMove = keyState.vertical;
  const baseResolution = sampler.resolution || 1;
  const speedMultiplier = readScrySpeedMultiplier();
  const fastFactor = keyState.fast ? 2 : 1;
  const travelDistance = baseResolution * 0.9 * speedMultiplier * fastFactor * deltaSeconds * Math.abs(forwardSign);
  if (travelDistance <= 0) return;
  const movementDirection = computeMovementDirection(camera, forwardSign, isVerticalMove);
  if (movementDirection.lengthSquared() === 0) return;
  const movementStep = travelDistanceDirection(movementDirection, travelDistance, isVerticalMove);
  const collisionRadius = Math.max(0.15, (baseResolution * 0.8) / 2);
  const stepCount = Math.max(1, Math.ceil(travelDistance / (collisionRadius * 0.6)));
  const incrementalStep = movementStep.scale(1 / stepCount);
  const workingPosition = ballMesh.position.clone();

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const candidate = workingPosition.add(incrementalStep);
    if (canOccupyPosition(candidate, sampler, collisionRadius)) {
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
    maybePersistBallPosition(scryState, workingPosition, space);
    Log?.log('SCRY', 'move:step', {
      position: { x: workingPosition.x, y: workingPosition.y, z: workingPosition.z },
      vertical: isVerticalMove,
    });
  }
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
function canOccupyPosition(position, sampler, collisionRadius) {
  const offsets = [
    { x: 0, z: 0 },
    { x: collisionRadius * 0.5, z: 0 },
    { x: -collisionRadius * 0.5, z: 0 },
    { x: 0, z: collisionRadius * 0.5 },
    { x: 0, z: -collisionRadius * 0.5 },
  ];
  for (const offset of offsets) {
    const sampleValue = sampler.valueAt(position.x + offset.x, position.y, position.z + offset.z);
    if (sampleValue === VoxelType.Rock || sampleValue === VoxelType.Wall) return false;
  }
  return true;
}

// Persist the latest ball position with throttling.
function maybePersistBallPosition(scryState, position, space) {
  if (!space || !space.id) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - scryState.lastPersistMs < 120) return;
  scryState.lastPersistMs = now;
  const storageKey = 'dw:scry:pos:' + space.id;
  localStorage.setItem(storageKey, JSON.stringify({ x: position.x, y: position.y, z: position.z }));
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
