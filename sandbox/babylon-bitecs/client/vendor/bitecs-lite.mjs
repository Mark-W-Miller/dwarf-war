// Minimal bitecs-like shim for browser, no build/server required.
// Implements just enough for the demo: Types, defineComponent, createWorld,
// addEntity, addComponent, defineQuery.

export const Types = {
  f32: 'f32', ui16: 'ui16', ui32: 'ui32'
};

export function defineComponent(schema = {}) {
  const comp = { __schema: schema };
  for (const key of Object.keys(schema)) comp[key] = [];
  // allow tag components
  comp.__isTag = Object.keys(schema).length === 0;
  return comp;
}

export function createWorld() {
  return {
    __nextEid: 1,
    __entities: new Set(),
    __compSets: new Map(), // component -> Set<eid>
  };
}

export function addEntity(world) {
  const eid = world.__nextEid++;
  world.__entities.add(eid);
  return eid;
}

export function addComponent(world, component, eid) {
  if (!world.__compSets.has(component)) world.__compSets.set(component, new Set());
  world.__compSets.get(component).add(eid);
  // ensure arrays exist for structured components
  if (!component.__isTag) {
    for (const key of Object.keys(component.__schema)) {
      const arr = component[key];
      if (arr[eid] === undefined) arr[eid] = 0;
    }
  }
}

export function defineQuery(components) {
  return function query(world) {
    if (components.length === 0) return [];
    const sets = components.map(c => world.__compSets.get(c) || new Set());
    // intersect starting from smallest set for perf
    sets.sort((a,b) => a.size - b.size);
    const smallest = sets[0];
    const result = [];
    for (const eid of smallest) {
      let ok = true;
      for (let i=1; i<sets.length; i++) if (!sets[i].has(eid)) { ok = false; break; }
      if (ok) result.push(eid);
    }
    return result;
  };
}

