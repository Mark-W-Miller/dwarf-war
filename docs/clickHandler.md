# Click Handling for 3D View

This document defines the pointer interaction model for the 3D view. UI component clicks (buttons, inputs, panels) are out of scope.

## Abbreviations

- WR: War Room
- CM: Cavern Mode
- SB: Scryball
- LC: Left Click
- RC: Right Click
- PP: Proposed Path (nodes/segments)

## Global Principles

- Mode‑first dispatch: Mode determines the handler set and behavior.
- Priority stack per mode: Only the first match handles a click; subsequent layers do nothing.
- Exactly one gizmo visible at a time; parts depend on selection context.
- Left‑drag never rotates the view (reserved for selection, voxels, gizmos). RC rotates; Cmd+RC pans.

## War Room (WR)

### Hit‑Test Priority

1) Gizmo parts (if allowed) → Gizmo Handler  
2) PP nodes → PP Node Selector  
3) Voxels → Voxel Selector  
4) Empty space → Base handler

Stop at the first match and consume the event.

### LC / Shift‑LC

- With Cmd (cmd‑LC / cmd‑shift‑LC):
  - Ignore gizmo and PP.
  - Select a space (cmd‑LC) or toggle spaces (cmd‑shift‑LC).
  - Update gizmo per visibility matrix; done.

- Without Cmd:
  - If gizmo hit → gizmo.transform(); done.
  - Else if PP node hit → select node (Shift adds), attach gizmo; done.
  - Else if voxel hit → select voxel (Shift adds), remove gizmo, start brush; done.
  - Else (empty) → clear selection; done.

### RC

- No modifiers → rotate around selection.
- Cmd + RC → pan.

### LC Double‑Click

- If over a space → switch WR → CM; remove gizmo.

### Gizmo Visibility Matrix

- Non‑voxeled spaces → rotate rings, ground plane disc (blue), Y (green) arrow
- Voxeled spaces → XYZ arrows, blue disc
- PP node(s) → blue disc and Y (green) arrow

### Continuous Interactions

- Voxel brush (LC held): throttled voxel picks; ignore misses; stop on release.
- Gizmo drag: claim pointer, detach camera, apply transform; release on pointerup.

### WR Pseudocode

```ts
function onPointerDown_WR(ev) {
  const norm = normalize(ev)
  if (norm.cmd) return handleSpaceSelection(norm)
  if (hitGizmo(norm)) return gizmo.handle(norm)
  if (hitPPNode(norm)) return pp.selectNode(norm)
  if (hitVoxel(norm)) return vox.selectAndBrush(norm)
  selection.clear(); emitSelectionChange([]); rebuildHalos(); removeGizmo()
}
```

## Cavern Mode (CM)

- No gizmo for spaces or PP nodes.
- LC/shift‑LC → voxel selection (with brush while held).
- RC → rotate around selection; Cmd+RC → pan.
- LC double‑click on Scryball → switch to SB.

### CM Pseudocode

```ts
function onPointerDown_CM(ev) {
  const norm = normalize(ev)
  return vox.selectAndBrush(norm)
}
```

## Scryball (SB)

- Voxel selection only (including clicks on the Scryball).
- Same brush/RC/Cmd+RC rules as CM.

### SB Pseudocode

```ts
function onPointerDown_SB(ev) {
  const norm = normalize(ev)
  return vox.selectAndBrush(norm)
}
```

## Event Propagation & Capture

- When a handler consumes an action:
  - Stop subsequent handling and mark as handled.
  - Detach camera pointer input while gizmo/brush is active; reattach on release.
- Camera gestures:
  - RC rotates; Cmd+RC pans; left‑drag never rotates.

## Event Bus Integration

- Selection publishes on the bus:
  - Emit `dw:selectionChange` with `{ selection: string[] }` whenever the set of selected spaces changes.
  - Emit `dw:selectionChange` with an empty array (`{ selection: [] }`) on deselects as well (e.g., LC on empty space, ESC).
- Database space view subscribes:
  - Listens for `dw:selectionChange` and reflects selection in the DB tree (highlight rows, keep sections open).
  - Clicking a space name in the DB view dispatches `dw:dbRowClick` with `{ type: 'space', id, shiftKey }` to force selection in the 3D view (toggling with Shift when present).
- Other related events (for completeness):
  - `dw:dbEdit` — DB inline edits; scene persists/rebuilds; gizmos/halos refresh.
  - `dw:voxelPick` — voxel selection/picks drive halo updates and brush behavior.

## Keyboard: ESC Behavior

- ESC always clears all selections and emits `dw:selectionChange` with `[]`.
- Mode fallback chain on ESC: SB → CM → WR (return to broader context when possible).


## State & Side‑Effects

- Selection changes: emit `selectionChange`, rebuild halos, evaluate gizmo visibility.
- Voxel selection: maintain selection array; reflect updates in halos; throttle brush.
- Gizmo transforms: persist to model; snapshot history; refresh DB view; schedule scene rebuild as needed.

## Logging

- Emit structured events for key actions:
  - Selection changes (space/node/voxel)
  - Gizmo press/drag/end; PP select/split
  - View decisions (rc:map, rc:target)
  - Errors with context and stacks where possible
