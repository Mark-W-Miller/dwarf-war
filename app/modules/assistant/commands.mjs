import { makeDefaultBarrow, layoutBarrow } from '../barrow/schema.mjs';

function slugId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function findCavern(barrow, token) {
  if (!token) return null;
  const t = token.trim();
  const byId = new Map(barrow.caverns.map(c => [c.id, c]));
  if (byId.has(t)) return byId.get(t);
  const byName = barrow.caverns.find(c => (c.name||'').toLowerCase() === t.toLowerCase());
  return byName || null;
}

function ensureCavern(barrow, nameOrId) {
  const existing = findCavern(barrow, nameOrId);
  if (existing) return existing;
  const id = slugId(nameOrId);
  const c = { id, name: nameOrId, size: 'medium', pos: null };
  barrow.caverns.push(c);
  return c;
}

export function executeCommands(barrow, commands) {
  const out = { barrow: structuredClone(barrow), messages: [] };
  const b = out.barrow;

  for (const cmd of commands) {
    const type = cmd?.type;
    if (!type) continue;
    switch (type) {
      case 'createBarrow': {
        const name = cmd.name || `barrow-${Date.now()}`;
        const fresh = makeDefaultBarrow();
        fresh.id = name;
        out.barrow = fresh;
        out.messages.push(`Created new barrow '${name}'.`);
        break;
      }
      case 'renameBarrow': {
        const name = cmd.name?.trim(); if (!name) { out.messages.push('Rename failed: missing name'); break; }
        b.id = name; out.messages.push(`Renamed barrow to '${name}'.`);
        break;
      }
      case 'addCavern': {
        const name = cmd.name?.trim(); if (!name) { out.messages.push('Add cavern failed: missing name'); break; }
        const cav = ensureCavern(b, name);
        if (cmd.role === 'central') cav.role = 'central';
        if (cmd.size) cav.size = cmd.size;
        if (cmd.tags && Array.isArray(cmd.tags)) cav.tags = [...new Set([...(cav.tags||[]), ...cmd.tags])];
        // Optional link/anchor
        if (cmd.anchor && cmd.direction) {
          const anchor = ensureCavern(b, cmd.anchor);
          b.links.push({ from: anchor.id, to: cav.id, direction: cmd.direction, type: 'tunnel' });
        }
        out.messages.push(`Added cavern '${cav.name}' (${cav.id}).`);
        break;
      }
      case 'renameCavern': {
        const from = findCavern(b, cmd.from);
        if (!from) { out.messages.push(`Rename cavern failed: '${cmd.from}' not found`); break; }
        from.name = cmd.to; out.messages.push(`Renamed cavern '${cmd.from}' to '${cmd.to}'.`);
        break;
      }
      case 'addLink': {
        const a = ensureCavern(b, cmd.from);
        const c = ensureCavern(b, cmd.to);
        b.links.push({ from: a.id, to: c.id, direction: cmd.direction, type: cmd.linkType || 'tunnel' });
        out.messages.push(`Linked '${a.id}' -> '${c.id}' (${cmd.direction||'?'})`);
        break;
      }
      case 'addCarddon': {
        b.carddons = Array.isArray(b.carddons) ? b.carddons : [];
        const name = cmd.name?.trim(); if (!name) { out.messages.push('Add carddon failed: missing name'); break; }
        const id = slugId(name);
        const existing = b.carddons.find(x => x.id === id || (x.name||'').toLowerCase() === name.toLowerCase());
        if (existing) { out.messages.push(`Carddon '${name}' already exists.`); break; }
        const cd = { id, name, cavernId: null };
        if (cmd.cavern) {
          const target = findCavern(b, cmd.cavern);
          if (target) cd.cavernId = target.id;
        }
        b.carddons.push(cd);
        out.messages.push(`Added carddon '${name}'${cd.cavernId?` in '${cd.cavernId}'`:''}.`);
        break;
      }
      case 'renameCarddon': {
        b.carddons = Array.isArray(b.carddons) ? b.carddons : [];
        const from = b.carddons.find(x => x.id === slugId(cmd.from) || (x.name||'').toLowerCase() === String(cmd.from).toLowerCase());
        if (!from) { out.messages.push(`Rename carddon failed: '${cmd.from}' not found`); break; }
        from.name = cmd.to; from.id = slugId(cmd.to);
        out.messages.push(`Renamed carddon '${cmd.from}' to '${cmd.to}'.`);
        break;
      }
      case 'listCaverns': {
        out.messages.push('Caverns: ' + b.caverns.map(c => `${c.id} (${c.name||c.id})`).join(', '));
        break;
      }
      case 'listCarddons': {
        const list = (b.carddons||[]).map(x => `${x.id} (${x.name})${x.cavernId?` @${x.cavernId}`:''}`).join(', ');
        out.messages.push('Carddons: ' + (list || '(none)'));
        break;
      }
      case 'showBarrow': {
        out.messages.push(JSON.stringify(b, null, 2));
        break;
      }
    }
  }

  layoutBarrow(out.barrow);
  return out;
}

