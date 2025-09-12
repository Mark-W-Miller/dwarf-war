Dwarf War — Editor Scaffold and Decisions

Overview
- Plain ES modules with Babylon.js via CDN, no bundler. Open `app/index.html` in a browser to run the editor scaffold.
- Right-side panel with tabs: Edit, Database, Settings, Log, Voxel. Panel can collapse and is resizable; state persists in localStorage.
- Camera uses Babylon ArcRotate with Y‑up; zoom and pan speeds are user‑tunable and scale with distance for predictable feel.

Data Model and Units
- Barrow object: `id`, `spaces` (new model), legacy `caverns`, `carddons`, `links`, and `meta`.
- Units: world units are “yards” by default. `meta.units = 'yard'` (display only).
- Voxel size: `meta.voxelSize` is the default world‑units per voxel. Each space may override with its own `res`.
- Space shape and meaning:
  - `id`: unique string; renames in DB view auto‑deduplicate by appending `-N`.
  - `type`: one of Carddon, Cavern, Tunnel, Room, Space (freeform).
  - `size`: `{ x, y, z }` in voxels; origin is the space center.
  - `origin`: `{ x, y, z }` center in world units.
  - `res`: world‑units per voxel for this space (falls back to `meta.voxelSize`).
  - `rotation`: Euler radians `{ x, y, z }`. Stored and reapplied as a quaternion when available.

Rendering Decisions
- Spaces (new model) are primary for the editor. Legacy caverns/links still render for context.
- Geometry by type:
  - Cavern → sphere with diameter = min(width, height, depth).
  - Others → translucent box sized to `size * res`.
- Labels: billboard planes parented to meshes show `id (type)` and dimensions; their visibility and scale are user‑controlled.
- Intersections: computed between built space meshes. Exact CSG intersection is optional (toggle) with AABB box fallback for performance.
- Grids: three axes-aligned grids (ground XZ, XY at Z=0, YZ at X=0); grid ratio ties to voxel size, extents auto‑fit to content with padding.
- Axis arrows: X/Y/Z arrows scale to grid extents; brightness is user‑controlled.

Interaction Decisions
- Selection: set of selected space IDs; glow highlight layer with adjustable strength.
- Transform gizmos:
  - Rotation: X/Y/Z rings sized to the target’s bounds; supports multi‑select via a temporary group node; writes back to `space.rotation`.
  - Move: XZ‑plane drag disc aligned to camera view; translates selected spaces and writes back to `origin`.
- Database view: nested details for meta and spaces; double‑click to edit any value in place; changes persist, rebuild the scene, and keep detail sections open.
- DB navigation: clicking a space row centers camera, selects the space, and refreshes gizmos/halos.

Voxelization Decisions
- Purpose: start attaching baked voxel data to spaces for later mesh/logic operations without changing current visible geometry.
- Types: `VoxelType = { Rock:0, Empty:1, Wall:2 }`.
- Bake: `bakeHollowContainer(space, { wallThickness })` produces a hollow shell of `Wall` voxels and marks interior `Empty`.
- Fill: `fillAllVoxels(vox, value)` bulk‑overwrites the voxel grid (e.g., to all `Rock`).
- Storage: baked data is attached as `space.vox = { res, size, data, palette, bakedAt, source }`.
- Editor UI: Voxel tab allows baking hollow containers and filling selected spaces’ voxels. Operations persist to localStorage and reflect in DB view.
- Current scope: voxel data does not yet drive mesh generation in the scene; transforms remain allowed. Future work may lock transforms when `space.vox` exists and add a voxel mesh builder.

Persistence and Settings
- Barrow and history:
  - `dw:barrow:current` — current JSON of the barrow.
  - `dw:barrow:history` — most recent snapshots (up to 50).
- UI settings (non‑exhaustive):
  - `dw:ui:zoomBase`, `dw:ui:panBase`, `dw:ui:textScale`, `dw:ui:gridStrength`, `dw:ui:arrowStrength`, `dw:ui:glowStrength`.
  - Grid toggles: `dw:ui:gridGround`, `dw:ui:gridXY`, `dw:ui:gridYZ`; label toggle `dw:ui:showNames`.
  - Panel state/width: `dw:ui:panelCollapsed`, `dw:ui:panelWidth`.
  - Picking debug: `dw:debug:picking`.
  - Intersections mode: `dw:ui:exactCSG` (on triggers rebuild with CSG).

Logging and Error Reporting
- In‑app `Log` tab aggregates class‑tagged logs in real time with simple class filters.
- Optional local receiver: `dev/error-reporter.mjs` listens on `http://localhost:6060/log` and appends lines to `.assistant.log`.
  - Enable sending from the app by setting `localStorage['dw:dev:sendErrors'] = '1'`.

How to Run
- Open `app/index.html` in a modern browser. Internet access is required for Babylon.js CDN assets.
- Optional: run the error receiver with `node dev/error-reporter.mjs` and enable sending as above.

Roadmap (near‑term)
- Generate renderable meshes from `space.vox` and add a toggle between analytic (box/sphere) and voxel views.
- Lock or warn on transforms for spaces with baked voxels to avoid divergence.
- Save/load `.json` export/import including `space.vox` payloads.
- Snap transform moves to voxel grid increments when desired.
