// Very lightweight natural-language to instructions JSON parser
// Covers common patterns like:
// - "Dento is the central cavern, it is ornate, and it is connected to caverns north, south, east, and west."
// - "Connect Dento to caverns north and south."

const DIR_MAP = new Map([
  ['n','N'], ['north','N'],
  ['s','S'], ['south','S'],
  ['e','E'], ['east','E'],
  ['w','W'], ['west','W'],
  ['ne','NE'], ['northeast','NE'],
  ['nw','NW'], ['northwest','NW'],
  ['se','SE'], ['southeast','SE'],
  ['sw','SW'], ['southwest','SW'],
  ['up','UP'], ['u','UP'],
  ['down','DOWN'], ['d','DOWN'],
]);

function slugId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

function normalizeList(text) {
  // split on commas and ands
  return text
    .replace(/\band\b/gi, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function toDirection(token) {
  const t = token.trim().toLowerCase();
  return DIR_MAP.get(t) || null;
}

export function parseInstructions(input) {
  const src = input.trim();
  if (!src) return { caverns: [], links: [], meta: { notes: 'empty input' } };

  // If it looks like JSON already, just parse and return
  if (src[0] === '{' || src[0] === '[') {
    try { return JSON.parse(src); } catch (_) { /* fallthrough to NL */ }
  }

  const sentences = src
    .replace(/[\n\r]+/g, ' ')
    .split(/[\.!?]+\s*/)
    .map(s => s.trim())
    .filter(Boolean);

  const caverns = new Map(); // id -> cavern
  const links = [];
  let central = null;
  let lastCavern = null;

  function ensureCavern(nameOrId, props = {}) {
    const id = props.id || slugId(nameOrId);
    if (!caverns.has(id)) caverns.set(id, { id, name: nameOrId, ...props });
    else Object.assign(caverns.get(id), props);
    return caverns.get(id);
  }

  function connect(fromId, toId, direction) {
    if (!fromId || !toId) return;
    links.push({ from: fromId, to: toId, direction: direction || undefined, type: 'tunnel' });
  }

  for (const s of sentences) {
    const text = s.trim();
    if (!text) continue;

    // 1) "X is the central cavern" (with optional attributes)
    let m = text.match(/^([A-Z][A-Za-z0-9 _'-]*)\s+is\s+(?:the\s+)?central\s+cavern/i);
    if (m) {
      const name = m[1].trim();
      const c = ensureCavern(name, { role: 'central' });
      central = c.id; lastCavern = c.id; continue;
    }

    // 2) Attributes for last cavern: "it is ornate" or "Dento is ornate"; size small/medium/large
    m = text.match(/^(it|[A-Z][A-Za-z0-9 _'-]*)\s+is\s+(?:an?\s+)?(ornate|rough|plain|small|medium|large)\b/i);
    if (m) {
      const nameOrIt = m[1];
      const attr = m[2].toLowerCase();
      const targetId = nameOrIt.toLowerCase() === 'it' ? lastCavern : ensureCavern(nameOrIt).id;
      if (targetId) {
        const cv = caverns.get(targetId);
        if (attr === 'small' || attr === 'medium' || attr === 'large') cv.size = attr;
        else {
          cv.tags = Array.isArray(cv.tags) ? cv.tags : [];
          if (!cv.tags.includes(attr)) cv.tags.push(attr);
        }
        lastCavern = targetId;
      }
      continue;
    }

    // 3) Connectivity: "connected to caverns north, south, east and west"
    m = text.match(/(connected\s+to|connect(?:ed)?(?:\s+to)?)\s+(?:caverns?\s+)?(.+)/i);
    if (m) {
      // Resolve subject: explicit X ... connected to ... OR default to central/lastCavern
      let subjectMatch = text.match(/^([A-Z][A-Za-z0-9 _'-]*)\s+.*connected\s+to/i);
      const subjectId = subjectMatch ? ensureCavern(subjectMatch[1]).id : (lastCavern || central);
      const parts = normalizeList(m[2]);
      const dirs = [];
      for (const p of parts) {
        const d = toDirection(p);
        if (d) dirs.push(d);
      }
      // For each direction, create/ensure a cavern like cavern-n and link
      for (const d of dirs) {
        const targetId = `cavern-${d.toLowerCase()}`;
        ensureCavern(targetId, { id: targetId, name: `${d} Cavern` });
        connect(subjectId, targetId, d);
      }
      continue;
    }

    // 4) Explicit link: "connect X to Y (north)"
    m = text.match(/^connect\s+([A-Z][A-Za-z0-9 _'-]*)\s+to\s+([A-Z][A-Za-z0-9 _'-]*)(?:\s*\(([^)]+)\))?/i);
    if (m) {
      const a = ensureCavern(m[1]).id;
      const b = ensureCavern(m[2]).id;
      const dir = m[3] ? toDirection(m[3]) : undefined;
      connect(a, b, dir);
      lastCavern = b;
      continue;
    }
  }

  // If nothing declared central but at least one cavern exists, choose the first
  if (!central && caverns.size > 0) {
    const first = caverns.values().next().value; first.role = first.role || 'central'; central = first.id;
  }

  return {
    caverns: Array.from(caverns.values()),
    links,
    meta: { parsed: true, source: 'nlParser' },
  };
}

// Parse imperative editor commands for direct execution
export function parseCommands(input) {
  const src = input.trim();
  const commands = [];
  if (!src) return commands;
  const text = src.replace(/[\n\r]+/g, ' ').trim();

  // Create new barrow [named X]
  let m = text.match(/^create\s+(?:a\s+)?new\s+barrow(?:\s+(?:named|called|as)\s+([^.!?]+))?/i);
  if (m) { commands.push({ type: 'createBarrow', name: m[1]?.trim() }); return commands; }

  // Rename current barrow to X
  m = text.match(/^rename\s+(?:current\s+)?barrow\s+(?:to\s+)?([^.!?]+)$/i);
  if (m) { commands.push({ type: 'renameBarrow', name: m[1].trim() }); return commands; }

  // Add cavern Foo [as central] [size small|medium|large] [(at|north|south|...) of <anchor>]
  m = text.match(/^add\s+cavern\s+([A-Z][A-Za-z0-9 _'-]*)(?:\s+as\s+(central))?(?:\s+size\s+(small|medium|large))?(?:\s+(north|south|east|west|ne|nw|se|sw|up|down)\s+of\s+([A-Z][A-Za-z0-9 _'-]*))?/i);
  if (m) {
    const dirToken = m[4]?.toLowerCase();
    const dir = dirToken ? (DIR_MAP.get(dirToken) || dirToken.toUpperCase()) : undefined;
    commands.push({ type: 'addCavern', name: m[1].trim(), role: m[2]? 'central': undefined, size: m[3], direction: dir, anchor: m[5] });
    return commands;
  }

  // Rename cavern A to B
  m = text.match(/^rename\s+cavern\s+([^\s].*?)\s+to\s+([^.!?]+)$/i);
  if (m) { commands.push({ type: 'renameCavern', from: m[1].trim(), to: m[2].trim() }); return commands; }

  // Add link A to B (north)
  m = text.match(/^add\s+link\s+([^\s].*?)\s+to\s+([^\s].*?)(?:\s*\(([^)]+)\))?$/i);
  if (m) { commands.push({ type: 'addLink', from: m[1].trim(), to: m[2].trim(), direction: m[3]?.toUpperCase() }); return commands; }

  // Add carddon X [to cavern Y]
  m = text.match(/^add\s+carddon\s+([^.!?]+?)(?:\s+to\s+cavern\s+([^.!?]+))?$/i);
  if (m) { commands.push({ type: 'addCarddon', name: m[1].trim(), cavern: m[2]?.trim() }); return commands; }

  // Rename carddon A to B
  m = text.match(/^rename\s+carddon\s+([^\s].*?)\s+to\s+([^.!?]+)$/i);
  if (m) { commands.push({ type: 'renameCarddon', from: m[1].trim(), to: m[2].trim() }); return commands; }

  // List caverns / carddons / show barrow
  if (/^list\s+caverns?$/i.test(text)) { commands.push({ type: 'listCaverns' }); return commands; }
  if (/^list\s+carddons?$/i.test(text)) { commands.push({ type: 'listCarddons' }); return commands; }
  if (/^(show|print|dump)\s+barrow$/i.test(text)) { commands.push({ type: 'showBarrow' }); return commands; }

  return commands;
}
