// Lightweight ECS world: entities, components, systems

export class World {
  constructor() {
    this._nextId = 1;
    this.entities = new Set();
    this.components = new Map(); // Map<name, Map<entityId, data>>
    this.systems = [];
  }

  createEntity() {
    const id = this._nextId++;
    this.entities.add(id);
    return id;
  }

  destroyEntity(id) {
    this.entities.delete(id);
    for (const comp of this.components.values()) comp.delete(id);
  }

  addComponent(id, name, data) {
    if (!this.components.has(name)) this.components.set(name, new Map());
    this.components.get(name).set(id, data);
  }

  getComponent(id, name) {
    return this.components.get(name)?.get(id);
  }

  query(...names) {
    if (names.length === 0) return [];
    const maps = names.map((n) => this.components.get(n) || new Map());
    maps.sort((a, b) => a.size - b.size);
    const smallest = maps[0];
    const result = [];
    for (const id of smallest.keys()) {
      let ok = true;
      for (let i = 1; i < maps.length; i++) {
        if (!maps[i].has(id)) { ok = false; break; }
      }
      if (ok) result.push(id);
    }
    return result;
  }

  addSystem(systemFn) {
    this.systems.push(systemFn);
  }

  tick(dt) {
    for (const sys of this.systems) sys(this, dt);
  }
}

