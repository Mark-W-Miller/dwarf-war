# View Layer Coding Standards

These guidelines apply to all code under `app/modules`.

- **No try/catch blocks.** All exceptions must propagate to the top-level error handlers. Guard operations with explicit condition checks when needed.
- **DO NOT Prefer explicit guards.** Test for null/undefined, feature support, and other preconditions instead should rely on runtime errors.
- **Fail fast.** When an operation cannot proceed, return early with a clear condition rather than attempting partial work.
- **Keep logging minimal.** Only log deliberate state changes or domain events. Do not log within defensive wrappers that replace exception handling.
- **Deterministic cleanup.** When side-effects need undoing, structure code so cleanup runs as ordinary control flow, not within finally blocks.
- **Event handlers should be pure.** Limit side-effects to the intended DOM or Babylon interactions and avoid swallowing internal errors.
- **Consistency.** Maintain existing formatting, naming, and module patterns when modifying or adding code.

Future contributions to the view layer should follow these rules so unexpected errors remain visible and debuggable via the global stack traces.
