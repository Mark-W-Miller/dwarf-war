// Shadax (Shield & Axe) DSL parser -> command array

function slugId(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

export function parseShadaxToCommands(text) {
  const cmds = [];
  const lines = String(text||'').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  for (const line of lines) {
    let m;
    if ((m = line.match(/^BARROW\s+name\s+"([^"]+)"/i))) {
      cmds.push({ type: 'renameBarrow', name: m[1] });
      continue;
    }
    // CAVERN with NAME
    if ((m = line.match(/^CAVERN\s+([a-z0-9_-]+)\s+NAME\s+"([^"]+)"(.*)$/i))) {
      const id = m[1]; /* const name = m[2]; */ const tail = m[3] || '';
      const cmd = { type: 'addCavern', name: id, role: undefined, size: undefined };
      // role
      if (/\bROLE\s+central\b/i.test(tail)) cmd.role = 'central';
      // size
      const sm = tail.match(/\bSIZE\s+(small|medium|large)\b/i); if (sm) cmd.size = sm[1].toLowerCase();
      // AT DIR OF anchor
      const am = tail.match(/\bAT\s+(N|S|E|W|NE|NW|SE|SW|UP|DOWN)\b\s+OF\s+([a-z0-9_-]+)/i);
      if (am) { cmd.direction = am[1].toUpperCase(); cmd.anchor = am[2]; }
      cmds.push(cmd);
      continue;
    }
    // CAVERN without NAME (id-only)
    if ((m = line.match(/^CAVERN\s+([a-z0-9_-]+)(.*)$/i))) {
      const id = m[1]; const tail = m[2] || '';
      const cmd = { type: 'addCavern', name: id, role: undefined, size: undefined };
      if (/\bROLE\s+central\b/i.test(tail)) cmd.role = 'central';
      const sm = tail.match(/\bSIZE\s+(small|medium|large)\b/i); if (sm) cmd.size = sm[1].toLowerCase();
      const am = tail.match(/\bAT\s+(N|S|E|W|NE|NW|SE|SW|UP|DOWN)\b\s+OF\s+([a-z0-9_-]+)/i);
      if (am) { cmd.direction = am[1].toUpperCase(); cmd.anchor = am[2]; }
      cmds.push(cmd);
      continue;
    }
    if ((m = line.match(/^LINK\s+([a-z0-9_-]+)\s+([a-z0-9_-]+)(.*)$/i))) {
      const from = m[1], to = m[2], tail = m[3]||'';
      const dm = tail.match(/\bDIR\s+(N|S|E|W|NE|NW|SE|SW|UP|DOWN)\b/i);
      const tm = tail.match(/\bTYPE\s+(tunnel|door)\b/i);
      cmds.push({ type: 'addLink', from, to, direction: dm ? dm[1].toUpperCase() : undefined, linkType: tm ? tm[1] : undefined });
      continue;
    }
    if ((m = line.match(/^CARDDON\s+"([^"]+)"(.*)$/i))) {
      const name = m[1]; const tail = m[2]||''; const im = tail.match(/\bIN\s+([a-z0-9_-]+)/i);
      cmds.push({ type: 'addCarddon', name, cavern: im ? im[1] : undefined });
      continue;
    }
    if ((m = line.match(/^RENAME\s+CAVERN\s+([a-z0-9_-]+)\s+TO\s+([a-z0-9_-]+)/i))) {
      cmds.push({ type: 'renameCavern', from: m[1], to: m[2] });
      continue;
    }
    if ((m = line.match(/^RENAME\s+CARDDON\s+"([^"]+)"\s+TO\s+"([^"]+)"/i))) {
      cmds.push({ type: 'renameCarddon', from: m[1], to: m[2] });
      continue;
    }
    // Fallback: simple central declaration
    if ((m = line.match(/^([A-Za-z][A-Za-z0-9 _'-]*)\s+is\s+the\s+central\s+cavern/i))) {
      cmds.push({ type: 'addCavern', name: m[1].trim(), role: 'central' });
      continue;
    }
  }
  return cmds;
}
